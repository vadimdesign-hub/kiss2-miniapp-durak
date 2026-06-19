/**
 * HTTP-polling matchmaking client.
 *
 * Design philosophy: SIMPLE > CLEVER. The server always returns the full
 * moves[] log on every poll. The client (useGameSession) dedupes by idx.
 * No cursor sync, no drift bugs, no "I missed a move because myUserId
 * was null at the wrong instant" scenarios.
 *
 * - mmClient.startPolling({ sessionId, onUpdate })  → ticks /poll on interval
 * - mmClient.queueMove(sessionId, move)             → reliable fire-and-forget
 * - mmClient.stopPolling()
 */

import { API_BASE_URL } from "~/config";
import { logError, logEvent, logWarn } from "./logger";

export interface DurakStateView {
	yourHand: { rank: string; suit: string }[];
	opponentHandCount: number;
	deckCount: number;
	trump: string;
	trumpCard: { rank: string; suit: string };
	table: { attack: { rank: string; suit: string }; defense?: { rank: string; suit: string } }[];
	attackerUserId: string;
	defenderUserId: string;
	phase: "attacking" | "defending" | "finished";
	currentTurnUserId: string;
	finished?: { winnerId: string | null; isDraw: boolean; reason: string };
}

export interface CheckersStateView {
	board: ("W" | "B" | "WK" | "BK" | null)[];
	whiteUserId: string;
	blackUserId: string;
	currentTurn: "W" | "B";
	currentTurnUserId: string;
	chainFrom: number | null;
	finished?: { winnerId: string | null; isDraw: boolean; reason: string };
}

export type GameStateView = DurakStateView | CheckersStateView;

export interface PollSnapshot {
	status: "idle" | "queued" | "matched" | "playing" | "finished" | "cancelled";
	sessionId?: string;
	gameType?: string;
	playerOneId?: string;
	playerTwoId?: string;
	starterUserId?: string;
	online?: number;
	waiting?: number;
	moves?: { idx: number; by: string; data: unknown; at: number }[];
	opponentReady?: boolean;
	opponentOnline?: boolean;
	result?: { winnerId: string | null; isDraw: boolean; reason: string };
	reason?: string;
	/** Server-authoritative game state (durak or checkers). When present,
	 * the client should render this directly instead of deriving from
	 * moves[]. Eliminates state divergence between players. */
	state?: GameStateView;
	version?: number;
}

type Listener = (s: PollSnapshot) => void;

class MmClient {
	private bridgeFetch: typeof fetch | null = null;
	private listeners = new Set<Listener>();
	private currentSessionId: string | undefined = undefined;
	private currentReady = false;
	private myUserId: string | null = null;
	/** Bumped on every stopPolling — recursive poll loop checks this and bails. */
	private generation = 0;
	/** Outbox of moves waiting to be reliably delivered. */
	private outbox: Array<{ sessionId: string; move: unknown; clientMoveId: string }> = [];
	private outboxRunning = false;
	/** Latest server version we've observed. Sent as baseVersion with each
	 * move so the server can reject stale-based moves with VERSION_CONFLICT. */
	private latestVersion = 0;

	setBridgeFetch(f: typeof fetch): void {
		this.bridgeFetch = f;
	}

	getMyUserId(): string | null {
		return this.myUserId;
	}

	setMyUserId(id: string | null): void {
		this.myUserId = id;
	}

	async joinQueue(gameType: string, stake: number): Promise<PollSnapshot> {
		return this.post("/matchmaking/joinQueue", { gameType, stake });
	}

	async fetchQueueList(gameType: string): Promise<{ stake: number; waiting: number; playerIds: string[] }[]> {
		try {
			return await this.get<{ stake: number; waiting: number; playerIds: string[] }[]>(
				`/matchmaking/queueList?gameType=${encodeURIComponent(gameType)}`,
			);
		} catch {
			return [];
		}
	}

	/**
	 * Register this user as "browsing the lobby" with the given stake.
	 * Call on page open and whenever the stake changes.
	 * Fire-and-forget — errors are swallowed.
	 */
	async setLobbyPresence(gameType: string, stake: number): Promise<void> {
		try {
			await this.post("/matchmaking/lobbyPresence", { gameType, stake });
		} catch {
			// Best-effort — lobby presence is not critical
		}
	}

