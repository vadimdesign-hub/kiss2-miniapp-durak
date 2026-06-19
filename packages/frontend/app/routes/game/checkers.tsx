import { useBridgeFetch, useFlutterBridge, useSignalReady } from "@playneta/flutter-js-bridge";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router";
import { API_BASE_URL } from "~/config";
import { getTranslations } from "~/i18n/translations";
import { mmClient } from "~/lib/mm-client";
import { useGameSession } from "~/hooks/use-game-session";
import { useMyUserId } from "~/hooks/use-my-user-id";
import { useOpponentProfile } from "~/hooks/use-opponent-profile";
import { GameResultSheet } from "~/components/game-result-sheet";
import { logEvent } from "~/lib/logger";
import { playCapture, playCrystalDebit, playCrystalPing, playFlyOff, playMove, playPieceDrop, playPiecePickup } from "~/lib/sounds";
import { CrystalIcon } from "~/components/crystal-icon";
import { getFakePlayer } from "~/lib/fake-players";
import { a } from "~/utils/asset-url";

function PieceImg({ owner, isKing, className = "" }: { owner: "mine" | "opp"; isKing?: boolean; className?: string }) {
	const src = owner === "mine"
		? (isKing ? a("/chess/piece_mine_king.png") : a("/chess/piece_mine_reg.png"))
		: (isKing ? a("/chess/piece_opp_king.png") : a("/chess/piece_opp_reg.png"));
	return <img src={src} alt={owner} className={`object-contain select-none ${className}`} />;
}

type Piece = "W" | "B" | "WK" | "BK" | null;
type Board = Piece[];

interface CheckersMove { from: number; to: number; captured?: number; }
interface LocationState { myMark?: "X" | "O"; myUserId?: string; vsBot?: boolean; starterUserId?: string; opponentUserId?: string; }

interface MovingPiece {
	piece: Piece;
	isMyPiece: boolean;
	fromIdx: number;
	toIdx: number;
	active: boolean;
}

interface CapturedOverlay {
	piece: Piece;
	isMyPiece: boolean;
	idx: number;
	flying: boolean;
	/** Random fly direction: -1 left, +1 right */
	dirX: number;
	/** Horizontal distance in px */
	distX: number;
	/** Vertical distance in px */
	distY: number;
	/** Total rotation in degrees */
	angle: number;
}

const CHECKERS_RULES = [
	{ text: "Простая шашка ходит по диагонали вперёд на одну клетку." },
	{ text: "Бить можно в любую сторону — взятие обязательно. Цепочкой можно бить несколько раз подряд." },
	{ text: "Дошёл до последней горизонтали — становишься дамкой. Дамка ходит и бьёт на любое расстояние." },
	{ text: "Побеждает тот, кто съест все шашки соперника или лишит его возможности ходить." },
];

function initBoard(): Board {
	const board: Board = Array(64).fill(null);
	for (let row = 0; row < 8; row++) {
		for (let col = 0; col < 8; col++) {
			if ((row + col) % 2 !== 1) continue;
			const idx = row * 8 + col;
			if (row <= 2) board[idx] = "B";
			else if (row >= 5) board[idx] = "W";
		}
	}
	return board;
}

function pieceColor(p: Piece): "W" | "B" | null {
	if (!p) return null;
	return p[0] as "W" | "B";
}

function getCaptures(board: Board, idx: number): CheckersMove[] {
	const piece = board[idx];
	if (!piece) return [];
	const color = pieceColor(piece)!;
	const isKing = piece === "WK" || piece === "BK";
	const row = Math.floor(idx / 8);
	const col = idx % 8;
	const moves: CheckersMove[] = [];

	for (const dr of [-1, 1]) {
		for (const dc of [-1, 1]) {
			if (isKing) {
				let r = row + dr;
				let c = col + dc;
				let capturedIdx: number | null = null;
				while (r >= 0 && r <= 7 && c >= 0 && c <= 7) {
					const i = r * 8 + c;
					if (capturedIdx === null) {
						if (!board[i]) { r += dr; c += dc; continue; }
						if (pieceColor(board[i]) === color) break;
						capturedIdx = i;
					} else {
						if (board[i]) break;
						moves.push({ from: idx, to: i, captured: capturedIdx });
					}
					r += dr; c += dc;
				}
			} else {
				const midRow = row + dr;
				const midCol = col + dc;
				const toRow = row + 2 * dr;
				const toCol = col + 2 * dc;
				if (toRow < 0 || toRow > 7 || toCol < 0 || toCol > 7) continue;
				const midIdx = midRow * 8 + midCol;
				const toIdx = toRow * 8 + toCol;
				const mid = board[midIdx];
				if (mid && pieceColor(mid) !== color && !board[toIdx]) {
					moves.push({ from: idx, to: toIdx, captured: midIdx });
				}
			}
		}
	}
	return moves;
}

function getRegularMoves(board: Board, idx: number): CheckersMove[] {
	const piece = board[idx];
	if (!piece) return [];
	const color = pieceColor(piece)!;
	const isKing = piece === "WK" || piece === "BK";
	const row = Math.floor(idx / 8);
	const col = idx % 8;
	const moves: CheckersMove[] = [];

	if (isKing) {
		for (const dr of [-1, 1]) {
			for (const dc of [-1, 1]) {
				let r = row + dr;
				let c = col + dc;
				while (r >= 0 && r <= 7 && c >= 0 && c <= 7) {
					const i = r * 8 + c;
					if (board[i]) break;
					moves.push({ from: idx, to: i });
					r += dr; c += dc;
				}
			}
		}
	} else {
		const rowDirs = color === "W" ? [-1] : [1];
		for (const dr of rowDirs) {
			for (const dc of [-1, 1]) {
				const toRow = row + dr;
				const toCol = col + dc;
				if (toRow < 0 || toRow > 7 || toCol < 0 || toCol > 7) continue;
				const toIdx = toRow * 8 + toCol;
				if (!board[toIdx]) moves.push({ from: idx, to: toIdx });
			}
		}
	}
	return moves;
}

