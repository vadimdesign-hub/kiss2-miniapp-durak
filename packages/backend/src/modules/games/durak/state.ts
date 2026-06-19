/**
 * Server-authoritative state simulator for Дурак (Durak).
 *
 * The server is the single source of truth. Clients send move INTENTS,
 * the server validates against the game rules, applies the change to
 * canonical state, and ships a player-specific view back. This eliminates
 * the entire class of "two clients independently replay moves and end up
 * in slightly different states" bugs that plagued the previous client-only
 * design.
 *
 * Each player's view exposes:
 *   - their own hand cards
 *   - opponent's hand SIZE (not cards)
 *   - the deck SIZE (not cards)
 *   - trump suit + the trump card visible at the bottom
 *   - the table (attack/defense pairs)
 *   - whose turn it is, current phase, finished/winner
 *
 * Initial deal is deterministic from a seed (sessionId), so a session can
 * always be reconstructed from { seed, moves[] } if state is ever lost.
 */

// Ranks and suits MUST match the client exactly (durak.tsx uses English
// ranks: J, Q, K, A — not В, Д, К, Т). If the strings diverge, the client
// can't render server-supplied cards correctly.
export type Suit = "♠" | "♥" | "♦" | "♣";
export type Rank = "6" | "7" | "8" | "9" | "10" | "J" | "Q" | "K" | "A";

export interface Card {
	rank: Rank;
	suit: Suit;
}

export interface TableSlot {
	attack: Card;
	defense?: Card;
}

export type Phase =
	| "attacking" // attacker's turn to play a card
	| "defending" // defender's turn to beat or take
	| "finished";

export interface DurakState {
	deck: Card[];                       // remaining draw pile (top = index 0)
	trump: Suit;                        // trump suit
	trumpCard: Card;                    // visible trump card (last in deck conceptually)
	hands: Record<string, Card[]>;      // userId → hand
	table: TableSlot[];
	attackerId: string;
	defenderId: string;
	phase: Phase;
	finished?: { winnerId: string | null; isDraw: boolean; reason: string };
}

// ─── Move intents (what the client sends) ─────────────────────────────────

export type DurakIntent =
	| { type: "attack"; card: Card }       // attacker opens a slot
	| { type: "add"; card: Card }          // attacker piles on (matching rank)
	| { type: "defend"; targetIdx: number; card: Card } // defender beats slot
	| { type: "take" }                     // defender gives up, takes pile
	| { type: "pass" };                    // attacker says "all beaten, бито"

// ─── Deck construction + seeded shuffle ───────────────────────────────────

// Order MUST match client's durak.tsx (SUITS, RANKS) so that the seeded
// shuffle produces the IDENTICAL deck order on both sides.
const SUITS: Suit[] = ["♠", "♥", "♦", "♣"];
const RANKS: Rank[] = ["6", "7", "8", "9", "10", "J", "Q", "K", "A"];
const RANK_VALUE: Record<Rank, number> = {
	"6": 6, "7": 7, "8": 8, "9": 9, "10": 10, "J": 11, "Q": 12, "K": 13, "A": 14,
};

// makeDeck and seededShuffle MUST be byte-identical to the client's
// versions in durak.tsx. Even subtle differences (different seed
// hashing, different RNG, different iteration order) would produce a
// different deck order → opponent's hand on the client and server
// disagree on what cards are where.
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

// ─── Initial deal ─────────────────────────────────────────────────────────

export function initialState(opts: {
	seed: string;
	playerOneId: string;
	playerTwoId: string;
	starterUserId: string;
}): DurakState {
	const shuffled = seededShuffle(makeDeck(), opts.seed);
	// Match the client's existing convention: STARTER (myMark="X") gets
	// slice(0, 6), the other player gets slice(6, 12). This keeps the
	// initial deal animation visually consistent if the client decides to
	// overlay it before the first server state arrives.
	const starterHand = shuffled.slice(0, 6);
	const otherHand = shuffled.slice(6, 12);
	const deck = shuffled.slice(12, 35);
	const trumpCard = shuffled[35];
	const attackerId = opts.starterUserId;
	const defenderId = attackerId === opts.playerOneId ? opts.playerTwoId : opts.playerOneId;
	return {
		deck,
		trump: trumpCard.suit,
		trumpCard,
		hands: {
			[attackerId]: starterHand,
			[defenderId]: otherHand,
		},
		table: [],
		attackerId,
		defenderId,
		phase: "attacking",
	};
}

