import { randomUUID } from "node:crypto";
import type { TypeBoxTypeProvider } from "@fastify/type-provider-typebox";
import type { FastifyPluginAsync } from "fastify";
import { Type } from "typebox";

function sendServerAnalytics(
	producer: unknown,
	event: unknown,
	analyticsHeaders: unknown,
): Promise<void> {
	return (
		producer as Record<string, (a: unknown, b: unknown) => Promise<void>>
	).sendServerAnalytics(event, analyticsHeaders);
}

export const analyticsEventRoutes: FastifyPluginAsync = async (fastify) => {
	const app = fastify.withTypeProvider<TypeBoxTypeProvider>();

	app.post(
		"/analyticsEvent",
		{
			schema: {
				body: Type.Object({
					entity: Type.Union([
						Type.Literal("opponentFound"),    // matchmaking found an opponent
						Type.Literal("pvpGameCompleted"), // PvP game finished without early exit
						Type.Literal("botGameCompleted"), // Bot game finished without early exit
						Type.Literal("miniappSession"),   // user closed the miniapp — carries durationSeconds
					]),
					gameType:        Type.Optional(Type.String()),
					stake:           Type.Optional(Type.Number({ minimum: 0 })),
					durationSeconds: Type.Optional(Type.Number({ minimum: 0 })),
				}),
				tags: ["analytics"],
				description: "Record a frontend-triggered analytics event",
			},
		},
		async (request) => {
			const userId = request.auth.userId;
			const { entity, gameType, stake, durationSeconds } = request.body;
			const now = new Date().toISOString();

			const meta: Record<string, unknown> = {};
			// gameType is NOT added to meta — it maps to the top-level `type` field
			if (stake !== undefined)           meta.stake           = stake;
			if (durationSeconds !== undefined) meta.durationSeconds = durationSeconds;

			try {
				await sendServerAnalytics(
					app.kafka.producer,
					{
						entity,
						action: "created",
						eventVersion: 1,
						new: {
							actors: [{ role: "user", userId }],
							createdAt: now,
							updatedAt: now,
							meta,
							id: randomUUID(),
							userId,
							...(gameType && { type: gameType }),
							source: "client",
						},
					},
					request.analyticsHeaders,
				);
			} catch {
				// analytics failure is non-fatal
			}

			return { ok: true };
		},
	);
};
