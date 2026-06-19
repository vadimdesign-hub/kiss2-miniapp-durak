import { FlutterRoute, useBridgeFetch, useFlutterBridge, useOpenRoute, useSignalReady } from "@playneta/flutter-js-bridge";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router";
import { API_BASE_URL } from "~/config";
import { getTranslations } from "~/i18n/translations";
import { getFakePlayer } from "~/lib/fake-players";
import { GameResultSheet } from "~/components/game-result-sheet";
import { playBotCardFly, playCardBeat, playCardPlay, playCardSweep, playCrystalDebit, playCrystalPing, playTableFlyMe, playTableFlyOpp } from "~/lib/sounds";
import { CrystalIcon } from "~/components/crystal-icon";
import { mmClient } from "~/lib/mm-client";
import { useGameSession } from "~/hooks/use-game-session";
import { logEvent } from "~/lib/logger";
import { useMyUserId } from "~/hooks/use-my-user-id";
import { useOpponentProfile } from "~/hooks/use-opponent-profile";
import { a } from "~/utils/asset-url";

interface Card { rank: string; suit: string; }
interface TableSlot { attack: Card; defense?: Card; }

type DurakAction =
	| { action: "attack"; card: Card }
	| { action: "defend"; card: Card; targetIdx: number }
	| { action: "take" }
	| { action: "pass" }
	| { action: "add"; card: Card };

interface LocationState { myMark?: "X" | "O"; myUserId?: string; vsBot?: boolean; starterUserId?: string; opponentUserId?: string; stake?: number; waitSeconds?: number; }

const SUITS = ["♠", "♥", "♦", "♣"];
const RANKS = ["6", "7", "8", "9", "10", "J", "Q", "K", "A"];

const SUIT_FILE: Record<string, string> = { "♠": "s", "♥": "h", "♦": "d", "♣": "c" };
const RANK_FILE: Record<string, string> = { "J": "j", "Q": "q", "K": "k", "A": "a" };

// CIS countries and Russian-speaking locales use the localised RU card art.
// All other languages get the international (_int) art for J, Q, A.
// King (K) is the same illustration for everyone.
const CIS_LANGS = ["ru", "kk", "uk", "be", "uz", "ky", "tg", "az", "hy", "ka"];
function isRuLang(lang: string): boolean {
	return CIS_LANGS.some((l) => lang.startsWith(l));
}
const INT_RANKS = new Set(["j", "q", "a"]);

function makeCardImg(lang: string) {
	return (card: Card): string => {
		const s = SUIT_FILE[card.suit] ?? "s";
		const r = RANK_FILE[card.rank] ?? card.rank;
		const useInt = !isRuLang(lang) && INT_RANKS.has(r);
		return a(`/durak/card_${s}${r}${useInt ? "_int" : ""}.png`);
	};
}
const CARD_BACK = a("/durak/card_back.png");
const TABLE_BG = a("/durak/bg.png");
const CHAIR_IMG = a("/durak/chair.png");

function SUIT_COLOR(suit: string) { return suit === "♥" || suit === "♦" ? "text-red-500" : "text-white"; }

// Default (RU) card image fn — used as fallback when imgFn not passed to CardImage
const defaultCardImg = makeCardImg("ru");

interface CardImgProps {
	card: Card;
	selected?: boolean;
	highlighted?: boolean;
	faded?: boolean;
	className?: string;
	style?: React.CSSProperties;
	imgFn?: (card: Card) => string;
}
function CardImage({ card, selected, highlighted, faded, className = "", style, imgFn = defaultCardImg }: CardImgProps) {
	return (
		<img
			src={imgFn(card)}
			alt={`${card.rank}${card.suit}`}
			className={`rounded-lg object-cover select-none ${
				selected ? "ring-2 ring-yellow-400 shadow-lg shadow-yellow-400/30" :
				highlighted ? "ring-2 ring-emerald-400/60" : ""
			} ${faded ? "opacity-40" : ""} ${className}`}
			style={style}
		/>
	);
}
const RANK_VALUES: Record<string, number> = Object.fromEntries(RANKS.map((r, i) => [r, i]));

const DURAK_RULES = [
	{ text: "Цель — избавиться от всех карт. Последний с картами на руках — Дурак." },
	{ text: "Защитник бьёт атаку картой той же масти старшего достоинства или козырем." },
	{ text: "Не можешь отбиться — «Взять». Все отбито — атакующий жмёт «Пас», роли меняются." },
	{ text: "После раунда оба добирают карты из колоды до 6 штук." },
];

function makeDeck(): Card[] {
	return SUITS.flatMap((suit) => RANKS.map((rank) => ({ rank, suit })));
}

