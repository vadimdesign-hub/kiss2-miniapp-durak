import { useMemo } from "react";
import { useFlutterBridge } from "@playneta/flutter-js-bridge";
import { a } from "~/utils/asset-url";
import { type GameType, getTranslations } from "~/i18n/translations";

interface GameDef {
	readonly type: GameType;
	readonly bannerImage: string;
	readonly description: string;
	readonly friendCount: number;
}

const GAMES: GameDef[] = [
	{
		type: "durak",
		bannerImage: a("/durak/banner.png"),
		description: "Классическая игра в Дурака, 36 карт",
		friendCount: 5,
	},
];

interface GameCatalogProps {
	readonly onPlay: (gameType: GameType) => void;
	readonly onPlayBot: (gameType: GameType) => void;
}

export function GameCatalog({ onPlay, onPlayBot }: GameCatalogProps) {
	const { state } = useFlutterBridge();
	const lang = state.headers?.["Accept-Language"] ?? "en";
	const t = useMemo(() => getTranslations(lang), [lang]);

	return (
		<div style={{ padding: "20px 16px 40px", display: "flex", flexDirection: "column", gap: 20 }}>
			{GAMES.map((game) => (
				<GameCard key={game.type} game={game} t={t} onPlay={onPlay} onPlayBot={onPlayBot} />
			))}
		</div>
	);
}

// Placeholder friend avatars — use pravatar's `img` parameter to get distinct, varied photos.
// Different ranges per game so the two cards show different faces.
const DURAK_AVATAR_IDS    = [12, 31, 47, 58, 65];
const CHECKERS_AVATAR_IDS = [22, 39, 52, 60, 68];
function friendAvatar(game: string, i: number): string {
	const id = (game === "durak" ? DURAK_AVATAR_IDS : CHECKERS_AVATAR_IDS)[i];
	return `https://i.pravatar.cc/80?img=${id}`;
}

function GameCard({ game, t, onPlay, onPlayBot }: {
	game: GameDef;
	t: ReturnType<typeof getTranslations>;
	onPlay: (type: GameType) => void;
	onPlayBot: (type: GameType) => void;
}) {
	const title = t[game.type];
	void onPlayBot;

	return (
		<div style={{
			background: "#fff",
			borderRadius: 20,
			border: "none",
			overflow: "hidden",
			boxShadow: "none",
		}}>
			{/* Banner image — padded with rounded corners */}
			<div style={{ padding: "12px 12px 0" }}>
				<div style={{ borderRadius: 14, overflow: "hidden", lineHeight: 0, height: 210 }}>
					<img
						src={game.bannerImage}
						alt={game.type}
						style={{ width: "100%", height: "100%", objectFit: "cover", objectPosition: "center", display: "block" }}
					/>
				</div>
			</div>

			{/* Card body */}
			<div style={{ padding: "16px 16px 18px", display: "flex", alignItems: "flex-end", gap: 12 }}>
				<div style={{ flex: 1, minWidth: 0 }}>
					<div style={{ fontFamily: "var(--font-ubuntu)", fontSize: 28, fontWeight: 700, color: "#1F2547", lineHeight: 1.15, marginBottom: 4 }}>
						{title}
					</div>
					<div style={{ fontFamily: "var(--font-ubuntu)", fontSize: 16, fontWeight: 400, color: "#8E8E93", marginBottom: 12 }}>
						{game.description}
					</div>

					{/* Friend avatars — overlapping circles */}
					<div style={{ display: "flex", alignItems: "center" }}>
						{Array.from({ length: game.friendCount }).map((_, i) => (
							<img
								key={i}
								src={friendAvatar(game.type, i)}
								alt=""
								style={{
									width: 32, height: 32,
									borderRadius: 12,
									objectFit: "cover",
									border: "2px solid #fff",
									marginLeft: i === 0 ? 0 : -8,
									flexShrink: 0,
									background: "#E5E5EA",
								}}
							/>
						))}
					</div>
				</div>

				{/* Play button */}
				<button
					type="button"
					onClick={() => onPlay(game.type)}
					style={{
						width: 56, height: 56,
						borderRadius: "50%",
						background: "#FF006F",
						border: "none",
						cursor: "pointer",
						display: "flex", alignItems: "center", justifyContent: "center",
						flexShrink: 0,
						boxShadow: "none",
						transition: "transform 0.12s",
					}}
					onPointerDown={(e) => { e.currentTarget.style.transform = "scale(0.93)"; }}
					onPointerUp={(e) => { e.currentTarget.style.transform = ""; }}
					aria-label={`Играть в ${title}`}
				>
					<svg width="24" height="24" viewBox="0 0 24 24" fill="none">
						<path d="M8 4l8 8-8 8" stroke="#fff" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round"/>
					</svg>
				</button>
			</div>
		</div>
	);
}
