/**
 * HTTP polling-based matchmaking endpoints.
 *
 * Replaces the WebSocket implementation. All client-server communication is
 * plain JSON over HTTPS — works through every proxy, iframe, and mobile
 * WebView, and survives backgrounding.
 *
 * Endpoints (all under /api/v1):
 *   POST /matchmaking/joinQueue   — { gameType } → match-or-enqueue
 *   POST /matchmaking/poll        — { sessionId?, lastMoveIdx?, ready? } → state snapshot
 *   POST /matchmaking/move        — { sessionId, move } → append a move
 *   POST /matchmaking/leaveQueue  — exit waiting queue
 *   POST /matchmaking/resign      — { sessionId } → forfeit
 *   GET  /matchmaking/debug       — full state snapshot (no auth)
 */

import type { TypeBoxTypeProvider } from "@fastify/type-provider-typebox";
import type { FastifyPluginAsync } from "fastify";
import { Type } from "typebox";

import { buildClientView as buildDurakView } from "../games/durak/state.js";
import { buildClientView as buildCheckersView } from "../games/checkers/state.js";
import {
	finishSession,
	getLobbyPlayers,
	getQueueList,
	getStateSnapshot,
	isOnline,
	leaveQueue,
	markReady,
	onlineCount,
	presences,
	queueSize,
	sessions,
	setLobbyPresence,
	startJanitor,
	submitMove,
	touch,
	tryMatchOrEnqueue,
} from "./pollState.js";
import { MatchmakingService } from "./service.js";