function mulberry32(seed: number) {
	return () => {
		seed = (seed + 0x6d2b79f5) | 0;
		let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

function seededShuffle<T>(arr: T[], seedStr: string): T[] {
	const n = seedStr.split("").reduce((a, c, i) => a + c.charCodeAt(0) * (i + 1), 0);
	const rng = mulberry32(n);
	const shuffled = [...arr];
	for (let i = shuffled.length - 1; i > 0; i--) {
		const j = Math.floor(rng() * (i + 1));
		[shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
	}
	return shuffled;
}

function canBeat(attack: Card, defense: Card, trump: string): boolean {
	if (defense.suit === attack.suit && RANK_VALUES[defense.rank] > RANK_VALUES[attack.rank]) return true;
	if (defense.suit === trump && attack.suit !== trump) return true;
	return false;
}

function cardKey(c: Card): string { return `${c.rank}${c.suit}`; }
function cardEqual(a: Card, b: Card): boolean { return a.rank === b.rank && a.suit === b.suit; }
function removeCard(hand: Card[], card: Card): Card[] {
	const idx = hand.findIndex((c) => cardEqual(c, card));
	return idx === -1 ? hand : [...hand.slice(0, idx), ...hand.slice(idx + 1)];
}

function DurakGame() {
	const { sessionId } = useParams<{ sessionId: string }>();
	const navigate = useNavigate();
	const location = useLocation();
	const locationState = (location.state ?? {}) as LocationState;
	const signalReady = useSignalReady();
	const openRoute = useOpenRoute();
	const { state: bridgeState } = useFlutterBridge();
	const lang = bridgeState.headers?.["Accept-Language"] ?? "en";
	const t = useMemo(() => getTranslations(lang), [lang]);
	// cardImg picks RU or international art based on user language
	const cardImg = useMemo(() => makeCardImg(lang), [lang]);

	const realUserId = useMyUserId();
	const myUserId = realUserId ?? locationState.myUserId ?? mmClient.getMyUserId();
	const myMark: "X" | "O" = locationState.starterUserId && myUserId
		? (myUserId === locationState.starterUserId ? "X" : "O")
		: (locationState.myMark ?? "X");
	// vsBot is mutable: starts from location state, can be toggled to true via "Play bot" button
	const [vsBot, setVsBot] = useState<boolean>(locationState.vsBot ?? false);

	// Game stat tracking refs — use refs (not state) to avoid re-renders.
	const gameStartRef = useRef<number>(Date.now());
	const takesRef = useRef(0);
	const defendsRef = useRef(0);
	const attacksRef = useRef(0);
	const movesRef = useRef(0);

	// Waiting for a real opponent? Only true for multiplayer games that haven't had any opponent activity yet.
	// opponentJoined defaults to TRUE for real MP sessions because /match.tsx
	// only navigates here once the server confirms the match. The earlier
	// 'Ожидаем игрока…' overlay was redundant — it duplicates the search UI
	// the user just finished. We still flip it via useGameSession callbacks
	// in case the server tells us otherwise.
	const [opponentJoined, setOpponentJoined] = useState<boolean>(true);
	const fakePlayer = useMemo(() => vsBot ? getFakePlayer(`durak-${sessionId ?? "demo"}`) : null, [vsBot, sessionId]);
	// For multiplayer games, pull the opponent's real avatar + nickname from the platform.
	const oppProfile = useOpponentProfile(!vsBot ? locationState.opponentUserId : null);

	const { myHand: initialHand, initialBotHand, deck: initialDeck, trump, trumpCard } = useMemo(() => {
		const shuffled = seededShuffle(makeDeck(), sessionId ?? "demo");
		return {
			myHand: myMark === "X" ? shuffled.slice(0, 6) : shuffled.slice(6, 12),
			initialBotHand: myMark === "X" ? shuffled.slice(6, 12) : shuffled.slice(0, 6),
			deck: shuffled.slice(12, 35),
			trump: shuffled[35].suit,
			trumpCard: shuffled[35],
		};
	}, [sessionId, myMark]);

	// Start with empty hands — the initial deal animation flies cards from the deck
	// and only after the animation completes do we actually populate the hands.
	const [myHand, setMyHand] = useState<Card[]>([]);
	const [botHand, setBotHand] = useState<Card[]>([]);
	const [oppHandCount, setOppHandCount] = useState(0);
	const [deckCards, setDeckCards] = useState<Card[]>(initialDeck);
	const [tableSlots, setTableSlots] = useState<TableSlot[]>([]);
	const [tableFlyDir, setTableFlyDir] = useState<"opp" | "me" | "left" | null>(null);
	const [botCardFlying, setBotCardFlying] = useState(false);
	const [isAttacker, setIsAttacker] = useState(myMark === "X");
	const [gameOver, setGameOver] = useState<"win" | "lose" | null>(null);
	// gameOverCoinsMP / gameOverCoinsBot — removed with crystals.
	// True while a round's fly-off animation is running; blocks bot and UI so roles don't swap on stale state.
	const [transitioning, setTransitioning] = useState(false);

	// Crystals removed from the product. Stub kept inline so call sites
	// can remain untouched; it does nothing visible.
	const addCrystals = (_delta: number) => { void _delta; };
	// Draw animation: flying card-backs from the deck to a target hand.
	const [flyingDraws, setFlyingDraws] = useState<Array<{ key: string; to: "me" | "opp"; delay: number }>>([]);
	const triggerDrawAnim = (myCount: number, oppCount: number) => {
		if (myCount === 0 && oppCount === 0) return;
		const now = Date.now();
		const flying: Array<{ key: string; to: "me" | "opp"; delay: number }> = [];
		for (let i = 0; i < myCount; i++)  flying.push({ key: `m-${now}-${i}`, to: "me",  delay: i * 80 });
		for (let i = 0; i < oppCount; i++) flying.push({ key: `o-${now}-${i}`, to: "opp", delay: (myCount + i) * 80 });
		setFlyingDraws(flying);
		flying.forEach(({ delay }) => setTimeout(() => playBotCardFly(), delay));
		setTimeout(() => setFlyingDraws([]), 600 + flying.length * 80);
	};
	const bridgeFetch = useBridgeFetch();
	const resultRecorded = useRef(false);
	// Holds the in-flight game-result POST so we can await it before navigating.
	const resultFetchRef = useRef<Promise<void> | null>(null);

	// Stake from matchmaking lobby (0 for bot games)
	const stake = locationState.stake ?? 0;

	// Record game result. Stores the fetch promise so navigation can wait for
	// the wallet to settle before the lobby re-fetches the balance.
	// Fire game-completion analytics (natural finish, no early exit)
	const fireGameCompleteAnalytics = useCallback((leftEarly?: boolean) => {
		if (leftEarly) return; // early exits not counted as "completed"
		const entity = vsBot ? "botGameCompleted" : "pvpGameCompleted";
		bridgeFetch(`${API_BASE_URL}/api/v1/analyticsEvent`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ entity, gameType: "durak", vsBot }),
		}).catch(() => {});
	}, [bridgeFetch, vsBot]);

	const recordResult = useCallback((result: "win" | "lose", leftEarly?: boolean) => {
		if (resultRecorded.current) return;
		resultRecorded.current = true;
		fireGameCompleteAnalytics(leftEarly);
		const durationSeconds = Math.round((Date.now() - gameStartRef.current) / 1000);
		resultFetchRef.current = bridgeFetch(`${API_BASE_URL}/api/v1/gameResult`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				gameType: "durak",
				result,
				stake: stake > 0 ? stake : undefined,
				sessionId: !vsBot && sessionId && !sessionId.startsWith("bot-") ? sessionId : undefined,
				durationSeconds,
				trump,
				firstMover: myMark === "X" ? "me" : "opp",
				...(leftEarly && { leftEarly: true }),
				...(locationState.waitSeconds !== undefined && { waitSeconds: locationState.waitSeconds }),
				...(takesRef.current > 0 && { cardsTaken: takesRef.current }),
				...(defendsRef.current > 0 && { cardsDefended: defendsRef.current }),
				...(attacksRef.current > 0 && { attacksMade: attacksRef.current }),
				...(movesRef.current > 0 && { totalMoves: movesRef.current }),
			}),
		}).then(() => { resultFetchRef.current = null; }).catch(() => { resultFetchRef.current = null; });
	}, [bridgeFetch, vsBot, sessionId, stake, trump, myMark, locationState.waitSeconds]);

	// Fire-and-forget analytics for result screen button clicks
	// Navigate to lobby only after the game-result POST resolves (or after 4s
	// timeout) so the wallet balance has settled before CoinBalancePill refetches.
	const navigateToLobby = useCallback(async () => {
		if (resultFetchRef.current) {
			await Promise.race([
				resultFetchRef.current,
				new Promise<void>((resolve) => setTimeout(resolve, 4000)),
			]);
		}
		navigate("/match/durak", { replace: true });
	}, [navigate]);

	// "Играть ещё" — skip the lobby and go straight to searching
	const navigateToSearch = useCallback(async () => {
		if (resultFetchRef.current) {
			await Promise.race([
				resultFetchRef.current,
				new Promise<void>((resolve) => setTimeout(resolve, 4000)),
			]);
		}
		navigate("/match/durak", { replace: true, state: { autoPlay: true, lastStake: stake } });
	}, [navigate, stake]);

	useEffect(() => {
		if (!gameOver) return;
		recordResult(gameOver === "win" ? "win" : "lose");
	}, [gameOver, recordResult]);
	const [opponentDisconnected, setOpponentDisconnected] = useState(false);
	const [botThinking, setBotThinking] = useState(false);
	const [phase, setPhase] = useState<"attacking" | "defending" | "waiting">(
		myMark === "X" ? "attacking" : "defending",
	);

	const isMyTurn = phase !== "waiting" && !gameOver && opponentJoined && !transitioning;

	// ── 15-second turn timer (MP only) ──────────────────────────────────────
	// Each turn starts with 15 seconds. Whoever's turn ends with the clock at
	// 0 loses (auto-resign). Each client tracks its OWN timer based on
	// `phase` — when `phase` changes (turn flipped), reset to 15.
	const TURN_LIMIT_SEC = 30;
	const [turnSecondsLeft, setTurnSecondsLeft] = useState(TURN_LIMIT_SEC);
	useEffect(() => {
		if (gameOver || !opponentJoined) return;
		setTurnSecondsLeft(TURN_LIMIT_SEC);
		const id = setInterval(() => {
			setTurnSecondsLeft((s) => {
				if (s <= 1) {
					clearInterval(id);
					if (phase !== "waiting") {
						if (vsBot) {
							// Bot mode: timer expired = instant loss
							setGameOver("lose");
						} else if (sessionId) {
							// MP: auto-resign; server marks the session finished
							mmClient.resign(sessionId).catch(() => {});
						}
					}
					return 0;
				}
				return s - 1;
			});
		}, 1000);
		return () => clearInterval(id);
	}, [phase, gameOver, opponentJoined, vsBot, sessionId]);

	// Keep a ref with latest game state so the bot timer closure reads fresh values.
	// CRITICAL: oppHandCount MUST be included — take/pass setTimeout closures
	// read it for refill math, and stale closure values cause both clients to
	// draw a different number of cards from the deck → permanent state
	// divergence visible as different deck/hand counts on the two screens.
	const gameStateRef = useRef({ tableSlots, botHand, myHand, deckCards, isAttacker, trump, oppHandCount });
	useEffect(() => {
		gameStateRef.current = { tableSlots, botHand, myHand, deckCards, isAttacker, trump, oppHandCount };
	});

	useEffect(() => { signalReady(); }, [signalReady]);

	// ── Initial deal: hands start empty, cards fly out of the deck, then populate. ──
	const initialDealTriggered = useRef(false);
	useEffect(() => {
		if (initialDealTriggered.current) return;
		if (!opponentJoined) return;
		// MP mode: server is the source of truth and will populate hands
		// via onState. Running the local deal animation here would APPEND
		// cards on top of whatever the server sync set, doubling them
		// (the bug where hands showed 12+ cards instead of 6).
		// Bot mode still uses the local deal since there's no server.
		if (!vsBot) {
			initialDealTriggered.current = true;
			return;
		}
		initialDealTriggered.current = true;

		// Queue 12 flying card-backs — alternating me/opp like a real dealer.
		const flying: Array<{ key: string; to: "me" | "opp"; delay: number }> = [];
		const now = Date.now();
		const stepMs = 90;
		for (let i = 0; i < 6; i++) {
			flying.push({ key: `init-m-${now}-${i}`, to: "me",  delay: (i * 2)     * stepMs });
			flying.push({ key: `init-o-${now}-${i}`, to: "opp", delay: (i * 2 + 1) * stepMs });
		}
		setFlyingDraws(flying);
		flying.forEach(({ delay }) => setTimeout(() => playBotCardFly(), delay));
		setTransitioning(true); // block bot + UI during the deal

		// As each card "lands", materialize it in the corresponding hand.
		// Card lands roughly when its animation ends: delay + 0.55s animation duration.
		const LAND_MS = 550;
		for (let i = 0; i < 6; i++) {
			const myDelay  = (i * 2)     * stepMs + LAND_MS;
			const oppDelay = (i * 2 + 1) * stepMs + LAND_MS;
			setTimeout(() => {
				setMyHand((h) => [...h, initialHand[i]]);
			}, myDelay);
			setTimeout(() => {
				setBotHand((h) => [...h, initialBotHand[i]]);
				setOppHandCount((c) => c + 1);
			}, oppDelay);
		}

		// Clear flying-draws DOM + unlock bot/UI after everything landed.
		const totalMs = 12 * stepMs + LAND_MS + 200;
		setTimeout(() => {
			setFlyingDraws([]);
			setTransitioning(false);
		}, totalMs);
	// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [opponentJoined]);

	// Bot logic — fires when phase==="waiting" (bot's turn to act)
	useEffect(() => {
		if (!vsBot || phase !== "waiting" || gameOver || botThinking || transitioning) return;
		setBotThinking(true);

		const timer = setTimeout(() => {
			setBotThinking(false);
			const { tableSlots: ts, botHand: bh, myHand: mh, deckCards: dc, isAttacker: ia } = gameStateRef.current;
			// isAttacker = true means I attacked, so bot defends; false means bot attacks
			const botIsAttacker = !ia;

			if (botIsAttacker) {
				const allDefended = ts.length > 0 && ts.every((s) => s.defense);
				if (allDefended) {
					// Check if bot can throw more cards (ranks matching table, defender still has cards)
					const tableRanks = new Set(ts.flatMap((s) => [s.attack.rank, s.defense?.rank].filter(Boolean) as string[]));
					const canAdd = bh.filter((c) => tableRanks.has(c.rank));
					const maxAdd = Math.min(mh.length, 6 - ts.length); // can't exceed defender's hand or 6 total
					if (canAdd.length > 0 && maxAdd > 0) {
						// Throw one more card (non-trump preferred, lowest rank)
						const nonTrumpAdd = canAdd.filter((c) => c.suit !== trump).sort((a, b) => RANK_VALUES[a.rank] - RANK_VALUES[b.rank]);
						const trumpAdd = canAdd.filter((c) => c.suit === trump).sort((a, b) => RANK_VALUES[a.rank] - RANK_VALUES[b.rank]);
						const chosen = nonTrumpAdd[0] ?? trumpAdd[0];
						const newBotHand = removeCard(bh, chosen);
						setBotHand(newBotHand);
						setOppHandCount(newBotHand.length);
						setBotCardFlying(true);
						playBotCardFly();
						setTimeout(() => {
							setBotCardFlying(false);
							setTableSlots((prev) => [...prev, { attack: chosen }]);
							setPhase("defending");
						}, 440);
						return;
					}
					// Bot (attacker) passes — player (defender) becomes new attacker
					// Bot draws first (was attacker), then player
					const botNeed = Math.max(0, 6 - bh.length);
					const botDraw = dc.slice(0, botNeed);
					const deck2 = dc.slice(botDraw.length);
					const myNeed = Math.max(0, 6 - mh.length);
					const myDraw = deck2.slice(0, myNeed);
					const newBotHand = [...bh, ...botDraw];
					const newMyHand = [...mh, ...myDraw];
					const newDeck = deck2.slice(myDraw.length);
					setBotHand(newBotHand);
					setOppHandCount(newBotHand.length);
					setMyHand(newMyHand);
					setDeckCards(newDeck);
					setTableSlots([]);
					setIsAttacker(true);
					setPhase("attacking");
					// Animate only as many cards as actually drawn from the deck
					triggerDrawAnim(myDraw.length, botDraw.length);
					return;
				}
				// Attack with lowest valid card
				const tableRanks = new Set(ts.flatMap((s) => [s.attack.rank, s.defense?.rank].filter(Boolean) as string[]));
				const playable = bh.filter((c) => ts.length === 0 || tableRanks.has(c.rank));
				const nonTrump = playable.filter((c) => c.suit !== trump).sort((a, b) => RANK_VALUES[a.rank] - RANK_VALUES[b.rank]);
				const trumpCards = playable.filter((c) => c.suit === trump).sort((a, b) => RANK_VALUES[a.rank] - RANK_VALUES[b.rank]);
				const chosen = nonTrump[0] ?? trumpCards[0];
				if (chosen) {
					const newBotHand = removeCard(bh, chosen);
					setBotHand(newBotHand);
					setOppHandCount(newBotHand.length);
					setBotCardFlying(true);
					playBotCardFly();
					setTimeout(() => {
						setBotCardFlying(false);
						setTableSlots((prev) => [...prev, { attack: chosen }]);
						setPhase("defending");
					}, 440);
				} else {
					// No cards to play — pass
					setBotHand(bh);
					setTableSlots([]);
					setIsAttacker(false);
					setPhase("defending");
				}
			} else {
				// Bot defends
				const undefended = ts.findIndex((s) => !s.defense);
				if (undefended === -1) {
					// All defended — pass: me draws first (attacker), then bot
					const myNeed = Math.max(0, 6 - mh.length);
					const newMyHand = [...mh, ...dc.slice(0, myNeed)];
					const deck2 = dc.slice(myNeed);
					const botNeed = Math.max(0, 6 - bh.length);
					const newBotHand = [...bh, ...deck2.slice(0, botNeed)];
					const newDeck = deck2.slice(botNeed);
					setMyHand(newMyHand);
					setBotHand(newBotHand);
					setOppHandCount(newBotHand.length);
					setDeckCards(newDeck);
					setTableFlyDir("left");
					setTimeout(() => { setTableSlots([]); setTableFlyDir(null); }, 500 + ts.length * 65);
					setIsAttacker(false);
					setPhase("defending");
					return;
				}
				const attackCard = ts[undefended].attack;
				const beaters = bh
					.filter((c) => canBeat(attackCard, c, trump))
					.sort((a, b) => {
						if (a.suit === trump && b.suit !== trump) return 1;
						if (b.suit === trump && a.suit !== trump) return -1;
						return RANK_VALUES[a.rank] - RANK_VALUES[b.rank];
					});
				if (beaters[0]) {
					const newBotHand = removeCard(bh, beaters[0]);
					setBotHand(newBotHand);
					setOppHandCount(newBotHand.length);
					setBotCardFlying(true);
					playBotCardFly();
					const beatCard = beaters[0];
					setTimeout(() => {
						setBotCardFlying(false);
						setTableSlots((prev) => prev.map((slot, i) =>
							i === undefended ? { ...slot, defense: beatCard } : slot,
						));
						playCardBeat();
						setPhase("attacking");
					}, 440);
				} else {
					// Take
					const allCards = ts.flatMap((s) => s.defense ? [s.attack, s.defense] : [s.attack]);
					const newBotHand = [...bh, ...allCards];
					// Me draws from deck
					const myNeed = Math.max(0, 6 - mh.length);
					const newMyHand = [...mh, ...dc.slice(0, myNeed)];
					const newDeck = dc.slice(myNeed);
					setBotHand(newBotHand);
					setOppHandCount(newBotHand.length);
					setMyHand(newMyHand);
					setDeckCards(newDeck);
					setTableFlyDir("opp");
					setTimeout(() => { setTableSlots([]); setTableFlyDir(null); }, 500 + ts.length * 65);
					setIsAttacker(true);
					setPhase("attacking");
				}
			}
		}, 350 + Math.random() * 250);

		return () => clearTimeout(timer);
	// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [vsBot, phase, gameOver]);

	// Sounds
	useEffect(() => {
		if (tableFlyDir === "opp") playTableFlyOpp();
		else if (tableFlyDir === "me") playTableFlyMe();
		// "left" direction = cards swept to the discard pile after a pass
		else if (tableFlyDir === "left") playCardSweep();
	}, [tableFlyDir]);

	const effectiveOppCount = vsBot ? botHand.length : oppHandCount;
	useEffect(() => {
		if (gameOver) return;
		if (myHand.length === 0 && deckCards.length === 0) setGameOver("win");
		else if (effectiveOppCount === 0 && deckCards.length === 0) setGameOver("lose");
	}, [myHand, effectiveOppCount, deckCards, gameOver]);

	// Coins removed — popup just shows "Вы победили / проиграли".

	const applyAction = (move: DurakAction, fromOpponent: boolean) => {
		if (move.action === "attack") {
			setTableSlots((prev) => [...prev, { attack: move.card }]);
			if (fromOpponent) { setOppHandCount((c) => c - 1); setPhase("defending"); }
			else setPhase("waiting");
		} else if (move.action === "add") {
			// Attacker threw another card of a matching rank onto the table.
			// The ball must hand off to the defender so they beat the new card.
			setTableSlots((prev) => [...prev, { attack: move.card }]);
			if (fromOpponent) {
				setOppHandCount((c) => c - 1);
				setPhase("defending"); // opp added — I must defend
			} else {
				setPhase("waiting");   // I added — opp defends
			}
		} else if (move.action === "defend") {
			setTableSlots((prev) =>
				prev.map((slot, i) => (i === move.targetIdx ? { ...slot, defense: move.card } : slot)),
			);
			if (fromOpponent) { setOppHandCount((c) => c - 1); setPhase("attacking"); }
			else {
				setPhase("waiting");
			}
		} else if (move.action === "take") {
			/*
			 * TAKE: defender gives up on beating, picks up all table cards.
			 * Read state via gameStateRef inside the timeout — prevents
			 * stale-closure overwrite if other moves get applied during
			 * the 500-700 ms fly-off animation.
			 */
			const nSlots = tableSlots.length;
			setTransitioning(true);
			setTableFlyDir(fromOpponent ? "opp" : "me");
			setTimeout(() => {
				const cur = gameStateRef.current;
				const allCards = cur.tableSlots.flatMap((s) => s.defense ? [s.attack, s.defense] : [s.attack]);
				if (fromOpponent) {
					// Opp (defender) took. I (attacker) refill, STAY attacker.
					const myNeed = Math.max(0, 6 - cur.myHand.length);
					setOppHandCount((c) => c + allCards.length);
					setMyHand((h) => [...h, ...cur.deckCards.slice(0, myNeed)]);
					setDeckCards((d) => d.slice(myNeed));
					setTableSlots([]);
					setTableFlyDir(null);
					setIsAttacker(true);
					setPhase("attacking");
				} else {
					// I (defender) took. Opp refills, STAYS attacker.
					// CRITICAL: read oppHandCount from gameStateRef (FRESH),
					// not from closure (STALE — captured at applyAction call,
					// could be 500+ ms behind by the time setTimeout fires).
					const oppNeed = Math.max(0, 6 - cur.oppHandCount);
					setMyHand((h) => [...h, ...allCards]);
					setOppHandCount((c) => c + oppNeed);
					setDeckCards((d) => d.slice(oppNeed));
					setTableSlots([]);
					setTableFlyDir(null);
					setIsAttacker(false);
					setPhase("waiting");
				}
				setTransitioning(false);
			}, 500 + nSlots * 65);
		} else if (move.action === "pass") {
			/*
			 * PASS (бито): attacker says "done, all beaten". Same gameStateRef
			 * pattern as take — read latest state inside the timeout.
			 */
			const nSlots = tableSlots.length;
			setTransitioning(true);
			setTableFlyDir("left");
			setTimeout(() => {
				const cur = gameStateRef.current;
				// FRESH reads from ref — closure values for oppHandCount
				// would be stale by 500+ ms.
				const myNeed  = Math.max(0, 6 - cur.myHand.length);
				const oppNeed = Math.max(0, 6 - cur.oppHandCount);
				if (!fromOpponent) {
					// I was attacker → I draw first, opp second, opp attacks next
					const mineDraw = cur.deckCards.slice(0, myNeed);
					const oppDraw  = cur.deckCards.slice(myNeed, myNeed + oppNeed);
					setMyHand((h) => [...h, ...mineDraw]);
					setOppHandCount((c) => c + oppDraw.length);
					setDeckCards((d) => d.slice(myNeed + oppNeed));
					setTableSlots([]);
					setTableFlyDir(null);
					setIsAttacker(false);
					setPhase("waiting");
				} else {
					// Opp was attacker → they draw first, I second, I attack next
					const oppDraw  = cur.deckCards.slice(0, oppNeed);
					const mineDraw = cur.deckCards.slice(oppNeed, oppNeed + myNeed);
					setOppHandCount((c) => c + oppDraw.length);
					setMyHand((h) => [...h, ...mineDraw]);
					setDeckCards((d) => d.slice(myNeed + oppNeed));
					setTableSlots([]);
					setTableFlyDir(null);
					setIsAttacker(true);
					setPhase("attacking");
				}
				setTransitioning(false);
			}, 500 + nSlots * 65);
		}
	};

	// Subscribe to the multiplayer session via HTTP polling. The hook handles
	// signalling GAME_READY (via the `ready: true` flag on /poll), receiving
	// opponent moves, and detecting cancellation/finish events.
	// Queue of pending opponent moves — process ONE per render cycle so each
	// applyAction call gets fresh closure values. Pause the queue while a
	// take/pass animation is in flight (transitioning=true) so the timeout's
	// final state mutations aren't clobbered by another move.
	const [oppMoveQueue, setOppMoveQueue] = useState<DurakAction[]>([]);
	useEffect(() => {
		if (oppMoveQueue.length === 0) return;
		if (transitioning) return; // wait until take/pass animation finishes
		const next = oppMoveQueue[0];
		try {
			applyAction(next, true);
		} catch (err) {
		}
		setOppMoveQueue((q) => q.slice(1));
	// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [oppMoveQueue, transitioning]);

	const lastSyncedVersionRef = useRef<number>(-1);
	// Previous server view kept for diff-based animations (take/pass sweep,
	// new attack fly-in, etc).
	const prevServerStateRef = useRef<{
		table: TableSlot[];
		attackerUserId: string;
		yourHandLen: number;
		oppHandCount: number;
	} | null>(null);
	// Click guard ref — declared early so onState can release it on every
	// authoritative state arrival.
	const isSendingMoveRef = useRef(false);
	const { opponentJoined: oppJoinedFromServer, opponentOnline } = useGameSession({
		sessionId: !vsBot && sessionId && !sessionId.startsWith("bot-") ? sessionId : null,
		myUserId,
		enabled: !vsBot && !!sessionId && !sessionId.startsWith("bot-"),
		// Server-authoritative state sync. The server is the SOURCE OF TRUTH.
		onState: (rawState, version) => {
			// onState is shared between durak and checkers; narrow to durak
			// view by checking for a durak-only field.
			if (!("yourHand" in rawState)) return;
			const state = rawState;
			lastSyncedVersionRef.current = version;
			isSendingMoveRef.current = false;
			setOpponentJoined(true);
			logEvent("durak", "sync state", {
				v: version,
				myHand: state.yourHand.length,
				oppHand: state.opponentHandCount,
				deck: state.deckCount,
				phase: state.phase,
				turn: state.currentTurnUserId === myUserId ? "me" : "opp",
				tableSlots: state.table.length,
			});

			// ── Diff-based animation triggers (bot-parity in MP) ──
			const prev = prevServerStateRef.current;
			const tableJustEmptied = prev && prev.table.length > 0 && state.table.length === 0;
			let animateSweep: "me" | "opp" | "left" | null = null;
			if (tableJustEmptied) {
				// Distinguish take vs pass by whether attacker swapped:
				//  - take: defender takes table cards, roles UNCHANGED.
				//  - pass: round closed, both refill, ROLES SWAP.
				if (prev.attackerUserId === state.attackerUserId) {
					// Take. Defender (= the one who did NOT attack) took the cards.
					animateSweep = state.defenderUserId === myUserId ? "me" : "opp";
				} else {
					// Pass — cards swept to discard.
					animateSweep = "left";
				}
			}

			// Opp just played a card (their hand shrank by exactly 1)
			// — same trigger we use for the bot's flying card-back.
			const oppPlayedCard = prev != null
				&& state.opponentHandCount === prev.oppHandCount - 1
				&& !tableJustEmptied;

			// ── Compute deck-draw counts for the post-sweep refill anim ──
			// Only meaningful when sweep is happening; on a sweep we need to
			// know how many cards each player just pulled FROM THE DECK
			// (vs took from the table) so we can fly the right number of
			// card-backs from the deck to each hand, just like bot mode.
			let myDeckDraw = 0;
			let oppDeckDraw = 0;
			if (animateSweep && prev) {
				const tableCardsCount = prev.table.flatMap((s) =>
					s.defense ? [s.attack, s.defense] : [s.attack],
				).length;
				const myHandDelta = state.yourHand.length - prev.yourHandLen;
				const oppHandDelta = state.opponentHandCount - prev.oppHandCount;
				if (animateSweep === "me") {
					// I (defender) took the table — my hand delta INCLUDES
					// those cards; the rest is deck refill (typically 0
					// since defender doesn't refill on take).
					myDeckDraw = Math.max(0, myHandDelta - tableCardsCount);
					oppDeckDraw = Math.max(0, oppHandDelta);
				} else if (animateSweep === "opp") {
					myDeckDraw = Math.max(0, myHandDelta);
					oppDeckDraw = Math.max(0, oppHandDelta - tableCardsCount);
				} else {
					// Pass: nobody takes the table, both refill from deck.
					myDeckDraw = Math.max(0, myHandDelta);
					oppDeckDraw = Math.max(0, oppHandDelta);
				}
			}

			// Phase update helper — deferred along with the visible card
			// movement so the UI doesn't switch turn indicators before the
			// animation finishes.
			const applyPhase = () => {
				if (state.phase === "finished") {
					if (state.finished) {
						const won = state.finished.winnerId === myUserId;
						setGameOver(state.finished.isDraw ? "lose" : (won ? "win" : "lose"));
					}
				} else if (state.currentTurnUserId === myUserId) {
					setPhase(state.attackerUserId === myUserId ? "attacking" : "defending");
				} else {
					setPhase("waiting");
				}
			};

			// Snap all state to the server's view. Called either immediately
			// (no animation) or from inside a setTimeout (after the cue plays).
			const commitState = () => {
				setMyHand(state.yourHand as Card[]);
				setOppHandCount(state.opponentHandCount);
				setDeckCards((prevDeck) => {
					if (prevDeck.length === state.deckCount) return prevDeck;
					return prevDeck.slice(prevDeck.length - state.deckCount);
				});
				setIsAttacker(state.attackerUserId === myUserId);
				setTableSlots(state.table as TableSlot[]);
				applyPhase();
			};

			if (animateSweep) {
				// Take/pass: hold OLD slots for the sweep animation, then
				// clear + commit + fly the deck-refill cards.
				setTableFlyDir(animateSweep);
				setTransitioning(true);
				const SWEEP_MS = 500 + (prev?.table.length ?? 0) * 65;
				setTimeout(() => {
					setTableFlyDir(null);
					setTransitioning(false);
					commitState();
					if (myDeckDraw > 0 || oppDeckDraw > 0) {
						triggerDrawAnim(myDeckDraw, oppDeckDraw);
					}
				}, SWEEP_MS);
			} else if (oppPlayedCard) {
				// Opp's incoming card — fire the flying overlay FIRST,
				// then commit so the card materializes on the table only
				// AFTER the fly-in animation lands.
				setBotCardFlying(true);
				playBotCardFly();
				setTimeout(() => {
					setBotCardFlying(false);
					commitState();
				}, 440);
			} else {
				commitState();
			}

			prevServerStateRef.current = {
				table: state.table as TableSlot[],
				attackerUserId: state.attackerUserId,
				yourHandLen: state.yourHand.length,
				oppHandCount: state.opponentHandCount,
			};
		},
		onCancelled: () => {
			navigate("/match/durak", { replace: true });
		},
		onFinished: (result) => {
			const gr: "win" | "lose" = result.isDraw ? "lose" : (result.winnerId === myUserId ? "win" : "lose");
			setGameOver(gr);
		},
	});
	useEffect(() => {
		if (oppJoinedFromServer) setOpponentJoined(true);
	}, [oppJoinedFromServer]);
	// Auto-win if opponent left mid-game. Wait until the game has actually
	// started (opponentJoined) so we don't fire on initial reconnect blips.
	useEffect(() => {
		if (vsBot || gameOver || !opponentJoined) return;
		if (opponentOnline) return;
		const tid = setTimeout(() => {
			setGameOver("win");
		}, 6_000);
		return () => clearTimeout(tid);
	}, [opponentOnline, opponentJoined, gameOver, vsBot]);

	const sendAction = (move: DurakAction) => {
		// Track move counters for analytics (refs → no re-renders).
		if (move.action === "take") takesRef.current++;
		else if (move.action === "defend") defendsRef.current++;
		else if (move.action === "attack" || move.action === "add") attacksRef.current++;
		movesRef.current++;

		if (!vsBot) {
			if (isSendingMoveRef.current) return;
			isSendingMoveRef.current = true;
			logEvent("durak", `user action: ${move.action}`, move);
			// PURE SERVER-AUTHORITATIVE: no optimistic local mutation.
			// User clicks → send intent → server validates+applies →
			// onState renders the new state. Click guard is released
			// either by the next onState arrival (typical: ~100 ms) or
			// by this safety timeout (1.5 s) for the rare case where
			// the network ate the move and no state arrived back.
			if (sessionId) mmClient.queueMove(sessionId, move);
			setTimeout(() => { isSendingMoveRef.current = false; }, 1500);
			return;
		}

		// vsBot mode: manage state directly to avoid applyAction role-swap bugs
		const { tableSlots: ts, botHand: bh, myHand: mh, deckCards: dc } = gameStateRef.current;

		if (move.action === "attack") {
			// I attack. Hand off to bot (defender).
			setMyHand(removeCard(mh, move.card));
			setTableSlots([...ts, { attack: move.card }]);
			setPhase("waiting");
		} else if (move.action === "add") {
			// I add a card. Hand off to bot (defender) to beat the new card.
			setMyHand(removeCard(mh, move.card));
			setTableSlots([...ts, { attack: move.card }]);
			setPhase("waiting");
		} else if (move.action === "defend") {
			// I defended opp's attack. Hand off to bot (attacker) — add more or pass.
			setMyHand(removeCard(mh, move.card));
			setTableSlots(ts.map((slot, i) => i === move.targetIdx ? { ...slot, defense: move.card } : slot));
			playCardBeat();
			setPhase("waiting");
		} else if (move.action === "take") {
			const allCards = ts.flatMap((s) => s.defense ? [s.attack, s.defense] : [s.attack]);
			const nSlots = ts.length;
			setMyHand([...mh, ...allCards]);

			// Penalty −5 for taking cards
			addCrystals(-5);

			setTransitioning(true);
			setTableFlyDir("me");
			setTimeout(() => {
				const botNeed = Math.max(0, 6 - bh.length);
				const botDraw = dc.slice(0, botNeed);
				const newBotHand = [...bh, ...botDraw];
				setBotHand(newBotHand);
				setOppHandCount(newBotHand.length);
				setDeckCards(dc.slice(botDraw.length));
				setTableSlots([]);
				setTableFlyDir(null);
				setIsAttacker(false);
				setPhase("waiting");
				setTransitioning(false);
				triggerDrawAnim(0, botDraw.length);
			}, 500 + nSlots * 65);
		} else if (move.action === "pass") {
			const nSlots = ts.length;

			setTransitioning(true);
			setTableFlyDir("left");
			setTimeout(() => {
				const myNeed = Math.max(0, 6 - mh.length);
				const myDraw = dc.slice(0, myNeed);
				const deck2 = dc.slice(myDraw.length);
				const botNeed = Math.max(0, 6 - bh.length);
				const botDraw = deck2.slice(0, botNeed);
				setMyHand([...mh, ...myDraw]);
				setBotHand([...bh, ...botDraw]);
				setOppHandCount(bh.length + botDraw.length);
				setDeckCards(deck2.slice(botDraw.length));
				setTableSlots([]);
				setTableFlyDir(null);
				setIsAttacker(false);
				setPhase("waiting");
				setTransitioning(false);
				triggerDrawAnim(myDraw.length, botDraw.length);
			}, 500 + nSlots * 65);
		}
	};

	const handleAttack = (card: Card) => {
		if (phase !== "attacking") return;
		if (tableSlots.length > 0) {
			const ranks = new Set(tableSlots.flatMap((s) => [s.attack.rank, s.defense?.rank].filter(Boolean)));
			if (!ranks.has(card.rank)) return;
			sendAction({ action: "add", card });
		} else {
			sendAction({ action: "attack", card });
		}
	};

	const handleDefend = (card: Card, targetIdx: number) => {
		if (phase !== "defending") return;
		const slot = tableSlots[targetIdx];
		if (!slot || slot.defense) return;
		if (!canBeat(slot.attack, card, trump)) return;
		sendAction({ action: "defend", card, targetIdx });
	};

	const canPlayCard = (card: Card): boolean => {
		if (phase === "attacking") {
			return tableSlots.length === 0 ||
				tableSlots.some((s) => s.attack.rank === card.rank || s.defense?.rank === card.rank);
		}
		if (phase === "defending") {
			return tableSlots.some((s) => !s.defense && canBeat(s.attack, card, trump));
		}
		return false;
	};

	const allDefended = tableSlots.length > 0 && tableSlots.every((s) => s.defense);
	// True if I can still throw more cards (some in-hand card matches a rank already on the table)
	const canThrowMore = useMemo(() => {
		if (tableSlots.length === 0) return false;
		const ranks = new Set(tableSlots.flatMap((s) => [s.attack.rank, s.defense?.rank].filter(Boolean) as string[]));
		return myHand.some((c) => ranks.has(c.rank));
	}, [tableSlots, myHand]);

	const [showExitConfirm, setShowExitConfirm] = useState(false);
	const [closingExit, setClosingExit] = useState(false);

	const dismissExit  = () => { setClosingExit(true);  setTimeout(() => { setShowExitConfirm(false); setClosingExit(false); }, 280); };
	const [launchingCard, setLaunchingCard] = useState<string | null>(null);
	const [rejectCard, setRejectCard] = useState<string | null>(null);

	// Horizontal scroll state for the hand (translateX offset in px)
	const [handScrollX, setHandScrollX] = useState(0);
	const handScrollRef = useRef(0);

	// Clamp scroll when hand size changes (e.g. after playing a card)
	useEffect(() => {
		const n = myHand.length;
		if (n <= 1) { handScrollRef.current = 0; setHandScrollX(0); return; }
		const mlPx = n > 9 ? -62 : n > 7 ? -52 : n > 5 ? -36 : -18;
		const totalW = 94 + (n - 1) * (94 + mlPx);
		const viewW = (typeof window !== "undefined" ? window.innerWidth : 390) - 16;
		const maxOff = Math.max(0, (totalW - viewW) / 2);
		if (Math.abs(handScrollRef.current) > maxOff) {
			const clamped = Math.sign(handScrollRef.current) * maxOff;
			handScrollRef.current = clamped;
			setHandScrollX(clamped);
		}
	}, [myHand.length]);

	// Refs for direct DOM manipulation during swipe (no re-render per frame)
	const cardRefs = useRef<Map<string, HTMLButtonElement>>(new Map());
	/** Unified drag state — tracks key, origin, scroll offset, and committed direction. */
	const handDragRef = useRef<{
		key: string;
		startX: number;
		startY: number;
		startScrollX: number;
		direction: "h" | "v" | null;
	} | null>(null);
	const swipeHandled = useRef(false);

	const animateLaunch = (card: Card, action: () => void) => {
		playCardPlay();
		setLaunchingCard(cardKey(card));
		setTimeout(() => { setLaunchingCard(null); action(); }, 400);
	};

	const animateReject = (card: Card) => {
		const k = cardKey(card);
		setRejectCard(k);
		setTimeout(() => setRejectCard((prev) => (prev === k ? null : prev)), 600);
	};

	const handleAttackAnimated = (card: Card) => {
		if (phase !== "attacking") return;
		if (tableSlots.length > 0) {
			const ranks = new Set(tableSlots.flatMap((s) => [s.attack.rank, s.defense?.rank].filter(Boolean)));
			if (!ranks.has(card.rank)) { animateReject(card); return; }
		}
		animateLaunch(card, () => handleAttack(card));
	};

	const handleDefendAnimated = (card: Card, targetIdx: number) => {
		if (phase !== "defending") return;
		const slot = tableSlots[targetIdx];
		if (!slot || slot.defense) return;
		if (!canBeat(slot.attack, card, trump)) { animateReject(card); return; }
		animateLaunch(card, () => { addCrystals(10); handleDefend(card, targetIdx); });
	};

	return (
		<div
			className="fixed inset-0 flex flex-col overflow-hidden"
			style={{ backgroundImage: `url(${TABLE_BG})`, backgroundSize: "cover", backgroundPosition: "center", touchAction: "none", overscrollBehavior: "none" }}
		>
			{/* ── Летящая карта противника ── */}
			{botCardFlying && (
				<div
					className="absolute z-[15] pointer-events-none select-none"
					style={{ top: "44%", left: "50%", transform: "translateX(-50%) translateY(-50%)", animation: "var(--animate-bot-card-launch)" }}
				>
					<img src={CARD_BACK} alt="" className="rounded-lg shadow-2xl" style={{ width: 88, height: 132 }} />
				</div>
			)}

			{/* ── Header — только кнопка выхода ── */}
			<div className="absolute z-20 top-0 left-0 px-4 pt-14 pointer-events-none">
				<button
					type="button"
					onClick={() => setShowExitConfirm(true)}
					className="w-11 h-11 rounded-full bg-black/45 backdrop-blur-sm flex items-center justify-center text-white active:bg-black/65 pointer-events-auto"
				>
					<svg width="16" height="16" viewBox="0 0 14 14" fill="none">
						<path d="M1 1l12 12M13 1L1 13" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"/>
					</svg>
				</button>
			</div>

			{/* ── Противник: кресло всегда видимо; аватар только когда соперник пришёл ── */}
			<div className="relative z-10 flex flex-col items-center w-full pt-1">
				<div className="relative flex items-end justify-center" style={{ height: 160 }}>
					{/* ── Колода: стек рубашек (повёрнут 90° по часовой) + козырь
				       снизу (вертикально). Размер увеличен на ~25%. ── */}
					{deckCards.length > 0 && (
						<div
							className="fixed select-none pointer-events-none"
							style={{
								right: 48,
								top: 36,
								zIndex: 15,
							}}
						>
							{/* Container has to fit:
							      - rotated horizontal stack on top (~80w × 52h)
							      - vertical trump card peeking below     */}
							<div style={{ position: "relative", width: 80, height: 115 }}>
								{/* Trump card — vertical, slides up from below
								    so the stack covers its top half. */}
								<img
									src={cardImg(trumpCard)}
									alt={`trump ${trumpCard.rank}${trumpCard.suit}`}
									style={{
										position: "absolute",
										top: 32,
										left: "50%",
										marginLeft: -26,
										width: 52,
										height: 78,
										borderRadius: 6,
										boxShadow: "0 2px 6px rgba(0,0,0,0.45)",
										zIndex: 1,
									}}
								/>
								{/* Face-down deck stack — each card rotated 90°
								    clockwise. Centered horizontally at x=40,
								    vertically at y=25 (top of container area).
								    margin-left/top on each card pivots around
								    the same center for a neat fan stack.    */}
								{(() => {
									const visible = Math.min(deckCards.length, 8);
									const arr: number[] = [];
									for (let i = 0; i < visible; i++) arr.push(i);
									return arr.map((i) => (
										<img
											key={i}
											src={CARD_BACK}
											alt=""
											style={{
												position: "absolute",
												top: 25 - i * 0.7,
												left: 40 - i * 0.7,
												width: 52,
												height: 78,
												marginLeft: -26,
												marginTop: -39,
												transform: `rotate(${90 + (i % 2 === 0 ? -0.45 : 0.45) * i}deg)`,
												boxShadow: i === visible - 1 ? "0 2px 8px rgba(0,0,0,0.45)" : "none",
												zIndex: 5 + i,
												borderRadius: 6,
											}}
										/>
									));
								})()}

								{/* Remaining deck count badge */}
								<div style={{
									position: "absolute",
									top: -6,
									right: -10,
									zIndex: 20,
									minWidth: 20,
									height: 20,
									borderRadius: 10,
									background: "#111",
									border: "1.5px solid rgba(255,255,255,0.75)",
									display: "flex",
									alignItems: "center",
									justifyContent: "center",
									padding: "0 4px",
									fontFamily: "var(--font-ubuntu)",
									fontSize: 11,
									fontWeight: 700,
									color: "#fff",
									boxShadow: "0 1px 4px rgba(0,0,0,0.55)",
									lineHeight: 1,
								}}>
									{deckCards.length}
								</div>
							</div>
						</div>
					)}

				{/* Crystal counter removed per spec — no in-game crystals or coins. */}

				{/* ── Flying card-backs from deck → target hand during draw ── */}
					{flyingDraws.map(({ key, to, delay }) => (
						<img
							key={key}
							src={CARD_BACK}
							alt=""
							className="fixed select-none pointer-events-none"
							style={{
								right: 62,
								top: 42,
								width: 41,
								height: 62,
								zIndex: 25,
								boxShadow: "0 3px 10px rgba(0,0,0,0.5)",
								animation: `fly-draw-${to} 0.55s ${delay}ms cubic-bezier(0.35, 0, 0.4, 1) both`,
							}}
						/>
					))}

					<img src={CHAIR_IMG} alt="" className="h-full w-auto pointer-events-none select-none" style={{ maxWidth: 230 }} />
					{opponentJoined && (
						<button
							type="button"
							onClick={() => {
								// Open the platform's mini-profile for the
								// opponent. Skip for bot games (no real userId).
								const oppId = !vsBot ? locationState.opponentUserId : null;
								if (oppId) {
									openRoute(FlutterRoute.Profile, { params: { profileId: oppId } });
								}
							}}
							className={`absolute w-[72px] h-[72px] rounded-2xl border-2 flex items-center justify-center shadow-xl overflow-hidden transition-colors ${!isMyTurn ? "border-purple-400/80" : "border-white/25"}`}
							style={{
								bottom: "32%",
								left: "50%",
								transform: "translateX(-50%)",
								padding: 0,
								cursor: !vsBot && locationState.opponentUserId ? "pointer" : "default",
								...(fakePlayer
									? { background: `linear-gradient(135deg, ${fakePlayer.gradientFrom}, ${fakePlayer.gradientTo})` }
									: { background: "rgba(0,0,0,0.55)", backdropFilter: "blur(6px)" }),
							}}
						>
							{fakePlayer ? (
								<span className="text-white text-xl font-bold">{fakePlayer.initials}</span>
							) : oppProfile?.avatarUrl ? (
								<img
									src={oppProfile.avatarUrl}
									alt=""
									className="w-full h-full object-cover"
									draggable={false}
								/>
							) : oppProfile?.nickname ? (
								<span className="text-white text-xl font-bold">
									{oppProfile.nickname.slice(0, 2).toUpperCase()}
								</span>
							) : (
								<span className="text-2xl">👤</span>
							)}
						</button>
					)}
				</div>
				{opponentJoined && (fakePlayer || oppProfile?.nickname) && (
					<div style={{ marginTop: -10, marginBottom: 8 }}>
						<span className="text-white font-bold drop-shadow-lg" style={{ fontFamily: "var(--font-ubuntu)", fontSize: "1.375rem" }}>
							{fakePlayer ? fakePlayer.name : oppProfile?.nickname}
						</span>
					</div>
				)}
				{/* Карты противника рубашкой — только если соперник присоединился */}
				<div className="flex justify-center overflow-visible w-full px-4">
					{opponentJoined && Array.from({ length: Math.min(effectiveOppCount, 12) }, (_, i) => {
						const n = Math.min(effectiveOppCount, 12);
						const angle = (i - (n - 1) / 2) * 4;
						return (
							<img
								key={i}
								src={CARD_BACK}
								alt="card"
								className="rounded-lg object-cover shadow-xl flex-shrink-0"
								style={{
									width: 52,
									height: 78,
									transformOrigin: "bottom center",
									transform: `rotate(${angle}deg)`,
									marginLeft: i === 0 ? 0 : (n > 9 ? -20 : -8),
								}}
							/>
						);
					})}
					{opponentJoined && effectiveOppCount === 0 && (
						<span className="text-white/30 text-xs py-4">{t.noCards}</span>
					)}
				</div>
			</div>

			{/* ── Подсказка в центре (пустой стол) — z-20 чтобы кнопка была кликабельной поверх стола ── */}
			{tableSlots.length === 0 && (
				<div
					className="absolute z-20 left-0 right-0 flex flex-col items-center justify-center"
					style={{ top: "calc(52% - 20px)", transform: "translateY(-50%)", padding: "0 40px", gap: 14 }}
				>
					{!opponentJoined ? (
						/* Waiting for opponent — text + animated dots + green bot button */
						<>
							<span
								style={{
									fontFamily: "var(--font-ubuntu)",
									fontSize: 22, fontWeight: 700,
									color: "rgba(255,255,255,0.92)",
									textShadow: "0 2px 12px rgba(0,0,0,0.6)",
									textAlign: "center",
								}}
							>
								{t.waitingForPlayer}
							</span>
							{/* Animated bounce dots — waiting indicator */}
							<div style={{ display: "flex", gap: 8, marginTop: 2, marginBottom: 8 }}>
								{[0, 1, 2].map((i) => (
									<div
										key={i}
										style={{
											width: 10, height: 10, borderRadius: "50%",
											background: "rgba(255,255,255,0.85)",
											animation: `wait-bounce 1.4s ${i * 0.16}s infinite ease-in-out`,
										}}
									/>
								))}
							</div>
							<style>{`@keyframes wait-bounce { 0%, 80%, 100% { transform: scale(0); opacity: 0.3; } 40% { transform: scale(1); opacity: 1; } }`}</style>
							<button
								type="button"
								onClick={() => {
									mmClient.leaveQueue().catch(() => {});
									mmClient.stopPolling();
									setVsBot(true);
									setOpponentJoined(true);
								}}
								style={{
									padding: "13px 28px",
									borderRadius: 999,
									background: "linear-gradient(to bottom, #66BB6A, #388E3C)",
									border: "none",
									borderBottom: "3px solid #1B5E20",
									boxShadow: "0 3px 0 #1B5E20, inset 0 1px 0 rgba(255,255,255,0.25)",
									fontFamily: "var(--font-ubuntu)",
									fontSize: 16, fontWeight: 700,
									color: "#fff",
									textShadow: "0 1px 2px rgba(0,0,0,0.35)",
									cursor: "pointer",
									transition: "transform 0.08s, box-shadow 0.08s",
								}}
								onPointerDown={(e) => { e.currentTarget.style.transform = "translateY(3px)"; e.currentTarget.style.boxShadow = "0 1px 0 #1B5E20, inset 0 1px 0 rgba(255,255,255,0.25)"; }}
								onPointerUp={(e) => { e.currentTarget.style.transform = ""; e.currentTarget.style.boxShadow = "0 3px 0 #1B5E20, inset 0 1px 0 rgba(255,255,255,0.25)"; }}
							>
								Играть с ботом
							</button>
						</>
					) : (
						<span
							className="pointer-events-none"
							style={{
								fontFamily: "var(--font-ubuntu)",
								fontSize: 20, fontWeight: 700,
								color: "rgba(255,255,255,0.88)",
								textShadow: "0 2px 12px rgba(0,0,0,0.6)",
								textAlign: "center",
								display: "inline-flex",
								alignItems: "center",
								gap: 10,
							}}
						>
							{isMyTurn ? t.yourTurn : t.opponentTurn}
						</span>
					)}
				</div>
			)}

			{/* ── Стол (карты в игре) — абсолютно по центру. Пустой стол не перехватывает клики. ── */}
			<style>{`
				@keyframes passIn {
					0%   { opacity: 0; transform: scale(0.78) translateY(-8px); }
					65%  { opacity: 1; transform: scale(1.07) translateY(0); }
					100% { opacity: 1; transform: scale(1)    translateY(0); }
				}
				@keyframes tfly-opp {
					0%   { transform: translateY(0)      scale(1);    opacity: 1; }
					30%  { opacity: 1; }
					100% { transform: translateY(-120vh) scale(0.4);  opacity: 0; }
				}
				@keyframes tfly-me {
					0%   { transform: translate(0, 0)            scale(1);    opacity: 1; }
					30%  { opacity: 1; }
					100% { transform: translate(-10vw, 120vh)    scale(0.5);  opacity: 0; }
				}
				@keyframes tfly-left {
					0%   { transform: translate(0, 0)            scale(1);    opacity: 1; }
					30%  { opacity: 1; }
					100% { transform: translate(-110vw, 20vh)    scale(0.3);  opacity: 0; }
				}
			`}</style>
			<div
				className="absolute z-10 left-0 right-0 flex items-center justify-center px-3"
				style={{ top: "28%", bottom: "300px", pointerEvents: tableSlots.length === 0 ? "none" : "auto", overflow: "visible" }}
			>
				<div className="w-full flex flex-wrap items-center justify-center gap-3" style={{ overflow: "visible" }}>
					{tableSlots.length === 0 ? null : (
						tableSlots.map((slot, idx) => (
							<div
								key={`${idx}-${tableFlyDir ?? "idle"}`}
								className="flex flex-col items-center"
								style={tableFlyDir ? {
									animationName: tableFlyDir === "opp" ? "tfly-opp" : tableFlyDir === "me" ? "tfly-me" : "tfly-left",
									animationDuration: "0.5s",
									animationTimingFunction: "cubic-bezier(0.4,0,0.6,1)",
									animationFillMode: "both",
									animationDelay: `${idx * 55}ms`,
								} : { animation: "var(--animate-slide-up)" }}
							>
								<CardImage card={slot.attack} imgFn={cardImg} className="w-[110px] h-[165px] shadow-2xl" />
								{slot.defense && (
									<div style={{ marginTop: -82, zIndex: 2, position: "relative", transform: "rotate(6deg)" }}>
										<CardImage
											card={slot.defense}
											imgFn={cardImg}
											className="w-[110px] h-[165px] shadow-2xl"
										/>
									</div>
								)}
							</div>
						))
					)}
				</div>
			</div>

			{/* ── Мои карты (фиксированная позиция снизу, горизонтальный скролл пальцем) ── */}
			<div className="absolute z-10 left-0 right-0 flex justify-center overflow-visible px-2" style={{ bottom: "170px" }}>
				<div className="flex items-end" style={{ transform: `translateX(${-handScrollX}px)`, willChange: "transform" }}>
					{myHand.map((card, i) => {
						const isLaunching = launchingCard === cardKey(card);
						const isRejecting = rejectCard === cardKey(card);
						const n = myHand.length;
						const angle = (i - (n - 1) / 2) * 3.5;
						const ml = i === 0 ? 0 : n > 9 ? -62 : n > 7 ? -52 : n > 5 ? -36 : -18;
						// Visual hints — light-gold halo on cards that are
						// LEGAL right now, subtle dim on the rest. Active in
						// two situations:
						//  - defending: which of my cards can beat the attack
						//  - adding (attacker, table NOT empty): which cards
						//    have a matching rank to pile on. Skipped during
						//    the OPENING attack (table empty) since any card
						//    is legal there.
						const isDefending = isMyTurn && phase === "defending" && !isLaunching && !isRejecting;
						const isAdding = isMyTurn && phase === "attacking" && tableSlots.length > 0 && !isLaunching && !isRejecting;
						const showHint = isDefending || isAdding;
						const playableHint = showHint && canPlayCard(card);
						const unplayableHint = showHint && !canPlayCard(card);

						const handleTouchStart = (e: React.TouchEvent) => {
							handDragRef.current = {
								key: cardKey(card),
								startX: e.touches[0].clientX,
								startY: e.touches[0].clientY,
								startScrollX: handScrollRef.current,
								direction: null,
							};
						};
						const handleTouchMove = (e: React.TouchEvent) => {
							if (!handDragRef.current || handDragRef.current.key !== cardKey(card)) return;
							const dx = e.touches[0].clientX - handDragRef.current.startX;
							const dy = e.touches[0].clientY - handDragRef.current.startY;

							// Commit to a direction once one axis clearly dominates
							if (!handDragRef.current.direction) {
								if (Math.abs(dx) > Math.abs(dy) + 8) handDragRef.current.direction = "h";
								else if (Math.abs(dy) > Math.abs(dx) + 8) handDragRef.current.direction = "v";
								else return; // not decided yet
							}

							if (handDragRef.current.direction === "h") {
								// Horizontal: scroll the hand
								const n = myHand.length;
								const mlPx = n > 9 ? -62 : n > 7 ? -52 : n > 5 ? -36 : -18;
								const totalW = 94 + Math.max(0, n - 1) * (94 + mlPx);
								const viewW = (typeof window !== "undefined" ? window.innerWidth : 390) - 16;
								const maxOff = Math.max(0, (totalW - viewW) / 2);
								const next = Math.max(-maxOff, Math.min(maxOff, handDragRef.current.startScrollX - dx));
								handScrollRef.current = next;
								setHandScrollX(next);
							} else if (handDragRef.current.direction === "v") {
								// Vertical: lift card visually
								if (!isMyTurn || isLaunching || isRejecting) return;
								const el = cardRefs.current.get(cardKey(card));
								if (el) {
									el.style.transform = `rotate(${angle}deg) translateY(${Math.min(0, dy)}px)`;
									el.style.transition = "none";
								}
							}
						};
						const handleTouchEnd = (e: React.TouchEvent) => {
							if (!handDragRef.current || handDragRef.current.key !== cardKey(card)) return;
							const info = handDragRef.current;
							handDragRef.current = null;

							if (info.direction === "h") {
								// Horizontal drag finished — mark as handled so onClick doesn't fire
								swipeHandled.current = true;
								return;
							}

							// Vertical (or tap with no direction committed)
							const dy = e.changedTouches[0].clientY - info.startY;
							const el = cardRefs.current.get(cardKey(card));
							if (el) {
								el.style.transition = "all 0.35s ease-in-out";
								el.style.transform = `rotate(${angle}deg)`;
							}
							if (dy < -55 && isMyTurn && !isLaunching && !isRejecting) {
								swipeHandled.current = true;
								if (phase === "attacking") handleAttackAnimated(card);
								else if (phase === "defending") {
									const targetIdx = tableSlots.findIndex((s) => !s.defense);
									if (targetIdx !== -1) handleDefendAnimated(card, targetIdx);
									else animateReject(card);
								}
							} else if (dy < -12 && isMyTurn && !isLaunching && !isRejecting) {
								swipeHandled.current = true;
								animateReject(card);
							}
						};

						return (
							<button
								key={cardKey(card) + i}
								ref={(el) => {
									if (el) cardRefs.current.set(cardKey(card), el);
									else cardRefs.current.delete(cardKey(card));
								}}
								type="button"
								onTouchStart={handleTouchStart}
								onTouchMove={handleTouchMove}
								onTouchEnd={handleTouchEnd}
								onClick={() => {
									if (!isMyTurn) return;
									if (swipeHandled.current) { swipeHandled.current = false; return; }
									if (isLaunching || isRejecting) return;
									if (phase === "attacking") handleAttackAnimated(card);
									else if (phase === "defending") {
										const targetIdx = tableSlots.findIndex((s) => !s.defense);
										if (targetIdx !== -1) handleDefendAnimated(card, targetIdx);
										else animateReject(card);
									}
								}}
								className="flex-shrink-0"
								style={{
									transformOrigin: "bottom center",
									transform: `rotate(${angle}deg)`,
									marginLeft: ml,
									zIndex: i,
									transition: isLaunching || isRejecting ? "none" : "all 0.35s ease-in-out",
								}}
							>
								<div
									style={
										isLaunching
											? { animation: "var(--animate-card-launch)" }
											: isRejecting
												? { animation: "var(--animate-card-reject)" }
												: undefined
									}
								>
									<img
										src={cardImg(card)}
										alt={`${card.rank}${card.suit}`}
										className="rounded-lg object-cover select-none shadow-2xl"
										style={{
											width: 94,
											height: 140,
											// Defense hints:
											//  - playable: light-gold drop-shadow halo
											//  - NOT playable: subtle brightness dim
											// `filter` follows the rounded card edge
											// (a `box-shadow` would render a clipped
											// rectangle that overlapping neighbours cut).
											filter: playableHint
												? "drop-shadow(0 0 6px rgba(255, 215, 130, 1)) drop-shadow(0 0 14px rgba(255, 215, 130, 0.65))"
												: unplayableHint
													? "brightness(0.62) saturate(0.88)"
													: undefined,
											transition: "filter 0.25s ease",
										}}
									/>
								</div>
							</button>
						);
					})}
				</div>
			</div>

			{/* ── Кнопки действий + таймер хода ──
			    Fixed-height container: buttons at the top slot, timer below.
			    All elements always rendered — visibility driven by opacity/transform
			    transitions so there are no layout jumps.
			    Button slot: top=0, height≈46px
			    Timer slot: top=0 (no button) → top=58px (button visible), via CSS transition */}
			{!gameOver && opponentJoined && (() => {
				const showPass = phase === "attacking" && allDefended;
				const showTake = phase === "defending" && tableSlots.some((s) => !s.defense);
				const showAction = showPass || showTake;
				const showTimer = isMyTurn;

				// Layout constants (px).
				// BTN_SLOT_H must match the actual rendered button height exactly so
				// the gap to the timer is identical for both Pass and Take.
				// Height = padding-top(13) + line-height(16, forced via lineHeight:1)
				//        + padding-bottom(13) + border-bottom(3) = 45px.
				const BTN_SLOT_H = 45;
				const GAP         = 14;   // gap between button bottom and timer top
				const TIMER_H     = 56;   // timer circle diameter
				const CONTAINER_H = BTN_SLOT_H + GAP + TIMER_H; // 115px — always fixed

				// Timer slides between these two positions
				const timerTop = showAction ? (BTN_SLOT_H + GAP) : 0;

				if (!showAction && !showTimer) return null;

				const CIRC = 2 * Math.PI * 22;
				const isUrgent  = turnSecondsLeft <= 5;
				const isMid     = turnSecondsLeft <= 10;
				const ringColor = isUrgent ? "#FF5252" : isMid ? "#FFD740" : "#4CAF50";
				const ringOffset = CIRC * (1 - turnSecondsLeft / TURN_LIMIT_SEC);

				return (
					<div
						className="absolute z-10 left-0 right-0 bottom-0 flex justify-center px-6"
						style={{ paddingBottom: "calc(18px + env(safe-area-inset-bottom, 0px))" }}
					>
						{/* Fixed-height inner container — no layout shifts */}
						<div style={{ position: "relative", height: CONTAINER_H, width: "100%", maxWidth: 320 }}>

							{/* ── Pass button — always in DOM at the same position ── */}
							<div style={{
								position: "absolute",
								top: -10,
								left: "50%",
								transform: showPass
									? "translateX(-50%) scale(1) translateY(0px)"
									: "translateX(-50%) scale(0.82) translateY(-6px)",
								opacity: showPass ? 1 : 0,
								pointerEvents: showPass ? "auto" : "none",
								/* Constant transition — browser reliably animates both in and out */
								transition: "opacity 0.26s ease, transform 0.30s cubic-bezier(0.34,1.56,0.64,1)",
								whiteSpace: "nowrap",
							}}>
								<button
									type="button"
									onClick={() => sendAction({ action: "pass" })}
									style={{
										padding: "18px 40px",
										borderRadius: 999,
										background: "linear-gradient(to bottom, #66BB6A, #388E3C)",
										border: "none",
										borderBottom: "3px solid #0A2A0E",
										boxShadow: "0 3px 0 #1F5025, inset 0 1px 0 rgba(255,255,255,0.25)",
										fontFamily: "var(--font-ubuntu)",
										fontSize: 16,
										fontWeight: 700,
										lineHeight: 1,
										color: "#fff",
										textShadow: "0 1px 2px rgba(0,0,0,0.35)",
										cursor: "pointer",
										display: "flex",
										alignItems: "center",
										justifyContent: "center",
									}}
									onPointerDown={(e) => { e.currentTarget.style.transform = "translateY(3px)"; e.currentTarget.style.boxShadow = "0 1px 0 #1F5025, inset 0 1px 0 rgba(255,255,255,0.25)"; }}
									onPointerUp={(e) => { e.currentTarget.style.transform = ""; e.currentTarget.style.boxShadow = "0 3px 0 #1F5025, inset 0 1px 0 rgba(255,255,255,0.25)"; }}
								>
									{t.pass}
								</button>
							</div>

							{/* ── Take button — always in DOM at the same position ── */}
							<div style={{
								position: "absolute",
								top: -10,
								left: "50%",
								transform: showTake
									? "translateX(-50%) scale(1) translateY(0px)"
									: "translateX(-50%) scale(0.82) translateY(-6px)",
								opacity: showTake ? 1 : 0,
								pointerEvents: showTake ? "auto" : "none",
								/* Constant transition — browser reliably animates both in and out */
								transition: "opacity 0.26s ease, transform 0.30s cubic-bezier(0.34,1.56,0.64,1)",
								whiteSpace: "nowrap",
							}}>
								<button
									type="button"
									onClick={() => sendAction({ action: "take" })}
									style={{
										padding: "18px 32px",
										borderRadius: 999,
										background: "linear-gradient(to bottom, #EF5350, #C62828)",
										border: "none",
										borderBottom: "3px solid #7F0000",
										boxShadow: "0 3px 0 #7F0000, inset 0 1px 0 rgba(255,255,255,0.2)",
										fontFamily: "var(--font-ubuntu)",
										fontSize: 16,
										fontWeight: 700,
										lineHeight: 1,
										color: "#fff",
										textShadow: "0 1px 2px rgba(0,0,0,0.4)",
										cursor: "pointer",
										display: "flex",
										alignItems: "center",
										justifyContent: "center",
									}}
									onPointerDown={(e) => { e.currentTarget.style.transform = "translateY(3px)"; e.currentTarget.style.boxShadow = "0 1px 0 #7F0000, inset 0 1px 0 rgba(255,255,255,0.2)"; }}
									onPointerUp={(e) => { e.currentTarget.style.transform = ""; e.currentTarget.style.boxShadow = "0 3px 0 #7F0000, inset 0 1px 0 rgba(255,255,255,0.2)"; }}
								>
									{t.takeCards}
								</button>
							</div>

							{/* ── Timer ring — slides between button position and below-button position ── */}
							{showTimer && (
								<div style={{
									position: "absolute",
									top: timerTop,
									left: "50%",
									transform: "translateX(-50%)",
									// smooth slide when button appears/disappears
									transition: "top 0.30s cubic-bezier(0.4,0,0.2,1)",
									pointerEvents: "none",
									width: 56,
									height: 56,
									display: "flex",
									alignItems: "center",
									justifyContent: "center",
								}}>
									<svg width="56" height="56" viewBox="0 0 56 56">
										<circle cx="28" cy="28" r="22" fill="rgba(0,0,0,0.52)" />
										<circle cx="28" cy="28" r="22" fill="none" stroke="rgba(255,255,255,0.12)" strokeWidth="3.5" />
										<circle cx="28" cy="28" r="22" fill="none" stroke={ringColor} strokeWidth="3.5"
											strokeDasharray={`${CIRC}`} strokeDashoffset={`${ringOffset}`}
											strokeLinecap="round" transform="rotate(-90 28 28)"
											style={{ transition: "stroke-dashoffset 0.9s linear, stroke 0.3s" }}
										/>
									</svg>
									<span style={{
										position: "absolute",
										fontFamily: "var(--font-ubuntu)",
										fontSize: 17,
										fontWeight: 700,
										color: isUrgent ? "#FF5252" : "#fff",
										transition: "color 0.3s",
										lineHeight: 1,
									}}>
										{turnSecondsLeft}
									</span>
								</div>
							)}

						</div>
					</div>
				);
			})()}

			{/* ── Game over popup ── */}
			{gameOver && (
				<GameResultSheet
					result={gameOver}
					coinsWon={gameOver === "win" && stake > 0
						? Math.floor(stake * 0.9)   // opponent's stake minus 10% commission
						: 0}
					coinsLost={gameOver === "lose" && stake > 0 ? stake : 0}
					lang={lang}
					vsBot={vsBot}
					onPlayAgain={vsBot
						// key={sessionId} on DurakGame forces full remount on new sessionId.
						? () => { navigate(`/game/durak/bot-${Date.now()}`, { replace: true, state: { vsBot: true, stake: 0 } }); }
						: () => void navigateToSearch()
					}
					onMenu={() => void navigateToLobby()}
				/>
			)}

			{/* ── Exit confirmation ── */}
			{showExitConfirm && (
				<div
					className="fixed inset-0 z-50 flex flex-col justify-end"
					style={{
						backdropFilter: "blur(12px)",
						WebkitBackdropFilter: "blur(12px)",
						background: "rgba(0,0,0,0.35)",
						animation: closingExit ? "var(--animate-backdrop-out)" : "var(--animate-backdrop-in)",
						overscrollBehavior: "contain",
						touchAction: "none",
					}}
					onClick={dismissExit}
				>
					<div
						className="relative bg-white rounded-t-[32px] shadow-2xl"
						style={{ padding: "32px 24px calc(48px + env(safe-area-inset-bottom, 20px))", animation: closingExit ? "var(--animate-sheet-down)" : "var(--animate-sheet-up)" }}
						onClick={(e) => e.stopPropagation()}
					>
						<p style={{ fontFamily: "var(--font-ubuntu)", fontSize: 28, fontWeight: 700, color: "#323C5E", textAlign: "center", marginBottom: 10 }}>
							{t.exitGameTitle}
						</p>
						<p style={{ fontFamily: "var(--font-ubuntu)", fontSize: 17, fontWeight: 400, color: "#64728F", textAlign: "center", marginBottom: opponentJoined && !vsBot && stake > 0 ? 24 : 32 }}>
							{opponentJoined ? t.exitNoPenalty : t.exitNoOpponent}
						</p>
						{/* Red warning box — only for PvP with real stake */}
						{opponentJoined && !vsBot && stake > 0 && (
							<div style={{ marginBottom: 24, display: "flex", justifyContent: "center" }}>
							<div style={{
								borderRadius: 12,
								padding: "12px 20px",
								display: "inline-flex",
								alignItems: "center",
								gap: 8,
								background: "rgba(229,57,53,0.08)",
							}}>
								<span style={{ fontSize: 18, flexShrink: 0 }}>⚠️</span>
								<span style={{
									fontFamily: "var(--font-ubuntu)",
									fontSize: 17,
									fontWeight: 700,
									color: "#E53935",
									lineHeight: 1.4,
									textAlign: "center",
								}}>
									{lang.startsWith("ru")
										? `Вы потеряете ${stake.toLocaleString()} монет`
										: `You will lose ${stake.toLocaleString()} coins`}
								</span>
							</div>
						</div>
						)}
						<div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 16 }}>
							<button
								type="button"
								onClick={() => {
									dismissExit();
									// Case 1: no real opponent has joined yet → just leave, no penalty, no loss popup.
									if (!opponentJoined) {
										if (!vsBot) mmClient.leaveQueue().catch(() => {});
										mmClient.stopPolling();
										navigate("/");
										return;
									}
									// Case 2: opponent joined (or bot) → this counts as resignation → loss.
									// recordResult with leftEarly=true so analytics knows it was an early exit.
									if (!vsBot && sessionId) mmClient.resign(sessionId).catch(() => {});
									recordResult("lose", true);
									setGameOver("lose");
								}}
								style={{ padding: "18px 56px", borderRadius: 999, background: "#F0196E", fontFamily: "var(--font-ubuntu)", fontSize: 20, fontWeight: 700, color: "#fff", border: "none", cursor: "pointer" }}
							>
								{t.exit}
							</button>
							<button
								type="button"
								onClick={dismissExit}
								style={{ background: "none", border: "none", cursor: "pointer", fontFamily: "var(--font-ubuntu)", fontSize: 17, fontWeight: 600, color: "#6B6B8A", padding: "8px 0" }}
							>
								{t.cancel}
							</button>
						</div>
					</div>
				</div>
			)}

		</div>
	);
}

/**
 * Wrapper exported as the route default. Provides a React `key` based on
 * `sessionId` so that navigating from one session to another (e.g. bot game
 * restart) forces a full component remount — all state, refs and timers are
 * reset and the bot starts moving correctly from the beginning.
 */
export default function Durak() {
	const { sessionId } = useParams<{ sessionId: string }>();
	return <DurakGame key={sessionId} />;
}
