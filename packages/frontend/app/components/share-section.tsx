import { useFlutterEvent, useSendToFlutter, useShareParams } from "@playneta/flutter-js-bridge";
import { useCallback, useState } from "react";

import { useT } from "~/i18n";

export function ShareSection() {
	const send = useSendToFlutter();
	const shareParams = useShareParams();
	const [showSuccess, setShowSuccess] = useState(false);
	const { t } = useT();

	const isInvited = shareParams?.queryParamString?.includes("invited=true") ?? false;

	useFlutterEvent("share_completed", () => {
		setShowSuccess(true);
	});

	const handleShare = useCallback(() => {
		send("share", {
			path: "/",
			queryParamString: "invited=true",
		});
	}, [send]);

	return (
		<div className="flex flex-col items-center gap-3 p-6">
			{isInvited && (
				<div className="w-full max-w-xs text-center py-2 px-4 rounded-xl bg-green-900/40 border border-green-600/30 text-green-400 text-sm font-medium">
					{t("youWereInvited")}
				</div>
			)}

			<button
				type="button"
				onClick={handleShare}
				className="w-full max-w-xs py-3 px-6 rounded-2xl text-base font-bold transition-all bg-gradient-to-r from-blue-500 to-purple-600 text-white active:scale-95 hover:shadow-lg hover:shadow-purple-500/30"
			>
				{t("inviteAFriend")}
			</button>

			{showSuccess && (
				<div className="text-sm text-green-400 font-medium animate-bounce">{t("shareSuccess")}</div>
			)}
		</div>
	);
}
