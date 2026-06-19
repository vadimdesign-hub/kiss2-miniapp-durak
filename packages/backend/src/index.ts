import { buildApp } from "./app.js";
import { loadEnv } from "./config/index.js";

async function main() {
	const env = loadEnv();
	const app = await buildApp({ env });

	// Graceful shutdown
	const signals: NodeJS.Signals[] = ["SIGINT", "SIGTERM"];
	for (const signal of signals) {
		process.on(signal, async () => {
			app.log.info({ signal }, "Shutting down…");
			await app.close();
			process.exit(0);
		});
	}

	await app.listen({ port: env.API_PORT, host: "0.0.0.0" });
}

main().catch((err) => {
	console.error("Fatal startup error:", err);
	process.exit(1);
});
