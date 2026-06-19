import { useBridgeFetch } from "@playneta/flutter-js-bridge";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";

import { GLOBAL_BACKEND_BASE_URL } from "~/config";
import { resolveFileUrl } from "~/utils/file-url";

export interface UserProfile {
	readonly id: string;
	readonly nickname: string;
	readonly currentAvatar: { readonly url: string } | null;
}

export interface UserBalance {
	readonly coin: number;
}

interface UserProfileState {
	readonly user: UserProfile | null;
	readonly balance: UserBalance | null;
	readonly loading: boolean;
	readonly error: string | null;
	readonly refetchBalance: () => Promise<void>;
}

interface MyUserResponseDTO {
	readonly id: string;
	readonly nickname: string;
	readonly currentAvatar: {
		readonly fileId: string;
	} | null;
}

export const MY_USER_QUERY_KEY = ["myUser"] as const;
export const userBalanceQueryKey = (userId: string) => ["userBalance", userId] as const;

export function useUserProfile(): UserProfileState {
	const bridgeFetch = useBridgeFetch();
	const queryClient = useQueryClient();

	const userQuery = useQuery<UserProfile, Error>({
		queryKey: MY_USER_QUERY_KEY,
		queryFn: async () => {
			const res = await bridgeFetch(`${GLOBAL_BACKEND_BASE_URL}/user/api/v1/myUser`);
			if (!res.ok) throw new Error("my_user_failed");
			const data = (await res.json()) as MyUserResponseDTO;

			let avatarUrl: string | null = null;
			if (data.currentAvatar?.fileId) {
				avatarUrl = await resolveFileUrl(data.currentAvatar.fileId, bridgeFetch);
			}

			return {
				id: data.id,
				nickname: data.nickname,
				currentAvatar: avatarUrl ? { url: avatarUrl } : null,
			};
		},
		// Profile is effectively immutable for the session — cache aggressively.
		staleTime: 5 * 60_000,
	});

	const userId = userQuery.data?.id ?? null;

	const balanceQuery = useQuery<UserBalance, Error>({
		queryKey: userId ? userBalanceQueryKey(userId) : ["userBalance", "_"],
		enabled: !!userId,
		queryFn: async () => {
			const res = await bridgeFetch(
				`${GLOBAL_BACKEND_BASE_URL}/wallet/api/v1/userBalance/${userId}`,
			);
			if (!res.ok) throw new Error("balance_failed");
			const data = (await res.json()) as { balance: { coin: number } };
			return { coin: data.balance.coin };
		},
	});

	const refetchBalance = useCallback(async () => {
		if (!userId) return;
		await queryClient.invalidateQueries({ queryKey: userBalanceQueryKey(userId) });
	}, [queryClient, userId]);

	return {
		user: userQuery.data ?? null,
		balance: balanceQuery.data ?? null,
		loading: userQuery.isLoading,
		error: userQuery.error ? "Failed to load user data" : null,
		refetchBalance,
	};
}
