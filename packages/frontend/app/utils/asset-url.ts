/**
 * Resolves a public-folder asset path relative to Vite's BASE_URL.
 *
 * When the app is served from a sub-path (e.g. /kiss2-miniapp-durak/),
 * absolute paths like "/diamond.png" point to the CDN root and return 404.
 * This helper prepends the correct base so assets are always found.
 *
 * Usage:  src={a("/diamond.png")}  →  "/kiss2-miniapp-durak/diamond.png"
 */
const BASE = import.meta.env.BASE_URL ?? "/";

export function a(path: string): string {
	return `${BASE}${path.replace(/^\/+/, "")}`;
}
