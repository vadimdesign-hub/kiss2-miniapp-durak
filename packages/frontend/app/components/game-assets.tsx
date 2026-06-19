/**
 * PLACEHOLDER game assets — replace these components with custom artwork.
 *
 * Each export is a self-contained React component with a stable props interface.
 * Swap in custom <img>, <svg>, or sprite-sheet components here; all games
 * import only from this file, so one change updates every board automatically.
 */

import type { CSSProperties } from "react";

/* ─── Tic-Tac-Toe ───────────────────────────────────────────────────────── */

export function XMark({ className = "" }: { className?: string }) {
	return (
		<span className={`text-purple-400 font-bold select-none ${className}`} aria-label="X">
			✕
		</span>
	);
}

export function OMark({ className = "" }: { className?: string }) {
	return (
		<span className={`text-orange-400 font-bold select-none ${className}`} aria-label="O">
			○
		</span>
	);
}

/* ─── Checkers ──────────────────────────────────────────────────────────── */

interface PieceProps {
	/** "mine" = amber, "opp" = white/dark */
	owner: "mine" | "opp";
	isKing?: boolean;
	className?: string;
}

export function CheckerPiece({ owner, isKing = false, className = "" }: PieceProps) {
	const base =
		owner === "mine"
			? "bg-amber-400 border-amber-200"
			: "bg-gray-200 border-gray-400";

	return (
		<div
			className={`rounded-full border-2 flex items-center justify-center ${base} ${className}`}
			aria-label={`${owner === "mine" ? "My" : "Opponent"} ${isKing ? "king" : "piece"}`}
		>
			{isKing && (
				<span className="text-[8px] leading-none select-none">♛</span>
			)}
		</div>
	);
}

/* ─── Durak ─────────────────────────────────────────────────────────────── */

interface CardFrontProps {
	rank: string;
	suit: string;
	highlighted?: boolean;
	selected?: boolean;
	className?: string;
	style?: CSSProperties;
}

const RED_SUITS = new Set(["♥", "♦"]);

export function CardFront({
	rank,
	suit,
	highlighted = false,
	selected = false,
	className = "",
	style,
}: CardFrontProps) {
	const textColor = RED_SUITS.has(suit) ? "text-red-600" : "text-gray-900";
	const border = selected
		? "border-purple-400"
		: highlighted
			? "border-emerald-400"
			: "border-gray-200";

	return (
		<div
			className={`bg-white rounded-lg border-2 flex flex-col items-center justify-center font-bold select-none ${border} ${textColor} ${className}`}
			aria-label={`${rank}${suit}`}
			style={style}
		>
			<span className="leading-tight text-xs">{rank}</span>
			<span className="leading-tight text-sm">{suit}</span>
		</div>
	);
}

interface CardBackProps {
	className?: string;
}

export function CardBack({ className = "" }: CardBackProps) {
	return (
		<div
			className={`bg-emerald-800 border border-emerald-600 rounded-lg flex items-center justify-center text-emerald-500 select-none ${className}`}
			aria-label="Card back"
		>
			<span className="text-lg">🂠</span>
		</div>
	);
}

/** Trump suit indicator shown in the corner of the Durak board */
export function TrumpBadge({ suit }: { suit: string }) {
	const isRed = RED_SUITS.has(suit);
	return (
		<span
			className={`text-sm font-bold select-none ${isRed ? "text-red-400" : "text-white"}`}
			aria-label={`Trump: ${suit}`}
		>
			{suit}
		</span>
	);
}
