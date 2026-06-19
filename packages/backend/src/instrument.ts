import * as Sentry from "@sentry/node";

const appEnv = process.env.APP_ENV || "stage";
const serviceName = process.env.SERVICE_NAME || "miniapp";

Sentry.init({
	dsn: process.env.SENTRY_DSN,
	environment: process.env.NODE_ENV ?? "development",
	enabled: !!process.env.SENTRY_DSN,
	tracesSampleRate: appEnv === "prod" ? 0.1 : 1.0,
	initialScope: (scope) => {
		scope.setTag("service", serviceName);
		return scope;
	},
});
