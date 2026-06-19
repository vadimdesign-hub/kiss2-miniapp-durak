import { useSignalReady } from "@playneta/flutter-js-bridge";
import { useEffect } from "react";
import { useNavigate } from "react-router";

/**
 * Single-game shell: the catalog / leaderboard / mode-picker have been
 * removed per product spec. Opening the app drops the user straight into
 * durak matchmaking.
 */
export default function Home() {
	const navigate = useNavigate();
	const signalReady = useSignalReady();
	useEffect(() => {
		signalReady();
		navigate("/match/durak", { replace: true });
	}, [navigate, signalReady]);
	return (
		<div className="flex items-center justify-center min-h-screen text-gray-500 font-mono">
			Loading…
		</div>
	);
}
