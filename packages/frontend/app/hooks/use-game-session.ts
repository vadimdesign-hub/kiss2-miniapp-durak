/**
 * HTTP-polling hook used by durak/checkers game pages.
 *
 * Polls /api/v1/matchmaking/poll on a 600ms interval, and:
 *  - exposes opponentJoined / opponentOnline
 *  - delivers new opponent moves via onOpponentMove
 *  - delivers SERVER-AUTHORITATIVE game state via onState (durak)
 *  - surfaces session cancellation / finished state via callbacks
 *
 * For durak, the SERVER is now the source of truth. The component should
 * sync local state from `state` rather than deriving its own from moves[].
 */
import { useBridgeFetch } from "@playneta/flutter-js-bridge";
import { useEffect, useRef, useState } from "react";
import { logEvent } from "~/lib/logger";
import { mmClient, type GameStateView, type PollSnapshot } from "~/lib/mm-client";

export interface UseGameSessionOpts {
	sessionId: string | null;
	myUserId: string | null;
	enabled: boolean;
	onOpponentMove?: (move: unknown) => void;
	onCancelled?: (reason: string) => void;
	onFinished?: (result: { winnerId: string | null; isDraw: boolean; reason: string }) => void;
	/** Server-authoritative state for the current game (durak or
	 * checkers). Fires on every poll. The component should sync its
	 * local rendered state to this. */
	onState?: (state: GameStateView, version: number) => void;
}

export interface UseGameSessionResult {
	opponentJoined: boolean;
	opponentOnline: boolean;
}

export function useGameSession(opts: UseGameSessionOpts): UseGameSessionResult {
	const bridgeFetch = useBridgeFetch();
	const [opponentJoined, setOpponentJoined] = useState(false);
	const [opponentOnline, setOpponentOnline] = useState(false);

	const handlersRef = useRef(opts);
	handlersRef.current = opts;

	const lastMoveIdxRef = useRef<number>(-1);
	const sessionIdRef = useRef<string | null>(null);

	useEffect(() => {
		if (!opts.enabled || !opts.sessionId) return;

		mmClient.setBridgeFetch(bridgeFetch);

		if (sessionIdRef.current !== opts.sessionId) {
			sessionIdRef.current = opts.sessionId;
			lastMoveIdxRef.current = -1;
		}

		// Force an immediate poll when the tab/window regains focus —
		// otherwise a backgrounded tab could sit on an outdated state for
		// several seconds after the user comes back.
		const onVisible = () => {
			if (document.visibilityState === "visible") void mmClient.pollNow();
		};
		const onFocus = () => { void mmClient.pollNow(); };
		document.addEventListener("visibilitychange", onVisible);
		window.addEventListener("focus", onFocus);

		const stop = mmClient.startPolling({
			sessionId: opts.sessionId,
			ready: true,
			intervalMs: 600,
			onUpdate: (snap: PollSnapshot) => {
				if (snap.opponentReady) setOpponentJoined(true);
				if (typeof snap.opponentOnline === "boolean") setOpponentOnline(snap.opponentOnline);

				// Server-authoritative state — render this directly.
				if (snap.state && typeof snap.version === "number") {
					handlersRef.current.onState?.(snap.state, snap.version);
					logEvent("session", "onState", { version: snap.version });
				}

				// Legacy move dispatch — kept for checkers and any
				// game type without server-authoritative state yet.
				if (snap.moves && !snap.state) {
					const me = handlersRef.current.myUserId;
					if (me) {
						for (const m of snap.moves) {
							if (m.idx <= lastMoveIdxRef.current) continue;
							lastMoveIdxRef.current = m.idx;
							if (m.by !== me) {
								handlersRef.current.onOpponentMove?.(m.data);
							}
						}
					}
				}

				if (snap.status === "cancelled") {
					logEvent("session", "cancelled", { reason: snap.reason });
					handlersRef.current.onCancelled?.(snap.reason ?? "cancelled");
				}
				if (snap.status === "finished" && snap.result) {
					logEvent("session", "finished", snap.result);
					handlersRef.current.onFinished?.(snap.result);
				}
			},
		});

		return () => {
			document.removeEventListener("visibilitychange", onVisible);
			window.removeEventListener("focus", onFocus);
			stop();
		};
	}, [opts.enabled, opts.sessionId, bridgeFetch]);

	return { opponentJoined, opponentOnline };
}
