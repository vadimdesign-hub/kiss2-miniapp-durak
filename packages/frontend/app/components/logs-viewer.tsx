import { useEffect, useState } from "react";
import { clearLogs, getLogs, type LogEntry, subscribeLogs } from "~/lib/logger";

/**
 * Floating "Логи" button + slide-up panel that shows the last N
 * captured events. Subscribes to the logger module so the panel
 * updates live as new events arrive.
 */
export function LogsViewer() {
	const [open, setOpen] = useState(false);
	const [logs, setLogs] = useState<LogEntry[]>(() => getLogs());

	useEffect(() => {
		return subscribeLogs(() => setLogs(getLogs()));
	}, []);

	const reversed = [...logs].reverse(); // newest first

	return (
		<>
			{/* Floating button — bottom-left so it doesn't collide with X/exit */}
			<button
				type="button"
				onClick={() => setOpen(true)}
				className="fixed bottom-4 left-4 z-[80] bg-black/70 backdrop-blur-sm text-white text-xs font-mono px-3 py-2 rounded-full border border-white/20 shadow-lg active:bg-black/85"
				style={{ pointerEvents: "auto" }}
			>
				📋 Логи ({logs.length})
			</button>

			{open && (
				<div className="fixed inset-0 z-[200] flex flex-col bg-black/95">
					{/* Header */}
					<div className="flex items-center justify-between px-4 py-3 bg-gray-900 text-white border-b border-white/10">
						<div className="flex items-center gap-2">
							<span className="font-bold text-base">📋 Логи</span>
							<span className="text-xs opacity-60">({logs.length})</span>
						</div>
						<div className="flex gap-2">
							<button
								type="button"
								onClick={() => clearLogs()}
								className="text-xs bg-red-600/80 text-white px-3 py-1.5 rounded active:bg-red-700"
							>
								Очистить
							</button>
							<button
								type="button"
								onClick={() => setOpen(false)}
								className="text-xs bg-gray-600/80 text-white px-3 py-1.5 rounded active:bg-gray-700"
							>
								Закрыть
							</button>
						</div>
					</div>

					{/* Log list */}
					<div className="flex-1 overflow-auto bg-black p-2 font-mono text-[11px] leading-relaxed">
						{reversed.length === 0 ? (
							<div className="text-gray-500 p-4 text-center">Пока пусто.</div>
						) : (
							reversed.map((log, i) => (
								<div
									key={`${log.ts}-${i}`}
									className={`pb-1 border-b border-white/5 mb-1 ${
										log.level === "error"
											? "text-red-400"
											: log.level === "warn"
												? "text-yellow-300"
												: "text-emerald-300"
									}`}
								>
									<div>
										<span className="text-gray-500">
											{formatTime(log.ts)}
										</span>
										<span className="text-blue-300 ml-2">[{log.category}]</span>
										<span className="ml-2">{log.message}</span>
									</div>
									{log.data !== undefined && (
										<div className="text-gray-400 pl-4 break-all whitespace-pre-wrap">
											{safeStringify(log.data)}
										</div>
									)}
								</div>
							))
						)}
					</div>
				</div>
			)}
		</>
	);
}

function formatTime(ts: number): string {
	const d = new Date(ts);
	const h = String(d.getHours()).padStart(2, "0");
	const m = String(d.getMinutes()).padStart(2, "0");
	const s = String(d.getSeconds()).padStart(2, "0");
	const ms = String(d.getMilliseconds()).padStart(3, "0");
	return `${h}:${m}:${s}.${ms}`;
}

function safeStringify(v: unknown): string {
	try {
		return JSON.stringify(v, null, 2);
	} catch {
		return String(v);
	}
}
