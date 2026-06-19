import * as Sentry from "@sentry/node";
import Fastify from "fastify";
import metricsPlugin from "fastify-metrics";

import { probesPlugin } from "@playneta/node-kiss2-lib/plugins";
import { KafkaConsumerService } from "@playneta/node-kiss2-lib/services";

import { loadEnv } from "./config/index.js";
import { databasePlugin } from "./infra/database/plugin.js";
import { buildUserDeletedHandler } from "./modules/lucky-coin/user-deleted.handler.js";

async function main() {
	const env = loadEnv();

	// Reuse the same plugin set as the HTTP server. Fastify's onClose hooks
	// chain DB → Kafka disconnects in the right order on SIGTERM automatically.
	const app = Fastify({
		logger: {
			level: env.LOG_LEVEL,
			...(env.NODE_ENV === "development" && {
				transport: { target: "pino-pretty" },
			}),
		},
	});

	// --- Probes / metrics (k8s health checks + Prometheus) ---
	await app.register(probesPlugin);
	// @ts-expect-error fastify-metrics types don't support generic FastifyTypeProvider
	await app.register(metricsPlugin, {
		endpoint: "/metrics",
		defaultMetrics: { enabled: true },
		routeMetrics: { enabled: true },
	});

	// --- Sentry ---
	Sentry.setupFastifyErrorHandler(app);

	// --- Infrastructure plugins (own Prisma client; no in-memory state shared
	// with the HTTP process). ---
	await app.register(databasePlugin, { databaseUrl: env.DATABASE_URL });

	// --- Kafka consumer ---
	const consumer = new KafkaConsumerService(
		{
			serviceName: env.SERVICE_NAME,
			brokers: env.KAFKA_SEED_BROKERS.split(","),
			username: env.KAFKA_USERNAME,
			password: env.KAFKA_PASSWORD,
		},
		app.log,
	);

	app.addHook("onReady", async () => {
		await consumer.connect();
		app.log.info("Kafka consumer connected");

		// `user.deleted` is REQUIRED for every miniapp — see launch_1.0.md.
		// Add additional miniapp-specific subscriptions here.
		await consumer.subscribe([buildUserDeletedHandler({ logger: app.log, prisma: app.prisma })]);

		app.log.info("Consumer is running. Waiting for messages…");
	});

	app.addHook("onClose", async () => {
		try {
			await consumer.disconnect();
			app.log.info("Kafka consumer disconnected");
		} catch (err) {
			app.log.error({ err }, "Kafka consumer disconnect error");
		}
	});

	// --- Probe/metrics port ---
	// In prod each process is in its own pod and can reuse API_PORT. Locally,
	// set CONSUMER_PORT in .env so the consumer doesn't try to bind the same
	// port as the HTTP server.
	const port = env.CONSUMER_PORT ?? env.API_PORT;
	await app.listen({ port, host: "0.0.0.0" });

	const signals: NodeJS.Signals[] = ["SIGINT", "SIGTERM"];
	for (const signal of signals) {
		process.on(signal, async () => {
			app.log.info({ signal }, "Shutting down consumer…");
			await app.close();
			process.exit(0);
		});
	}
}

main().catch((err) => {
	console.error("Fatal consumer startup error:", err);
	process.exit(1);
});
