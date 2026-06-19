/**
 * Tiny in-memory event log for debugging multiplayer sync issues.
 *
 * Ring buffer of the last N events. Components can subscribe to be
 * re-rendered when new events come in. Persisted to sessionStorage so
 * a hard-refresh during testing doesn't lose context.
 */

export type LogLevel = "info" | "warn" | "error";

export interface LogEntry {
	ts: number;
	level: LogLevel;
	category: string;
	message: string;
	data?: unknown;
}

const MAX_ENTRIES = 300;
const STORAGE_KEY = "miniapp:debug-logs";

let buffer: LogEntry[] = [];
const listeners = new Set<() => void>();

// Hydrate from sessionStorage on module load (browser only).
if (typeof window !== "undefined") {
	try {
		const raw = sessionStorage.getItem(STORAGE_KEY);
		if (raw) {
			const parsed = JSON.parse(raw) as LogEntry[];
			if (Array.isArray(parsed)) buffer = parsed.slice(-MAX_ENTRIES);
		}
	} catch {
		// ignore
	}
}

function persist(): void {
	if (typeof window === "undefined") return;
	try {
		sessionStorage.setItem(STORAGE_KEY, JSON.stringify(buffer));
	} catch {
		// quota exceeded etc — silently drop
	}
}

export function logEvent(
	category: string,
	message: string,
	data?: unknown,
	level: LogLevel = "info",
): void {
	const entry: LogEntry = { ts: Date.now(), level, category, message, data };
	buffer.push(entry);
	if (buffer.length > MAX_ENTRIES) buffer = buffer.slice(-MAX_ENTRIES);
	persist();
	for (const fn of listeners) fn();
}

export function logWarn(category: string, message: string, data?: unknown): void {
	logEvent(category, message, data, "warn");
}

export function logError(category: string, message: string, data?: unknown): void {
	logEvent(category, message, data, "error");
}

export function getLogs(): LogEntry[] {
	return buffer.slice();
}

export function subscribeLogs(fn: () => void): () => void {
	listeners.add(fn);
	return () => {
		listeners.delete(fn);
	};
}

export function clearLogs(): void {
	buffer = [];
	persist();
	for (const fn of listeners) fn();
}
