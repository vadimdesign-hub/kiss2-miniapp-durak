import "dotenv/config";
import { type Static, Type } from "typebox";
import { Value } from "typebox/value";

const EnvSchema = Type.Object({
	API_PORT: Type.Number({ default: 3001 }),
	// Optional override for the consumer process's probe/metrics port. In
	// production each process runs in its own pod and can reuse API_PORT; set
	// this only when running the consumer alongside the HTTP server on the
	// same host (local dev).
	CONSUMER_PORT: Type.Optional(Type.Number()),
	APP_ENV: Type.Union([Type.Literal("stage"), Type.Literal("prod")], { default: "stage" }),
	SERVICE_NAME: Type.String(),
	LOG_LEVEL: Type.Union(
		[
			Type.Literal("fatal"),
			Type.Literal("error"),
			Type.Literal("warn"),
			Type.Literal("info"),
			Type.Literal("debug"),
			Type.Literal("trace"),
		],
		{ default: "info" },
	),
	NODE_ENV: Type.Union(
		[Type.Literal("development"), Type.Literal("production"), Type.Literal("test")],
		{ default: "development" },
	),

	// Sentry
	SENTRY_DSN: Type.Optional(Type.String()),

	// Service-specific API URLs
	WALLET_API_URL: Type.String({ default: "https://api-stage.kisskissplay.com/wallet" }),

	// Auth
	AUTH_SECRET_KEY: Type.String(),

	// PostgreSQL
	DATABASE_URL: Type.String(),

	// Redis
	REDIS_URL: Type.String({ default: "redis://localhost:6379" }),

	// Kafka / Redpanda
	KAFKA_SEED_BROKERS: Type.String({ default: "localhost:19092" }),
	KAFKA_USERNAME: Type.Optional(Type.String()),
	KAFKA_PASSWORD: Type.Optional(Type.String()),
});

export type Env = Static<typeof EnvSchema>;

export function loadEnv(): Env {
	const raw: Record<string, unknown> = {
		...process.env,
		API_PORT: process.env.API_PORT ? Number(process.env.API_PORT) : undefined,
		CONSUMER_PORT: process.env.CONSUMER_PORT ? Number(process.env.CONSUMER_PORT) : undefined,
	};

	Value.Default(EnvSchema, raw);

	const errors = [...Value.Errors(EnvSchema, raw)];
	if (errors.length > 0) {
		const details = errors.map((e) => `  - ${e.instancePath || "/"}: ${e.message}`).join("\n");
		throw new Error(`Invalid environment variables:\n${details}`);
	}

	return Value.Decode(EnvSchema, raw);
}
