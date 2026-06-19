/**
 * Fetches the opponent's profile (nickname + avatar) from the platform user
 * service so we can render their real avatar in the chair during a multiplayer
 * match. Returns null until the request completes (or if userId is null).
 */
import { useBridgeFetch } from "@playneta/flutter-js-bridge";
import { useEffect, useState } from "react";

import { GLOBAL_BACKEND_BASE_URL } from "~/config";
import { resolveFileUrl } from "~/utils/file-url";

export interface OpponentProfile {
	readonly id: string;
	readonly nickname: string;
	readonly avatarUrl: string | null;
}

interface UserResponseDTO {
	readonly id: string;
	readonly nickname: string;
	readonly currentAvatar?: { readonly fileId: string } | null;
}

export function useOpponentProfile(userId: string | null | undefined): OpponentProfile | null {
	const bridgeFetch = useBridgeFetch();
	const [profile, setProfile] = useState<OpponentProfile | null>(null);

	useEffect(() => {
		if (!userId) {
			setProfile(null);
			return;
		}
		let cancelled = false;
		(async () => {
			try {
				const res = await bridgeFetch(`${GLOBAL_BACKEND_BASE_URL}/user/api/v1/user/${userId}`);
				if (!res.ok) return;
				const data = (await res.json()) as UserResponseDTO;
				let avatarUrl: string | null = null;
				if (data.currentAvatar?.fileId) {
					avatarUrl = await resolveFileUrl(data.currentAvatar.fileId, bridgeFetch);
				}
				if (cancelled) return;
				setProfile({ id: data.id, nickname: data.nickname, avatarUrl });
			} catch {
				/* non-fatal — keep null, fall back to default avatar */
			}
		})();
		return () => { cancelled = true; };
	}, [userId, bridgeFetch]);

	return profile;
}
