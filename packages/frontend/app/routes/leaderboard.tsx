import { useBridgeFetch, useFlutterBridge, useSignalReady } from "@playneta/flutter-js-bridge";
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { API_BASE_URL, GLOBAL_BACKEND_BASE_URL } from "~/config";
import { a } from "~/utils/asset-url";
import { getTranslations } from "~/i18n/translations";
import { useUserProfile } from "~/hooks/use-user-profile";
import { CrystalIcon } from "~/components/crystal-icon";

// ── Types ─────────────────────────────────────────────────────────────────────
type GameFilter = "all" | "checkers" | "durak";

interface LeaderboardEntry { rank: number; userId: string; totalCoins: number; wins: number; }
interface LeaderboardResponse { entries: LeaderboardEntry[]; myEntry: LeaderboardEntry | null; }

interface FileURL { resource: "assets" | "public" | "private"; path: string; }
interface VipTierConfig { level: number; smallIconFileURL?: FileURL; }
interface VipUserLevel { userId: string; activeLevel: number; }

// ── File URL builder ──────────────────────────────────────────────────────────
const isProd = GLOBAL_BACKEND_BASE_URL.includes("-prod") || GLOBAL_BACKEND_BASE_URL.includes(".prod");
const CDN: Record<string, { stage: string; prod: string }> = {
	assets:  { stage: "https://assets-stage.kisskissplay.com",  prod: "https://assets-prod.kisskissplay.com" },
	public:  { stage: "https://public-stage.kisskissplay.com",  prod: "https://public-prod.kisskissplay.com" },
	private: { stage: "https://private-stage.kisskissplay.com", prod: "https://private-prod.kisskissplay.com" },
};
function buildFileUrl(f: FileURL): string {
	const base = isProd ? CDN[f.resource].prod : CDN[f.resource].stage;
	return `${base}/${f.path.replace(/^\/+/, "")}`;
}

// ── VIP styling by tier ───────────────────────────────────────────────────────
// Each level gets a pill background + a matching name-decorator emoji pair.
const VIP_STYLE: Record<number, { bg: string; text: string; deco?: string }> = {
	1:  { bg: "linear-gradient(90deg,#FF8A65,#FF5722)", text: "#fff" },
	2:  { bg: "linear-gradient(90deg,#FFA726,#F57C00)", text: "#fff" },
	3:  { bg: "linear-gradient(90deg,#FFCA28,#FB8C00)", text: "#fff", deco: "♦" },
	4:  { bg: "linear-gradient(90deg,#CE93D8,#7B1FA2)", text: "#fff", deco: "♦" },
	5:  { bg: "linear-gradient(90deg,#9C27B0,#4A148C)", text: "#fff", deco: "♦" },
	6:  { bg: "linear-gradient(90deg,#E91E63,#AD1457)", text: "#fff", deco: "✦" },
	7:  { bg: "linear-gradient(90deg,#8BC34A,#33691E)", text: "#fff", deco: "🦇" },
	8:  { bg: "linear-gradient(90deg,#FFB74D,#E65100)", text: "#fff", deco: "✦" },
	9:  { bg: "linear-gradient(90deg,#EC407A,#880E4F)", text: "#fff", deco: "💧" },
	10: { bg: "linear-gradient(90deg,#42A5F5,#7B1FA2)", text: "#fff", deco: "💎" },
};

// ── Helpers ───────────────────────────────────────────────────────────────────
const TABS: { id: GameFilter; label: string }[] = [
	{ id: "all",      label: "Все игры" },
	{ id: "checkers", label: "Шашки" },
	{ id: "durak",    label: "Дурак" },
];

function formatScore(n: number): string {
	if (n >= 1_000_000) return `${+(n / 1_000_000).toFixed(1)}M`;
	if (n >= 1_000)     return `${+(n / 1_000).toFixed(1)}K`;
	return String(n);
}

function strHash(s: string): number {
	let h = 0;
	for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
	return Math.abs(h);
}

const MEDAL_POOL = ["🏅","🎖️","⭐","🔥","💎","🌟","🎗️","🏆"];
function fakeMedals(userId: string, wins: number): string[] {
	const count = Math.min(4, Math.max(0, Math.floor(wins / 3)));
	return Array.from({ length: count }, (_, i) => MEDAL_POOL[(strHash(userId) + i * 7) % MEDAL_POOL.length]);
}