	/**
	 * Returns all online players currently in the lobby for the given gameType
	 * (both browsing and queued), as seen by the server. Excludes self.
	 */
	async fetchLobbyPlayers(gameType: string): Promise<{ userId: string; stake: number; inQueue: boolean; inGame: boolean; opponentId?: string }[]> {
		try {
			return await this.get<{ userId: string; stake: number; inQueue: boolean; inGame: boolean; opponentId?: string }[]>(
				`/matchmaking/lobbyPlayers?gameType=${encodeURIComponent(gameType)}`,
			);
		} catch {
			return [];
		}
	}

	async leaveQueue(): Promise<void> {
		await this.post("/matchmaking/leaveQueue", {});
	}

	async resign(sessionId: string): Promise<void> {
		await this.post("/matchmaking/resign", { sessionId });
	}

	/**
	 * Reliable fire-and-forget. Adds the move to an outbox; a single
	 * background worker keeps retrying POST /move until 200 OK or the
	 * session ends. Each move gets a unique clientMoveId for server-side
	 * dedup — even if a network hiccup causes a retry, the server
	 * processes the move at most once.
	 */
	queueMove(sessionId: string, move: unknown): void {
		const clientMoveId = (typeof crypto !== "undefined" && "randomUUID" in crypto)
			? (crypto as Crypto).randomUUID()
			: `${Date.now()}-${Math.random().toString(36).slice(2)}`;
		this.outbox.push({ sessionId, move, clientMoveId });
		logEvent("mm-client", "queueMove", { move, clientMoveId });
		void this.processOutbox();
	}

	private async processOutbox(): Promise<void> {
		if (this.outboxRunning) return;
		this.outboxRunning = true;
		try {
			while (this.outbox.length > 0) {
				const item = this.outbox.shift();
				if (!item) break;
				// SERIALIZE: await each send before starting the next.
				// Parallel sends could arrive at the server out of order,
				// making the opponent see "defend" before "attack". The
				// serialization cost is small (~50 ms per move).
				await this.sendMoveWithRetry(item.sessionId, item.move, item.clientMoveId);
			}
		} finally {
			this.outboxRunning = false;
		}
	}

	private async sendMoveWithRetry(sessionId: string, move: unknown, clientMoveId: string): Promise<void> {
		// Retry POST /move up to 5× on transient failures. The server
		// dedupes by clientMoveId — even if the same move is retried,
		// it's processed at most once.
		for (let attempt = 0; attempt < 5; attempt++) {
			try {
				const result = await this.post<{ ok: boolean; idx?: number; version?: number; state?: GameStateView }>(
					"/matchmaking/move",
					{ sessionId, move, clientMoveId, baseVersion: this.latestVersion },
				);
				if (result.ok) {
					if (result.state && typeof result.version === "number") {
						this.latestVersion = result.version;
						this.listeners.forEach((l) => l({
							status: "playing",
							sessionId,
							state: result.state,
							version: result.version,
						} as PollSnapshot));
					}
					logEvent("mm-client", "move accepted", {
						clientMoveId, idx: result.idx, version: result.version,
					});
					return;
				}
			} catch (err) {
				const msg = err instanceof Error ? err.message : "";
				if (msg.includes("HTTP 409")) {
					logWarn("mm-client", "move 409 (session ended / version conflict)", { clientMoveId, msg });
					await this.pollNow();
					return;
				}
				if (msg.includes("HTTP 400")) {
					logWarn("mm-client", "move 400 (invalid)", { clientMoveId, msg });
					await this.pollNow();
					return;
				}
				logWarn("mm-client", `move attempt ${attempt + 1} failed`, { clientMoveId, msg });
			}
			await new Promise((r) => setTimeout(r, 200 * (attempt + 1)));
		}
		logError("mm-client", "move dropped after 5 attempts", { clientMoveId });
	}

	/**
	 * Force an immediate poll, dispatching to listeners. Used after
	 * errors / version conflicts so the client doesn't sit on a stale
	 * view waiting for the next polling tick.
	 */
	async pollNow(): Promise<void> {
		try {
			const snap = await this.pollOnce();
			if (typeof snap.version === "number") this.latestVersion = snap.version;
			this.listeners.forEach((l) => l(snap));
		} catch {
			// Swallow — the polling loop will retry.
		}
	}

