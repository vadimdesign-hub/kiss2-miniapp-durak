// In dev mode, route through Vite's proxy to avoid CORS and simulator host issues.
// In production, use the real URLs directly.

export const API_BASE_URL = import.meta.env.DEV
	? "/proxy/api"
	: import.meta.env.VITE_API_BASE_URL || "http://localhost:3001";

export const GLOBAL_BACKEND_BASE_URL = import.meta.env.DEV
	? "/proxy/global"
	: import.meta.env.VITE_GLOBAL_BACKEND_BASE_URL || "https://api-stage.kisskissplay.com";

// Slug for this miniapp. Must match the backend's SERVICE_NAME and the slug
// registered in the version service. Used by the top bar to look up a
// localized display name from the platform.
export const SERVICE_NAME = import.meta.env.VITE_SERVICE_NAME ?? "";
