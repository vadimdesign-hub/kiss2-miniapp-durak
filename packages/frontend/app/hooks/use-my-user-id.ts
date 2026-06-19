/**
 * Returns the current user's id by parsing the `sub` claim out of the JWT
 * delivered by the Flutter bridge. Synchronous (memoised on the auth header)
 * so callers get a real userId on first render — no race against
 * mmClient.setMyUserId() effects.
 */
import { useFlutterBridge } from "@playneta/flutter-js-bridge";
import { useMemo } from "react";

export function useMyUserId(): string | null {
	const { state } = useFlutterBridge();
	return useMemo(() => {
		const auth = state.headers?.authorization;
		if (!auth) return null;
		const raw = auth.startsWith("Bearer ") ? auth.slice(7) : auth;
		try {
			const parts = raw.split(".");
			if (parts.length !== 3) return null;
			const payload = JSON.parse(atob(parts[1].replace(/-/g, "+").replace(/_/g, "/")));
			return payload.sub ? String(payload.sub) : null;
		} catch {
			return null;
		}
	}, [state.headers?.authorization]);
}
