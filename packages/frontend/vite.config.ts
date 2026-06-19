import { reactRouter } from "@react-router/dev/vite";
import { sentryVitePlugin } from "@sentry/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig, loadEnv } from "vite";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig(({ mode }) => {
	const env = loadEnv(mode, process.cwd(), "");
	const serviceName = env.VITE_SERVICE_NAME || "";
	const basePath = serviceName ? `/${serviceName}/` : "/";
	const globalBackendUrl = env.VITE_GLOBAL_BACKEND_BASE_URL || "https://api-stage.kisskissplay.com";
	const localBackendUrl = env.VITE_API_BASE_URL || "http://localhost:3001";

	return {
		base: basePath,
		build: {
			sourcemap: true,
		},
		server: {
			proxy: {
				"/proxy/global": {
					target: globalBackendUrl,
					changeOrigin: true,
					rewrite: (path) => path.replace(/^\/proxy\/global/, ""),
				},
				"/proxy/api": {
					target: localBackendUrl,
					changeOrigin: true,
					rewrite: (path) => path.replace(/^\/proxy\/api/, ""),
					ws: true,
				},
			},
		},
		plugins: [
			// Intercept Chrome DevTools probe before react-router treats it as a 404
			{
				name: "ignore-wellknown",
				configureServer(server) {
					server.middlewares.use((req, res, next) => {
						if (req.url?.startsWith("/.well-known/")) {
							res.statusCode = 404;
							res.end();
							return;
						}
						next();
					});
				},
			},
			tailwindcss(),
			reactRouter(),
			tsconfigPaths(),
			// Upload source maps to Sentry on production builds.
			// Requires SENTRY_AUTH_TOKEN, SENTRY_ORG, SENTRY_PROJECT env vars.
			sentryVitePlugin({
				disable: !process.env.SENTRY_AUTH_TOKEN,
				sourcemaps: {
					filesToDeleteAfterUpload: ["./build/**/*.map"],
				},
			}),
		],
	};
});