	/**
	 * One-shot POST /move that throws on failure. Kept for API
	 * compatibility — most callers should use queueMove() instead.
	 */
	async sendMove(sessionId: string, move: unknown): Promise<{ ok: boolean; idx?: number }> {
		return this.post<{ ok: boolean; idx?: number }>("/matchmaking/move", { sessionId, move });
	}

	async pollOnce(): Promise<PollSnapshot> {
		// Single attempt — let the regular tick interval handle retries.
		// Multi-attempt with backoff inside one call would block the
		// inFlight guard for the next interval and skip ticks.
		return this.post<PollSnapshot>("/matchmaking/poll", {
			sessionId: this.currentSessionId,
			ready: this.currentReady,
		});
	}

	startPolling(opts: {
		sessionId?: string;
		ready?: boolean;
		intervalMs?: number;
		onUpdate: Listener;
	}): () => void {
		this.stopPolling();
		this.currentSessionId = opts.sessionId;
		this.currentReady = !!opts.ready;
		this.listeners.add(opts.onUpdate);
		this.latestVersion = 0;
		const interval = opts.intervalMs ?? 600;
		const myGeneration = ++this.generation;

		// RECURSIVE polling loop, not setInterval. Two reasons:
		//   1. setInterval can stack overlapping requests if the server
		//      responds slower than the interval. The recursive form
		//      AWAITS each poll, so the next one starts only when the
		//      previous finished.
		//   2. Errors don't crash the loop — they're caught and we keep
		//      iterating so polling NEVER stops mid-game on a flaky
		//      network blip.
		const loop = async () => {
			while (myGeneration === this.generation) {
				try {
					const snap = await this.pollOnce();
					if (myGeneration !== this.generation) return;
					if (typeof snap.version === "number" && snap.version > this.latestVersion) {
						this.latestVersion = snap.version;
						logEvent("mm-client", "poll: new version", { version: snap.version });
					}
					this.listeners.forEach((l) => l(snap));
				} catch (err) {
					logWarn("mm-client", "poll error (will retry)", { msg: err instanceof Error ? err.message : String(err) });
				}
				if (myGeneration !== this.generation) return;
				await new Promise((r) => setTimeout(r, interval));
			}
		};
		void loop();
		logEvent("mm-client", "startPolling", { sessionId: opts.sessionId, intervalMs: interval });

		return () => {
			this.listeners.delete(opts.onUpdate);
			if (this.listeners.size === 0) this.stopPolling();
		};
	}

	stopPolling(): void {
		// Bumping the generation makes the recursive loop exit on its
		// next iteration. No need to track timer handles.
		this.generation++;
	}

	private async get<T = unknown>(path: string): Promise<T> {
		const f = this.bridgeFetch ?? fetch;
		const url = `${API_BASE_URL}/api/v1${path}`;
		const controller = new AbortController();
		const timeout = setTimeout(() => controller.abort(), 8000);
		try {
			const res = await f(url, {
				method: "GET",
				headers: { "Cache-Control": "no-store" },
				signal: controller.signal,
			});
			if (!res.ok) {
				const text = await res.text().catch(() => "");
				throw new Error(`HTTP ${res.status}: ${text}`);
			}
			return res.json() as Promise<T>;
		} finally {
			clearTimeout(timeout);
		}
	}

	private async post<T = PollSnapshot>(path: string, body: unknown): Promise<T> {
		const f = this.bridgeFetch ?? fetch;
		const url = path === "/matchmaking/poll"
			? `${API_BASE_URL}/api/v1${path}?t=${Date.now()}`
			: `${API_BASE_URL}/api/v1${path}`;
		// 8-second timeout. A hung fetch (server gone, mobile suspended,
		// proxy stuck) would otherwise block the entire polling loop
		// forever — the user would sit on a stale view indefinitely.
		const controller = new AbortController();
		const timeout = setTimeout(() => controller.abort(), 8000);
		try {
			const res = await f(url, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					"Cache-Control": "no-store",
				},
				body: JSON.stringify(body),
				signal: controller.signal,
			});
			if (!res.ok) {
				const text = await res.text().catch(() => "");
				throw new Error(`HTTP ${res.status}: ${text}`);
			}
			return res.json();
		} finally {
			clearTimeout(timeout);
		}
	}
}

export const mmClient = new MmClient();
