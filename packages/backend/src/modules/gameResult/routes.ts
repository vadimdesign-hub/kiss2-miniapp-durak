import { randomUUID } from "node:crypto";
import type { TypeBoxTypeProvider } from "@fastify/type-provider-typebox";
import type { FastifyPluginAsync } from "fastify";
import { Type } from "typebox";

// sendServerAnalytics is available at runtime but not yet in the installed lib typings.
// Cast through unknown to avoid `any` lint — the method exists on the runtime object.
function sendServerAnalytics(
	producer: unknown,
	event: unknown,
	analyticsHeaders: unknown,
): Promise<void> {
	return (
		producer as Record<string, (a: unknown, b: unknown) => Promise<void>>
	).sendServerAnalytics(event, analyticsHeaders);
}

import { finishSession, sessions } from "../matchmaking/pollState.js";

// Default flat coin reward when no stake is provided (bot games / legacy).
const COINS_FOR_WIN_DEFAULT = 10;
const COINS_FOR_DRAW = 0;

/**
 * Platform commission rate (10%).
 *
 * Applied to stake games only — commission taken from the WINNER'S prize:
 *   winner Δ = floor(stake × (1 − COMMISSION_RATE))   e.g. +90 for stake 100
 *   loser  Δ = −stake                                  e.g. −100 for stake 100
 *
 * Example: both stake 100 → winner receives 190 total (100 own + 90 prize).
 */
const COMMISSION_RATE = 0.10;

interface GameResultRoutesOptions {
	walletApiUrl: string;
	serviceName: string;
}

/**
 * Adjust real platform coins for a user via the wallet API.
 * Positive amount = credit, negative = debit.
 * Service-to-service auth via X-Forward-* headers (no JWT needed).
 */
async function adjustRealCoins(
	walletApiUrl: string,
	source: string,
	userId: string,
	amount: number,
	// biome-ignore lint/suspicious/noExplicitAny: fastify logger type
	logger: any,
): Promise<void> {
	if (amount === 0) return;
	try {
		const res = await fetch(`${walletApiUrl}/api/v1/userBalance/transaction`, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				"X-Forward-Role": "admin",
				"X-Forward-User-Id": userId,
			},
			body: JSON.stringify([
				{ userId, type: "coin", quantity: amount, source },
			]),
		});
		if (!res.ok) {
			const text = await res.text().catch(() => "");
			logger.error({ userId, amount, status: res.status, text }, "Wallet API rejected coin adjustment");
		} else {
			logger.info({ userId, amount, source }, amount > 0 ? "Real coins credited" : "Real coins debited");
		}
	} catch (err) {
		logger.error({ err, userId, amount }, "Failed to call wallet API");
	}
}

const FAKE_PLAYERS = ["alice", "bob", "charlie", "diana", "eve", "frank", "grace", "hank", "iris", "jack"];
const GAME_TYPES = ["checkers", "durak"];

// ── Auto-seed: called on startup, inserts fake players only if they don't exist yet ──
export async function seedFakePlayersIfNeeded(
	// biome-ignore lint/suspicious/noExplicitAny: accepts any Prisma client
	prisma: any,
): Promise<void> {
	const existing = await prisma.gameResult.count({ where: { winnerId: { in: FAKE_PLAYERS } } });
	if (existing > 0) return; // already seeded

	for (const player of FAKE_PLAYERS) {
		const wins = Math.floor(Math.random() * 18) + 4;
		for (let i = 0; i < wins; i++) {
			const opponents = FAKE_PLAYERS.filter((p) => p !== player);
			const opponent = opponents[Math.floor(Math.random() * opponents.length)];
			const gameType = GAME_TYPES[Math.floor(Math.random() * GAME_TYPES.length)];
			const session = await prisma.gameSession.create({
				data: { gameType, playerOneId: randomUUID(), playerTwoId: randomUUID(), status: "finished" },
			});
			await prisma.gameResult.create({
				data: {
					sessionId: session.id,
					gameType,
					winnerId: player,
					loserId: opponent,
					isDraw: false,
					durationSeconds: Math.floor(Math.random() * 300) + 30,
					coinsAwarded: COINS_FOR_WIN_DEFAULT,
				},
			});
		}
	}
}

