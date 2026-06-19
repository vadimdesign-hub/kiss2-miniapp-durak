import { useSendToFlutter } from "@playneta/flutter-js-bridge";

import { useMiniappDisplay } from "~/hooks/use-miniapp-display";

/**
 * Main-navigation top bar for the miniapp's root page.
 *
 *   - Back-arrow button on the left that closes the WebView (the only way out
 *     of a fullscreen miniapp — must be present on every main page so users
 *     are never trapped).
 *   - Localized miniapp display name as the title, sourced from the platform's
 *     version service (Accept-Language is resolved server-side).
 *
 * Inner pages with their own back navigation should keep their existing
 * inline back-arrow bar — same shape, different gesture (go back vs exit).
 *
 * Add page-level nav actions (history, settings, etc.) on the right side of
 * this bar rather than as separate floating buttons; the navigation chrome
 * belongs in one place at the same vertical baseline.
 */
export function TopBar() {
	const send = useSendToFlutter();
	const { displayName } = useMiniappDisplay();

	return (
		<div className="px-4 pt-5 flex items-center gap-2 text-white">
			<button
				type="button"
				onClick={() => send("close_webview", {})}
				aria-label="Exit"
				className="w-12 h-12 rounded-full flex items-center justify-center shrink-0 bg-white/10 active:scale-95"
			>
				<svg width="24" height="24" viewBox="0 0 18 18" fill="none" aria-hidden>
					<title>Exit</title>
					<path
						d="M11 3L5 9l6 6"
						stroke="#fff"
						strokeWidth="2.2"
						strokeLinecap="round"
						strokeLinejoin="round"
					/>
				</svg>
			</button>
			<div className="font-bold text-lg truncate flex-1 min-w-0">{displayName ?? ""}</div>
		</div>
	);
}
