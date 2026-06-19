import { type RouteConfig, index, route } from "@react-router/dev/routes";

export default [
	index("routes/home.tsx"),
	// Catch-all: S3 static hosting serves index.html at paths like /template/index.html
	// which React Router doesn't match to "/". This splat ensures all paths render home.
	route("*", "routes/catch-all.tsx"),
] satisfies RouteConfig;
