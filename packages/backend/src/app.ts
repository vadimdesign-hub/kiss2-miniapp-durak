import fastifyCompress from "@fastify/compress";
import fastifySensible from "@fastify/sensible";
import fastifySwagger from "@fastify/swagger";
import fastifySwaggerUI from "@fastify/swagger-ui";
import type { TypeBoxTypeProvider } from "@fastify/type-provider-typebox";
import fastifyWebsocket from "@fastify/websocket";
import * as Sentry from "@sentry/node";
import Fastify, { type FastifyInstance } from "fastify";
import metricsPlugin from "fastify-metrics";

import { createMiniappFetch } from "@playneta/node-kiss2-lib/clients";
import {
	analyticsPlugin,
	authPlugin,
	kafkaPlugin,
	probesPlugin,
	redisPlugin,
} from "@playneta/node-kiss2-lib/plugins";

import { type Env, loadEnv } from "./config/index.js";
import { databasePlugin } from "./infra/database/plugin.js";
import { dailyMessageRoutes } from "./modules/daily-message/routes.js";
import { luckyCoinRoutes } from "./modules/lucky-coin/routes.js";

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

	// --- Outbound HTTP ---
	// One miniapp-aware fetch per process. Stamps `X-Miniapp` and a default
	// `X-Forward-Role: admin`, retries on 429/5xx/network errors. Pass into any
	// route plugin or service that calls platform backends — never use the
	// global `fetch` directly.
	const miniappFetch = createMiniappFetch({ serviceName: env.SERVICE_NAME });

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
		skipPaths: ["/api/v1/dailyMessage"],
	});
	await app.register(analyticsPlugin);

	// --- WebSocket ---

	await app.register(fastifyWebsocket);

	// --- API routes ---

	await app.register(dailyMessageRoutes, { prefix: "/api/v1" });
	await app.register(luckyCoinRoutes, {
		prefix: "/api/v1",
		walletApiUrl: env.WALLET_API_URL,
		serviceName: env.SERVICE_NAME,
		fetch: miniappFetch,
	});

	return app;
}