function initials(name: string) { return name.slice(0, 2).toUpperCase(); }
function avatarColor(userId: string) { return `hsl(${strHash(userId) % 360},55%,55%)`; }
function avatarBgHex(userId: string): string {
	const h = strHash(userId) % 360;
	const s = 0.55, l = 0.55;
	const a = s * Math.min(l, 1 - l);
	const f = (n: number) => {
		const k = (n + h / 30) % 12;
		const c = l - a * Math.max(-1, Math.min(k - 3, Math.min(9 - k, 1)));
		return Math.round(255 * c).toString(16).padStart(2, "0");
	};
	return `${f(0)}${f(8)}${f(4)}`;
}


// ── Component ─────────────────────────────────────────────────────────────────
export default function Leaderboard() {
	const navigate = useNavigate();
	const signalReady = useSignalReady();
	const { state } = useFlutterBridge();
	const lang = state.headers?.["Accept-Language"] ?? "en";
	const t = useMemo(() => getTranslations(lang), [lang]);
	const bridgeFetch = useBridgeFetch();
	const { user } = useUserProfile();

	const [activeTab, setActiveTab] = useState<GameFilter>("all");
	const [data, setData]           = useState<LeaderboardResponse | null>(null);
	const [loading, setLoading]     = useState(true);
	const [error, setError]         = useState(false);
	const [seeding, setSeeding]     = useState(false);

	const [vipTiers, setVipTiers]           = useState<Map<number, string>>(new Map());
	const [userVipLevels, setUserVipLevels] = useState<Map<string, number>>(new Map());

	// Swipe-to-switch-tabs
	const swipeRef = useRef<HTMLDivElement | null>(null);
	const swipeStartXRef = useRef<number | null>(null);
	const swipeStartYRef = useRef<number | null>(null);
	const handleSwipeStart = (e: React.TouchEvent) => {
		swipeStartXRef.current = e.touches[0].clientX;
		swipeStartYRef.current = e.touches[0].clientY;
	};
	const handleSwipeEnd = (e: React.TouchEvent) => {
		if (swipeStartXRef.current === null) return;
		const dx = e.changedTouches[0].clientX - swipeStartXRef.current;
		const dy = e.changedTouches[0].clientY - (swipeStartYRef.current ?? 0);
		swipeStartXRef.current = null;
		swipeStartYRef.current = null;
		// Only treat as swipe if horizontal motion dominates and is large enough
		if (Math.abs(dx) < 60 || Math.abs(dy) > Math.abs(dx)) return;
		const idx = TABS.findIndex((t) => t.id === activeTab);
		const nextIdx = dx < 0 ? idx + 1 : idx - 1;
		if (nextIdx >= 0 && nextIdx < TABS.length) handleTabChange(TABS[nextIdx].id);
	};

	useEffect(() => {
		bridgeFetch(`${GLOBAL_BACKEND_BASE_URL}/vip/api/v1/config`)
			.then((r) => r.json() as Promise<VipTierConfig[]>)
			.then((tiers) => {
				const m = new Map<number, string>();
				for (const tier of tiers) if (tier.smallIconFileURL) m.set(tier.level, buildFileUrl(tier.smallIconFileURL));
				setVipTiers(m);
			})
			.catch(() => {});
	// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);

	const loadEntries = (tab: GameFilter) => {
		// Keep current data visible during refetch — only show spinner if we have nothing yet.
		setError(false);
		if (!data) setLoading(true);
		const url = tab === "all"
			? `${API_BASE_URL}/api/v1/leaderboard`
			: `${API_BASE_URL}/api/v1/leaderboard?gameType=${tab}`;
		bridgeFetch(url)
			.then((r) => r.json() as Promise<LeaderboardResponse>)
			.then((d) => {
				setData(d); setLoading(false);
				const ids = d.entries.map((e) => e.userId);
				if (d.myEntry) ids.push(d.myEntry.userId);
				if (ids.length) {
					const qs = ids.map((id) => `userId=${encodeURIComponent(id)}`).join("&");
					bridgeFetch(`${GLOBAL_BACKEND_BASE_URL}/vip/api/v1/userLevel?${qs}`)
						.then((r) => r.json() as Promise<VipUserLevel[]>)
						.then((levels) => {
							const m = new Map<string, number>();
							for (const l of levels) m.set(l.userId, l.activeLevel);
							setUserVipLevels(m);
						}).catch(() => {});
				}
			})
			.catch(() => { setError(true); setLoading(false); });
	};

	// eslint-disable-next-line react-hooks/exhaustive-deps
	useEffect(() => { loadEntries("all"); }, []);
	useEffect(() => { if (!loading) signalReady(); }, [loading, signalReady]);

	const handleTabChange = (tab: GameFilter) => { setActiveTab(tab); loadEntries(tab); };
	const handleSeed = async () => {
		setSeeding(true);
		await bridgeFetch(`${API_BASE_URL}/api/v1/dev/seed`, { method: "POST" }).catch(() => {});
		setSeeding(false); loadEntries(activeTab);
	};

	const entries = data?.entries ?? [];
	const myEntry = data?.myEntry ?? null;
	const myInTop = myEntry ? entries.some((e) => e.userId === myEntry.userId) : false;
	const isMe    = (e: LeaderboardEntry) => e.userId === myEntry?.userId;
	const myName  = user?.nickname ?? "Вы";

	// ── Row ────────────────────────────────────────────────────────────────────
	const Row = ({ player, mine, hideSeparator = false }: { player: LeaderboardEntry; mine: boolean; hideSeparator?: boolean }) => {
		const name    = mine ? myName : `Player_${player.userId.slice(0, 8)}`;
		const medals  = fakeMedals(player.userId, player.wins);
		const lvl     = userVipLevels.get(player.userId) ?? 0;
		const vipIcon = vipTiers.get(lvl);
		const vipStyle = VIP_STYLE[lvl];

		return (
			<div style={{
				position: "relative",
				display: "flex", alignItems: "center", gap: 14,
				// Same content x-position for ALL rows:
				//   non-me: margin 0  + padding-x 24 → content at x=24
				//   me:     margin 8  + padding-x 16 → content at x=24
				padding: mine ? "14px 16px" : "14px 24px",
				margin: mine ? "4px 8px" : "0",
				borderRadius: mine ? 22 : 0,
				background: mine ? "linear-gradient(90deg,#8B3FD4,#6D28D9)" : "transparent",
				boxShadow: mine ? "0 4px 16px rgba(109,40,217,0.3)" : "none",
			}}>
				{/* Thin light-grey separator inset from both edges (only on non-mine
			    rows, and only when not hidden by the wrapper — e.g. the last
			    row, or the row immediately above the 'me' purple pill). */}
				{!mine && !hideSeparator && (
					<div
						aria-hidden
						style={{
							position: "absolute",
							left: 24,
							right: 24,
							bottom: 0,
							height: 1,
							background: "#F0F0F4",
							pointerEvents: "none",
						}}
					/>
				)}
				{/*
				 Rank badge — Place.png image has the medal circle in the UPPER part
				 and a ribbon hanging below. We size the wrapper to match the avatar
				 (58px) and position the medal so its CIRCLE (not the full image) sits
				 at the row's vertical center — this keeps the gold circle aligned
				 across every row even though different rows vary in content height.
				*/}
				<div style={{ position: "relative", width: 50, height: 58, flexShrink: 0 }}>
					{/* Medal image: top offset pushes ribbon below the row's center */}
					<img src={a("/place.png")} alt="" style={{ position: "absolute", top: 8, left: 3, width: 44, height: 44, objectFit: "contain" }} />
					{/* Number — centered on the medal CIRCLE, which sits at top 8 + circle-center-in-image ~14 = 22 from wrapper top */}
					<span style={{
						position: "absolute",
						top: 18, left: 0, right: 0,
						height: 22,
						display: "flex", alignItems: "center", justifyContent: "center",
						fontFamily: "var(--font-ubuntu)", fontSize: 11, fontWeight: 700,
						color: "#fff",
						textShadow: "0 1px 2px rgba(0,0,0,0.45)",
						pointerEvents: "none",
					}}>
						{player.rank}
					</span>
				</div>

				{/* Avatar — use user's real avatar for "me", generated avatar for others */}
				<div style={{ position: "relative", flexShrink: 0 }}>
					{mine && user?.currentAvatar?.url ? (
						<img
							src={user.currentAvatar.url}
							alt={name}
							style={{ width: 66, height: 66, borderRadius: 16, objectFit: "cover", display: "block" }}
						/>
					) : strHash(player.userId) % 3 !== 2 ? (
						<img
							src={`https://i.pravatar.cc/100?img=${(strHash(player.userId) % 70) + 1}`}
							alt={name}
							style={{ width: 66, height: 66, borderRadius: 16, objectFit: "cover", display: "block" }}
						/>
					) : (
						<div style={{
							width: 66, height: 66, borderRadius: 16,
							background: avatarColor(player.userId),
							display: "flex", alignItems: "center", justifyContent: "center",
							fontFamily: "var(--font-ubuntu)", fontSize: 22, fontWeight: 700,
							color: "#fff",
						}}>
							{initials(name)}
						</div>
					)}
					{strHash(player.userId + "o") % 3 === 0 && (
						<div style={{ position: "absolute", bottom: 2, right: 2, width: 12, height: 12, borderRadius: "50%", background: "#4CAF50", border: "2.5px solid #fff" }} />
					)}
				</div>

				{/* Name + badges */}
				<div style={{ flex: 1, minWidth: 0 }}>
					<div style={{
						fontFamily: "var(--font-ubuntu)", fontSize: 18, fontWeight: 700,
						color: mine ? "#fff" : "#1C1C1E",
						overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
						marginBottom: 6,
						display: "flex", alignItems: "center", gap: 6,
					}}>
						{vipStyle?.deco && <span style={{ flexShrink: 0 }}>{vipStyle.deco}</span>}
						<span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{name}</span>
						{vipStyle?.deco && <span style={{ flexShrink: 0 }}>{vipStyle.deco}</span>}
					</div>

					{/* VIP pill + medals */}
					<div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "nowrap", overflow: "hidden" }}>
						{lvl > 0 && vipStyle && (
							<div style={{
								display: "inline-flex", alignItems: "center", gap: 4,
								background: vipStyle.bg, color: vipStyle.text,
								padding: "3px 10px 3px 4px", borderRadius: 999,
								flexShrink: 0, boxShadow: "0 2px 4px rgba(0,0,0,0.12)",
							}}>
								{vipIcon
									? <img src={vipIcon} alt="" style={{ width: 20, height: 20, objectFit: "contain" }} />
									: <span style={{ width: 20, height: 20, display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 14 }}>⭐</span>}
								<span style={{ fontFamily: "var(--font-ubuntu)", fontSize: 11, fontWeight: 700 }}>
									VIP {lvl}
								</span>
							</div>
						)}
						{medals.map((m, i) => (
							<span key={i} style={{ fontSize: 18, lineHeight: 1, flexShrink: 0 }}>{m}</span>
						))}
					</div>
				</div>

				{/* Score + crystal */}
				<div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4, flexShrink: 0 }}>
					<span style={{
						fontFamily: "var(--font-ubuntu)", fontSize: 18, fontWeight: 700,
						color: mine ? "#fff" : "#1C1C1E",
					}}>
						{formatScore(player.totalCoins)}
					</span>
					<CrystalIcon size={22} />
				</div>
			</div>
		);
	};

	return (
		<div style={{ height: "100dvh", display: "flex", flexDirection: "column", background: "#fff", overflow: "hidden" }}>

			{/* ── Header with throne-hall background image ── */}
			<div style={{
				position: "relative",
				paddingBottom: 64,
				background: "#13082D",
				backgroundImage: `url(${a("/leaderboard-bg.png")})`,
				backgroundSize: "cover",
				backgroundPosition: "top center",
				backgroundRepeat: "no-repeat",
				overflow: "hidden",
			}}>
				{/* Top bar */}
				<div style={{ display: "flex", alignItems: "center", gap: 16, padding: "52px 16px 28px" }}>
					<button
						type="button"
						onClick={() => navigate("/")}
						style={{ width: 52, height: 52, borderRadius: "50%", background: "rgba(0,0,0,0.45)", border: "none", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, backdropFilter: "blur(4px)", WebkitBackdropFilter: "blur(4px)" }}
					>
						<svg width="10" height="17" viewBox="0 0 9 15" fill="none">
							<path d="M7.5 1L1.5 7.5l6 6.5" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"/>
						</svg>
					</button>
					<span style={{ fontFamily: "var(--font-ubuntu)", fontSize: 26, fontWeight: 700, color: "#fff" }}>
						{t.leaderboard}
					</span>
				</div>

				{/* Tabs — single underline slides between tabs via transform */}
				<div style={{ position: "relative", padding: "16px 16px 0" }}>
					<div style={{ display: "flex", position: "relative" }}>
						{TABS.map((tab) => {
							const active = activeTab === tab.id;
							return (
								<button
									key={tab.id}
									type="button"
									onClick={() => handleTabChange(tab.id)}
									style={{
										flex: 1,
										padding: "6px 0 8px",
										background: "none", border: "none", cursor: "pointer",
										fontFamily: "var(--font-ubuntu)",
										fontSize: 20,
										fontWeight: active ? 700 : 500,
										color: active ? "#fff" : "rgba(255,255,255,0.5)",
										transition: "color 0.25s, font-weight 0.25s",
										textAlign: "center",
									}}
								>
									{tab.label}
								</button>
							);
						})}
						{/* Sliding underline — outer wrapper slides per tab, inner pill is the visible line */}
						<div
							style={{
								position: "absolute",
								bottom: 0,
								left: 0,
								width: `${100 / TABS.length}%`,
								transform: `translateX(${TABS.findIndex((t) => t.id === activeTab) * 100}%)`,
								transition: "transform 0.32s cubic-bezier(0.34, 1.4, 0.5, 1)",
								pointerEvents: "none",
								display: "flex",
								justifyContent: "center",
							}}
						>
							<div style={{ width: 56, height: 2, background: "#fff", borderRadius: 2 }} />
						</div>
					</div>
			</div>
			</div>

			{/* ── White card ── */}
			<div
				ref={swipeRef}
				onTouchStart={handleSwipeStart}
				onTouchEnd={handleSwipeEnd}
				style={{
					flex: 1,
					background: "#fff",
					borderRadius: "28px 28px 0 0",
					marginTop: -30,
					position: "relative",
					overflowY: "auto",
					paddingTop: 14,
					paddingBottom: 100,
					overscrollBehavior: "contain",
					WebkitOverflowScrolling: "touch",
				}}>
				{loading ? (
					<div style={{ display: "flex", alignItems: "center", justifyContent: "center", padding: 60 }}>
						<div style={{ width: 36, height: 36, borderRadius: "50%", border: "4px solid #F0F0F0", borderTopColor: "#7B2FBE", animation: "spin 0.8s linear infinite" }} />
					</div>
				) : error ? (
					<div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 12, padding: "40px 24px", textAlign: "center" }}>
						<span style={{ fontSize: 40 }}>⚠️</span>
						<span style={{ fontFamily: "var(--font-ubuntu)", fontSize: 15, color: "#8E8E93" }}>Ошибка загрузки</span>
						<button type="button" onClick={() => loadEntries(activeTab)}
							style={{ padding: "10px 28px", borderRadius: 999, background: "#7B2FBE", border: "none", cursor: "pointer", fontFamily: "var(--font-ubuntu)", fontWeight: 700, color: "#fff", fontSize: 14 }}>
							Повторить
						</button>
					</div>
				) : entries.length === 0 ? (
					<div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 12, padding: "48px 24px", textAlign: "center" }}>
						<span style={{ fontSize: 52 }}>🏆</span>
						<span style={{ fontFamily: "var(--font-ubuntu)", fontSize: 18, fontWeight: 700, color: "#1C1C1E" }}>Нет игр</span>
						<span style={{ fontFamily: "var(--font-ubuntu)", fontSize: 14, color: "#8E8E93" }}>Станьте первым победителем!</span>
						<button type="button" onClick={() => navigate("/")}
							style={{ marginTop: 8, padding: "13px 40px", borderRadius: 999, background: "#F0196E", border: "none", cursor: "pointer", fontFamily: "var(--font-ubuntu)", fontWeight: 700, color: "#fff", fontSize: 15 }}>
							Играть
						</button>
						<button type="button" onClick={handleSeed} disabled={seeding}
							style={{ padding: "10px 24px", borderRadius: 999, background: "#F5F5F5", border: "none", cursor: "pointer", fontFamily: "var(--font-ubuntu)", color: "#8E8E93", fontSize: 13 }}>
							{seeding ? "Добавляем…" : "🌱 Тест-игроки"}
						</button>
					</div>
				) : (
					<>
						{entries.map((player, i) => {
							const next = entries[i + 1];
							const mine = isMe(player);
							// Hide separator if:
							//  - this is the last row
							//  - the next row is "me" (we don't want a line right above the purple pill)
							const hideSep = i === entries.length - 1 || (next && isMe(next));
							return (
								<Row
									key={player.userId}
									player={player}
									mine={mine}
									hideSeparator={hideSep}
								/>
							);
						})}

						{myEntry && !myInTop && (
							<>
								<div style={{ display: "flex", justifyContent: "center", gap: 5, padding: "10px 0" }}>
									{[0,1,2].map((i) => <div key={i} style={{ width: 5, height: 5, borderRadius: "50%", background: "#D0D0D0" }} />)}
								</div>
								<Row player={myEntry} mine={true} />
							</>
						)}
					</>
				)}
			</div>
		</div>
	);
}