function getAllCaptures(board: Board, color: "W" | "B"): CheckersMove[] {
	const result: CheckersMove[] = [];
	for (let i = 0; i < 64; i++) {
		if (pieceColor(board[i]) === color) result.push(...getCaptures(board, i));
	}
	return result;
}

function getMovesForPiece(board: Board, idx: number, color: "W" | "B"): CheckersMove[] {
	if (getAllCaptures(board, color).length > 0) return getCaptures(board, idx);
	return getRegularMoves(board, idx);
}

/** True if `color` has at least one legal move (capture or regular). */
function hasAnyLegalMove(board: Board, color: "W" | "B"): boolean {
	for (let i = 0; i < 64; i++) {
		if (pieceColor(board[i]) === color) {
			if (getMovesForPiece(board, i, color).length > 0) return true;
		}
	}
	return false;
}

function applyMove(board: Board, move: CheckersMove): Board {
	const next = [...board] as Board;
	next[move.to] = next[move.from];
	next[move.from] = null;
	if (move.captured !== undefined) next[move.captured] = null;
	const toRow = Math.floor(move.to / 8);
	if (next[move.to] === "W" && toRow === 0) next[move.to] = "WK";
	if (next[move.to] === "B" && toRow === 7) next[move.to] = "BK";
	return next;
}

function countPieces(board: Board, color: "W" | "B"): number {
	return board.filter((p) => p && pieceColor(p) === color).length;
}

