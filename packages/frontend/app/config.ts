// In dev mode, route through Vite's proxy to avoid CORS and simulator host issues.
// In production, use the real URLs directly.

export const API_BASE_URL = import.meta.env.DEV
	? "/proxy/api"
	: import.meta.env.VITE_API_BASE_URL || "http://localhost:3001";

export const GLOBAL_BACKEND_BASE_URL = import.meta.env.DEV
	? "/proxy/global"
	: import.meta.env.VITE_GLOBAL_BACKEND_BASE_URL || "https://api-stage.kisskissplay.com";

// Returns WebSocket URL. Vite proxy handles ws: true for /proxy/api, so in dev
// we connect to the same host/port as the frontend and the proxy upgrades it.
export function getWsUrl(): string {
	if (import.meta.env.DEV) {
		const proto = window.location.protocol === "https:" ? "wss" : "ws";
		// Vite proxy strips /proxy/api prefix, so we need /proxy/api + /api/v1/ws
		// to end up at ws://localhost:3001/api/v1/ws
		return `${proto}://${window.location.host}/proxy/api/api/v1/ws`;
	}
	// Fallback to the known stage URL if VITE_API_BASE_URL wasn't set at build time —
	// the static frontend may otherwise try ws://localhost:3001 in production.
	const base =
		import.meta.env.VITE_API_BASE_URL ||
		"https://api-miniapps-stage.kisskissplay.com/durak";
	return `${base.replace(/^http/, "ws")}/api/v1/ws`;
}
