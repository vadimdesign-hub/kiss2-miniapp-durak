import { useBridgeFetch } from "@playneta/flutter-js-bridge";
import { useQuery } from "@tanstack/react-query";

import { GLOBAL_BACKEND_BASE_URL, SERVICE_NAME } from "~/config";

interface DisplayMiniappItem {
	readonly id: string;
	readonly slug: string;
	readonly displayName: string;
}

interface DisplayMiniappListResponse {
	readonly items?: readonly DisplayMiniappItem[];
}

/**
 * Looks up this miniapp's localized display name from the version service.
 * The endpoint resolves `displayName` against the user's `Accept-Language`
 * header — no client-side localization needed.
 *
 * Cached for the session: the slug never changes at runtime, and language
 * changes are rare enough that React Query's default refetch-on-focus is off
 * (see root.tsx).
 */
export function useMiniappDisplay() {
	const bridgeFetch = useBridgeFetch();

	const query = useQuery<string | null>({
		queryKey: ["miniappDisplay", SERVICE_NAME],
		queryFn: async () => {
			const params = new URLSearchParams();
			params.append("slug", SERVICE_NAME);
			params.set("limit", "1");
			const url = `${GLOBAL_BACKEND_BASE_URL}/version/api/v1/miniapp/display?${params.toString()}`;
			const res = await bridgeFetch(url);
			if (!res.ok) throw new Error("miniapp_display_failed");
			const data = (await res.json()) as DisplayMiniappListResponse;
			return data.items?.[0]?.displayName ?? null;
		},
		enabled: SERVICE_NAME !== "",
		staleTime: 60 * 60_000,
	});

	return {
		displayName: query.data ?? null,
		loading: query.isPending,
	};
}
