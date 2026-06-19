import { useBridgeFetch } from "@playneta/flutter-js-bridge";
import { useCallback, useEffect, useState } from "react";

import { API_BASE_URL } from "~/config";

interface LuckyCoinState {
	readonly attemptsLeft: number | null;
	readonly loading: boolean;
	readonly claiming: boolean;
	readonly lastWin: number | null;
	readonly error: string | null;
	readonly claim: () => Promise<void>;
}

export function useLuckyCoin(): LuckyCoinState {
	const bridgeFetch = useBridgeFetch();
	const [attemptsLeft, setAttemptsLeft] = useState<number | null>(null);
	const [loading, setLoading] = useState(true);
	const [claiming, setClaiming] = useState(false);
	const [lastWin, setLastWin] = useState<number | null>(null);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		let cancelled = false;

		const fetchStatus = async () => {
			try {
				const res = await bridgeFetch(`${API_BASE_URL}/api/v1/luckyCoin/status`);
				if (!cancelled && res.ok) {
					const data = (await res.json()) as { attemptsLeft: number };
					setAttemptsLeft(data.attemptsLeft);
				}
			} catch {
				if (!cancelled) setError("Failed to load status");
			} finally {
				if (!cancelled) setLoading(false);
			}
		};

		fetchStatus();
		return () => {
			cancelled = true;
		};
	}, [bridgeFetch]);

	const claim = useCallback(async () => {
		setClaiming(true);
		setError(null);
		setLastWin(null);

		try {
			const res = await bridgeFetch(`${API_BASE_URL}/api/v1/luckyCoin/claim`, {
				method: "POST",
			});

			if (res.ok) {
				const data = (await res.json()) as { amount: number; attemptsLeft: number };
				setLastWin(data.amount);
				setAttemptsLeft(data.attemptsLeft);
			} else if (res.status === 429) {
				setAttemptsLeft(0);
			} else {
				setError("Failed to claim");
			}
		} catch {
			setError("Failed to claim");
		} finally {
			setClaiming(false);
		}
	}, [bridgeFetch]);

	return { attemptsLeft, loading, claiming, lastWin, error, claim };
}
