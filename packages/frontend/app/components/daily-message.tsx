import { useDailyMessage } from "~/hooks/use-daily-message";

export function DailyMessage() {
	const { message, connected } = useDailyMessage();

	return (
		<div className="flex flex-col items-center gap-2 p-6">
			<div className="flex items-center gap-2">
				<div className={`w-2 h-2 rounded-full ${connected ? "bg-green-400" : "bg-red-400"}`} />
				<span className="text-xs text-gray-500">{connected ? "Live" : "Connecting..."}</span>
			</div>
			{message && (
				<div className="text-2xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-purple-400 to-pink-500 animate-pulse">
					{message}
				</div>
			)}
		</div>
	);
}
