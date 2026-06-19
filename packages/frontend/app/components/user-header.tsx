import { FlutterRoute, useFlutterBridge, useOpenRoute } from "@playneta/flutter-js-bridge";
import { useCallback, useMemo } from "react";
import type { UserProfile } from "~/hooks/use-user-profile";
import { getTranslations } from "~/i18n/translations";
import { CrystalIcon } from "~/components/crystal-icon";
import { a } from "~/utils/asset-url";

export function UserHeader({
	user,
	coinBalance,
	onLeaderboard,
}: {
	readonly user: UserProfile;
	readonly coinBalance: number | null;
	readonly onLeaderboard?: () => void;
}) {
	const { state } = useFlutterBridge();
	const openRoute = useOpenRoute();
	const lang = state.headers?.["Accept-Language"] ?? "en";
	const t = useMemo(() => getTranslations(lang), [lang]);
	void t;

	const handleOpenProfile = useCallback(() => {
		openRoute(FlutterRoute.Profile, { params: { profileId: user.id } });
	}, [openRoute, user.id]);

	const initials = user.nickname.slice(0, 2).toUpperCase();

	return (
		<div
			style={{
				background: "linear-gradient(160deg, #2D1B69 0%, #4A2DBF 60%, #5B3AD4 100%)",
				borderRadius: "0 0 28px 28px",
				padding: "52px 20px 24px",
				position: "relative",
				overflow: "hidden",
			}}
		>
			{/* Фоновая картинка с прозрачностью — самый нижний слой */}
			<div style={{ position: "absolute", inset: 0, zIndex: 0, backgroundImage: `url(${a("/hub-fon2.png")})`, backgroundSize: "cover", backgroundPosition: "center 60%", opacity: 0.7, pointerEvents: "none" }} />
			{/* Контент поверх фона */}
			<div style={{ position: "relative", zIndex: 1 }}>

				{/* Верхний ряд: заголовок «Игровой Хаб» слева, валюта справа */}
				<div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 20 }}>
					<span style={{ fontFamily: "var(--font-ubuntu)", fontSize: 34, fontWeight: 700, color: "#fff", lineHeight: 1.1 }}>
						Игровой Хаб
					</span>
					{coinBalance != null && (
						<div style={{ display: "flex", alignItems: "center", gap: 8, background: "rgba(0,0,0,0.28)", borderRadius: 999, padding: "8px 18px 8px 13px", border: "1px solid rgba(255,255,255,0.12)", flexShrink: 0, backdropFilter: "blur(12px)", WebkitBackdropFilter: "blur(12px)" }}>
							<CrystalIcon size={26} />
							<span style={{ fontFamily: "var(--font-ubuntu)", fontSize: 20, fontWeight: 700, color: "#fff", minWidth: 30 }}>
								{coinBalance.toLocaleString()}
							</span>
						</div>
					)}
				</div>

				{/* Строка профиля: аватар + имя слева, кнопка лидерборда справа */}
				<div style={{ display: "flex", alignItems: "center", gap: 10 }}>
					{/* Профиль */}
					<button
						type="button"
						onClick={handleOpenProfile}
						style={{ display: "flex", alignItems: "center", gap: 12, flex: 1, minWidth: 0, background: "none", border: "none", cursor: "pointer", padding: 0, textAlign: "left" }}
					>
						{user.currentAvatar ? (
							<img
								src={user.currentAvatar.url}
								alt={user.nickname}
								style={{ width: 53, height: 53, borderRadius: 14, objectFit: "cover", flexShrink: 0 }}
							/>
						) : (
							<div style={{ width: 53, height: 53, borderRadius: 14, background: "linear-gradient(135deg,#7C3AED,#4F46E5)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
								<span style={{ fontFamily: "var(--font-ubuntu)", fontSize: 19, fontWeight: 700, color: "#fff" }}>{initials}</span>
							</div>
						)}
						<div style={{ flex: 1, minWidth: 0 }}>
							<div style={{ fontFamily: "var(--font-ubuntu)", fontSize: 20, fontWeight: 700, color: "#fff", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
								{user.nickname}
							</div>
						</div>
					</button>

					{/* Кнопка лидерборда — пилюля с текстом и стрелкой */}
					{onLeaderboard && (
						<button
							type="button"
							onClick={onLeaderboard}
							style={{
								display: "flex", alignItems: "center", gap: 10,
								padding: "13px 18px",
								borderRadius: 999,
								background: "rgba(255,255,255,0.18)",
								border: "1px solid rgba(255,255,255,0.22)",
								cursor: "pointer",
								flexShrink: 0,
								fontFamily: "var(--font-ubuntu)",
								fontSize: 17, fontWeight: 700,
								color: "#fff",
								backdropFilter: "blur(12px)",
								WebkitBackdropFilter: "blur(12px)",
							}}
							aria-label="Таблица лидеров"
						>
							<span>Таблица лидеров</span>
							<svg width="9" height="16" viewBox="0 0 7 12" fill="none">
								<path d="M1 1l5 5-5 5" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
							</svg>
						</button>
					)}
				</div>
			</div>
		</div>
	);
}
