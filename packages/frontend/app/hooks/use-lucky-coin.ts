import { useBridgeFetch } from "@playneta/flutter-js-bridge";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useState } from "react";

import { API_BASE_URL } from "~/config";

interface LuckyCoinState {
	readonly attemptsLeft: number | null;
	readonly loading: boolean;
	readonly claiming: boolean;
	readonly lastWin: number | null;
	readonly error: string | null;
	readonly claim: () => Promise<void>;
}

interface ClaimResponse {
	readonly amount: number;
	readonly attemptsLeft: number;
}

interface StatusResponse {
	readonly attemptsLeft: number;
}

const LUCKY_COIN_STATUS_QUERY_KEY = ["luckyCoinStatus"] as const;

export function useLuckyCoin(): LuckyCoinState {
	const bridgeFetch = useBridgeFetch();
	const queryClient = useQueryClient();
	const [lastWin, setLastWin] = useState<number | null>(null);

	const statusQuery = useQuery<StatusResponse, Error>({
		queryKey: LUCKY_COIN_STATUS_QUERY_KEY,
		queryFn: async () => {
			const res = await bridgeFetch(`${API_BASE_URL}/api/v1/luckyCoin/status`);
			if (!res.ok) throw new Error("status_failed");
			return (await res.json()) as StatusResponse;
		},
	});

	const claimMutation = useMutation<ClaimResponse | { readonly attemptsLeft: 0 }, Error, void>({
		mutationFn: async () => {
			const res = await bridgeFetch(`${API_BASE_URL}/api/v1/luckyCoin/claim`, {
				method: "POST",
			});
			if (res.ok) {
				return (await res.json()) as ClaimResponse;
			}
			if (res.status === 429) {
				return { attemptsLeft: 0 };
			}
			throw new Error("claim_failed");
		},
		onSuccess: (data) => {
			if ("amount" in data) {
				setLastWin(data.amount);
			}
			// Source of truth for attemptsLeft is the status endpoint; the claim
			// response carries a fresh value, so seed the cache instead of refetching.
			queryClient.setQueryData<StatusResponse>(LUCKY_COIN_STATUS_QUERY_KEY, {
				attemptsLeft: data.attemptsLeft,
			});
		},
	});

	const claim = useCallback(async () => {
		setLastWin(null);
		try {
			await claimMutation.mutateAsync();
		} catch {
			// Error surface is exposed via claimMutation.error below.
		}
	}, [claimMutation]);

	const error =
		statusQuery.error || claimMutation.error
			? statusQuery.error
				? "Failed to load status"
				: "Failed to claim"
			: null;

	return {
		attemptsLeft: statusQuery.data?.attemptsLeft ?? null,
		loading: statusQuery.isLoading,
		claiming: claimMutation.isPending,
		lastWin,
		error,
		claim,
	};
}