export const matchmakingHttpRoutes: FastifyPluginAsync = async (fastify) => {
	const app = fastify.withTypeProvider<TypeBoxTypeProvider>();
	const service = new MatchmakingService(fastify.redis, fastify.prisma, fastify.log);

	// Start the in-memory janitor that prunes stale state.
	const janitor = startJanitor();
	fastify.addHook("onClose", async () => { janitor.stop(); });
	fastify.log.info("Matchmaking (HTTP polling) initialised");

	// Open debug endpoint — viewable in browser without auth.
	fastify.get("/matchmaking/debug", async () => getStateSnapshot());

	// ── joinQueue ───────────────────────────────────────────────────────────
	app.post(
		"/matchmaking/joinQueue",
		{
			schema: {
				body: Type.Object({
					gameType: Type.String({ minLength: 1 }),
					/** Stake amount — only matches players with the same stake. */
					stake: Type.Number({ minimum: 1 }),
				}),
				tags: ["matchmaking"],
				description: "Enter the queue for a game type + stake. Matches with a live opponent of the same stake.",
			},
		},
		async (request) => {
			const userId = request.auth.userId;
			const { gameType, stake } = request.body;
			const queueKey = `${gameType}:${stake}`;

			const session = tryMatchOrEnqueue(userId, gameType, stake);
			if (session) {
				// Persist the session in the DB the moment we hand it to clients,
				// so /api/v1/gameResult can attach final results to it later.
				try {
					await fastify.prisma.gameSession.create({
						data: {
							id: session.sessionId,
							gameType,
							playerOneId: session.playerOneId,
							playerTwoId: session.playerTwoId,
						},
					});
				} catch (err) {
					fastify.log.warn({ err, sessionId: session.sessionId }, "DB session insert failed (continuing)");
				}
				fastify.log.info(
					{ sessionId: session.sessionId, p1: session.playerOneId, p2: session.playerTwoId, gameType, stake },
					"MATCH CREATED",
				);
				return {
					status: "matched" as const,
					sessionId: session.sessionId,
					playerOneId: session.playerOneId,
					playerTwoId: session.playerTwoId,
					starterUserId: session.starterUserId,
					gameType,
					online: onlineCount(),
				};
			}

			return {
				status: "queued" as const,
				gameType,
				stake,
				waiting: queueSize(queueKey),
				online: onlineCount(),
			};
		},
	);

	// ── lobbyPresence ──────────────────────────────────────────────────────
	// Called by the client on page-open and on every stake change so other
	// players can see this user in the lobby list before they click "Играть".
	app.post(
		"/matchmaking/lobbyPresence",
		{
			schema: {
				body: Type.Object({
					gameType: Type.String({ minLength: 1 }),
					stake: Type.Number({ minimum: 1 }),
				}),
				tags: ["matchmaking"],
				description: "Register lobby presence with current stake. Call on open and on stake change.",
			},
		},
		async (request) => {
			const { gameType, stake } = request.body;
			setLobbyPresence(request.auth.userId, gameType, stake);
			return { ok: true };
		},
	);

	// ── lobbyPlayers ───────────────────────────────────────────────────────
	// Returns all online users currently in the lobby for the given gameType
	// (both browsing and queued), excluding the requesting user.
	app.get(
		"/matchmaking/lobbyPlayers",
		{
			schema: {
				querystring: Type.Object({
					gameType: Type.String({ minLength: 1 }),
				}),
				tags: ["matchmaking"],
				description: "All online lobby players (browsing + queued) for a game type.",
			},
		},
		async (request) => {
			const userId = request.auth.userId;
			touch(userId);
			const { gameType } = request.query as { gameType: string };
			return getLobbyPlayers(gameType, userId);
		},
	);

	// ── queueList ──────────────────────────────────────────────────────────
	app.get(
		"/matchmaking/queueList",
		{
			schema: {
				querystring: Type.Object({
					gameType: Type.String({ minLength: 1 }),
				}),
				tags: ["matchmaking"],
				description: "Returns per-stake waiting counts for the given game type.",
			},
		},
		async (request) => {
			touch(request.auth.userId);
			const { gameType } = request.query as { gameType: string };
			return getQueueList(gameType);
		},
	);

	// ── leaveQueue ─────────────────────────────────────────────────────────
	app.post(
		"/matchmaking/leaveQueue",
		{ schema: { tags: ["matchmaking"], description: "Leave the waiting queue." } },
		async (request) => {
			leaveQueue(request.auth.userId);
			return { ok: true };
		},
	);

	// ── poll ───────────────────────────────────────────────────────────────
	// The single endpoint clients hit on a 1-2 s interval to drive the whole
	// matchmaking + game state machine.
	app.post(
		"/matchmaking/poll",
		{
			schema: {
				body: Type.Object({
					sessionId: Type.Optional(Type.String()),
					lastMoveIdx: Type.Optional(Type.Number()),
					ready: Type.Optional(Type.Boolean()),
				}),
				tags: ["matchmaking"],
				description: "Heartbeat + state fetch. Returns current state for matchmaking or active session.",
			},
		},
		async (request, reply) => {
			// Disable browser/CDN caching — /poll must always hit fresh.
			reply.header("Cache-Control", "no-store, no-cache, must-revalidate");
			reply.header("Pragma", "no-cache");
			reply.header("Expires", "0");
			const userId = request.auth.userId;
			touch(userId);

			const { sessionId, lastMoveIdx = -1, ready = false } = request.body;
			const presence = presences.get(userId)!;

			// No sessionId given — client is on the matchmaking page.
			if (!sessionId) {
				// If the user got matched in the meantime (rare race), surface it.
				if (presence.sessionId) {
					const s = sessions.get(presence.sessionId);
					if (s && !s.finished && !s.cancelled) {
						return {
							status: "matched" as const,
							sessionId: s.sessionId,
							playerOneId: s.playerOneId,
							playerTwoId: s.playerTwoId,
							starterUserId: s.starterUserId,
							gameType: s.gameType,
							online: onlineCount(),
						};
					}
				}
				if (presence.queuedFor) {
					return {
						status: "queued" as const,
						gameType: presence.queuedFor,
						waiting: queueSize(presence.queuedFor),
						online: onlineCount(),
					};
				}
				return { status: "idle" as const, online: onlineCount() };
			}

			// Session-scoped poll.
			const s = sessions.get(sessionId);
			if (!s) {
				return { status: "cancelled" as const, sessionId, reason: "session not found" };
			}
			if (s.cancelled) {
				return { status: "cancelled" as const, sessionId, reason: s.cancelled };
			}

			if (ready) {
				markReady(sessionId, userId);
			}

			const opponentId = s.playerOneId === userId ? s.playerTwoId : s.playerOneId;
			// Always return the full move log. Client-side dedup by idx is
			// O(1) per check; sending the full log eliminates an entire
			// class of cursor-drift bugs (server slice based on stale
			// client cursor → moves silently lost). Local payload is tiny
			// (~100 bytes per move × <100 moves typical = <10 KB).
			const newMoves = s.moves.slice();
			void lastMoveIdx; // intentionally unused; kept in API for compat

			// Build the player-specific authoritative game state view. For
			// durak/checkers, this is the canonical state computed by the
			// server's rules engine — clients should render this directly
			// instead of deriving their own from moves[].
			const stateView = s.durakState
				? buildDurakView(s.durakState, userId)
				: s.checkersState
					? buildCheckersView(s.checkersState, userId)
					: undefined;

			if (s.finished) {
				return {
					status: "finished" as const,
					sessionId,
					gameType: s.gameType,
					playerOneId: s.playerOneId,
					playerTwoId: s.playerTwoId,
					starterUserId: s.starterUserId,
					moves: newMoves,
					result: s.finished,
					opponentReady: s.ready.has(opponentId),
					opponentOnline: isOnline(opponentId),
					online: onlineCount(),
					version: s.version,
					state: stateView,
				};
			}

			const bothReady = s.ready.has(s.playerOneId) && s.ready.has(s.playerTwoId);
			return {
				status: bothReady ? ("playing" as const) : ("matched" as const),
				sessionId,
				gameType: s.gameType,
				playerOneId: s.playerOneId,
				playerTwoId: s.playerTwoId,
				starterUserId: s.starterUserId,
				moves: newMoves,
				opponentReady: s.ready.has(opponentId),
				opponentOnline: isOnline(opponentId),
				online: onlineCount(),
				version: s.version,
				state: stateView,
			};
		},
	);

	// ── move ───────────────────────────────────────────────────────────────
	app.post(
		"/matchmaking/move",
		{
			schema: {
				body: Type.Object({
					sessionId: Type.String(),
					move: Type.Unknown(),
					/** Optional clientMoveId (UUID). If two requests arrive
					 * with the same id, the second is a no-op (returns current
					 * state). Protects against retries causing double-apply. */
					clientMoveId: Type.Optional(Type.String()),
					/** Optional baseVersion. If provided and doesn't match the
					 * server's current version, the move is rejected with
					 * VERSION_CONFLICT — client should re-fetch state. */
					baseVersion: Type.Optional(Type.Number()),
				}),
				tags: ["matchmaking"],
				description: "Submit a move INTENT; server validates against game rules and applies.",
			},
		},
		async (request, reply) => {
			const userId = request.auth.userId;
			touch(userId);
			const { sessionId, move, clientMoveId, baseVersion } = request.body;

			const result = submitMove(sessionId, userId, move, clientMoveId, baseVersion);
			if (!result.ok) {
				// Structured logging — every move (success/fail) goes through here.
				fastify.log.warn(
					{ sessionId, userId, error: result.error, baseVersion, currentVersion: result.version, move },
					"move rejected",
				);
				const code = result.error === "GAME_NOT_FOUND" || result.error === "GAME_ALREADY_FINISHED" ? 409
					: result.error === "VERSION_CONFLICT" ? 409
					: 400;
				return reply.code(code).send({
					ok: false,
					error: result.error,
					version: result.version,
					currentVersion: result.currentVersion,
				});
			}
			// Return the player's view of the new state so the client can
			// snap to authoritative truth without waiting for the next poll.
			const s = sessions.get(sessionId);
			const stateView = s?.durakState
				? buildDurakView(s.durakState, userId)
				: s?.checkersState
					? buildCheckersView(s.checkersState, userId)
					: undefined;
			fastify.log.info(
				{ sessionId, userId, idx: result.idx, version: result.version, move },
				"move accepted",
			);
			return { ok: true, idx: result.idx, version: result.version, state: stateView };
		},
	);

	// ── resign ─────────────────────────────────────────────────────────────
	app.post(
		"/matchmaking/resign",
		{
			schema: {
				body: Type.Object({ sessionId: Type.String() }),
				tags: ["matchmaking"],
				description: "Forfeit the match — opponent wins.",
			},
		},
		async (request) => {
			const userId = request.auth.userId;
			touch(userId);
			const { sessionId } = request.body;
			const s = sessions.get(sessionId);
			if (!s || s.finished) return { ok: false };
			const winnerId = s.playerOneId === userId ? s.playerTwoId : s.playerOneId;
			const updated = finishSession(sessionId, winnerId, false, "resigned");
			if (updated) {
				// Persist final result in DB (best-effort).
				try {
					await service.finalizeSession(sessionId, winnerId, false, 0, 100);
				} catch (err) {
					fastify.log.warn({ err, sessionId }, "finalizeSession failed");
				}
			}
			return { ok: true, winnerId };
		},
	);
};
