import { FlutterRoute, useOpenRoute } from "@playneta/flutter-js-bridge";
import { useUserProfile } from "~/hooks/use-user-profile";
import { a } from "~/utils/asset-url";

const COIN_ICON    = a("/durak/CoinIcon.png");
const BTN_GET_MORE = a("/btn-get-more.png");

/**
 * Coin balance pill — entire pill is tappable (opens CoinShop).
 * H Fixed 40px, background rgba(0,0,0,0.35) + backdrop-blur.
 */
export function CoinBalancePill({ style }: { style?: React.CSSProperties }) {
	const { balance } = useUserProfile();
	const openRoute   = useOpenRoute();

	const formatted = balance != null
		? balance.coin.toLocaleString("ru-RU").replace(/,/g, " ")
		: "—";

	return (
		<button
			type="button"
			onClick={() => openRoute(FlutterRoute.CoinShop, { params: {} })}
			aria-label="Купить монеты"
			style={{
				display: "inline-flex",
				alignItems: "center",
				height: 40,
				overflow: "visible",
				background: "rgba(0,0,0,0.35)",
				backdropFilter: "blur(12px)",
				WebkitBackdropFilter: "blur(12px)",
				borderRadius: 999,
				paddingRight: 8,
				border: "none",
				cursor: "pointer",
				...style,
			}}
		>
			{/* Coin icon */}
			<img
				src={COIN_ICON}
				alt=""
				width={40}
				height={40}
				style={{ flexShrink: 0, display: "block" }}
				aria-hidden
			/>

			{/* Balance number */}
			<span
				style={{
					paddingLeft: 8,
					paddingRight: 8,
					fontFamily: "var(--font-ubuntu)",
					fontSize: 17,
					fontWeight: 700,
					color: "#fff",
					letterSpacing: 0.2,
					whiteSpace: "nowrap",
					lineHeight: 1,
				}}
			>
				{formatted}
			</span>

			{/* ButtonGetMore icon — bigger */}
			<img
				src={BTN_GET_MORE}
				alt=""
				width={38}
				height={38}
				style={{ flexShrink: 0, display: "block" }}
				aria-hidden
			/>
		</button>
	);
}