// ─── Move validation + application ────────────────────────────────────────

export interface ApplyResult {
	ok: boolean;
	error?: string;
	state: DurakState;
}

const cardEq = (a: Card, b: Card) => a.rank === b.rank && a.suit === b.suit;
const findCard = (hand: Card[], c: Card) => hand.findIndex((h) => cardEq(h, c));

/**
 * Returns true if `defense` legally beats `attack` (higher same-suit OR any trump beats non-trump,
 * trump-vs-trump compares ranks).
 */
function beats(attack: Card, defense: Card, trump: Suit): boolean {
	if (defense.suit === attack.suit) {
		return RANK_VALUE[defense.rank] > RANK_VALUE[attack.rank];
	}
	if (defense.suit === trump && attack.suit !== trump) return true;
	return false;
}

/**
 * Refill both players up to 6 cards. Attacker draws first per durak rules.
 * Returns NEW state (does not mutate input).
 */
function refill(state: DurakState): DurakState {
	const order = [state.attackerId, state.defenderId];
	const newHands = { ...state.hands };
	let deck = state.deck.slice();
	for (const uid of order) {
		const need = Math.max(0, 6 - newHands[uid].length);
		const take = deck.slice(0, need);
		newHands[uid] = [...newHands[uid], ...take];
		deck = deck.slice(need);
	}
	return { ...state, hands: newHands, deck };
}

/**
 * Check if either player has 0 cards AND deck is empty → game over.
 */
function checkGameOver(state: DurakState): DurakState {
	if (state.deck.length > 0) return state;
	const aLen = state.hands[state.attackerId]?.length ?? 0;
	const dLen = state.hands[state.defenderId]?.length ?? 0;
	// Whoever has cards left when the other is empty LOSES (they're "the
	// дурак"). If both empty simultaneously → draw.
	if (aLen === 0 && dLen === 0) {
		return { ...state, phase: "finished", finished: { winnerId: null, isDraw: true, reason: "both empty" } };
	}
	if (aLen === 0) {
		return { ...state, phase: "finished", finished: { winnerId: state.attackerId, isDraw: false, reason: "natural" } };
	}
	if (dLen === 0) {
		return { ...state, phase: "finished", finished: { winnerId: state.defenderId, isDraw: false, reason: "natural" } };
	}
	return state;
}