export const gameResultRoutes: FastifyPluginAsync<GameResultRoutesOptions> = async (fastify, opts) => {
	const app = fastify.withTypeProvider<TypeBoxTypeProvider>();
	const { walletApiUrl, serviceName } = opts;

	// Record a game result for the current user (bot OR multiplayer).
	// On win, also issues real platform coins via the wallet API:
	//   realCoins = round(crystals / 3)
	app.post(
		"/gameResult",
		{
			schema: {
				body: Type.Object({
					gameType: Type.String(),
					result: Type.Union([Type.Literal("win"), Type.Literal("lose"), Type.Literal("draw")]),
					coins: Type.Optional(Type.Number()),
					/**
					 * Stake amount agreed before the match.
					 * Winner receives +stake, loser pays -stake.
					 * If absent, falls back to the flat default (bot games / legacy).
					 */
					stake: Type.Optional(Type.Number({ minimum: 0 })),
					/** Optional sessionId for multiplayer games — if absent we treat as bot game. */
					sessionId: Type.Optional(Type.String()),
					/** Game duration in seconds. */
					durationSeconds: Type.Optional(Type.Number({ minimum: 0 })),
					/** Time spent waiting for opponent before game started. */
					waitSeconds: Type.Optional(Type.Number({ minimum: 0 })),
					/** Trump suit: "♠"|"♥"|"♦"|"♣" */
					trump: Type.Optional(Type.String()),
					/** Who moved first: "me" | "opp" */
					firstMover: Type.Optional(Type.String()),
					/** Whether the player left early (resigned). */
					leftEarly: Type.Optional(Type.Boolean()),
					/** How many times the player took cards from the table. */
					cardsTaken: Type.Optional(Type.Integer({ minimum: 0 })),
					/** How many attacks the player successfully defended. */
					cardsDefended: Type.Optional(Type.Integer({ minimum: 0 })),
					/** How many attacks the player made. */
					attacksMade: Type.Optional(Type.Integer({ minimum: 0 })),
					/** Total moves made in the game. */
					totalMoves: Type.Optional(Type.Integer({ minimum: 0 })),
				}),
				tags: ["gameResult"],
				description: "Record game result + issue real platform coins on win",
			},
		},
		async (request) => {
			const userId = request.auth.userId;
			const { gameType, result, coins, stake, sessionId, durationSeconds, waitSeconds, trump, firstMover, leftEarly, cardsTaken, cardsDefended, attacksMade, totalMoves } = request.body;

			const isDraw = result === "draw";
			const isWin = result === "win";
			const opponentLabel = sessionId ? "opponent" : "bot";
			const winnerId = isWin ? userId : isDraw ? null : opponentLabel;
			const loserId = isWin ? opponentLabel : isDraw ? null : userId;

			// Coin delta for real platform wallet with commission:
			//   Stake game  → winner: +floor(stake × 0.8),  loser: -stake
			//   Bot / legacy → winner: +default,              loser: 0  (no real money)
			const stakeAmount = typeof stake === "number" && stake > 0 ? stake : null;
			const flatDefault = COINS_FOR_WIN_DEFAULT;

			let coinDelta: number;
			let coinsAwarded: number;
			if (stakeAmount !== null) {
				// Stake game with commission on winner's prize only.
				// winner gets: own stake back + floor(opponent's stake × 0.9)
				// winner Δ (wallet change) = floor(stake × 0.9)  e.g. +90 for stake 100
				const winnerDelta = Math.floor(stakeAmount * (1 - COMMISSION_RATE)); // e.g. +90
				coinDelta = isWin ? winnerDelta : isDraw ? 0 : -stakeAmount;
				coinsAwarded = isWin ? stakeAmount + winnerDelta : isDraw ? COINS_FOR_DRAW : 0;
			} else {
				// Bot / legacy flat reward — no commission, no debit.
				const flatDelta = isWin ? flatDefault : isDraw ? COINS_FOR_DRAW : 0;
				coinDelta = flatDelta;
				coinsAwarded = isWin ? (typeof coins === "number" && coins >= 0 ? coins : flatDefault) : isDraw ? COINS_FOR_DRAW : 0;
			}

			// For MP games we already have a GameSession from matchmaking; reuse it.
			// For bot games, create a synthetic one.
			let actualSessionId = sessionId ?? null;
			if (actualSessionId) {
				// Tell pollState the session is finished so the OPPONENT's
				// next /poll surfaces status:"finished" with the result —
				// otherwise they'd be stuck on the playing screen because
				// game-over detection is purely client-side.
				const inMemSession = sessions.get(actualSessionId);
				if (inMemSession && !inMemSession.finished && !inMemSession.cancelled) {
					const realWinnerId = isWin ? userId : (inMemSession.playerOneId === userId
						? inMemSession.playerTwoId
						: inMemSession.playerOneId);
					finishSession(actualSessionId, isDraw ? null : realWinnerId, isDraw, "natural");
				}
				// Try to mark existing session as finished (best-effort)
				try {
					await app.prisma.gameSession.update({
						where: { id: actualSessionId },
						data: { status: "finished" },
					});
				} catch {
					actualSessionId = null; // session not found in DB → fall through to synthetic
				}
			}
			if (!actualSessionId) {
				const synthetic = await app.prisma.gameSession.create({
					data: {
						gameType,
						playerOneId: userId,
						playerTwoId: randomUUID(),
						status: "finished",
					},
				});
				actualSessionId = synthetic.id;
			}

			// Idempotency: don't double-award if a result for this session+winner already exists.
			const existing = await app.prisma.gameResult.findFirst({
				where: { sessionId: actualSessionId, winnerId },
			});

			let realCoinsAwarded = 0;
			if (!existing) {
				await app.prisma.gameResult.create({
					data: {
						sessionId: actualSessionId,
						gameType,
						winnerId,
						loserId,
						isDraw,
						durationSeconds: 0,
						coinsAwarded,
					},
				});

				// Adjust real platform coins (winner +stake, loser -stake, or flat default).
				if (coinDelta !== 0) {
					await adjustRealCoins(
						walletApiUrl,
						`${serviceName}.gameResult.${gameType}`,
						userId,
						coinDelta,
						app.log,
					);
					realCoinsAwarded = coinDelta;
				}
			}

			// Fire server analytics — non-fatal, never breaks the main response.
			try {
				const now = new Date().toISOString();
				const vsBot = !sessionId || sessionId.startsWith("bot-");
				const commissionCoins =
					stakeAmount !== null && isWin
						? stakeAmount - Math.floor(stakeAmount * (1 - COMMISSION_RATE))
						: 0;

				await sendServerAnalytics(
					app.kafka.producer,
					{
						entity: "gameResult",
						action: "created",
						eventVersion: 1,
						new: {
							actors: [{ role: isWin ? "winner" : isDraw ? "player" : "loser", userId }],
							createdAt: now,
							updatedAt: now,
							meta: {
								vsBot,
								// omit stake for bot/legacy games (no agreed stake)
								...(stakeAmount !== null && { stake: stakeAmount }),
								// omit commissionCoins when zero (draws, bot games)
								...(commissionCoins > 0 && { commissionCoins }),
							},
							id: actualSessionId,
							userId,
							status: isDraw ? "draw" : isWin ? "win" : "lose",
							type: gameType,
							source: vsBot ? "bot" : "pvp",
						},
					},
					request.analyticsHeaders,
				);
			} catch (err) {
				app.log.warn({ err }, "gameResult analytics: failed to emit (non-fatal)");
			}

			return { ok: true, coinsAwarded, userDelta: coinDelta, realCoinsAwarded };
		},
	);

	// Dev-only: seed fake players into the leaderboard
	app.post(
		"/dev/seed",
		{
			schema: {
				tags: ["dev"],
				description: "Populate leaderboard with fake players for testing",
			},
		},
		async () => {
			let created = 0;
			for (const player of FAKE_PLAYERS) {
				const wins = Math.floor(Math.random() * 18) + 4;
				for (let i = 0; i < wins; i++) {
					const opponents = FAKE_PLAYERS.filter((p) => p !== player);
					const opponent = opponents[Math.floor(Math.random() * opponents.length)];
					const gameType = GAME_TYPES[Math.floor(Math.random() * GAME_TYPES.length)];

					const session = await app.prisma.gameSession.create({
						data: { gameType, playerOneId: randomUUID(), playerTwoId: randomUUID(), status: "finished" },
					});

					await app.prisma.gameResult.create({
						data: {
							sessionId: session.id,
							gameType,
							winnerId: player,
							loserId: opponent,
							isDraw: false,
							durationSeconds: Math.floor(Math.random() * 300) + 30,
							coinsAwarded: COINS_FOR_WIN_DEFAULT,
						},
					});
					created++;
				}
			}
			return { ok: true, created };
		},
	);

	/* ── Dev: reset MY game history + seed starter crystals (checkers 200 + durak 100 = 300) ── */
	app.post(
		"/dev/resetMyStats",
		{
			schema: {
				tags: ["dev"],
				description: "Delete all my game results and seed 300 starter crystals (2 checkers wins + 1 durak win)",
			},
		},
		async (request) => {
			const userId = request.auth.userId;

			// 1. Wipe everything involving this user.
			const deleted = await app.prisma.gameResult.deleteMany({
				where: { OR: [{ winnerId: userId }, { loserId: userId }] },
			});

			// 2. Seed starter wins: 2 × checkers (+200) + 1 × durak (+100) = 300 net.
			const seedPlan: { gameType: string }[] = [
				{ gameType: "checkers" },
				{ gameType: "checkers" },
				{ gameType: "durak" },
			];
			let seeded = 0;
			for (const { gameType } of seedPlan) {
				const session = await app.prisma.gameSession.create({
					data: { gameType, playerOneId: userId, playerTwoId: randomUUID(), status: "finished" },
				});
				await app.prisma.gameResult.create({
					data: {
						sessionId: session.id,
						gameType,
						winnerId: userId,
						loserId: "bot",
						isDraw: false,
						durationSeconds: 0,
						coinsAwarded: COINS_FOR_WIN_DEFAULT, // 100
					},
				});
				seeded++;
			}

			return { ok: true, deleted: deleted.count, seeded, starterTotal: 300 };
		},
	);
};
