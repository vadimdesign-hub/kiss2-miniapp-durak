import { buildApp } from "./app.js";
import { loadEnv } from "./config/index.js";
import { type ConsumerHandle, startConsumer } from "./consumer.js";
import { seedFakePlayersIfNeeded } from "./modules/gameResult/routes.js";

async function main() {
	const env = loadEnv();
	const app = await buildApp({ env });

	// Auto-seed fake players into the leaderboard if DB is empty
	await seedFakePlayersIfNeeded(app.prisma).catch((err) => {
		app.log.warn({ err }, "Fake player seed skipped or failed");
	});

	// Start Kafka consumer in the BACKGROUND — never block HTTP startup on it.
	// If kafkajs hangs trying to connect (broker unreachable, SASL mismatch,
	// missing topic), HTTP must still come up so health probes pass and the WS
	// route is reachable. This was the regression that took matchmaking down.
	let consumerHandle: ConsumerHandle | null = null;
	startConsumer(app.log, env)
		.then((handle) => {
			consumerHandle = handle;
			app.log.info("Consumer started in background");
		})
		.catch((err) => {
			app.log.error({ err }, "Consumer failed to start — HTTP server keeps running");
		});

	// Graceful shutdown — disconnect consumer first so kafkajs doesn't try to
	// heartbeat on a closed socket.
	const signals: NodeJS.Signals[] = ["SIGINT", "SIGTERM"];
	for (const signal of signals) {
		process.on(signal, async () => {
			app.log.info({ signal }, "Shutting down…");
			if (consumerHandle) await consumerHandle.stop();
			await app.close();
			process.exit(0);
		});
	}

	// HTTP starts IMMEDIATELY — does not wait for Kafka.
	await app.listen({ port: env.API_PORT, host: "0.0.0.0" });
}

main().catch((err) => {
	console.error("Fatal startup error:", err);
	process.exit(1);
});
