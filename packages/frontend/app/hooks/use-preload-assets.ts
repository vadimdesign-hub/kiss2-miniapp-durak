/**
 * Preload all game assets in the background once the app loads, so that
 * when the user enters a game room the cards / board / pieces are already
 * cached by the browser and don't pop in.
 *
 * Fires once per page-load on home; subsequent navigations to /game/* will
 * use the cache.
 */
import { useEffect } from "react";
import { a } from "~/utils/asset-url";

const SUITS = ["c", "d", "h", "s"] as const;
const RANKS = ["6", "7", "8", "9", "10", "j", "q", "k", "a"] as const;

const ASSETS: string[] = [
	// shared
	a("/diamond.png"),

	// durak
	a("/durak/banner.png"),
	a("/durak/bg.png"),
	a("/durak/card_back.png"),
	a("/durak/chair.png"),
	a("/durak/table_bg.png"),
	a("/durak/table-bg-overlay.png"),
	a("/durak/trump_circle.png"),
	a("/durak/suit_club.png"),
	a("/durak/suit_diamond.png"),
	a("/durak/suit_heart.png"),
	a("/durak/suit_spade.png"),
	...SUITS.flatMap((s) => RANKS.map((r) => a(`/durak/card_${s}${r}.png`))),

	// checkers
	a("/chess/banner.png"),
	a("/chess/bg.png"),
	a("/chess/board.png"),
	a("/chess/chair.png"),
	a("/chess/piece_mine_reg.png"),
	a("/chess/piece_mine_king.png"),
	a("/chess/piece_opp_reg.png"),
	a("/chess/piece_opp_king.png"),
];

export function usePreloadAssets(): void {
	useEffect(() => {
		// Use Image() preloading — browser caches the response so subsequent
		// <img src> hits will resolve instantly. Fire-and-forget; failures don't
		// matter (the asset will load normally if needed).
		const imgs: HTMLImageElement[] = [];
		for (const src of ASSETS) {
			const img = new Image();
			img.src = src;
			imgs.push(img);
		}
		// Hold references briefly so we don't get GC'd mid-fetch.
		const tid = setTimeout(() => {
			imgs.length = 0;
		}, 30_000);
		return () => clearTimeout(tid);
	}, []);
}
