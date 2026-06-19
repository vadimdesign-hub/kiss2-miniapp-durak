import { useBridgeFetch, useFlutterBridge } from "@playneta/flutter-js-bridge";
import { useEffect, useRef, useState } from "react";
import { mmClient, type PollSnapshot } from "~/lib/mm-client";
import type { GameType } from "~/i18n/translations";

export interface MatchFound {
	sessionId: string;
	gameType: GameType;
	playerOneId: string;
	playerTwoId: string;
	starterUserId: string;
}

type MatchmakingState = "idle" | "connecting" | "searching" | "found" | "timeout" | "error";

interface UseMatchmakingResult {
	readonly state: MatchmakingState;
	readonly match: MatchFound | null;
	readonly elapsed: number;
	readonly waiting: number;
	readonly online: number;
	readonly joinQueue: (stake: number) => void;
	readonly leaveQueue: () => void;
}

const TIMEOUT_SEC = 180;

export function useMatchmaking(gameType: GameType): UseMatchmakingResult {
	const { state: bridgeState } = useFlutterBridge();
	const bridgeFetch = useBridgeFetch();
	const [mmState, setMmState] = useState<MatchmakingState>("idle");
	const [match, setMatch] = useState<MatchFound | null>(null);
	const [elapsed, setElapsed] = useState(0);
	const [waiting, setWaiting] = useState(0);
	const [online, setOnline] = useState(0);
	const stopPollRef = useRef<(() => void) | null>(null);
	const elapsedTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

	// Wire bridgeFetch into the singleton on mount.
	useEffect(() => {
		mmClient.setBridgeFetch(bridgeFetch);
		// Best-effort: read userId from JWT (sub claim) so the client can echo it.
		const auth = bridgeState.headers?.authorization;
		if (auth) {
			const raw = auth.startsWith("Bearer ") ? auth.slice(7) : auth;
			try {
				const parts = raw.split(".");
				if (parts.length === 3) {
					const payload = JSON.parse(atob(parts[1].replace(/-/g, "+").replace(/_/g, "/")));
					if (payload.sub) mmClient.setMyUserId(String(payload.sub));
				}
			} catch { /* ignore */ }
		}
	}, [bridgeFetch, bridgeState.headers]);

	const startElapsedTimer = () => {
		stopElapsedTimer();
		elapsedTimerRef.current = setInterval(() => {
			setElapsed((s) => {
				if (s + 1 >= TIMEOUT_SEC) {
					stopElapsedTimer();
					setMmState("timeout");
					return TIMEOUT_SEC;
				}
				return s + 1;
			});
		}, 1000);
	};
	const stopElapsedTimer = () => {
		if (elapsedTimerRef.current) {
			clearInterval(elapsedTimerRef.current);
			elapsedTimerRef.current = null;
		}
	};

	const joinQueue = async (stake: number) => {
		const token = bridgeState.headers?.authorization;
		if (!token) {
			setMmState("error");
			return;
		}
		setMmState("connecting");
		setElapsed(0);

		try {
			const snap = await mmClient.joinQueue(gameType, stake);
			handleSnapshot(snap);

			// Start polling for updates if we're in queue.
			if (snap.status === "queued") {
				startElapsedTimer();
				stopPollRef.current = mmClient.startPolling({
					intervalMs: 1500,
					onUpdate: handleSnapshot,
				});
			}
		} catch (err) {
			setMmState("error");
		}
	};

	const handleSnapshot = (snap: PollSnapshot) => {
		if (typeof snap.online === "number") setOnline(snap.online);
		if (typeof snap.waiting === "number") setWaiting(snap.waiting);

		if (snap.status === "matched" && snap.sessionId) {
			stopElapsedTimer();
			stopPollRef.current?.();
			stopPollRef.current = null;
			setMatch({
				sessionId: snap.sessionId,
				gameType: (snap.gameType as GameType) ?? gameType,
				playerOneId: snap.playerOneId ?? "",
				playerTwoId: snap.playerTwoId ?? "",
				starterUserId: snap.starterUserId ?? "",
			});
			setMmState("found");
		} else if (snap.status === "queued") {
			setMmState("searching");
		}
	};

	const leaveQueue = async () => {
		stopElapsedTimer();
		stopPollRef.current?.();
		stopPollRef.current = null;
		setMmState("idle");
		setElapsed(0);
		try {
			await mmClient.leaveQueue();
		} catch { /* non-fatal */ }
	};

	useEffect(() => {
		return () => {
			stopElapsedTimer();
			stopPollRef.current?.();
			stopPollRef.current = null;
		};
	}, []);

	return { state: mmState, match, elapsed, waiting, online, joinQueue, leaveQueue };
}
