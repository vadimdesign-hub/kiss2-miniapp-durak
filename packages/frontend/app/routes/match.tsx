import { useBridgeFetch, useFlutterBridge, useSendToFlutter, useSignalReady } from "@playneta/flutter-js-bridge";
import { CoinBalancePill } from "~/components/coin-balance-pill";
import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router";
import { type GameType, getDurakRules, getTranslations } from "~/i18n/translations";
import { a } from "~/utils/asset-url";
import { useMatchmaking } from "~/hooks/use-matchmaking";
import { useUserProfile } from "~/hooks/use-user-profile";
import { mmClient } from "~/lib/mm-client";
import { API_BASE_URL, GLOBAL_BACKEND_BASE_URL } from "~/config";
import { resolveFileUrl } from "~/utils/file-url";

const GAME_ROUTES: Record<GameType, string> = { durak: "durak" };
const STAKES = [10, 30, 50, 100, 200, 500, 1000, 3000, 5000];
const COIN_ICON = a("/durak/CoinIcon.png");

const GAME_BG_IMAGE: Record<GameType, string> = { durak: a("/durak/bg.png") };
const GAME_BG_FALLBACK: Record<GameType, string> = {
	durak: "linear-gradient(160deg, #0F3320 0%, #1A4A2A 60%, #0F3320 100%)",
};
const CHAIR: Record<GameType, string> = { durak: a("/durak/chair.png") };


interface PlayerProfile { nickname: string; avatarUrl: string | null }

