import * as Sentry from "@sentry/react";

/** Matches basename routing; used to identify which miniapp instance this is in Sentry. */
const serviceName = import.meta.env.VITE_SERVICE_NAME || "miniapp";

const appEnv = import.meta.env.VITE_APP_ENV || "stage";

Sentry.init({
	dsn: import.meta.env.VITE_SENTRY_DSN,
	environment: import.meta.env.MODE,
	enabled: !!import.meta.env.VITE_SENTRY_DSN,
	tracesSampleRate: appEnv === "prod" ? 0.1 : 1.0,
	replaysSessionSampleRate: appEnv === "prod" ? 0.1 : 0,
	replaysOnErrorSampleRate: 1.0,
	initialScope: (scope) => {
		scope.setTag("service", serviceName);
		return scope;
	},
});
