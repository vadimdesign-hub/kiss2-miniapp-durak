import type { TypeBoxTypeProvider } from "@fastify/type-provider-typebox";
import type { FastifyPluginAsync } from "fastify";
import { Type } from "typebox";

const SERVICE_PREFIX = "kiss2-miniapp-durak";

const GAMES = [
	{ type: "checkers", name: "Checkers", minPlayers: 2, maxPlayers: 2 },
	{ type: "durak", name: "Durak", minPlayers: 2, maxPlayers: 2 },
] as const;

const GameDto = Type.Object({
	type: Type.String(),
	name: Type.String(),
	minPlayers: Type.Integer(),
	maxPlayers: Type.Integer(),
});

const OnlineCountDto = Type.Object({
	gameType: Type.String(),
	online: Type.Integer(),
});

export const gameRoutes: FastifyPluginAsync = async (fastify) => {
	const app = fastify.withTypeProvider<TypeBoxTypeProvider>();

	app.get(
		"/game",
		{
			schema: {
				response: { 200: Type.Array(GameDto) },
				tags: ["game"],
				description: "List all available games",
			},
		},
		async () => [...GAMES],
	);

	app.get(
		"/game/:type/online",
		{
			schema: {
				params: Type.Object({ type: Type.String() }),
				response: { 200: OnlineCountDto },
				tags: ["game"],
				description: "Get number of players currently in queue or in-game for a game type",
			},
		},
		async (request) => {
			const { type } = request.params;
			const queueKey = `${SERVICE_PREFIX}:queue:${type}`;
			const online = await app.redis.lLen(queueKey);
			return { gameType: type, online };
		},
	);
};