export function applyMove(state: DurakState, byUserId: string, intent: DurakIntent): ApplyResult {
	if (state.phase === "finished") return { ok: false, error: "GAME_FINISHED", state };

	if (intent.type === "attack" || intent.type === "add") {
		// Only the attacker may attack/add.
		if (byUserId !== state.attackerId) return { ok: false, error: "NOT_YOUR_TURN", state };
		// The defender's hand must have room to defend the new attack:
		// you can't have more table slots than the defender has cards.
		const defenderHandSize = state.hands[state.defenderId].length;
		if (state.table.length >= defenderHandSize) return { ok: false, error: "DEFENDER_FULL", state };

		const hand = state.hands[byUserId];
		const idx = findCard(hand, intent.card);
		if (idx < 0) return { ok: false, error: "CARD_NOT_IN_HAND", state };

		if (intent.type === "attack") {
			// Only legal if table is empty (otherwise it's an "add").
			if (state.table.length !== 0) return { ok: false, error: "TABLE_NOT_EMPTY", state };
		} else {
			// "add": rank must match a rank already on the table.
			const ranksOnTable = new Set<Rank>();
			for (const slot of state.table) {
				ranksOnTable.add(slot.attack.rank);
				if (slot.defense) ranksOnTable.add(slot.defense.rank);
			}
			if (!ranksOnTable.has(intent.card.rank)) return { ok: false, error: "RANK_MISMATCH", state };
		}

		const newHand = [...hand.slice(0, idx), ...hand.slice(idx + 1)];
		const newTable = [...state.table, { attack: intent.card }];
		return {
			ok: true,
			state: {
				...state,
				hands: { ...state.hands, [byUserId]: newHand },
				table: newTable,
				phase: "defending",
			},
		};
	}

	if (intent.type === "defend") {
		if (byUserId !== state.defenderId) return { ok: false, error: "NOT_YOUR_TURN", state };
		const slot = state.table[intent.targetIdx];
		if (!slot) return { ok: false, error: "NO_SUCH_SLOT", state };
		if (slot.defense) return { ok: false, error: "SLOT_ALREADY_DEFENDED", state };
		const hand = state.hands[byUserId];
		const idx = findCard(hand, intent.card);
		if (idx < 0) return { ok: false, error: "CARD_NOT_IN_HAND", state };
		if (!beats(slot.attack, intent.card, state.trump)) return { ok: false, error: "ILLEGAL_BEAT", state };

		const newHand = [...hand.slice(0, idx), ...hand.slice(idx + 1)];
		const newTable = state.table.map((s, i) =>
			i === intent.targetIdx ? { ...s, defense: intent.card } : s,
		);
		const allDefended = newTable.every((s) => s.defense);
		return {
			ok: true,
			state: {
				...state,
				hands: { ...state.hands, [byUserId]: newHand },
				table: newTable,
				// If everything's been defended, control returns to attacker
				// to either pile on more or call "бито".
				phase: allDefended ? "attacking" : "defending",
			},
		};
	}

	if (intent.type === "take") {
		if (byUserId !== state.defenderId) return { ok: false, error: "NOT_YOUR_TURN", state };
		if (state.table.length === 0) return { ok: false, error: "EMPTY_TABLE", state };
		// Defender takes ALL cards from the table.
		const allCards: Card[] = [];
		for (const s of state.table) {
			allCards.push(s.attack);
			if (s.defense) allCards.push(s.defense);
		}
		const newDefHand = [...state.hands[state.defenderId], ...allCards];
		// Refill: attacker first (defender keeps their pile, no refill for them).
		// Per durak rules: only attacker refills, defender keeps the cards they took.
		let next: DurakState = {
			...state,
			hands: { ...state.hands, [state.defenderId]: newDefHand },
			table: [],
			phase: "attacking",
		};
		// Refill attacker only.
		const attHand = next.hands[next.attackerId];
		const need = Math.max(0, 6 - attHand.length);
		const draw = next.deck.slice(0, need);
		next = {
			...next,
			hands: { ...next.hands, [next.attackerId]: [...attHand, ...draw] },
			deck: next.deck.slice(need),
		};
		// Roles do NOT swap on take — attacker remains attacker.
		return { ok: true, state: checkGameOver(next) };
	}

	if (intent.type === "pass") {
		// Only attacker may declare "бито", and only when all attacks defended.
		if (byUserId !== state.attackerId) return { ok: false, error: "NOT_YOUR_TURN", state };
		if (state.table.length === 0) return { ok: false, error: "EMPTY_TABLE", state };
		const allDefended = state.table.every((s) => s.defense);
		if (!allDefended) return { ok: false, error: "UNDEFENDED_SLOTS", state };

		// Cards go to discard (we just drop them — no need to track the discard pile).
		let next: DurakState = { ...state, table: [], phase: "attacking" };
		// Refill both players, attacker first.
		next = refill(next);
		// Roles SWAP after a successful round.
		next = {
			...next,
			attackerId: state.defenderId,
			defenderId: state.attackerId,
		};
		return { ok: true, state: checkGameOver(next) };
	}

	return { ok: false, error: "UNKNOWN_INTENT", state };
}

// ─── Player-specific view ─────────────────────────────────────────────────

export interface DurakClientView {
	yourHand: Card[];
	opponentHandCount: number;
	deckCount: number;
	trump: Suit;
	trumpCard: Card;
	table: TableSlot[];
	attackerUserId: string;
	defenderUserId: string;
	phase: Phase;
	currentTurnUserId: string;
	finished: DurakState["finished"];
}

export function buildClientView(state: DurakState, forUserId: string): DurakClientView {
	const opponentId = forUserId === state.attackerId ? state.defenderId : state.attackerId;
	// Whose turn?
	let currentTurnUserId: string;
	if (state.phase === "attacking") currentTurnUserId = state.attackerId;
	else if (state.phase === "defending") currentTurnUserId = state.defenderId;
	else currentTurnUserId = state.attackerId; // finished — doesn't matter
	return {
		yourHand: state.hands[forUserId] ?? [],
		opponentHandCount: state.hands[opponentId]?.length ?? 0,
		deckCount: state.deck.length,
		trump: state.trump,
		trumpCard: state.trumpCard,
		table: state.table,
		attackerUserId: state.attackerId,
		defenderUserId: state.defenderId,
		phase: state.phase,
		currentTurnUserId,
		finished: state.finished,
	};
}
