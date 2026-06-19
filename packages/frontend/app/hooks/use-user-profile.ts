import { useBridgeFetch } from "@playneta/flutter-js-bridge";
import { useCallback, useEffect, useState } from "react";

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

export function useUserProfile(): UserProfileState {
	const bridgeFetch = useBridgeFetch();
	const [user, setUser] = useState<UserProfile | null>(null);
	const [balance, setBalance] = useState<UserBalance | null>(null);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);

	const fetchBalance = useCallback(
		async (userId: string) => {
			try {
				const res = await bridgeFetch(
					`${GLOBAL_BACKEND_BASE_URL}/wallet/api/v1/userBalance/${userId}`,
				);
				if (res.ok) {
					const data = (await res.json()) as { balance: { coin: number } };
					setBalance({ coin: data.balance.coin });
				}
			} catch {
				// Balance fetch failure is non-critical
			}
		},
		[bridgeFetch],
	);

	const refetchBalance = useCallback(async () => {
		if (user?.id) {
			await fetchBalance(user.id);
		}
	}, [user?.id, fetchBalance]);

	useEffect(() => {
		let cancelled = false;

		const load = async () => {
			setLoading(true);
			setError(null);

			try {
				const profileRes = await bridgeFetch(`${GLOBAL_BACKEND_BASE_URL}/user/api/v1/myUser`);

				if (cancelled) return;

				if (profileRes.ok) {
					const data = (await profileRes.json()) as MyUserResponseDTO;

					let avatarUrl: string | null = null;
					if (data.currentAvatar?.fileId) {
						avatarUrl = await resolveFileUrl(data.currentAvatar.fileId, bridgeFetch);
					}

					if (cancelled) return;

					setUser({
						id: data.id,
						nickname: data.nickname,
						currentAvatar: avatarUrl ? { url: avatarUrl } : null,
					});

					await fetchBalance(data.id);
				} else {
					setError("Failed to load user data");
				}
			} catch {
				if (!cancelled) {
					setError("Failed to load user data");
				}
			} finally {
				if (!cancelled) {
					setLoading(false);
				}
			}
		};

		load();
		return () => {
			cancelled = true;
		};
	}, [bridgeFetch, fetchBalance]);

	return { user, balance, loading, error, refetchBalance };
}
