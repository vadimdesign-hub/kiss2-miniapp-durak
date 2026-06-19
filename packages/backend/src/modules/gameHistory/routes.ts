import type { TypeBoxTypeProvider } from "@fastify/type-provider-typebox";
import type { FastifyPluginAsync } from "fastify";
import { Type } from "typebox";

const GameHistoryEntryDto = Type.Object({
	sessionId: Type.String(),
	gameType: Type.String(),
	result: Type.Union([Type.Literal("win"), Type.Literal("lose"), Type.Literal("draw")]),
	opponentId: Type.String(),
	coinsAwarded: Type.Integer(),
	durationSeconds: Type.Integer(),
	playedAt: Type.String(),
});

export const gameHistoryRoutes: FastifyPluginAsync = async (fastify) => {
	const app = fastify.withTypeProvider<TypeBoxTypeProvider>();

	app.get(
		"/gameHistory",
		{
			schema: {
				querystring: Type.Object({
					limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 50, default: 20 })),
					offset: Type.Optional(Type.Integer({ minimum: 0, default: 0 })),
				}),
				response: { 200: Type.Array(GameHistoryEntryDto) },
				tags: ["gameHistory"],
				description: "Game history for the current user",
			},
		},
		async (request) => {
			const userId = request.auth.userId;
			const { limit = 20, offset = 0 } = request.query;

			const results = await app.prisma.gameResult.findMany({
				where: {
					OR: [{ winnerId: userId }, { loserId: userId }],
				},
				orderBy: { createdAt: "desc" },
				take: limit,
				skip: offset,
			});

			return results.map((r) => {
				const isWinner = r.winnerId === userId;
				const isDraw = r.isDraw;
				const opponentId = isWinner ? (r.loserId ?? "") : (r.winnerId ?? "");

				return {
					sessionId: r.sessionId,
					gameType: r.gameType,
					result: isDraw ? "draw" : isWinner ? "win" : "lose",
					opponentId,
					coinsAwarded: r.coinsAwarded,
					durationSeconds: r.durationSeconds,
					playedAt: r.createdAt.toISOString(),
				};
			});
		},
	);
};
