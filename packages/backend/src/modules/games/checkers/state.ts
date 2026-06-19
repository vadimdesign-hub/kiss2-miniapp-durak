/**
 * Server-authoritative state simulator for Шашки (Checkers / Russian draughts).
 *
 * Mirrors the durak module's design: server holds canonical state, validates
 * every intent against the rules, and returns a player-specific client view.
 *
 * Rules implemented (Russian variant):
 *  - 8x8 board, dark squares only.
 *  - White starts at rows 5-7, black at rows 0-2.
 *  - Men move 1 square diagonally forward.
 *  - Captures: jump over an enemy piece into the empty square beyond.
 *    Captures are MANDATORY: if any capture exists, you can't make a
 *    non-capture move.
 *  - Chain captures: if landing on a square allows another capture, you
 *    MUST continue (turn doesn't switch until the chain is exhausted).
 *  - Promotion: man reaches the last row → king. Kings move/capture any
 *    distance along diagonals.
 *  - Game over: opponent has no pieces, or no legal move on their turn.
 */

export type Piece = "W" | "B" | "WK" | "BK" | null;
export type Board = Piece[]; // length 64, row-major (idx = row*8 + col)

export interface CheckersMove {
	from: number;
	to: number;
	captured?: number;
}

export interface CheckersState {
	board: Board;
	whiteUserId: string;
	blackUserId: string;
	currentTurn: "W" | "B";
	/** When set, the player MUST continue capturing from this square. */
	chainFrom: number | null;
	finished?: { winnerId: string | null; isDraw: boolean; reason: string };
}

export type CheckersIntent = { type: "move"; move: CheckersMove };

// ─── Pure rule helpers ────────────────────────────────────────────────────

function pieceColor(p: Piece): "W" | "B" | null {
	if (!p) return null;
	return p[0] as "W" | "B";
}

function isKing(p: Piece): boolean {
	return p === "WK" || p === "BK";
}

function getCaptures(board: Board, idx: number): CheckersMove[] {
	const piece = board[idx];
	if (!piece) return [];
	const color = pieceColor(piece)!;
	const king = isKing(piece);
	const row = Math.floor(idx / 8);
	const col = idx % 8;
	const moves: CheckersMove[] = [];

	for (const dr of [-1, 1]) {
		for (const dc of [-1, 1]) {
			if (king) {
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
	const king = isKing(piece);
	const row = Math.floor(idx / 8);
	const col = idx % 8;
	const moves: CheckersMove[] = [];

	if (king) {
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
		// Whites move toward row 0 (decreasing row), blacks toward row 7.
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

function getLegalMovesForPiece(board: Board, idx: number, color: "W" | "B"): CheckersMove[] {
	if (getAllCaptures(board, color).length > 0) {
		// Capture is mandatory — only captures are legal.
		return getCaptures(board, idx);
	}
	return getRegularMoves(board, idx);
}

function hasAnyLegalMove(board: Board, color: "W" | "B"): boolean {
	for (let i = 0; i < 64; i++) {
		if (pieceColor(board[i]) === color) {
			if (getLegalMovesForPiece(board, i, color).length > 0) return true;
		}
	}
	return false;
}

function applyBoardMove(board: Board, move: CheckersMove): Board {
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

// ─── Initial state ────────────────────────────────────────────────────────

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

export function initialState(opts: {
	playerOneId: string;
	playerTwoId: string;
	starterUserId: string;
}): CheckersState {
	// Starter plays white (white moves first in standard checkers).
	const whiteUserId = opts.starterUserId;
	const blackUserId = whiteUserId === opts.playerOneId ? opts.playerTwoId : opts.playerOneId;
	return {
		board: initBoard(),
		whiteUserId,
		blackUserId,
		currentTurn: "W",
		chainFrom: null,
	};
}

// ─── Validate + apply ─────────────────────────────────────────────────────

export interface ApplyResult {
	ok: boolean;
	error?: string;
	state: CheckersState;
}

export function applyMove(
	state: CheckersState,
	byUserId: string,
	intent: CheckersIntent,
): ApplyResult {
	if (state.finished) return { ok: false, error: "GAME_FINISHED", state };
	if (intent.type !== "move") return { ok: false, error: "UNKNOWN_INTENT", state };

	const { move } = intent;
	const expectedUserId = state.currentTurn === "W" ? state.whiteUserId : state.blackUserId;
	if (byUserId !== expectedUserId) return { ok: false, error: "NOT_YOUR_TURN", state };

	// Bounds + basic shape.
	if (move.from < 0 || move.from > 63 || move.to < 0 || move.to > 63) {
		return { ok: false, error: "OUT_OF_BOUNDS", state };
	}

	const piece = state.board[move.from];
	if (!piece) return { ok: false, error: "NO_PIECE", state };
	if (pieceColor(piece) !== state.currentTurn) {
		return { ok: false, error: "NOT_YOUR_PIECE", state };
	}

	// Mid-chain: only allow continuing FROM the chain piece, AND only captures.
	if (state.chainFrom !== null && move.from !== state.chainFrom) {
		return { ok: false, error: "MUST_CONTINUE_CHAIN", state };
	}

	// Check the move is in the legal moves list. Do this against the canonical
	// rule helper rather than trusting client-supplied `captured`.
	const legalMoves = state.chainFrom !== null
		? getCaptures(state.board, move.from)
		: getLegalMovesForPiece(state.board, move.from, state.currentTurn);
	const matches = legalMoves.find((m) =>
		m.from === move.from
		&& m.to === move.to
		&& (m.captured ?? -1) === (move.captured ?? -1),
	);
	if (!matches) return { ok: false, error: "ILLEGAL_MOVE", state };

	// Apply.
	const newBoard = applyBoardMove(state.board, matches);

	// Chain capture? If this move captured AND the landing square has more
	// captures available, the SAME player continues from `to`.
	let newChainFrom: number | null = null;
	let newCurrentTurn = state.currentTurn;
	if (matches.captured !== undefined && getCaptures(newBoard, matches.to).length > 0) {
		newChainFrom = matches.to;
	} else {
		newCurrentTurn = state.currentTurn === "W" ? "B" : "W";
	}

	let next: CheckersState = {
		...state,
		board: newBoard,
		currentTurn: newCurrentTurn,
		chainFrom: newChainFrom,
	};

	// Check game over: opponent has no pieces OR no legal moves.
	const oppColor = newCurrentTurn;
	if (countPieces(newBoard, oppColor) === 0 || !hasAnyLegalMove(newBoard, oppColor)) {
		const winnerId = newCurrentTurn === "W" ? state.blackUserId : state.whiteUserId;
		next = {
			...next,
			finished: { winnerId, isDraw: false, reason: "natural" },
		};
	}

	return { ok: true, state: next };
}

// ─── Player view ──────────────────────────────────────────────────────────

export interface CheckersClientView {
	board: Board;
	whiteUserId: string;
	blackUserId: string;
	currentTurn: "W" | "B";
	currentTurnUserId: string;
	chainFrom: number | null;
	finished?: CheckersState["finished"];
}

export function buildClientView(state: CheckersState, _forUserId: string): CheckersClientView {
	void _forUserId; // checkers has no hidden info — same view for both.
	return {
		board: state.board,
		whiteUserId: state.whiteUserId,
		blackUserId: state.blackUserId,
		currentTurn: state.currentTurn,
		currentTurnUserId: state.currentTurn === "W" ? state.whiteUserId : state.blackUserId,
		chainFrom: state.chainFrom,
		finished: state.finished,
	};
}
