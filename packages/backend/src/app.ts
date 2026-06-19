import fastifyCompress from "@fastify/compress";
import fastifyRateLimit from "@fastify/rate-limit";
import fastifySensible from "@fastify/sensible";
import fastifySwagger from "@fastify/swagger";
import fastifySwaggerUI from "@fastify/swagger-ui";
import type { TypeBoxTypeProvider } from "@fastify/type-provider-typebox";
import fastifyWebsocket from "@fastify/websocket";
import * as Sentry from "@sentry/node";
import Fastify, { type FastifyInstance } from "fastify";
import metricsPlugin from "fastify-metrics";

import {
	analyticsPlugin,
	authPlugin,
	kafkaPlugin,
	probesPlugin,
	redisPlugin,
} from "@playneta/node-kiss2-lib/plugins";

import { type Env, loadEnv } from "./config/index.js";
import { databasePlugin } from "./infra/database/plugin.js";
import { analyticsEventRoutes } from "./modules/analytics/routes.js";
import { dailyMessageRoutes } from "./modules/daily-message/routes.js";
import { gameRoutes } from "./modules/game/routes.js";
import { gameHistoryRoutes } from "./modules/gameHistory/routes.js";
import { gameResultRoutes } from "./modules/gameResult/routes.js";
import { leaderboardRoutes } from "./modules/leaderboard/routes.js";
import { luckyCoinRoutes } from "./modules/lucky-coin/routes.js";
import { matchmakingHttpRoutes } from "./modules/matchmaking/httpRoutes.js";
import { playerStatRoutes } from "./modules/playerStat/routes.js";

export interface BuildAppOptions {
	env?: Env;
}

export async function buildApp(options: BuildAppOptions = {}): Promise<FastifyInstance> {
	const env = options.env ?? loadEnv();

	const base = Fastify({
		logger: {
			level: env.LOG_LEVEL,
			...(env.NODE_ENV === "development" && {
				transport: { target: "pino-pretty" },
			}),
		},
	});

	// --- Observability (register before type provider) ---

	await base.register(probesPlugin);
	// @ts-expect-error fastify-metrics types don't support generic FastifyTypeProvider
	await base.register(metricsPlugin, {
		endpoint: "/metrics",
		defaultMetrics: { enabled: true },
		routeMetrics: { enabled: true },
	});

	const app = base.withTypeProvider<TypeBoxTypeProvider>();

	// --- Sentry ---

	Sentry.setupFastifyErrorHandler(app);

	app.addHook("onRequest", async (request) => {
		const span = Sentry.getActiveSpan();
		if (span) {
			const route = request.routeOptions?.url;
			if (route) {
				Sentry.getRootSpan(span)?.updateName(`${request.method} ${route}`);
			}
		}
	});

	// --- Core plugins ---

	await app.register(fastifySensible);

	await app.register(fastifyCompress, {
		threshold: 2048,
		encodings: ["gzip", "deflate"],
	});

	await app.register(fastifyRateLimit, {
		// Polling-based MP needs lots of requests: each game session does
		// ~100 /poll per minute (600ms interval) per player, plus moves +
		// heartbeats + pollNow recoveries. The old 100/min limit choked
		// this — clients would 429-loop and the game would hang. We now
		// allow generous headroom and skip the high-frequency
		// matchmaking endpoints from rate-limiting entirely.
		max: 600,
		timeWindow: "1 minute",
		allowList: (req) => {
			const url = req.url ?? "";
			return (
				url.includes("/matchmaking/poll")
				|| url.includes("/matchmaking/move")
				|| url.includes("/matchmaking/joinQueue")
				|| url.includes("/matchmaking/leaveQueue")
			);
		},
	});

	// --- Swagger ---

	await app.register(fastifySwagger, {
		openapi: {
			openapi: "3.0.0",
			info: {
				title: "Kiss2 Miniapp API",
				version: "1.0.0",
				description: "Miniapp backend service",
			},
			components: {
				securitySchemes: {
					bearerAuth: {
						type: "http",
						scheme: "bearer",
					},
				},
			},
		},
	});

	await app.register(fastifySwaggerUI, {
		routePrefix: "/openapi",
	});

	// --- Infrastructure plugins ---

	await app.register(databasePlugin, { databaseUrl: env.DATABASE_URL });
	await app.register(redisPlugin, { url: env.REDIS_URL });
	await app.register(kafkaPlugin, {
		brokers: env.KAFKA_SEED_BROKERS.split(","),
		username: env.KAFKA_USERNAME,
		password: env.KAFKA_PASSWORD,
		serviceName: env.SERVICE_NAME,
	});

	// --- Auth & Analytics ---

	await app.register(authPlugin, {
		secretKey: env.AUTH_SECRET_KEY,
		// WebSocket routes handle auth via first-message pattern (browser WS API
		// does not support custom headers on the upgrade request).
		skipPaths: ["/api/v1/dailyMessage", "/api/v1/dev/seed", "/api/v1/matchmaking/debug"],
	});
	await app.register(analyticsPlugin);

	// --- WebSocket plugin (used only by daily-message; matchmaking uses HTTP polling) ---

	await app.register(fastifyWebsocket);

	// --- API routes ---

	await app.register(dailyMessageRoutes, { prefix: "/api/v1" });
	await app.register(luckyCoinRoutes, {
		prefix: "/api/v1",
		walletApiUrl: env.WALLET_API_URL,
		serviceName: env.SERVICE_NAME,
	});
	await app.register(gameRoutes, { prefix: "/api/v1" });
	await app.register(playerStatRoutes, { prefix: "/api/v1" });
	await app.register(leaderboardRoutes, { prefix: "/api/v1" });
	await app.register(gameHistoryRoutes, { prefix: "/api/v1" });
	await app.register(matchmakingHttpRoutes, { prefix: "/api/v1" });
	await app.register(gameResultRoutes, {
		prefix: "/api/v1",
		walletApiUrl: env.WALLET_API_URL,
		serviceName: env.SERVICE_NAME,
	});
	await app.register(analyticsEventRoutes, { prefix: "/api/v1" });

	return app;
}
