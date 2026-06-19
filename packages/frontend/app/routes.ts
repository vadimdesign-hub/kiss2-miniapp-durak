import { type RouteConfig, index, route } from "@react-router/dev/routes";

export default [
	// Single-game shell: app starts directly in durak matchmaking.
	// Home / mode-picker / leaderboard / checkers are removed per spec.
	index("routes/home.tsx"),
	route("match/:gameType", "routes/match.tsx"),
	route("game/durak/:sessionId", "routes/game/durak.tsx"),
	route("game-over", "routes/game-over.tsx"),
	route("*", "routes/catch-all.tsx"),
] satisfies RouteConfig;
