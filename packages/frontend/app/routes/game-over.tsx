import { useBridgeFetch, useSignalReady, useFlutterBridge } from "@playneta/flutter-js-bridge";
import { useEffect, useMemo, useRef } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { API_BASE_URL } from "~/config";
import { a } from "~/utils/asset-url";
import { getTranslations, type GameType } from "~/i18n/translations";
import { CrystalIcon } from "~/components/crystal-icon";
import { playLose, playWin } from "~/lib/sounds";

const RESULT_CONFIG = {
	win:  { label: "Вы победили!", img: a("/result-win.png") },
	lose: { label: "Вы проиграли", img: a("/result-lose.png") },
	draw: { label: "Ничья",        img: a("/result-lose.png") },
};

export default function GameOver() {
	const navigate = useNavigate();
	const signalReady = useSignalReady();
	const [params] = useSearchParams();
	const { state } = useFlutterBridge();
	const lang = state.headers?.["Accept-Language"] ?? "en";
	const t = useMemo(() => getTranslations(lang), [lang]);

	const result   = params.get("result") as "win" | "lose" | "draw" | null;
	const gameType = params.get("game") as GameType | null;
	const coins    = Number(params.get("coins") ?? 0);
	const vsBot    = params.get("vsBot") === "1";

	const bridgeFetch = useBridgeFetch();
	const recorded = useRef(false);

	useEffect(() => {
		if (!vsBot || !result || !gameType || recorded.current) return;
		recorded.current = true;
		bridgeFetch(`${API_BASE_URL}/api/v1/gameResult`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ gameType, result }),
		}).catch(() => {});
	// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);

	useEffect(() => { signalReady(); }, [signalReady]);

	// Win / lose fanfare on mount (once).
	const playedRef = useRef(false);
	useEffect(() => {
		if (playedRef.current || !result) return;
		playedRef.current = true;
		if (result === "win") playWin();
		else playLose();
	}, [result]);

	const cfg = RESULT_CONFIG[result ?? "lose"];
	// suppress unused warnings
	void t; void gameType;

	return (
		/*
		  Transparent blur overlay — lets the Flutter app behind show through blurred.
		*/
		<div
			className="fixed inset-0 z-30 flex flex-col justify-end"
			style={{
				backdropFilter: "blur(12px)",
				WebkitBackdropFilter: "blur(12px)",
				background: "rgba(0,0,0,0.35)",
				animation: "var(--animate-backdrop-in)",
			}}
		>
			{/* Tap outside sheet → menu */}
			<div className="absolute inset-0" onClick={() => navigate("/")} />

			{/* Sheet + art */}
			<div className="relative" style={{ animation: "var(--animate-sheet-up)" }}>
				{/* Art image — full width */}
				<img
					src={cfg.img}
					alt=""
					style={{ display: "block", width: "100%", objectFit: "cover", objectPosition: "center center" }}
				/>

				{/* White card — rounded top, overlaps image */}
				<div className="bg-white" style={{ borderRadius: "24px 24px 0 0", marginTop: -20, padding: "32px 24px calc(48px + env(safe-area-inset-bottom, 20px))", position: "relative" }}>
					{/* Title */}
					<p style={{ fontFamily: "var(--font-ubuntu)", fontSize: 28, fontWeight: 700, color: "#323C5E", textAlign: "center", marginBottom: coins > 0 ? 20 : 36 }}>
						{cfg.label}
					</p>

					{/* Crystals */}
					{coins > 0 && (
						<div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 12, marginBottom: 36 }}>
							<CrystalIcon size={64} />
							<div style={{ display: "flex", alignItems: "center", gap: 6, background: "#F0F8FF", borderRadius: 999, padding: "10px 24px", border: "1px solid #B3E5FC" }}>
								<span style={{ fontFamily: "var(--font-ubuntu)", fontSize: 18, fontWeight: 700, color: "#0288D1" }}>
									+{coins} кристаллов
								</span>
							</div>
						</div>
					)}

					{/* Buttons */}
					<div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 16 }}>
						{gameType && (
							<button
								type="button"
								onClick={() => navigate(`/mode/${gameType}`)}
								style={{ padding: "18px 52px", borderRadius: 999, background: "#F0196E", fontFamily: "var(--font-ubuntu)", fontSize: 20, fontWeight: 700, color: "#fff", border: "none", cursor: "pointer" }}
							>
								Играть ещё
							</button>
						)}
						<button
							type="button"
							onClick={() => navigate("/")}
							style={{ background: "none", border: "none", cursor: "pointer", fontFamily: "var(--font-ubuntu)", fontSize: 17, fontWeight: 600, color: "#6B6B8A", padding: "8px 0" }}
						>
							В меню
						</button>
					</div>
				</div>
			</div>
		</div>
	);
}
