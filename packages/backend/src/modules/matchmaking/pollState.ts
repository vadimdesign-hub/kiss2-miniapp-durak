/**
 * In-memory matchmaking state for the HTTP-polling implementation.
 *
 * Why polling (not WebSocket):
 *  - Works through every proxy / iframe / corporate firewall.
 *  - Survives Flutter WebView backgrounding (no half-open sockets).
 *  - Trivial to debug: every interaction is a plain HTTP request you can curl.
 *
 * Liveness model: each client must hit /poll (or /joinQueue) at least every
 * ONLINE_TIMEOUT_MS ms to remain "online". A janitor runs every 3 s, prunes
 * stale presences, removes them from queues, and cancels their open sessions.
 *
 * Single-pod only (replicaCount: 1). State dies with the pod.
 */

import { randomUUID } from "node:crypto";

import type { DurakState } from "../games/durak/state.js";
import { applyMove as durakApplyMove, initialState as durakInitialState, type DurakIntent } from "../games/durak/state.js";
import type { CheckersState } from "../games/checkers/state.js";
import { applyMove as checkersApplyMove, initialState as checkersInitialState, type CheckersIntent } from "../games/checkers/state.js";

export interface UserPresence {
	userId: string;
	lastSeenAt: number;
	/** Full queue key the user is waiting in: "{gameType}:{stake}" */
	queuedFor?: string;
	/** The stake amount the user entered the queue with */
	stake?: number;
	sessionId?: string;        // active match session
	/** Lobby browsing: gameType the user is currently viewing */
	lobbyGameType?: string;
	/** Lobby browsing: stake the user has selected (updates in real-time) */
	lobbyStake?: number;
}

export interface RecordedMove {
	idx: number;
	by: string;                // userId who played
	data: unknown;             // game-specific move payload
	at: number;                // server epoch ms
}

export interface MatchSession {
	sessionId: string;
	gameType: string;
	playerOneId: string;
	playerTwoId: string;
	starterUserId: string;
	createdAt: number;
	moves: RecordedMove[];
	ready: Set<string>;        // userIds that have signalled GAME_READY
	finished?: { winnerId: string | null; isDraw: boolean; reason: string };
	cancelled?: string;        // cancellation reason (set if pre-game timeout / opponent abandon)
	// Server-authoritative game state (only durak for now; checkers can be
	// added later). Set on session creation. Bumped on every successful
	// move. The server VALIDATES every move against this state; clients
	// just submit intents and render the result.
	durakState?: DurakState;
	checkersState?: CheckersState;
	version: number;             // bumped on each accepted move
	processedClientMoves: Set<string>; // dedup by clientMoveId
}

const ONLINE_TIMEOUT_MS = 10_000;     // 10s without poll → considered offline
const HANDSHAKE_TIMEOUT_MS = 20_000;  // both sides must send GAME_READY within 20s
const SESSION_RETENTION_MS = 30 * 60 * 1000; // keep finished sessions for 30 min

export const presences = new Map<string, UserPresence>();
export const queues = new Map<string, Set<string>>();
export const sessions = new Map<string, MatchSession>();

function getQueue(gameType: string): Set<string> {
	let q = queues.get(gameType);
	if (!q) {
		q = new Set();
		queues.set(gameType, q);
	}
	return q;
}

function getOrCreatePresence(userId: string): UserPresence {
	let p = presences.get(userId);
	if (!p) {
		p = { userId, lastSeenAt: Date.now() };
		presences.set(userId, p);
	}
	return p;
}

export function touch(userId: string): UserPresence {
	const p = getOrCreatePresence(userId);
	p.lastSeenAt = Date.now();
	return p;
}

export function isOnline(userId: string): boolean {
	const p = presences.get(userId);
	return !!p && Date.now() - p.lastSeenAt < ONLINE_TIMEOUT_MS;
}

export function onlineCount(): number {
	const now = Date.now();
	let n = 0;
	for (const p of presences.values()) {
		if (now - p.lastSeenAt < ONLINE_TIMEOUT_MS) n++;
	}
	return n;
}

export function queueSize(gameType: string): number {
	return getQueue(gameType).size;
}

/**
 * Try to match userId with an online opponent in the same gameType+stake queue.
 * If a live opponent is found, creates a session and returns it.
 * Otherwise enqueues the user (if not already queued) and returns null.
 *
 * Queue key format: "{gameType}:{stake}"  e.g. "durak:100"
 */
