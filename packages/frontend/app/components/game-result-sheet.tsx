import { useEffect, useRef, useState } from "react";
import { getTranslations } from "~/i18n/translations";
import { playLose, playWin } from "~/lib/sounds";
import { a } from "~/utils/asset-url";

const COIN_ICON = a("/durak/CoinIcon.png");

interface GameResultSheetProps {
	result: "win" | "lose";
	/** Net coins won (after commission). Only shown on win when > 0. */
	coinsWon?: number;
	/** Coins lost (stake). Only shown on lose when > 0, in red. */
	coinsLost?: number;
	/** BCP-47 language tag from the Flutter bridge (e.g. "ru", "en-US"). */
	lang?: string;
	/** When true the title changes to "Играть с ботом ещё раз?" */
	vsBot?: boolean;
	onPlayAgain: () => void;
	onMenu: () => void;
}

export function GameResultSheet({ result, coinsWon = 0, coinsLost = 0, lang = "en", vsBot = false, onPlayAgain, onMenu }: GameResultSheetProps) {
	const [closing, setClosing] = useState(false);
	const t = getTranslations(lang);

	const cfg = {
		win:  { label: vsBot ? t.botResultTitle : t.youWon,  img: a("/result-win.png") },
		lose: { label: vsBot ? t.botResultTitle : t.youLost, img: a("/result-lose.png") },
	}[result];

	// Play win/lose fanfare exactly once when the sheet appears.
	const playedRef = useRef(false);
	useEffect(() => {
		if (playedRef.current) return;
		playedRef.current = true;
		if (result === "win") playWin();
		else playLose();
	}, [result]);

	const dismiss = (cb: () => void) => {
		setClosing(true);
		setTimeout(cb, 280);
	};

	return (
		/*
		  Outer div: covers the whole screen.
		  backdrop-filter here blurs the GAME content that is behind this fixed layer.
		  background: semi-transparent dark overlay.
		*/
		<div
			className="fixed inset-0 z-30 flex flex-col justify-end"
			style={{
				backdropFilter: "blur(12px)",
				WebkitBackdropFilter: "blur(12px)",
				background: "rgba(0,0,0,0.35)",
				animation: closing ? "var(--animate-backdrop-out)" : "var(--animate-backdrop-in)",
				overscrollBehavior: "contain",
			}}
		>
			{/* Sheet + art — animated slide */}
			<div
				className="relative"
				style={{ animation: closing ? "var(--animate-sheet-down)" : "var(--animate-sheet-up)" }}
			>
				{/* Art image */}
				<img
					src={cfg.img}
					alt=""
					style={{ display: "block", width: "100%", pointerEvents: "none", userSelect: "none" }}
				/>

				{/* White card */}
				<div
					className="bg-white"
					style={{ borderRadius: "24px 24px 0 0", marginTop: -20, padding: "32px 24px calc(48px + env(safe-area-inset-bottom, 20px))", position: "relative" }}
				>
					<p style={{
						fontFamily: "var(--font-ubuntu)", fontSize: 28, fontWeight: 700,
						color: "#323C5E", textAlign: "center",
						marginBottom: (result === "win" && coinsWon > 0) || (result === "lose" && coinsLost > 0) ? 16 : 36,
					}}>
						{cfg.label}
					</p>

					{result === "win" && coinsWon > 0 && (
						<div style={{
							display: "flex", alignItems: "center", justifyContent: "center",
							gap: 10, marginBottom: 28,
						}}>
							<img src={COIN_ICON} alt="" width={40} height={40} style={{ flexShrink: 0 }} />
							<span style={{
								fontFamily: "var(--font-ubuntu)", fontSize: 26, fontWeight: 700,
								color: "#323C5E",
							}}>
								{coinsWon.toLocaleString()}
							</span>
						</div>
					)}

					{result === "lose" && coinsLost > 0 && (
						<div style={{
							display: "flex", alignItems: "center", justifyContent: "center",
							gap: 10, marginBottom: 28,
						}}>
							<img src={COIN_ICON} alt="" width={40} height={40} style={{ flexShrink: 0 }} />
							<span style={{
								fontFamily: "var(--font-ubuntu)", fontSize: 26, fontWeight: 700,
								color: "#E53935",
							}}>
								−{coinsLost.toLocaleString()}
							</span>
						</div>
					)}

					<div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 14 }}>
						<button
							type="button"
							onClick={() => dismiss(onPlayAgain)}
							style={{ padding: "18px 52px", borderRadius: 999, background: "#F0196E", fontFamily: "var(--font-ubuntu)", fontSize: 20, fontWeight: 700, color: "#fff", border: "none", cursor: "pointer" }}
						>
							{vsBot ? t.play : t.playAgain}
						</button>
						<button
							type="button"
							onClick={() => dismiss(onMenu)}
							style={{ padding: "14px 40px", borderRadius: 999, background: "transparent", fontFamily: "var(--font-ubuntu)", fontSize: 18, fontWeight: 600, color: "#64728F", border: "none", cursor: "pointer" }}
						>
							{t.toLobby}
						</button>
					</div>
				</div>
			</div>
		</div>
	);
}
