/**
 * Game-mode picker. Opens after the user taps a game tile on the home
 * screen and lets them choose multiplayer (→ /match/<type>) or vs-bot
 * (→ /game/<type>/bot-<ts>).
 */
import { useSignalReady } from "@playneta/flutter-js-bridge";
import { useEffect } from "react";
import { useNavigate, useParams } from "react-router";
import type { GameType } from "~/i18n/translations";
import { a } from "~/utils/asset-url";

const GAME_BG_IMAGE: Record<GameType, string> = {
	durak: a("/durak/bg.png"),
};
const GAME_BG_FALLBACK: Record<GameType, string> = {
	durak: "linear-gradient(160deg, #0F3320 0%, #1A4A2A 60%, #0F3320 100%)",
};

export default function Mode() {
	const { gameType } = useParams<{ gameType: GameType }>();
	const navigate = useNavigate();
	const signalReady = useSignalReady();

	useEffect(() => {
		signalReady();
	}, [signalReady]);

	const bgImage = gameType ? GAME_BG_IMAGE[gameType] : "";
	const bgFallback = gameType ? GAME_BG_FALLBACK[gameType] : "linear-gradient(160deg,#1A1A2E,#2D1B6E)";

	const handleMP = () => navigate(`/match/${gameType}`);
	const handleBot = () => {
		const fakeSessionId = `bot-${Date.now()}`;
		navigate(`/game/${gameType}/${fakeSessionId}`, {
			state: { vsBot: true },
		});
	};

	return (
		<div
			style={{
				height: "100dvh",
				background: bgFallback,
				backgroundImage: bgImage ? `url(${bgImage})` : undefined,
				backgroundSize: "cover",
				backgroundPosition: "center",
				backgroundRepeat: "no-repeat",
				position: "relative",
				display: "flex",
				flexDirection: "column",
				alignItems: "center",
				justifyContent: "center",
				overflow: "hidden",
				touchAction: "none",
				overscrollBehavior: "none",
				padding: "0 24px 40px",
			}}
		>
			{/* Close button → back to home */}
			<button
				type="button"
				onClick={() => navigate("/")}
				style={{
					position: "absolute",
					top: 40,
					left: 16,
					width: 48,
					height: 48,
					borderRadius: "50%",
					background: "rgba(0,0,0,0.45)",
					backdropFilter: "blur(4px)",
					WebkitBackdropFilter: "blur(4px)",
					border: "none",
					cursor: "pointer",
					display: "flex",
					alignItems: "center",
					justifyContent: "center",
					zIndex: 10,
				}}
			>
				<svg width="16" height="16" viewBox="0 0 14 14" fill="none">
					<path d="M1 1l12 12M13 1L1 13" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" />
				</svg>
			</button>

			{/* Title */}
			<div
				style={{
					fontFamily: "var(--font-ubuntu)",
					fontSize: 28,
					fontWeight: 700,
					color: "#fff",
					textShadow: "0 2px 12px rgba(0,0,0,0.6)",
					textAlign: "center",
					marginBottom: 36,
				}}
			>
				Выберите режим игры
			</div>

			{/* Buttons */}
			<div style={{ display: "flex", flexDirection: "column", gap: 18, width: "100%", maxWidth: 360, alignItems: "center" }}>
				{/* Multiplayer — pink, "Пас" 3D pill style */}
				<button
					type="button"
					onClick={handleMP}
					style={{
						width: "100%",
						padding: "18px 0",
						borderRadius: 999,
						background: "linear-gradient(to bottom, #F0699F, #D81B60)",
						border: "none",
						borderBottom: "3px solid #880E4F",
						boxShadow: "0 3px 0 #880E4F, inset 0 1px 0 rgba(255,255,255,0.25)",
						fontFamily: "var(--font-ubuntu)",
						fontSize: 20,
						fontWeight: 700,
						color: "#fff",
						textShadow: "0 1px 2px rgba(0,0,0,0.35)",
						cursor: "pointer",
						transition: "transform 0.08s, box-shadow 0.08s",
					}}
					onPointerDown={(e) => {
						e.currentTarget.style.transform = "translateY(3px)";
						e.currentTarget.style.boxShadow = "0 1px 0 #880E4F, inset 0 1px 0 rgba(255,255,255,0.25)";
					}}
					onPointerUp={(e) => {
						e.currentTarget.style.transform = "";
						e.currentTarget.style.boxShadow = "0 3px 0 #880E4F, inset 0 1px 0 rgba(255,255,255,0.25)";
					}}
				>
					Мультиплеер
				</button>

				{/* Bot — green, "Пас" style */}
				<button
					type="button"
					onClick={handleBot}
					style={{
						width: "100%",
						padding: "18px 0",
						borderRadius: 999,
						background: "linear-gradient(to bottom, #66BB6A, #388E3C)",
						border: "none",
						borderBottom: "3px solid #1B5E20",
						boxShadow: "0 3px 0 #1B5E20, inset 0 1px 0 rgba(255,255,255,0.25)",
						fontFamily: "var(--font-ubuntu)",
						fontSize: 20,
						fontWeight: 700,
						color: "#fff",
						textShadow: "0 1px 2px rgba(0,0,0,0.35)",
						cursor: "pointer",
						transition: "transform 0.08s, box-shadow 0.08s",
					}}
					onPointerDown={(e) => {
						e.currentTarget.style.transform = "translateY(3px)";
						e.currentTarget.style.boxShadow = "0 2px 0 #1B5E20, inset 0 1px 0 rgba(255,255,255,0.25)";
					}}
					onPointerUp={(e) => {
						e.currentTarget.style.transform = "";
						e.currentTarget.style.boxShadow = "0 3px 0 #1B5E20, inset 0 1px 0 rgba(255,255,255,0.25)";
					}}
				>
					Игра с ботом
				</button>
			</div>
		</div>
	);
}
