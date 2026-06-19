import type { TypeBoxTypeProvider } from "@fastify/type-provider-typebox";
import type { FastifyPluginAsync } from "fastify";
import { Type } from "typebox";

import { LuckyCoinExhaustedError, LuckyCoinService } from "./service.js";

type FetchFn = typeof fetch;

const LuckyCoinStatusResponse = Type.Object({
	attemptsUsed: Type.Integer(),
	attemptsLeft: Type.Integer(),
});

const LuckyCoinClaimResponse = Type.Object({
	amount: Type.Integer(),
	attemptsLeft: Type.Integer(),
});

export const luckyCoinRoutes: FastifyPluginAsync<{
	walletApiUrl: string;
	serviceName: string;
	fetch: FetchFn;
}> = async (fastify, opts) => {
	const app = fastify.withTypeProvider<TypeBoxTypeProvider>();
	const service = new LuckyCoinService(
		app.prisma,
		app.kafka.producer,
		opts.walletApiUrl,
		opts.serviceName,
		opts.fetch,
		app.log,
	);

	app.get(
		"/luckyCoin/status",
		{
			schema: {
				response: { 200: LuckyCoinStatusResponse },
				tags: ["luckyCoin"],
				description: "Get current user's lucky coin attempt status",
			},
		},
		async (request) => {
			return service.getStatus(request.auth.userId);
		},
	);

	app.post(
		"/luckyCoin/claim",
		{
			schema: {
				response: {
					200: LuckyCoinClaimResponse,
				},
				tags: ["luckyCoin"],
				description: "Claim a lucky coin reward (max 5 attempts per user lifetime)",
			},
		},
		async (request, reply) => {
			try {
				return await service.claim(request.auth.userId, request.analyticsHeaders);
			} catch (error) {
				if (error instanceof LuckyCoinExhaustedError) {
					return reply.tooManyRequests("All lucky coin attempts have been used");
				}
				throw error;
			}
		},
	);
};
