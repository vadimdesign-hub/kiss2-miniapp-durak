import { useState } from "react";

interface Rule {
	text: string;
}

interface GameLayoutProps {
	/** Game display name */
	gameName: string;
	/** Game icon/emoji shown in header */
	gameIcon: string;
	/** Short session id shown in header corner */
	sessionId?: string;
	/** My avatar symbol / piece color label */
	mySymbol: React.ReactNode;
	/** Opponent avatar symbol / piece color label */
	opponentSymbol: React.ReactNode;
	/** Whether it's my turn (affects opponent status text) */
	isMyTurn: boolean;
	/** Status text shown between header and board */
	status: React.ReactNode;
	/** Rules shown in the ? sheet */
	rules: Rule[];
	/** Bottom action bar content (resign button, etc.) */
	footer: React.ReactNode;
	/** The game board */
	children: React.ReactNode;
	onExit: () => void;
	/** Optional className override for the root container */
	className?: string;
	/** Optional inline style for the root container */
	style?: React.CSSProperties;
}

export function GameLayout({
	gameName,
	gameIcon,
	sessionId,
	mySymbol,
	opponentSymbol,
	isMyTurn,
	status,
	rules,
	footer,
	children,
	onExit,
	className,
	style,
}: GameLayoutProps) {
	const [showRules, setShowRules] = useState(false);

	return (
		<div className={className ?? "min-h-screen bg-[#111] flex flex-col"} style={style}>
			{/* ── Header ── */}
			<div className="flex items-center justify-between px-4 pt-4 pb-2">
				<button
					type="button"
					onClick={onExit}
					className="w-9 h-9 rounded-full bg-white/8 flex items-center justify-center text-white/60 active:bg-white/15 active:text-white transition-colors"
					aria-label="Exit"
				>
					<svg width="14" height="14" viewBox="0 0 14 14" fill="none">
						<path d="M1 1l12 12M13 1L1 13" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
					</svg>
				</button>

				<div className="flex items-center gap-1.5">
					<span className="text-base">{gameIcon}</span>
					<span className="text-white font-semibold text-base">{gameName}</span>
					{sessionId && (
						<span className="text-white/25 text-xs font-mono ml-1">#{sessionId.slice(0, 6)}</span>
					)}
				</div>

				<button
					type="button"
					onClick={() => setShowRules(true)}
					className="w-9 h-9 rounded-full bg-white/8 flex items-center justify-center text-white/60 active:bg-white/15 active:text-white transition-colors text-sm font-bold"
					aria-label="Rules"
				>
					?
				</button>
			</div>

			{/* ── Opponent card ── */}
			<div className="px-3 pt-1 pb-1">
				<div className={`flex items-center gap-2 px-3 py-2 rounded-xl border transition-colors ${!isMyTurn ? "bg-white/8 border-white/15" : "bg-white/3 border-white/6"}`}>
					<div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 transition-colors ${!isMyTurn ? "bg-purple-500/30 ring-2 ring-purple-400/50" : "bg-white/10"}`}>
						{opponentSymbol}
					</div>
					<div className="flex-1 min-w-0">
						<div className="text-white/60 text-xs font-medium">Opponent</div>
					</div>
					{/* Always rendered — visibility prevents layout shift */}
					<div className="flex gap-1" style={{ visibility: !isMyTurn ? "visible" : "hidden" }}>
						{[0, 1, 2].map((i) => (
							<div
								key={i}
								className="w-1 h-1 rounded-full bg-purple-400 animate-bounce"
								style={{ animationDelay: `${i * 0.15}s` }}
							/>
						))}
					</div>
				</div>
			</div>

			{/* ── Status ── */}
			<div className="text-center px-4 py-0.5 h-[22px] flex items-center justify-center overflow-hidden">
				{status}
			</div>

			{/* ── Game board ── */}
			<div className="flex-1 flex flex-col min-h-0">
				{children}
			</div>

			{/* ── My card + footer ── */}
			<div className="px-3 pb-1 pt-1">
				<div className={`flex items-center gap-2 px-3 py-2 rounded-xl border transition-colors ${isMyTurn ? "bg-white/8 border-white/15" : "bg-white/3 border-white/6"}`}>
					<div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 transition-colors ${isMyTurn ? "bg-emerald-500/30 ring-2 ring-emerald-400/50" : "bg-white/10"}`}>
						{mySymbol}
					</div>
					<div className="flex-1 min-w-0">
						<div className="text-white/60 text-xs font-medium">You</div>
					</div>
					{/* Always rendered — visibility prevents layout shift */}
					<span className="text-emerald-400 text-xs" style={{ visibility: isMyTurn ? "visible" : "hidden" }}>
						Your turn
					</span>
				</div>
			</div>

			{/* ── Footer actions ── */}
			<div className="px-3 pb-4">
				{footer}
			</div>

			{/* ── Rules bottom sheet ── */}
			{showRules && (
				<div
					className="fixed inset-0 z-50 flex flex-col justify-end"
					onClick={() => setShowRules(false)}
				>
					<div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
					<div
						className="relative bg-[#1c1c1e] rounded-t-3xl p-6 pb-10 max-h-[70vh] overflow-y-auto"
						onClick={(e) => e.stopPropagation()}
					>
						<div className="w-10 h-1 rounded-full bg-white/20 mx-auto mb-5" />
						<div className="flex items-center gap-2 mb-4">
							<span className="text-2xl">{gameIcon}</span>
							<h2 className="text-white font-bold text-lg">{gameName} — Rules</h2>
						</div>
						<ul className="flex flex-col gap-3">
							{rules.map((rule, i) => (
								<li key={i} className="flex gap-3 text-white/70 text-sm leading-relaxed">
									<span className="text-white/30 font-mono mt-0.5 flex-shrink-0">{i + 1}.</span>
									<span>{rule.text}</span>
								</li>
							))}
						</ul>
						<button
							type="button"
							onClick={() => setShowRules(false)}
							className="mt-6 w-full py-3.5 rounded-2xl bg-white/10 text-white font-medium active:bg-white/15"
						>
							Got it
						</button>
					</div>
				</div>
			)}
		</div>
	);
}