export default function Match() {
	const { gameType } = useParams<{ gameType: GameType }>();
	const navigate = useNavigate();
	const location = useLocation();
	const locationState = location.state as { autoPlay?: boolean; lastStake?: number } | null;
	const signalReady = useSignalReady();
	const { state: bridgeState } = useFlutterBridge();
	const bridgeFetch = useBridgeFetch();
	const sendToFlutter = useSendToFlutter();
	const lang = bridgeState.headers?.["Accept-Language"] ?? "en";
	const t = useMemo(() => getTranslations(lang), [lang]);
	const durakRules = useMemo(() => getDurakRules(lang), [lang]);

	const { state, match, elapsed, waiting, online, joinQueue, leaveQueue } = useMatchmaking(gameType!);
	const { balance, refetchBalance } = useUserProfile();

	const [inLobby, setInLobby] = useState(!locationState?.autoPlay);
	// Restore last stake when coming from "Играть ещё", otherwise start at minimum
	const [stake, setStake] = useState<number>(() => {
		const last = locationState?.lastStake;
		return last && STAKES.includes(last) ? last : STAKES[0];
	});
	const [lobbyPlayers, setLobbyPlayers] = useState<{ userId: string; stake: number; inQueue: boolean; inGame: boolean; opponentId?: string }[]>([]);
	const [profiles, setProfiles] = useState<Record<string, PlayerProfile>>({});
	const lobbyTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
	const fetchingRef = useRef<Set<string>>(new Set());
	const hadPlayersRef = useRef(false);

	const sessionStartRef = useRef(Date.now());

	const [showRules, setShowRules] = useState(false);
	const [rulesClosing, setRulesClosing] = useState(false);

	const handleCloseWebview = () => {
		const durationSeconds = Math.round((Date.now() - sessionStartRef.current) / 1000);
		bridgeFetch(`${API_BASE_URL}/api/v1/analyticsEvent`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ entity: "miniappSession", durationSeconds }),
		}).catch(() => {});
		sendToFlutter("close_webview", {});
	};

	const closeRules = () => {
		setRulesClosing(true);
		setTimeout(() => { setShowRules(false); setRulesClosing(false); }, 300);
	};

	useEffect(() => { signalReady(); }, [signalReady]);

	// Refresh balance on mount. Second refetch after 1.5 s covers any
	// wallet propagation delay so wins are always visible.
	useEffect(() => {
		void refetchBalance();
		const t = setTimeout(() => { void refetchBalance(); }, 1500);
		return () => clearTimeout(t);
	// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);

	// Auto-start search when coming from "Играть ещё" (autoPlay flag)
	const autoPlayDoneRef = useRef(false);
	useEffect(() => {
		if (!locationState?.autoPlay || autoPlayDoneRef.current) return;
		autoPlayDoneRef.current = true;
		joinQueue(stake);
	// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []); // run once on mount

	// Register lobby presence on mount and when stake changes
	useEffect(() => {
		if (!inLobby) return;
		void mmClient.setLobbyPresence(gameType ?? "durak", stake);
	}, [inLobby, gameType, stake]);

	// Poll lobby players while in lobby
	useEffect(() => {
		if (!inLobby) return;
		const doFetch = async () => {
			const players = await mmClient.fetchLobbyPlayers(gameType ?? "durak");
			setLobbyPlayers(players);
		};
		doFetch();
		lobbyTimerRef.current = setInterval(doFetch, 3000);
		return () => { if (lobbyTimerRef.current) clearInterval(lobbyTimerRef.current); };
	}, [inLobby, gameType]);

	// Fetch player profiles for IDs we don't have yet
	useEffect(() => {
		const allIds = [
			...lobbyPlayers.map((p) => p.userId),
			...lobbyPlayers.flatMap((p) => (p.opponentId ? [p.opponentId] : [])),
		];
		const missing = allIds.filter((id) => !profiles[id] && !fetchingRef.current.has(id));
		if (missing.length === 0) return;
		for (const userId of missing) {
			fetchingRef.current.add(userId);
			(async () => {
				try {
					const res = await bridgeFetch(`${GLOBAL_BACKEND_BASE_URL}/user/api/v1/user/${userId}`);
					if (!res.ok) return;
					const data = await res.json() as { id: string; nickname: string; currentAvatar?: { fileId: string } | null };
					let avatarUrl: string | null = null;
					if (data.currentAvatar?.fileId) {
						avatarUrl = await resolveFileUrl(data.currentAvatar.fileId, bridgeFetch);
					}
					setProfiles((prev) => ({ ...prev, [userId]: { nickname: data.nickname, avatarUrl } }));
				} catch {
					setProfiles((prev) => ({ ...prev, [userId]: { nickname: t.playerFallback, avatarUrl: null } }));
				} finally {
					fetchingRef.current.delete(userId);
				}
			})();
		}
	}, [lobbyPlayers, bridgeFetch, profiles]);

	// Navigate when match found
	useEffect(() => {
		if (state === "found" && match) {
			bridgeFetch(`${API_BASE_URL}/api/v1/analyticsEvent`, {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ entity: "opponentFound", gameType: gameType ?? "durak", stake }),
				}).catch(() => {});
			const myUserId = mmClient.getMyUserId();
			const myMark = myUserId === match.starterUserId ? "X" : "O";
			const opponentUserId = myUserId === match.playerOneId ? match.playerTwoId : match.playerOneId;
			navigate(`/game/${GAME_ROUTES[match.gameType]}/${match.sessionId}`, {
				state: { myMark, myUserId, starterUserId: match.starterUserId, opponentUserId, stake, waitSeconds: elapsed },
			});
		}
	}, [state, match, navigate, stake]);

	// Sort: queued first → lobby browsers second → in-game last
	const playerRows = [...lobbyPlayers].sort((a, b) => {
		const rank = (p: typeof a) => p.inQueue ? 0 : !p.inGame ? 1 : 2;
		return rank(a) - rank(b) || a.stake - b.stake;
	});
	const hasPlayers = playerRows.length > 0;
	// All visible players are in active games → suggest bot
	const allBusy = hasPlayers && lobbyPlayers.every((p) => p.inGame);

	// When someone comes online after no-one was there → snap stake to minimum,
	// BUT only if the user didn't come from a previous game with a saved stake.
	useEffect(() => {
		if (hasPlayers && !hadPlayersRef.current && !locationState?.lastStake) {
			setStake(STAKES[0]);
		}
		hadPlayersRef.current = hasPlayers;
	}, [hasPlayers]);

	// In no-players mode stake is always displayed as 0 and controls are locked
	const displayStake = hasPlayers ? stake : 0;
	const coinBalance = balance?.coin ?? 0;
	const stakeIdx = STAKES.indexOf(stake);
	// "+" is also disabled when the NEXT stake tier would exceed the player's balance
	const nextStake = stakeIdx < STAKES.length - 1 ? STAKES[stakeIdx + 1] : null;
	const canIncrease = hasPlayers && nextStake !== null && nextStake <= coinBalance;
	const canDecrease = hasPlayers && stakeIdx > 0;
	const handleStakeMinus = () => {
		if (!canDecrease) return;
		setStake(STAKES[stakeIdx - 1]);
	};
	const handleStakePlus = () => {
		if (!canIncrease) return;
		setStake(nextStake!);
	};

	const handlePlay = () => {
		if (lobbyTimerRef.current) { clearInterval(lobbyTimerRef.current); lobbyTimerRef.current = null; }
		setInLobby(false);
		joinQueue(stake);
	};

	const handlePlayBot = () => {
		navigate(`/game/${GAME_ROUTES[gameType ?? "durak"]}/bot-${Date.now()}`, {
			state: { vsBot: true, stake: 0 },
		});
	};

	const handleBack = () => {
		leaveQueue();
		setInLobby(true);
	};

	const bgImage    = gameType ? GAME_BG_IMAGE[gameType] : "";
	const bgFallback = gameType ? GAME_BG_FALLBACK[gameType] : "linear-gradient(160deg,#1A1A2E,#2D1B6E)";
	const chair      = gameType ? CHAIR[gameType] : "";

	return (
		<div
			style={{
				height: "100dvh",
				background: bgFallback,
				backgroundImage: bgImage ? `url(${bgImage})` : undefined,
				backgroundSize: "cover",
				backgroundPosition: "center",
				backgroundRepeat: "no-repeat",
				display: "flex",
				flexDirection: "column",
				overflow: "hidden",
				touchAction: "none",
				overscrollBehavior: "none",
			}}
		>

			{/* ══ LOBBY ══════════════════════════════════════════════════════ */}
			{inLobby && (
				<>
					{/* Top bar */}
					<div style={{
						flexShrink: 0, display: "flex", alignItems: "center",
						gap: 10, padding: "56px 16px 0 16px",
					}}>
						<button
							type="button"
							onClick={handleCloseWebview}
							style={{
								width: 44, height: 44, borderRadius: "50%",
								background: "rgba(0,0,0,0.55)", border: "none", cursor: "pointer",
								flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center",
							}}
						>
							<svg width="14" height="14" viewBox="0 0 14 14" fill="none">
								<path d="M1 1l12 12M13 1L1 13" stroke="#fff" strokeWidth="2.2" strokeLinecap="round"/>
							</svg>
						</button>

						<div style={{ display: "flex", alignItems: "center", gap: 8 }}>
							<span style={{
								fontFamily: "var(--font-ubuntu)", fontSize: 28, fontWeight: 700,
								color: "#fff", textShadow: "0 2px 8px rgba(0,0,0,0.5)",
							}}>
								{t.durak}
							</span>
							<button
								type="button"
								onClick={() => setShowRules(true)}
								style={{
									width: 28, height: 28, borderRadius: "50%",
									background: "rgba(255,255,255,0.15)",
									backdropFilter: "blur(8px)", WebkitBackdropFilter: "blur(8px)",
									border: "none", cursor: "pointer",
									flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center",
								}}
							>
								<img src={a("/info-icon.png")} alt="" width={18} height={18} style={{ display: "block" }} />
							</button>
						</div>
					</div>

					{/* Coin pill */}
					<div style={{ padding: "28px 16px 0", display: "flex" }}>
						<CoinBalancePill />
					</div>

					{/* Player list panel */}
					<div style={{
						flex: 1, margin: "24px 16px 0",
						background: "rgba(0,0,0,0.50)",
						backdropFilter: "blur(10px)", WebkitBackdropFilter: "blur(10px)",
						borderRadius: 20, display: "flex", flexDirection: "column",
						overflow: "hidden", minHeight: 0,
					}}>
						<div style={{
							flexShrink: 0, display: "flex", justifyContent: "space-between",
							padding: "14px 20px 10px",
						}}>
							<div style={{ display: "flex", alignItems: "center", gap: 8 }}>
								<span style={{ fontFamily: "var(--font-ubuntu)", fontSize: 16, fontWeight: 700, color: "#fff" }}>
									{t.players}
								</span>
								{lobbyPlayers.length > 0 && (
									<span style={{
										background: "rgba(255,255,255,0.15)",
										color: "rgba(255,255,255,0.75)",
										fontFamily: "var(--font-ubuntu)",
										fontSize: 13,
										fontWeight: 600,
										borderRadius: 999,
										padding: "2px 8px",
										lineHeight: 1.4,
									}}>
										{lobbyPlayers.length}
									</span>
								)}
							</div>
							<span style={{ fontFamily: "var(--font-ubuntu)", fontSize: 16, fontWeight: 700, color: "#fff" }}>
								{t.stakeLabel}
							</span>
						</div>

						<div style={{ height: 1, background: "rgba(255,255,255,0.1)", margin: "0 20px", flexShrink: 0 }} />

						{/* All-busy banner: shown when every visible player is in an active game */}
						{allBusy && (
							<div style={{
								flexShrink: 0,
								display: "flex", flexDirection: "column", alignItems: "center",
								gap: 16, padding: "22px 20px 20px",
								borderBottom: "1px solid rgba(255,255,255,0.07)",
							}}>
								<span style={{
									fontFamily: "var(--font-ubuntu)", fontSize: 13, fontWeight: 500,
									color: "rgba(255,255,255,0.55)", textAlign: "center", lineHeight: 1.55,
									display: "block",
								}}>
									{lang.startsWith("ru") ? (
										<>На данный момент все игроки заняты,<br />вы можете сыграть с ботом</>
									) : (
										<>All players are currently busy.<br />You can play against the bot</>
									)}
								</span>
								<button
									type="button"
									onClick={handlePlayBot}
									style={{
										padding: "9px 22px", borderRadius: 999,
										background: "linear-gradient(to bottom, #66BB6A, #388E3C)",
										border: "none", borderBottom: "2px solid #0A2A0E",
										fontFamily: "var(--font-ubuntu)", fontSize: 14, fontWeight: 700,
										color: "#fff", cursor: "pointer",
									}}
									onPointerDown={(e) => { e.currentTarget.style.transform = "translateY(1px)"; e.currentTarget.style.borderBottomWidth = "1px"; }}
									onPointerUp={(e) => { e.currentTarget.style.transform = ""; e.currentTarget.style.borderBottomWidth = "2px"; }}
								>
									{t.playWithBot}
								</button>
							</div>
						)}

						{/* Empty state OR player rows */}
						{!hasPlayers ? (
							<div style={{
								flex: 1, display: "flex", alignItems: "center", justifyContent: "center",
							}}>
								<span style={{
									fontFamily: "var(--font-ubuntu)", fontSize: 16, fontWeight: 500,
									color: "rgba(255,255,255,0.4)",
								}}>
									{t.noPlayersOnline}
								</span>
							</div>
						) : (
							<div style={{ flex: 1, overflowY: "auto" }}>
								{playerRows.map(({ userId, stake: s, inGame, inQueue, opponentId }, idx) => {
									const profile = profiles[userId];
									const isLobbyBrowser = !inQueue && !inGame;
									return (
										<Fragment key={`${userId}-${s}`}>
											<button
												type="button"
												onClick={() => { if (s <= coinBalance) setStake(s); }}
												style={{
													width: "100%", display: "flex", alignItems: "center", gap: 14,
													padding: "11px 20px", background: "transparent", border: "none",
													borderTop: idx > 0 ? "1px solid rgba(255,255,255,0.07)" : "none",
													cursor: "pointer", textAlign: "left",
												}}
											>
												{/* Avatar */}
												{profile?.avatarUrl ? (
													<img
														src={profile.avatarUrl}
														alt=""
														style={{ width: 52, height: 52, borderRadius: 12, objectFit: "cover", flexShrink: 0 }}
													/>
												) : (
													<div style={{
														width: 52, height: 52, borderRadius: 12,
														background: "rgba(255,255,255,0.10)", flexShrink: 0,
														display: "flex", alignItems: "center", justifyContent: "center",
														fontFamily: "var(--font-ubuntu)", fontSize: 20, fontWeight: 700,
														color: "rgba(255,255,255,0.35)",
													}}>
														{profile?.nickname?.[0]?.toUpperCase() ?? "?"}
													</div>
												)}

												<div style={{ flex: 1, display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
													<span style={{
														fontFamily: "var(--font-ubuntu)", fontSize: 16, fontWeight: 500,
														color: "rgba(255,255,255,0.85)", overflow: "hidden",
														textOverflow: "ellipsis", whiteSpace: "nowrap",
													}}>
														{profile?.nickname ?? t.playerFallback}
													</span>

													{/* Green: in queue — "В ожидании" */}
													{inQueue && (
														<span style={{
															flexShrink: 0,
															background: "#2E7D32",
															color: "#fff",
															fontFamily: "var(--font-ubuntu)",
															fontSize: 11,
															fontWeight: 700,
															borderRadius: 999,
															padding: "2px 9px",
															lineHeight: 1.4,
															whiteSpace: "nowrap",
														}}>
															{t.inQueue}
														</span>
													)}

													{/* Orange: browsing lobby — "Делает ставку" */}
													{isLobbyBrowser && (
														<span style={{
															flexShrink: 0,
															background: "#F59E0B",
															color: "#fff",
															fontFamily: "var(--font-ubuntu)",
															fontSize: 11,
															fontWeight: 700,
															borderRadius: 999,
															padding: "2px 9px",
															lineHeight: 1.4,
															whiteSpace: "nowrap",
														}}>
															{t.makingStake}
														</span>
													)}

													{/* Bright green: in active game — "Играет с X" */}
													{inGame && (
														<span style={{
															flexShrink: 0,
															background: "#00C853",
															color: "#fff",
															fontFamily: "var(--font-ubuntu)",
															fontSize: 11,
															fontWeight: 700,
															borderRadius: 999,
															padding: "2px 9px",
															lineHeight: 1.4,
															whiteSpace: "nowrap",
														}}>
															{opponentId && profiles[opponentId]?.nickname
																? (lang.startsWith("ru") ? `Играет с ${profiles[opponentId].nickname}` : `Playing vs ${profiles[opponentId].nickname}`)
																: t.inGame}
														</span>
													)}
												</div>

												<div style={{ display: "flex", alignItems: "center", gap: 5, flexShrink: 0 }}>
													<img src={COIN_ICON} alt="" width={22} height={22} />
													<span style={{
														fontFamily: "var(--font-ubuntu)", fontSize: 17, fontWeight: 700, color: "#fff",
													}}>
														{s.toLocaleString()}
													</span>
												</div>
											</button>
										</Fragment>
									);
								})}
							</div>
						)}
					</div>

					{/* Stake stepper + play button */}
					<div style={{
						flexShrink: 0,
						background: "rgba(0,0,0,0.40)",
						backdropFilter: "blur(10px)", WebkitBackdropFilter: "blur(10px)",
						borderRadius: 20, margin: "8px 16px 0",
						padding: "16px 16px",
						paddingBottom: "calc(20px + env(safe-area-inset-bottom, 0px))",
					}}>
						<p style={{
							textAlign: "center", fontFamily: "var(--font-ubuntu)", fontSize: 17, fontWeight: 700,
							color: "#fff", margin: "0 0 12px", textShadow: "0 1px 4px rgba(0,0,0,0.5)",
						}}>
							{t.yourStake}
						</p>

						<div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
							{/* Narrow − button */}
							<button
								type="button"
								onClick={handleStakeMinus}
								disabled={!canDecrease}
								style={{
									flexShrink: 0, width: 80, height: 58, borderRadius: 16,
									background: "rgba(0,0,0,0.45)", border: "none",
									cursor: canDecrease ? "pointer" : "default",
									fontFamily: "var(--font-ubuntu)", fontSize: 32, fontWeight: 700,
									color: canDecrease ? "#fff" : "rgba(255,255,255,0.2)",
								}}
							>−</button>

							{/* Wide center — coin + value, no background */}
							<div style={{
								flex: 1, display: "flex", alignItems: "center", justifyContent: "center",
								gap: 10, height: 58, whiteSpace: "nowrap",
							}}>
								<img src={COIN_ICON} alt="" width={32} height={32} />
								<span style={{
									fontFamily: "var(--font-ubuntu)", fontSize: 24, fontWeight: 700, color: "#fff",
								}}>
									{displayStake.toLocaleString()}
								</span>
							</div>

							{/* Narrow + button */}
							<button
								type="button"
								onClick={handleStakePlus}
								disabled={!canIncrease}
								style={{
									flexShrink: 0, width: 80, height: 58, borderRadius: 16,
									background: "rgba(0,0,0,0.45)", border: "none",
									cursor: canIncrease ? "pointer" : "default",
									fontFamily: "var(--font-ubuntu)", fontSize: 32, fontWeight: 700,
									color: canIncrease ? "#fff" : "rgba(255,255,255,0.2)",
								}}
							>+</button>
						</div>

						{/* Play / Play vs Bot button */}
						<button
							type="button"
							onClick={hasPlayers ? handlePlay : handlePlayBot}
							style={{
								width: "100%", padding: "16px 36px", borderRadius: 999,
								background: "linear-gradient(to bottom, #66BB6A, #388E3C)",
								border: "none", borderBottom: "3px solid #0A2A0E",
								fontFamily: "var(--font-ubuntu)", fontSize: 19, fontWeight: 700,
								color: "#fff", textShadow: "0 1px 2px rgba(0,0,0,0.35)",
								cursor: "pointer",
							}}
							onPointerDown={(e) => {
								e.currentTarget.style.transform = "translateY(2px)";
								e.currentTarget.style.borderBottomWidth = "1px";
							}}
							onPointerUp={(e) => {
								e.currentTarget.style.transform = "";
								e.currentTarget.style.borderBottomWidth = "3px";
							}}
						>
							{hasPlayers ? t.play : t.playWithBot}
						</button>
					</div>
				</>
			)}

			{/* ══ SEARCHING ══════════════════════════════════════════════════ */}
			{!inLobby && (
				<>
					<div style={{ flexShrink: 0, padding: "56px 16px 0", display: "flex", alignItems: "center", gap: 12 }}>
						<button
							type="button"
							onClick={handleBack}
							style={{
								width: 44, height: 44, borderRadius: "50%",
								background: "rgba(0,0,0,0.55)", border: "none", cursor: "pointer",
								display: "flex", alignItems: "center", justifyContent: "center",
								flexShrink: 0,
							}}
						>
							<svg width="18" height="18" viewBox="0 0 18 18" fill="none">
								<path d="M11 3L5 9l6 6" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"/>
							</svg>
						</button>
					</div>

					<div style={{
						flex: 1, display: "flex", flexDirection: "column",
						alignItems: "center", justifyContent: "center",
						gap: 16, padding: "0 20px 40px",
					}}>
						<div style={{ position: "relative", width: 180, height: 180, display: "flex", alignItems: "center", justifyContent: "center" }}>
							<img src={chair} alt="" style={{ width: "100%", height: "100%", objectFit: "contain", opacity: 0.9 }} />
							<div style={{
								position: "absolute", top: "30%",
								width: 72, height: 72, borderRadius: 14,
								background: "rgba(0,0,0,0.60)",
								backdropFilter: "blur(14px)", WebkitBackdropFilter: "blur(14px)",
								border: "2px dashed rgba(255,255,255,0.45)",
								display: "flex", alignItems: "center", justifyContent: "center",
								fontFamily: "var(--font-ubuntu)", fontSize: 36, fontWeight: 700,
								color: "rgba(255,255,255,0.6)",
							}}>?</div>
						</div>

						{state === "error" ? (
							<div style={{ textAlign: "center" }}>
								<div style={{ fontSize: 36, marginBottom: 8 }}>⚠️</div>
								<div style={{ fontFamily: "var(--font-ubuntu)", fontSize: 18, fontWeight: 700, color: "#fff" }}>
									{t.connectionError}
								</div>
							</div>
						) : (
							<div style={{ textAlign: "center" }}>
								<div style={{
									fontFamily: "var(--font-ubuntu)", fontSize: 26, fontWeight: 700,
									color: "#fff", textShadow: "0 2px 12px rgba(0,0,0,0.6)", marginBottom: 6,
								}}>
									{t.waitingForOpponent}
								</div>
								<div style={{
									fontFamily: "var(--font-ubuntu)", fontSize: 17, fontWeight: 400,
									color: "rgba(255,255,255,0.65)",
								}}>
									{t.searchStatus(elapsed, waiting, online)}
								</div>
							</div>
						)}

						<div style={{ display: "flex", gap: 8 }}>
							{[0, 1, 2].map((i) => (
								<div key={i} style={{
									width: 7, height: 7, borderRadius: "50%",
									background: "rgba(255,255,255,0.6)",
									animation: `bounce 1.4s ${i * 0.16}s infinite ease-in-out`,
								}} />
							))}
						</div>
					</div>
				</>
			)}

			{/* Keyframes */}
			<style>{`
				@keyframes bounce{0%,80%,100%{transform:scale(0);opacity:.4}40%{transform:scale(1);opacity:1}}
				@keyframes overlayIn{from{opacity:0}to{opacity:1}}
				@keyframes overlayOut{from{opacity:1}to{opacity:0}}
				@keyframes sheetUp{from{transform:translateY(100%)}to{transform:translateY(0)}}
				@keyframes sheetDown{from{transform:translateY(0)}to{transform:translateY(100%)}}
			`}</style>

			{/* Rules bottom sheet — animated */}
			{showRules && (
				<div
					onClick={closeRules}
					style={{
						position: "fixed", inset: 0, zIndex: 50,
						display: "flex", flexDirection: "column", justifyContent: "flex-end",
						background: "rgba(0,0,0,0.5)",
						backdropFilter: "blur(14px)", WebkitBackdropFilter: "blur(14px)",
						touchAction: "none",
						animation: rulesClosing
							? "overlayOut 0.28s ease forwards"
							: "overlayIn 0.25s ease forwards",
					}}
				>
					<div
						onClick={(e) => e.stopPropagation()}
						style={{
							background: "#fff",
							borderRadius: "28px 28px 0 0",
							padding: "28px 20px calc(32px + env(safe-area-inset-bottom, 16px))",
							animation: rulesClosing
								? "sheetDown 0.3s cubic-bezier(0.55,0.06,0.68,0.19) forwards"
								: "sheetUp 0.32s cubic-bezier(0.25,0.46,0.45,0.94) forwards",
						}}
					>
						<p style={{
							fontFamily: "var(--font-ubuntu)", fontSize: 24, fontWeight: 700,
							color: "#323C5E", textAlign: "center", margin: "0 0 16px",
						}}>
							{t.durak} — {t.rules}
						</p>
						<ul style={{ display: "flex", flexDirection: "column", gap: 8, listStyle: "none", padding: 0, margin: "0 0 20px" }}>
							{durakRules.map((rule, i) => (
								<li key={i} style={{
									display: "flex", alignItems: "flex-start", gap: 12,
									padding: "12px 14px", borderRadius: 14,
									background: rule.isCommission ? "#FFF4E5" : "#F7F7F7",
									border: rule.isCommission ? "1px solid #FFD89B" : "none",
								}}>
									{rule.isCommission ? (
										<span style={{
											flexShrink: 0, width: 24, height: 24, borderRadius: "50%",
											background: "#E87B0A", display: "flex", alignItems: "center",
											justifyContent: "center", fontSize: 12, fontWeight: 700,
											color: "#fff", marginTop: 2,
										}}>%</span>
									) : (
										<span style={{
											flexShrink: 0, width: 24, height: 24, borderRadius: "50%",
											background: "#E8E8E8", display: "flex", alignItems: "center",
											justifyContent: "center", fontFamily: "var(--font-ubuntu)",
											fontSize: 13, fontWeight: 700, color: "#64728F", marginTop: 2,
										}}>{i + 1}</span>
									)}
									<span style={{
										fontFamily: "var(--font-ubuntu)", fontSize: 15, lineHeight: 1.5,
										color: rule.isCommission ? "#9B6A00" : "#64728F",
										fontWeight: rule.isCommission ? 500 : 400,
									}}>
										{rule.text}
									</span>
								</li>
							))}
						</ul>
						<div style={{ display: "flex", justifyContent: "center" }}>
							<button
								type="button"
								onClick={closeRules}
								style={{
									padding: "15px 52px", borderRadius: 999, background: "#F0196E",
									fontFamily: "var(--font-ubuntu)", fontSize: 18, fontWeight: 700,
									color: "#fff", border: "none", cursor: "pointer",
								}}
							>
								{t.rulesOk}
							</button>
						</div>
					</div>
				</div>
			)}
		</div>
	);
}