export function tryMatchOrEnqueue(userId: string, gameType: string, stake: number): MatchSession | null {
	const queueKey = `${gameType}:${stake}`;
	const presence = touch(userId);
	const q = getQueue(queueKey);

	// Already in a session? Hand it back.
	if (presence.sessionId) {
		const existing = sessions.get(presence.sessionId);
		if (existing && !existing.finished && !existing.cancelled) {
			return existing;
		}
		presence.sessionId = undefined;
	}

	// Look for any live opponent already waiting in the same stake queue.
	for (const candidate of q) {
		if (candidate === userId) continue;
		if (isOnline(candidate)) {
			// Match found.
			q.delete(candidate);
			q.delete(userId);

			const opp = presences.get(candidate);
			if (opp) { opp.queuedFor = undefined; opp.stake = undefined; }
			presence.queuedFor = undefined;
			presence.stake = undefined;

			const sessionId = randomUUID();
			const starterUserId = Math.random() < 0.5 ? candidate : userId;
			const session: MatchSession = {
				sessionId,
				gameType,
				playerOneId: candidate,
				playerTwoId: userId,
				starterUserId,
				createdAt: Date.now(),
				moves: [],
				ready: new Set(),
				version: 0,
				processedClientMoves: new Set(),
				durakState: gameType === "durak"
					? durakInitialState({
						seed: sessionId,
						playerOneId: candidate,
						playerTwoId: userId,
						starterUserId,
					})
					: undefined,
				checkersState: gameType === "checkers"
					? checkersInitialState({
						playerOneId: candidate,
						playerTwoId: userId,
						starterUserId,
					})
					: undefined,
			};
			sessions.set(session.sessionId, session);
			if (opp) opp.sessionId = session.sessionId;
			presence.sessionId = session.sessionId;
			return session;
		}
		// Stale — drop them inline.
		q.delete(candidate);
		const stale = presences.get(candidate);
		if (stale) { stale.queuedFor = undefined; stale.stake = undefined; }
	}

	// No live opponent — enqueue self.
	q.add(userId);
	presence.queuedFor = queueKey;
	presence.stake = stake;
	return null;
}

/**
 * Register a user as "browsing the lobby" for the given gameType + stake.
 * Called whenever the lobby page opens or the user changes their stake.
 * The lobby presence expires after ONLINE_TIMEOUT_MS (same as general presence).
 */
export function setLobbyPresence(userId: string, gameType: string, stake: number): void {
	const p = touch(userId);
	p.lobbyGameType = gameType;
	p.lobbyStake = stake;
}

/**
 * Returns all online users for the given gameType (lobby, queue, or active game).
 * Excludes the requesting user.
 * inGame:true  — currently in an active session
 * inQueue:true — waiting in the matchmaking queue
 * both false   — browsing the lobby
 */
export function getLobbyPlayers(
	gameType: string,
	excludeUserId?: string,
): { userId: string; stake: number; inQueue: boolean; inGame: boolean; opponentId?: string }[] {
	const now = Date.now();
	const result: { userId: string; stake: number; inQueue: boolean; inGame: boolean; opponentId?: string }[] = [];
	for (const p of presences.values()) {
		if (p.userId === excludeUserId) continue;
		if (now - p.lastSeenAt >= ONLINE_TIMEOUT_MS) continue;
		// Players in an active (non-finished, non-cancelled) session → show as "in game"
		const activeSession = p.sessionId
			? sessions.get(p.sessionId)
			: undefined;
		const isInGame = !!activeSession && !activeSession.finished && !activeSession.cancelled;
		if (isInGame) {
			const stake = p.stake ?? p.lobbyStake ?? 0;
			const opponentId = activeSession.playerOneId === p.userId
				? activeSession.playerTwoId
				: activeSession.playerOneId;
			result.push({ userId: p.userId, stake, inQueue: false, inGame: true, opponentId });
		} else if (p.queuedFor?.startsWith(`${gameType}:`)) {
			result.push({ userId: p.userId, stake: p.stake ?? 0, inQueue: true, inGame: false });
		} else if (p.lobbyGameType === gameType && typeof p.lobbyStake === "number") {
			result.push({ userId: p.userId, stake: p.lobbyStake, inQueue: false, inGame: false });
		}
	}
	return result;
}

/**
 * Returns per-stake waiting counts + up to 5 player IDs for a given gameType.
 * Only includes stakes that have at least one player waiting.
 */
export function getQueueList(gameType: string): { stake: number; waiting: number; playerIds: string[] }[] {
	const prefix = `${gameType}:`;
	const result: { stake: number; waiting: number; playerIds: string[] }[] = [];
	for (const [key, set] of queues.entries()) {
		if (key.startsWith(prefix) && set.size > 0) {
			const stake = Number(key.slice(prefix.length));
			if (!Number.isNaN(stake)) {
				result.push({ stake, waiting: set.size, playerIds: [...set].slice(0, 5) });
			}
		}
	}
	return result.sort((a, b) => a.stake - b.stake);
}

export function leaveQueue(userId: string): void {
	const p = presences.get(userId);
	if (!p?.queuedFor) return;
	queues.get(p.queuedFor)?.delete(userId);
	p.queuedFor = undefined;
	p.stake = undefined;
}

