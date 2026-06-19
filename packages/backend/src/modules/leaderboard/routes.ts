import type { TypeBoxTypeProvider } from "@fastify/type-provider-typebox";
import type { FastifyPluginAsync } from "fastify";
import { Type } from "typebox";

const LeaderboardEntryDto = Type.Object({
	rank: Type.Integer(),
	userId: Type.String(),
	totalCoins: Type.Integer(),
	wins: Type.Integer(),
});

const LeaderboardResponseDto = Type.Object({
	entries: Type.Array(LeaderboardEntryDto),
	myEntry: Type.Union([LeaderboardEntryDto, Type.Null()]),
});

// ─── Rewards (keep in sync with backend/gameResult & frontend) ────────────────
// +100 per win, −50 per loss, +10 per draw. Losses contribute 0 to `coinsAwarded`
// but increment the loser's counter → we subtract 50×losses in the aggregation.
const COINS_FOR_WIN = 100;
const COINS_FOR_DRAW = 10;
const COINS_PENALTY_FOR_LOSS = 50;
void COINS_FOR_WIN; void COINS_FOR_DRAW; // referenced for doc only

interface NetRow {
	userId: string;
	total_coins: number | string | bigint;
	wins: number | string | bigint;
}

export const leaderboardRoutes: FastifyPluginAsync = async (fastify) => {
	const app = fastify.withTypeProvider<TypeBoxTypeProvider>();

	app.get(
		"/leaderboard",
		{
			schema: {
				querystring: Type.Object({
					gameType: Type.Optional(
						Type.Union([
							Type.Literal("checkers"),
							Type.Literal("durak"),
						]),
					),
				}),
				response: { 200: LeaderboardResponseDto },
				tags: ["leaderboard"],
				description: "Top-50 players by NET crystals (wins add coinsAwarded; each loss subtracts 50).",
			},
		},
		async (request) => {
			const userId = request.auth.userId;
			const { gameType } = request.query;

			/*
			 * Single raw SQL that computes net per user:
			 *   net = SUM(coins_awarded when user=winner) − 50 × COUNT(when user=loser)
			 *   wins = COUNT(when user=winner)
			 *
			 * UNION ALL of (winners perspective) and (losers perspective),
			 * then GROUP BY userId for the sum.
			 */
			const gameFilter = gameType ? `AND game_type = '${gameType}'` : "";

			const rows = await app.prisma.$queryRawUnsafe<NetRow[]>(`
				SELECT
					u AS "userId",
					SUM(win_coins) - (${COINS_PENALTY_FOR_LOSS} * SUM(loss_count)) AS total_coins,
					SUM(win_count) AS wins
				FROM (
					SELECT winner_id AS u,
					       coins_awarded AS win_coins,
					       1 AS win_count,
					       0 AS loss_count
					FROM game_results
					WHERE winner_id IS NOT NULL ${gameFilter}
					UNION ALL
					SELECT loser_id AS u,
					       0 AS win_coins,
					       0 AS win_count,
					       1 AS loss_count
					FROM game_results
					WHERE loser_id IS NOT NULL ${gameFilter}
				) combined
				GROUP BY u
				ORDER BY total_coins DESC
				LIMIT 200
			`);

			const all = rows.map((r) => ({
				userId: r.userId,
				totalCoins: Number(r.total_coins),
				wins: Number(r.wins),
			}));

			const top = all.slice(0, 50).map((e, i) => ({ rank: i + 1, ...e }));

			// myEntry: if in top, return that; else compute rank from the full list.
			let myEntry = top.find((e) => e.userId === userId) ?? null;
			if (!myEntry) {
				const mineIdx = all.findIndex((e) => e.userId === userId);
				if (mineIdx >= 0) {
					myEntry = { rank: mineIdx + 1, ...all[mineIdx] };
				}
			}

			return { entries: top, myEntry };
		},
	);

	/* ── Debug: explicit breakdown of my crystals (useful during dev) ── */
	app.get(
		"/myStats",
		{
			schema: {
				response: {
					200: Type.Object({
						userId: Type.String(),
						byGame: Type.Array(Type.Object({
							gameType: Type.String(),
							wins: Type.Integer(),
							losses: Type.Integer(),
							draws: Type.Integer(),
							netCoins: Type.Integer(),
						})),
						totals: Type.Object({
							wins: Type.Integer(),
							losses: Type.Integer(),
							draws: Type.Integer(),
							winCoins: Type.Integer(),
							lossPenalty: Type.Integer(),
							netCoins: Type.Integer(),
						}),
					}),
				},
				tags: ["leaderboard"],
				description: "Detailed breakdown of current user's crystals by game.",
			},
		},
		async (request) => {
			const userId = request.auth.userId;

			const allResults = await app.prisma.gameResult.findMany({
				where: { OR: [{ winnerId: userId }, { loserId: userId }] },
				select: { gameType: true, winnerId: true, loserId: true, isDraw: true, coinsAwarded: true },
			});

			const byGameMap = new Map<string, { wins: number; losses: number; draws: number; netCoins: number }>();
			let totalWins = 0, totalLosses = 0, totalDraws = 0, winCoinsSum = 0;

			for (const r of allResults) {
				const g = byGameMap.get(r.gameType) ?? { wins: 0, losses: 0, draws: 0, netCoins: 0 };
				if (r.isDraw) { g.draws++; totalDraws++; }
				else if (r.winnerId === userId) {
					g.wins++; totalWins++;
					g.netCoins += r.coinsAwarded;
					winCoinsSum += r.coinsAwarded;
				} else if (r.loserId === userId) {
					g.losses++; totalLosses++;
					g.netCoins -= COINS_PENALTY_FOR_LOSS;
				}
				byGameMap.set(r.gameType, g);
			}

			return {
				userId,
				byGame: Array.from(byGameMap.entries()).map(([gameType, v]) => ({ gameType, ...v })),
				totals: {
					wins: totalWins,
					losses: totalLosses,
					draws: totalDraws,
					winCoins: winCoinsSum,
					lossPenalty: totalLosses * COINS_PENALTY_FOR_LOSS,
					netCoins: winCoinsSum - totalLosses * COINS_PENALTY_FOR_LOSS,
				},
			};
		},
	);
};