export default function Checkers() {
	const { sessionId } = useParams<{ sessionId: string }>();
	const navigate = useNavigate();
	const location = useLocation();
	const locationState = (location.state ?? {}) as LocationState;
	const signalReady = useSignalReady();
	const { state: bridgeState } = useFlutterBridge();
	const lang = bridgeState.headers?.["Accept-Language"] ?? "en";
	const t = useMemo(() => getTranslations(lang), [lang]);

	// Source of truth for userId — parses JWT directly so we never get null
	// after a remount or singleton reset.
	const realUserId = useMyUserId();
	const myUserId = realUserId ?? locationState.myUserId ?? mmClient.getMyUserId();
	// If we know the starter, recompute myMark from it (handles the case where
	// match.tsx navigated before mmClient knew the userId — we override here).
	const myMark: "X" | "O" = locationState.starterUserId && myUserId
		? (myUserId === locationState.starterUserId ? "X" : "O")
		: (locationState.myMark ?? "X");
	const [vsBot, setVsBot] = useState<boolean>(locationState.vsBot ?? false);
	// Default to TRUE — when we get here from /match, the match is already
	// confirmed by the server. Old 'Ожидаем игрока…' overlay was redundant.
	const [opponentJoined, setOpponentJoined] = useState<boolean>(true);

	// Responsive margin below board (turn hint)
	const turnHintMargin = -5;

	// Round-scoped crystals: +10 per captured opponent piece, −5 per own piece lost.
	const [roundCrystals, setRoundCrystals] = useState(0);
	const [crystalPulse, setCrystalPulse] = useState(0);
	const [lastDelta, setLastDelta] = useState<{ value: number; id: number } | null>(null);
	const addCrystals = useCallback((delta: number) => {
		setRoundCrystals((c) => c + delta);
		setCrystalPulse((p) => p + 1);
		setLastDelta({ value: delta, id: Date.now() });
		if (delta > 0) playCrystalPing();
		else           playCrystalDebit();
		setTimeout(() => setLastDelta((d) => (d && d.value === delta) ? null : d), 1200);
	}, []);
	const myColor: "W" | "B" = myMark === "X" ? "W" : "B";
	const oppColor: "W" | "B" = myColor === "W" ? "B" : "W";

	const [board, setBoard] = useState<Board>(initBoard);
	const [selected, setSelected] = useState<number | null>(null);
	const [validMoves, setValidMoves] = useState<CheckersMove[]>([]);
	const [currentTurn, setCurrentTurn] = useState<"W" | "B">("W");
	const [opponentDisconnected, setOpponentDisconnected] = useState(false);
	const [gameOver, setGameOver] = useState<"win" | "lose" | null>(null);
	const [gameOverCoinsMP, setGameOverCoinsMP] = useState<number | null>(null);
	const [gameOverCoinsBot, setGameOverCoinsBot] = useState<number | null>(null);
	// Board fly-in + piece placement animation
	const [boardSlideIn, setBoardSlideIn] = useState(false);
	const [visiblePieces, setVisiblePieces] = useState<Set<number>>(new Set());
	const [piecesReady, setPiecesReady] = useState(false);
	const bridgeFetch = useBridgeFetch();
	const resultRecorded = useRef(false);

	useEffect(() => {
		if (!gameOver || resultRecorded.current) return;
		// Record results for both bot games AND multiplayer games (so the winner
		// of an MP match also gets real platform coins issued via wallet API).
		resultRecorded.current = true;
		// Win = BASE 100 + roundCrystals (can be negative if player lost
		// pieces; floored at 0 so a win never yields negative crystals).
		const winCoins = gameOver === "win" ? Math.max(0, 100 + roundCrystals) : 0;
		const body: { gameType: string; result: "win" | "lose" | "draw"; coins?: number; sessionId?: string } = {
			gameType: "checkers",
			result: gameOver,
			coins: gameOver === "win" ? winCoins : undefined,
		};
		if (!vsBot && sessionId && !sessionId.startsWith("bot-")) body.sessionId = sessionId;
		bridgeFetch(`${API_BASE_URL}/api/v1/gameResult`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(body),
		})
			.then(async (r) => {
				const data = await r.json().catch(() => null) as { userDelta?: number; realCoinsAwarded?: number } | null;
				if (!r.ok) throw new Error(`HTTP ${r.status}`);
				if (typeof data?.userDelta === "number") setGameOverCoinsBot(data.userDelta);
				sessionStorage.setItem("crystalsChanged", String(Date.now()));
				window.dispatchEvent(new Event("crystalsChanged"));
			})
			.catch((err) => {
				resultRecorded.current = false;
			});
	}, [gameOver, vsBot, bridgeFetch]);
	// Fly-in board + sequential piece placement when game starts
	useEffect(() => {
		if (!opponentJoined) return;
		// Step 1: trigger board slide-in after 50ms
		const t1 = setTimeout(() => setBoardSlideIn(true), 50);
		// Step 2: after board lands (~600ms), place pieces one by one
		const initialPieces: number[] = [];
		for (let i = 0; i < 64; i++) { if (initBoard()[i]) initialPieces.push(i); }
		let idx = 0;
		let interval: ReturnType<typeof setInterval>;
		const t2 = setTimeout(() => {
			interval = setInterval(() => {
				if (idx >= initialPieces.length) {
					clearInterval(interval);
					setPiecesReady(true);
					return;
				}
				setVisiblePieces((prev) => new Set([...prev, initialPieces[idx++]]));
				playPieceDrop();
			}, 55);
		}, 620);
		return () => { clearTimeout(t1); clearTimeout(t2); clearInterval(interval); };
	// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [opponentJoined]);

	const [botThinking, setBotThinking] = useState(false);
	const [chainCapture, setChainCapture] = useState<number | null>(null);
	const [lastMovedTo, setLastMovedTo] = useState<number | null>(null);
	const [isAnimating, setIsAnimating] = useState(false);
	const [movingPiece, setMovingPiece] = useState<MovingPiece | null>(null);
	const [capturedOverlay, setCapturedOverlay] = useState<CapturedOverlay | null>(null);

	const boardRef = useRef<HTMLDivElement>(null);

	const isMyTurn = currentTurn === myColor && !gameOver;

	useEffect(() => { signalReady(); }, [signalReady]);

	// Map between absolute board idx and the on-screen visual position. For
	// the black player we flip the index so their own pieces render at the
	// bottom of the screen — without rotating the board frame.
	const absoluteToVisual = useCallback((absoluteIdx: number) => {
		return myColor === "B" ? 63 - absoluteIdx : absoluteIdx;
	}, [myColor]);
	const visualToAbsolute = useCallback((visualIdx: number) => {
		return myColor === "B" ? 63 - visualIdx : visualIdx;
	}, [myColor]);

	// Returns center position of a cell relative to the board element.
	// Takes an ABSOLUTE board idx and returns its on-screen visual position.
	const getCellCenter = useCallback((absoluteIdx: number) => {
		const el = boardRef.current;
		if (!el) return null;
		const { width, height } = el.getBoundingClientRect();
		const gridLeft = width * 0.11;
		const gridTop = height * 0.09;
		const cellW = width * (1 - 0.11 - 0.12) / 8;
		const cellH = height * (1 - 0.09 - 0.15) / 8;
		const visualIdx = absoluteToVisual(absoluteIdx);
		const row = Math.floor(visualIdx / 8);
		const col = visualIdx % 8;
		return {
			x: gridLeft + col * cellW + cellW / 2,
			y: gridTop + row * cellH + cellH / 2,
			size: Math.min(cellW, cellH) * 0.88,
		};
	}, [absoluteToVisual]);

	// Animate one move step; calls done(newBoard) after animation completes
	const animateMoveStep = useCallback((
		move: CheckersMove,
		currentBoard: Board,
		done: (newBoard: Board) => void,
	) => {
		const piece = currentBoard[move.from];
		const capturedPiece = move.captured !== undefined ? currentBoard[move.captured] : null;

		playMove();

		setMovingPiece({
			piece,
			isMyPiece: pieceColor(piece) === myColor,
			fromIdx: move.from,
			toIdx: move.to,
			active: false,
		});

		if (capturedPiece && move.captured !== undefined) {
			const myPieceLost = pieceColor(capturedPiece) === myColor;
			// Reward / penalty based on who lost a piece:
			//   mover is me + captured opp piece → +10
			//   mover is opp + captured my piece → −5
			const moverIsMe = pieceColor(piece) === myColor;
			if (moverIsMe && !myPieceLost) addCrystals(10);
			else if (!moverIsMe && myPieceLost) addCrystals(-5);

			const dirX = Math.random() < 0.5 ? -1 : 1;
			setCapturedOverlay({
				piece: capturedPiece,
				isMyPiece: myPieceLost,
				idx: move.captured,
				flying: false,
				dirX,
				distX: 120 + Math.random() * 100,
				distY: 160 + Math.random() * 80,
				angle: dirX * (540 + Math.random() * 360),
			});
		}

		requestAnimationFrame(() => {
			requestAnimationFrame(() => {
				setMovingPiece((prev) => prev ? { ...prev, active: true } : null);
				if (capturedPiece) {
					setTimeout(() => {
						playCapture();
						playFlyOff();
						setCapturedOverlay((prev) => prev ? { ...prev, flying: true } : null);
					}, 220);
				}
			});
		});

		setTimeout(() => {
			setMovingPiece(null);
			setCapturedOverlay(null);
			done(applyMove(currentBoard, move));
		}, 700);
	}, [myColor]);

	// Bot move logic
	useEffect(() => {
		if (!vsBot || currentTurn !== oppColor || gameOver || isAnimating) return;
		setBotThinking(true);

		const timer = setTimeout(() => {
			setBotThinking(false);
			setIsAnimating(true);

			const currentBoard = board;
			const captures = getAllCaptures(currentBoard, oppColor);

			const runChain = (moves: CheckersMove[], b: Board, stepIdx: number) => {
				if (stepIdx >= moves.length) {
					setBoard(b);
					setIsAnimating(false);
					setCurrentTurn(myColor);
					return;
				}
				animateMoveStep(moves[stepIdx], b, (nextBoard) => {
					setBoard(nextBoard);
					if (stepIdx < moves.length - 1) {
						setTimeout(() => runChain(moves, nextBoard, stepIdx + 1), 80);
					} else {
						setIsAnimating(false);
						setCurrentTurn(myColor);
					}
				});
			};

			if (captures.length === 0) {
				const all: CheckersMove[] = [];
				for (let i = 0; i < 64; i++) {
					if (pieceColor(currentBoard[i]) === oppColor) all.push(...getRegularMoves(currentBoard, i));
				}
				if (all.length === 0) { setIsAnimating(false); return; }
				runChain([all[Math.floor(Math.random() * all.length)]], currentBoard, 0);
				return;
			}

			// Build full capture chain
			const chainMoves: CheckersMove[] = [];
			let b = currentBoard;
			let move = captures[Math.floor(Math.random() * captures.length)];
			chainMoves.push(move);
			b = applyMove(b, move);
			for (;;) {
				const cont = getCaptures(b, move.to);
				if (cont.length === 0) break;
				move = cont[Math.floor(Math.random() * cont.length)];
				chainMoves.push(move);
				b = applyMove(b, move);
			}

			runChain(chainMoves, currentBoard, 0);
		}, 300 + Math.random() * 200);

		return () => clearTimeout(timer);
	// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [vsBot, currentTurn, oppColor, myColor, gameOver, isAnimating]);

	useEffect(() => {
		if (gameOver) return;
		if (countPieces(board, oppColor) === 0) setGameOver("win");
		else if (countPieces(board, myColor) === 0) setGameOver("lose");
		// Stalemate / blocked: whoever's turn it is and has no legal moves loses.
		else if (currentTurn === myColor && !hasAnyLegalMove(board, myColor)) setGameOver("lose");
		else if (currentTurn === oppColor && !hasAnyLegalMove(board, oppColor)) setGameOver("win");
	}, [board, myColor, oppColor, gameOver, currentTurn]);

	// No turn timer — players have unlimited time per move.

	// Fallback shown before server responds: use actual round crystals.
	// +100 base + roundCrystals (floored at 0). Loss always −50.
	const gameOverCoins = gameOver === "win" ? Math.max(0, 100 + roundCrystals) : -50;

	// Signal the server we've arrived at the game — server notifies opponent.
	// Retry until OPPONENT_JOINED is received. NO fake-opponent fallback —
	// we MUST wait for a real player to join.
	// Queue opponent moves — process one per render so each move sees fresh
	// closure values. Pause while a local animation is in flight (isAnimating)
	// so the move's setBoard doesn't race with the local move's setBoard.
	const [oppMoveQueue, setOppMoveQueue] = useState<CheckersMove[]>([]);
	useEffect(() => {
		if (oppMoveQueue.length === 0) return;
		// Wait for any in-flight LOCAL animation so the user's own piece
		// finishes moving before we apply opp's response. State mutations
		// in applyMove are synchronous and use a functional updater, so
		// they're race-free, but visually we want sequential animation.
		if (isAnimating) return;
		const move = oppMoveQueue[0];
		try {
			setLastMovedTo(move.to);
			setBoard((prev) => {
				const next = applyMove(prev, move);
				const canChain = move.captured !== undefined && getCaptures(next, move.to).length > 0;
				if (!canChain) setCurrentTurn(myColor);
				return next;
			});
		} catch (err) {
		}
		setOppMoveQueue((q) => q.slice(1));
	// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [oppMoveQueue, myColor, isAnimating]);

	// Watchdog — if `isAnimating` sticks for >2 s (max anim is ~600 ms),
	// force-clear it so the opponent-move queue can drain and the game
	// doesn't freeze.
	useEffect(() => {
		if (!isAnimating) return;
		const tid = setTimeout(() => {
			setIsAnimating(false);
		}, 2_000);
		return () => clearTimeout(tid);
	}, [isAnimating]);

	// 3-second heartbeat — same defence-in-depth as durak:
	//   1) Force-clear isAnimating if it's been on too long
	//   2) Force-poll the server so we never miss a move
	//   3) Log status so DevTools shows live state
	useEffect(() => {
		if (vsBot || !sessionId || sessionId.startsWith("bot-")) return;
		const id = setInterval(() => {
			if (isAnimating) setIsAnimating(false);
			mmClient.pollOnce().catch(() => {});
		}, 3000);
		return () => clearInterval(id);
	// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [vsBot, sessionId, currentTurn, isAnimating, oppMoveQueue.length]);

	const lastSyncedVersionRef = useRef<number>(-1);
	const { opponentJoined: oppJoinedFromServer, opponentOnline } = useGameSession({
		sessionId: !vsBot && sessionId && !sessionId.startsWith("bot-") ? sessionId : null,
		myUserId,
		enabled: !vsBot && !!sessionId && !sessionId.startsWith("bot-"),
		// Server-authoritative state for checkers. Overrides local
		// board/turn from the canonical server simulation. Eliminates the
		// drift bugs that caused MP freezes ("Ваш ход and opp's view also
		// says it's their opp's turn — both wait").
		onState: (rawState, version) => {
			if (version <= lastSyncedVersionRef.current) return;
			if (!("board" in rawState)) return; // narrow to checkers view
			const state = rawState;
			lastSyncedVersionRef.current = version;
			setOpponentJoined(true);
			logEvent("checkers", "sync state", {
				v: version,
				turn: state.currentTurn,
				myTurn: state.currentTurnUserId === myUserId,
				chainFrom: state.chainFrom,
				finished: state.finished?.reason ?? null,
			});
			setBoard(state.board as Board);
			setCurrentTurn(state.currentTurn);
			// Clear any in-flight selection if it's no longer this player's
			// turn (e.g., opp just moved — can't keep an old selection).
			if (state.currentTurnUserId !== myUserId) {
				setSelected(null);
				setValidMoves([]);
			}
			if (state.finished) {
				const won = state.finished.winnerId === myUserId;
				setGameOver(state.finished.isDraw ? "lose" : (won ? "win" : "lose"));
			}
		},
		onCancelled: () => navigate("/match/checkers", { replace: true }),
		onFinished: (result) => {
			const gr: "win" | "lose" = result.isDraw ? "lose" : (result.winnerId === myUserId ? "win" : "lose");
			setGameOver(gr);
		},
	});
	useEffect(() => {
		if (oppJoinedFromServer) setOpponentJoined(true);
	}, [oppJoinedFromServer]);
	// Auto-win if opponent left mid-game.
	useEffect(() => {
		if (vsBot || gameOver || !opponentJoined) return;
		if (opponentOnline) return;
		const tid = setTimeout(() => {
			setGameOver("win");
		}, 6_000);
		return () => clearTimeout(tid);
	}, [opponentOnline, opponentJoined, gameOver, vsBot]);

	const handleCellClick = (idx: number) => {
		if (!isMyTurn || isAnimating) return;
		const piece = board[idx];

		if (selected !== null) {
			const move = validMoves.find((m) => m.to === idx);
			if (move) {
				setIsAnimating(true);
				logEvent("checkers", "user move", move);
				// Reliable outbox — retries forever until the server confirms
				// the move actually landed in moves[]. Avoids the "I moved
				// but opponent never saw it" hang.
				if (!vsBot && sessionId) mmClient.queueMove(sessionId, move);

				animateMoveStep(move, board, (newBoard) => {
					setBoard(newBoard);
					setLastMovedTo(move.to);
					const continuations = move.captured !== undefined ? getCaptures(newBoard, move.to) : [];
					setIsAnimating(false);
					if (continuations.length > 0) {
						setSelected(move.to);
						setValidMoves(continuations);
						setChainCapture(move.to);
					} else {
						setSelected(null);
						setValidMoves([]);
						setChainCapture(null);
						setCurrentTurn(oppColor);
					}
				});
				return;
			}
		}

		if (chainCapture !== null) return;

		if (piece && pieceColor(piece) === myColor) {
			const moves = getMovesForPiece(board, idx, myColor);
			if (moves.length > 0) playPiecePickup();
			setSelected(idx);
			setValidMoves(moves);
		} else {
			setSelected(null);
			setValidMoves([]);
		}
	};

	const validDests = new Set(validMoves.map((m) => m.to));
	const myCount = countPieces(board, myColor);
	const oppCount = countPieces(board, oppColor);

	const status = opponentDisconnected ? (
		<span className="text-sm text-yellow-400 font-medium">⚠️ Opponent disconnected</span>
	) : gameOver ? (
		<span className={`text-base font-bold ${gameOver === "win" ? "text-yellow-400" : "text-white/50"}`}>
			{gameOver === "win" ? "🏆 " + t.youWon : "💔 " + t.youLost}
		</span>
	) : botThinking ? (
		<span className="text-sm text-white/40">🤖 Bot is thinking…</span>
	) : (
		<span className={`text-sm font-medium ${isMyTurn ? "text-emerald-400" : "text-white/30"}`}>
			{isMyTurn ? "Select a piece" : ""}
		</span>
	);

	const [showRules, setShowRules] = useState(false);
	const [closingRules, setClosingRules] = useState(false);
	const [showExitConfirm, setShowExitConfirm] = useState(false);
	const [closingExit, setClosingExit] = useState(false);

	const dismissRules = () => { setClosingRules(true); setTimeout(() => { setShowRules(false); setClosingRules(false); }, 280); };
	const dismissExit  = () => { setClosingExit(true);  setTimeout(() => { setShowExitConfirm(false); setClosingExit(false); }, 280); };

	// Pre-compute overlay positions
	const movingFrom = movingPiece ? getCellCenter(movingPiece.fromIdx) : null;
	const movingTo = movingPiece ? getCellCenter(movingPiece.toIdx) : null;
	const capturedPos = capturedOverlay ? getCellCenter(capturedOverlay.idx) : null;

	const fakePlayer = useMemo(
		() => vsBot ? getFakePlayer(sessionId ?? "demo") : null,
		[vsBot, sessionId],
	);
	const oppProfile = useOpponentProfile(!vsBot ? locationState.opponentUserId : null);
	const oppName = fakePlayer?.name ?? oppProfile?.nickname ?? "Opponent";
	void oppName; // reserved for future "captured all your pieces!" toasts

	return (
		<div
			className="fixed inset-0 flex flex-col overflow-hidden"
			style={{ backgroundImage: `url(${a("/chess/bg.png")})`, backgroundSize: "cover", backgroundPosition: "center", touchAction: "none", overscrollBehavior: "none" }}
		>
			{/* ── Header (плавающие кнопки поверх контента) ── */}
			<div className="absolute z-20 top-0 left-0 right-0 flex items-center justify-between px-4 pt-10 pointer-events-none">
				<button
					type="button"
					onClick={() => setShowExitConfirm(true)}
					className="w-12 h-12 rounded-full bg-black/45 backdrop-blur-sm flex items-center justify-center text-white active:bg-black/65 pointer-events-auto"
				>
					<svg width="16" height="16" viewBox="0 0 14 14" fill="none">
						<path d="M1 1l12 12M13 1L1 13" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"/>
					</svg>
				</button>
				<button
					type="button"
					onClick={() => setShowRules(true)}
					className="w-12 h-12 rounded-full bg-black/45 backdrop-blur-sm flex items-center justify-center text-white active:bg-black/65 pointer-events-auto"
					style={{ fontFamily: "var(--font-ubuntu)", fontSize: 22, fontWeight: 700, lineHeight: 1 }}
				>
					?
				</button>
			</div>

			{/* ── Кресло противника (всегда вверху) ── */}
			<div className="relative z-10 flex flex-col items-center w-full pt-1">
				<div className="relative flex items-end justify-center" style={{ height: 160 }}>
					<img src={a("/chess/chair.png")} alt="" className="h-full w-auto pointer-events-none select-none" style={{ maxWidth: 230 }} />
					{opponentJoined && (
						<div
							className={`absolute w-[72px] h-[72px] rounded-2xl border-2 flex items-center justify-center shadow-xl transition-colors select-none overflow-hidden ${!isMyTurn ? "border-purple-400/80" : "border-white/25"}`}
							style={{
								bottom: "32%",
								left: "50%",
								transform: "translateX(-50%)",
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
						</div>
					)}
				</div>
				{opponentJoined && (fakePlayer || oppProfile?.nickname) && (
					<div style={{ marginTop: -10, marginBottom: 8 }}>
						<span className="text-white font-bold drop-shadow-lg" style={{ fontFamily: "var(--font-ubuntu)", fontSize: "1.375rem" }}>
							{fakePlayer ? fakePlayer.name : oppProfile?.nickname}
						</span>
					</div>
				)}
			</div>

			{/* ── Ожидание: текст + кнопка по центру экрана (как в дураке) ── */}
			{!opponentJoined && (
				<div
					className="absolute z-20 left-0 right-0 flex flex-col items-center justify-center"
					style={{ top: "calc(52% - 20px)", transform: "translateY(-50%)", padding: "0 40px", gap: 14 }}
				>
					<span style={{ fontFamily: "var(--font-ubuntu)", fontSize: 22, fontWeight: 700, color: "rgba(255,255,255,0.92)", textShadow: "0 2px 12px rgba(0,0,0,0.6)", textAlign: "center" }}>
						{t.waitingForPlayer}
					</span>
					<div style={{ display: "flex", gap: 8, marginTop: 2, marginBottom: 8 }}>
						{[0, 1, 2].map((i) => (
							<div key={i} style={{ width: 10, height: 10, borderRadius: "50%", background: "rgba(255,255,255,0.85)", animation: `wait-bounce 1.4s ${i * 0.16}s infinite ease-in-out` }} />
						))}
					</div>
					<style>{`@keyframes wait-bounce { 0%, 80%, 100% { transform: scale(0); opacity: 0.3; } 40% { transform: scale(1); opacity: 1; } }`}</style>
					<button
						type="button"
						onClick={() => { mmClient.leaveQueue().catch(() => {}); mmClient.stopPolling(); setVsBot(true); setOpponentJoined(true); }}
						style={{ padding: "13px 28px", borderRadius: 999, background: "linear-gradient(to bottom, #66BB6A, #388E3C)", border: "none", borderBottom: "3px solid #1B5E20", boxShadow: "0 3px 0 #1B5E20, inset 0 1px 0 rgba(255,255,255,0.25)", fontFamily: "var(--font-ubuntu)", fontSize: 16, fontWeight: 700, color: "#fff", textShadow: "0 1px 2px rgba(0,0,0,0.35)", cursor: "pointer", transition: "transform 0.08s, box-shadow 0.08s" }}
						onPointerDown={(e) => { e.currentTarget.style.transform = "translateY(3px)"; e.currentTarget.style.boxShadow = "0 1px 0 #1B5E20, inset 0 1px 0 rgba(255,255,255,0.25)"; }}
						onPointerUp={(e) => { e.currentTarget.style.transform = ""; e.currentTarget.style.boxShadow = "0 3px 0 #1B5E20, inset 0 1px 0 rgba(255,255,255,0.25)"; }}
					>
						Играть с ботом
					</button>
				</div>
			)}

			{/* ── Кристалл-счётчик раунда (слева сверху) ── */}
			<div
				className="fixed select-none pointer-events-none"
				style={{
					left: 88,
					top: 60,
					display: "flex",
					flexDirection: "column",
					alignItems: "center",
					gap: 4,
					zIndex: 15,
				}}
			>
				<div
					key={`pulse-${crystalPulse}`}
					style={{
						width: 52, height: 54,
						display: "flex", alignItems: "center", justifyContent: "center",
						animation: crystalPulse > 0 ? "crystal-pulse 0.55s cubic-bezier(0.34, 1.56, 0.64, 1)" : "none",
					}}
				>
					<CrystalIcon size={52} />
				</div>
				<div style={{
					fontFamily: "var(--font-ubuntu)",
					fontSize: 12,
					fontWeight: 700,
					color: "#fff",
					textShadow: "0 2px 6px rgba(0,0,0,0.7)",
					background: "rgba(0,0,0,0.45)",
					padding: "1px 7px",
					borderRadius: 999,
					border: "1px solid rgba(255,255,255,0.18)",
				}}>
					{roundCrystals}
				</div>
				{lastDelta && (
					<div
						key={lastDelta.id}
						style={{
							position: "absolute",
							top: -8,
							left: "50%",
							transform: "translateX(-50%)",
							fontFamily: "var(--font-ubuntu)",
							fontSize: 16, fontWeight: 700,
							color: lastDelta.value > 0 ? "#4FC3F7" : "#EF5350",
							textShadow: "0 2px 6px rgba(0,0,0,0.7)",
							animation: "crystal-delta-float 1.1s ease-out forwards",
							pointerEvents: "none",
						}}
					>
						{lastDelta.value > 0 ? `+${lastDelta.value}` : lastDelta.value}
					</div>
				)}
				<style>{`
					@keyframes crystal-pulse {
						0%   { transform: scale(1); }
						40%  { transform: scale(1.35); filter: drop-shadow(0 0 12px rgba(100,200,255,0.9)); }
						100% { transform: scale(1); filter: none; }
					}
					@keyframes crystal-delta-float {
						0%   { transform: translateX(-50%) translateY(0); opacity: 0; }
						20%  { opacity: 1; }
						100% { transform: translateX(-50%) translateY(-36px); opacity: 0; }
					}
				`}</style>
			</div>

			{/* ── Board ── */}
			<div
				className="flex-1 flex flex-col items-center justify-start min-h-0 px-0"
				style={{
					paddingTop: "clamp(35px, calc((100vh - 750px) * 0.4 + 35px), 75px)",
					transform: opponentJoined
						? (boardSlideIn ? "translateY(0)" : "translateY(100vh)")
						: "translateY(100vh)",
					transition: boardSlideIn ? "transform 0.55s cubic-bezier(0.34,1.2,0.64,1)" : "none",
					visibility: opponentJoined ? "visible" : "hidden",
				}}
			>
				<div
					ref={boardRef}
					className="relative w-full"
				>
					<img
						src={a("/chess/board.png")}
						alt="board"
						className="w-full pointer-events-none select-none"
					/>

					{/* Grid overlay — for the black player the visual order is reversed
					    (visualIdx 0 = absolute idx 63) so their own dark pieces render
					    at the bottom of the screen. The board frame itself stays put. */}
					<div className="absolute inset-0 grid grid-cols-8 grid-rows-8 pl-[11%] pt-[9%] pr-[12%] pb-[15%]">
						{Array.from({ length: 64 }, (_, visualIdx) => {
							const absIdx = visualToAbsolute(visualIdx);
							const row = Math.floor(visualIdx / 8);
							const col = visualIdx % 8;
							const isDark = (row + col) % 2 === 1;
							const piece = board[absIdx];
							const isSelected = selected === absIdx;
							const isValidDest = validDests.has(absIdx);
							const isMyPiece = piece && pieceColor(piece) === myColor;
							const justMoved = lastMovedTo === absIdx;
							const isMovingFrom = movingPiece?.fromIdx === absIdx;
							const isCapturedAnim = capturedOverlay?.idx === absIdx;

							return (
								<button
									key={visualIdx}
									type="button"
									onClick={() => handleCellClick(absIdx)}
									className={`flex items-center justify-center relative rounded-sm
										${isSelected
											? "bg-yellow-400/40 ring-1 ring-yellow-400/60"
											: isValidDest && isDark
												? "bg-emerald-500/35"
												: justMoved
													? "bg-yellow-600/25"
													: "bg-transparent"
										}
									`}
								>
									{isValidDest && isDark && !piece && (
										<div className="w-[30%] h-[30%] rounded-full bg-emerald-400/70 shadow-lg shadow-emerald-400/40" />
									)}
									{piece && !isMovingFrom && !isCapturedAnim && (piecesReady || visiblePieces.has(absIdx)) && (
										<div
											key={`${absIdx}-${piece}`}
											className={`w-[88%] h-[88%] flex items-center justify-center transition-transform duration-200 ${isSelected ? "scale-110" : ""}`}
											style={justMoved ? { animation: "var(--animate-pop-in)" } : (visiblePieces.has(absIdx) && !piecesReady ? { animation: "piece-pop 0.2s cubic-bezier(0.34,1.56,0.64,1)" } : undefined)}
										>
											{/* Absolute colours: W → gold, B → dark. Same for both players. */}
											<PieceImg
												owner={pieceColor(piece) === "W" ? "mine" : "opp"}
												isKing={piece === "WK" || piece === "BK"}
												className="w-full h-full"
											/>
										</div>
									)}
									<style>{`@keyframes piece-pop { 0% { transform: scale(0) translateY(-8px); opacity:0; } 100% { transform: scale(1); opacity:1; } }`}</style>
								</button>
							);
						})}
					</div>

					{/* Moving piece overlay */}
					{movingPiece && movingFrom && movingTo && (
						<div
							style={{
								position: "absolute",
								left: (movingPiece.active ? movingTo.x : movingFrom.x) - movingFrom.size / 2,
								top: (movingPiece.active ? movingTo.y : movingFrom.y) - movingFrom.size / 2,
								width: movingFrom.size,
								height: movingFrom.size,
								transition: movingPiece.active
									? "left 0.36s cubic-bezier(0.4, 0, 0.2, 1), top 0.36s cubic-bezier(0.4, 0, 0.2, 1)"
									: "none",
								zIndex: 20,
								pointerEvents: "none",
							}}
						>
							<PieceImg
								owner={pieceColor(movingPiece.piece) === "W" ? "mine" : "opp"}
								isKing={movingPiece.piece === "WK" || movingPiece.piece === "BK"}
								className="w-full h-full"
							/>
						</div>
					)}

					{/* Captured piece flying off the board */}
					{capturedOverlay && capturedPos && (
						<div
							style={{
								position: "absolute",
								left: capturedPos.x - capturedPos.size / 2,
								top: capturedPos.y - capturedPos.size / 2,
								width: capturedPos.size,
								height: capturedPos.size,
								transition: capturedOverlay.flying
									? "transform 0.68s cubic-bezier(0.2, 0, 0.8, 0.4), opacity 0.68s ease-in"
									: "none",
								transform: capturedOverlay.flying
									? `translateY(-${capturedOverlay.distY}px) translateX(${capturedOverlay.dirX * capturedOverlay.distX}px) rotate(${capturedOverlay.angle}deg) scale(0.08)`
									: "none",
								opacity: capturedOverlay.flying ? 0 : 1,
								zIndex: 15,
								pointerEvents: "none",
							}}
						>
							<PieceImg
								owner={pieceColor(capturedOverlay.piece) === "W" ? "mine" : "opp"}
								isKing={capturedOverlay.piece === "WK" || capturedOverlay.piece === "BK"}
								className="w-full h-full"
							/>
						</div>
					)}
				</div>

			{/* ── Turn hint (no timer — unlimited time per move) ── */}
			{opponentJoined && !gameOver && (
				<div style={{ marginTop: turnHintMargin, display: "flex", justifyContent: "center", alignItems: "center", pointerEvents: "none", zIndex: 15, width: "100%" }}>
					<span style={{ fontFamily: "var(--font-ubuntu)", fontSize: 22, fontWeight: 700, color: "#fff", textShadow: "0 2px 12px rgba(0,0,0,0.6)" }}>
						{isMyTurn ? t.yourTurn : t.opponentTurn}
					</span>
				</div>
			)}
			</div>{/* end board container */}

			{/* ── Game over popup ── */}
			{gameOver && (
				<GameResultSheet
					result={gameOver}
					coinsWon={gameOver === "win" ? Math.max(0, gameOverCoinsMP ?? gameOverCoinsBot ?? gameOverCoins) : 0}
					lang={lang}
					onPlayAgain={() => navigate("/mode/checkers")}
					onMenu={() => navigate("/mode/checkers")}
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
						<p style={{ fontFamily: "var(--font-ubuntu)", fontSize: 17, fontWeight: 400, color: "#64728F", textAlign: "center", marginBottom: 32 }}>
							{opponentJoined
								? t.exitNoPenalty
								: t.exitNoOpponent}
						</p>
						<div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 16 }}>
							<button
								type="button"
								onClick={() => {
									dismissExit();
									if (!opponentJoined) {
										if (!vsBot) mmClient.leaveQueue().catch(() => {});
										mmClient.stopPolling();
										navigate("/");
										return;
									}
									if (!vsBot && sessionId) mmClient.resign(sessionId).catch(() => {});
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

			{/* ── Rules sheet ── */}
			{showRules && (
				<div
					className="fixed inset-0 z-50 flex flex-col justify-end"
					style={{
						backdropFilter: "blur(12px)",
						WebkitBackdropFilter: "blur(12px)",
						background: "rgba(0,0,0,0.35)",
						animation: closingRules ? "var(--animate-backdrop-out)" : "var(--animate-backdrop-in)",
						overscrollBehavior: "contain",
						touchAction: "none",
					}}
					onClick={dismissRules}
				>
					<div
						className="relative bg-white rounded-t-[32px] shadow-2xl"
						style={{ padding: "32px 24px calc(36px + env(safe-area-inset-bottom, 20px))", animation: closingRules ? "var(--animate-sheet-down)" : "var(--animate-sheet-up)", touchAction: "none" }}
						onClick={(e) => e.stopPropagation()}
					>
						<p style={{ fontFamily: "var(--font-ubuntu)", fontSize: 28, fontWeight: 700, color: "#323C5E", textAlign: "center", marginBottom: 20 }}>
							{t.checkers} — Правила
						</p>

						<ul style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 20 }}>
							{CHECKERS_RULES.map((rule, i) => (
								<li key={i} style={{ display: "flex", alignItems: "flex-start", gap: 12, padding: "13px 16px", background: "#F7F7F7", borderRadius: 14 }}>
									<span style={{ flexShrink: 0, width: 24, height: 24, borderRadius: "50%", background: "#E8E8E8", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "var(--font-ubuntu)", fontSize: 13, fontWeight: 700, color: "#64728F", marginTop: 2 }}>
										{i + 1}
									</span>
									<span style={{ fontFamily: "var(--font-ubuntu)", fontSize: 17, color: "#64728F", lineHeight: 1.5 }}>{rule.text}</span>
								</li>
							))}
						</ul>

						<div style={{ display: "flex", justifyContent: "center" }}>
							<button
								type="button"
								onClick={dismissRules}
								style={{ padding: "18px 52px", borderRadius: 999, background: "#F0196E", fontFamily: "var(--font-ubuntu)", fontSize: 20, fontWeight: 700, color: "#fff", border: "none", cursor: "pointer" }}
							>
								Понятно
							</button>
						</div>
					</div>
				</div>
			)}
		</div>
	);
}