export interface SubmitMoveResult {
	ok: boolean;
	error?: string;
	idx?: number;
	version: number;
	currentVersion?: number; // present on VERSION_CONFLICT
}

/**
 * Authoritative move submission. Validates the intent against the
 * current game state, applies it, appends to moves[] log, increments
 * the version, and dedupes by clientMoveId if provided.
 *
 * If `baseVersion` is provided and doesn't match the current version,
 * the move is rejected with VERSION_CONFLICT — caller should re-fetch
 * state and retry.
 */
export function submitMove(
	sessionId: string,
	by: string,
	data: unknown,
	clientMoveId?: string,
	baseVersion?: number,
): SubmitMoveResult {
	const s = sessions.get(sessionId);
	if (!s) return { ok: false, error: "GAME_NOT_FOUND", version: 0 };
	if (s.finished) return { ok: false, error: "GAME_ALREADY_FINISHED", version: s.version };
	if (s.cancelled) return { ok: false, error: "GAME_NOT_ACTIVE", version: s.version };
	if (s.playerOneId !== by && s.playerTwoId !== by) return { ok: false, error: "PLAYER_NOT_IN_GAME", version: s.version };

	// Dedup: if this clientMoveId was already processed, return the
	// current state without re-applying.
	if (clientMoveId && s.processedClientMoves.has(clientMoveId)) {
		const last = s.moves[s.moves.length - 1];
		return { ok: true, idx: last?.idx ?? -1, version: s.version };
	}

	// Optimistic concurrency check. The client tells us which version
	// it BASED its decision on. If the server has moved on since (e.g.,
	// opp made a move in between), this attempt is stale — reject and
	// force the client to re-fetch.
	if (typeof baseVersion === "number" && baseVersion !== s.version) {
		return { ok: false, error: "VERSION_CONFLICT", version: s.version, currentVersion: s.version };
	}

	// Authoritative path for durak.
	if (s.gameType === "durak" && s.durakState) {
		const intent = parseDurakIntent(data);
		if (!intent) return { ok: false, error: "INVALID_MOVE", version: s.version };
		const result = durakApplyMove(s.durakState, by, intent);
		if (!result.ok) return { ok: false, error: result.error ?? "INVALID_MOVE", version: s.version };
		s.durakState = result.state;
		const move: RecordedMove = { idx: s.moves.length, by, data, at: Date.now() };
		s.moves.push(move);
		s.version += 1;
		if (clientMoveId) s.processedClientMoves.add(clientMoveId);
		// Mirror finished state to the matchmaking-level finished field
		// so /poll's status surfaces correctly to the loser.
		if (result.state.phase === "finished" && result.state.finished && !s.finished) {
			s.finished = result.state.finished;
		}
		return { ok: true, idx: move.idx, version: s.version };
	}

	// Authoritative path for checkers.
	if (s.gameType === "checkers" && s.checkersState) {
		const intent = parseCheckersIntent(data);
		if (!intent) return { ok: false, error: "INVALID_MOVE", version: s.version };
		const result = checkersApplyMove(s.checkersState, by, intent);
		if (!result.ok) return { ok: false, error: result.error ?? "INVALID_MOVE", version: s.version };
		s.checkersState = result.state;
		const move: RecordedMove = { idx: s.moves.length, by, data, at: Date.now() };
		s.moves.push(move);
		s.version += 1;
		if (clientMoveId) s.processedClientMoves.add(clientMoveId);
		if (result.state.finished && !s.finished) {
			s.finished = result.state.finished;
		}
		return { ok: true, idx: move.idx, version: s.version };
	}

	// Legacy path (any non-handled gameType): client-trusted append.
	const recorded = appendMove(sessionId, by, data);
	if (!recorded) return { ok: false, error: "GAME_NOT_FOUND", version: s.version };
	s.version += 1;
	if (clientMoveId) s.processedClientMoves.add(clientMoveId);
	return { ok: true, idx: recorded.idx, version: s.version };
}

function parseCheckersIntent(data: unknown): CheckersIntent | null {
	if (!data || typeof data !== "object") return null;
	const d = data as { from?: unknown; to?: unknown; captured?: unknown };
	if (typeof d.from !== "number" || typeof d.to !== "number") return null;
	const move: CheckersIntent["move"] = { from: d.from, to: d.to };
	if (typeof d.captured === "number") move.captured = d.captured;
	return { type: "move", move };
}

