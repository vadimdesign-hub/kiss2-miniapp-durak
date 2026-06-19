import { useSignalReady } from "@playneta/flutter-js-bridge";
import { useEffect } from "react";
import { DailyMessage } from "~/components/daily-message";
import { LuckyDaySection } from "~/components/lucky-day-section";
import { ShareSection } from "~/components/share-section";
import { TopBar } from "~/components/top-bar";
import { UserHeader } from "~/components/user-header";
import { useUserProfile } from "~/hooks/use-user-profile";

export default function Home() {
	const { user, balance, loading, refetchBalance } = useUserProfile();
	const signalReady = useSignalReady();

	// Tell Flutter we're ready once initial data has loaded
	useEffect(() => {
		if (!loading && user) {
			signalReady();
		}
	}, [loading, user, signalReady]);

	if (loading || !user) {
		return (
			<div className="flex items-center justify-center min-h-screen text-gray-500 font-mono">
				{loading ? "Loading..." : "Waiting for user..."}
			</div>
		);
	}

	return (
		<div className="min-h-screen bg-[#1a1a1a] font-sans">
			<TopBar />
			<UserHeader user={user} coinBalance={balance?.coin ?? null} />
			<DailyMessage />
			<div className="mt-8">
				<LuckyDaySection onClaimed={refetchBalance} />
			</div>
			<ShareSection />
		</div>
	);
}
