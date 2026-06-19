/**
 * Kafka consumer setup. Currently unused — left as a stub so we can wire
 * platform topic subscriptions later if/when needed. Polling-based
 * matchmaking does not require Kafka.
 */
import type { FastifyBaseLogger } from "fastify";

import type { Env } from "./config/index.js";

export interface ConsumerHandle {
	stop(): Promise<void>;
}

export async function startConsumer(
	logger: FastifyBaseLogger,
	_env: Env,
): Promise<ConsumerHandle> {
	logger.info("Consumer: no subscriptions registered (HTTP polling matchmaking is in use)");
	return {
		async stop() { /* no-op */ },
	};
}