function parseDurakIntent(data: unknown): DurakIntent | null {
	if (!data || typeof data !== "object") return null;
	const d = data as { action?: string; card?: { rank?: string; suit?: string }; targetIdx?: number };
	const action = d.action;
	const c = d.card && typeof d.card.rank === "string" && typeof d.card.suit === "string"
		? { rank: d.card.rank, suit: d.card.suit } as { rank: string; suit: string }
		: null;
	if (action === "attack" && c) return { type: "attack", card: c as never };
	if (action === "add" && c) return { type: "add", card: c as never };
	if (action === "defend" && c && typeof d.targetIdx === "number") {
		return { type: "defend", card: c as never, targetIdx: d.targetIdx };
	}
	if (action === "take") return { type: "take" };
	if (action === "pass") return { type: "pass" };
	return null;
}

export function appendMove(sessionId: string, by: string, data: unknown): RecordedMove | null {
	const s = sessions.get(sessionId);
	if (!s || s.finished || s.cancelled) return null;
	const move: RecordedMove = { idx: s.moves.length, by, data, at: Date.now() };
	s.moves.push(move);
	return move;
}

export function markReady(sessionId: string, userId: string): void {
	const s = sessions.get(sessionId);
	if (!s) return;
	s.ready.add(userId);
}

export function finishSession(
	sessionId: string,
	winnerId: string | null,
	isDraw: boolean,
	reason: string,
): MatchSession | null {
	const s = sessions.get(sessionId);
	if (!s || s.finished) return s ?? null;
	s.finished = { winnerId, isDraw, reason };
	// Free up presences so users can start a new game.
	const p1 = presences.get(s.playerOneId);
	const p2 = presences.get(s.playerTwoId);
	if (p1?.sessionId === sessionId) p1.sessionId = undefined;
	if (p2?.sessionId === sessionId) p2.sessionId = undefined;
	return s;
}

function cancelSession(sessionId: string, reason: string): void {
	const s = sessions.get(sessionId);
	if (!s || s.cancelled || s.finished) return;
	s.cancelled = reason;
	const p1 = presences.get(s.playerOneId);
	const p2 = presences.get(s.playerTwoId);
	if (p1?.sessionId === sessionId) p1.sessionId = undefined;
	if (p2?.sessionId === sessionId) p2.sessionId = undefined;
}

/**
 * Janitor — runs every few seconds. Prunes:
 *   - stale presences (no poll for 10s)
 *   - their queue entries
 *   - pre-game sessions whose handshake didn't complete in 20s
 *   - finished/cancelled sessions older than 30 min
 *   - mid-game sessions where one player has been offline for a while
 */
export function startJanitor(intervalMs = 3_000): { stop: () => void } {
	const tick = () => {
		const now = Date.now();

		// 1. Prune stale presences and clean queues.
		for (const [userId, p] of presences.entries()) {
			if (now - p.lastSeenAt < ONLINE_TIMEOUT_MS) continue;
			if (p.queuedFor) queues.get(p.queuedFor)?.delete(userId);
			if (p.sessionId) {
				// Player went offline mid-session. Cancel if pre-game; otherwise leave it
				// so the opponent can resign-via-timeout from the client side.
				const s = sessions.get(p.sessionId);
				if (s && !s.finished && !s.cancelled) {
					if (s.ready.size < 2) {
						cancelSession(s.sessionId, "player went offline before game started");
					}
				}
			}
			presences.delete(userId);
		}

		// 2. Cancel pre-game sessions where handshake never completed.
		for (const s of sessions.values()) {
			if (s.finished || s.cancelled) continue;
			if (s.ready.size < 2 && now - s.createdAt > HANDSHAKE_TIMEOUT_MS) {
				cancelSession(s.sessionId, "handshake timeout");
			}
		}

		// 3. Drop ancient finished/cancelled sessions.
		for (const [sid, s] of sessions.entries()) {
			if ((s.finished || s.cancelled) && now - s.createdAt > SESSION_RETENTION_MS) {
				sessions.delete(sid);
			}
		}
	};
	const id = setInterval(tick, intervalMs);
	return {
		stop() { clearInterval(id); },
	};
}

/** Snapshot for debug endpoint. */
export function getStateSnapshot() {
	const now = Date.now();
	return {
		online: onlineCount(),
		presences: [...presences.values()].map((p) => ({
			userId: p.userId,
			ageMs: now - p.lastSeenAt,
			online: now - p.lastSeenAt < ONLINE_TIMEOUT_MS,
			queuedFor: p.queuedFor,
			stake: p.stake,
			sessionId: p.sessionId,
		})),
		queues: Object.fromEntries([...queues.entries()].map(([gt, set]) => [gt, [...set]])),
		sessions: [...sessions.values()].map((s) => ({
			sessionId: s.sessionId,
			gameType: s.gameType,
			p1: s.playerOneId,
			p2: s.playerTwoId,
			starter: s.starterUserId,
			ageMs: now - s.createdAt,
			moves: s.moves.length,
			readyCount: s.ready.size,
			finished: s.finished ?? null,
			cancelled: s.cancelled ?? null,
		})),
	};
}
