import type { TypeBoxTypeProvider } from "@fastify/type-provider-typebox";
import type { FastifyPluginAsync } from "fastify";
import { Type } from "typebox";

const PlayerStatDto = Type.Object({
	userId: Type.String(),
	gamesPlayed: Type.Integer(),
	wins: Type.Integer(),
	losses: Type.Integer(),
	draws: Type.Integer(),
	totalCoins: Type.Integer(),
});

export const playerStatRoutes: FastifyPluginAsync = async (fastify) => {
	const app = fastify.withTypeProvider<TypeBoxTypeProvider>();

	app.get(
		"/playerStat/me",
		{
			schema: {
				response: { 200: PlayerStatDto },
				tags: ["playerStat"],
				description: "Get game stats for the current user",
			},
		},
		async (request) => {
			const userId = request.auth.userId;

			const [wins, losses, draws] = await Promise.all([
				app.prisma.gameResult.count({ where: { winnerId: userId } }),
				app.prisma.gameResult.count({ where: { loserId: userId } }),
				app.prisma.gameResult.count({
					where: { isDraw: true, OR: [{ winnerId: userId }, { loserId: userId }] },
				}),
			]);

			const coinsAgg = await app.prisma.gameResult.aggregate({
				where: { winnerId: userId },
				_sum: { coinsAwarded: true },
			});

			return {
				userId,
				gamesPlayed: wins + losses + draws,
				wins,
				losses,
				draws,
				totalCoins: coinsAgg._sum.coinsAwarded ?? 0,
			};
		},
	);
};
