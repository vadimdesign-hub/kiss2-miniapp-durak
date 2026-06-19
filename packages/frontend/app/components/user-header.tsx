import { FlutterRoute, useOpenRoute } from "@playneta/flutter-js-bridge";
import { useCallback } from "react";

import type { UserProfile } from "~/hooks/use-user-profile";
import { useT } from "~/i18n";

export function UserHeader({
	user,
	coinBalance,
}: {
	readonly user: UserProfile;
	readonly coinBalance: number | null;
}) {
	const openRoute = useOpenRoute();
	const { t } = useT();

	const handleOpenProfile = useCallback(() => {
		openRoute(FlutterRoute.Profile, { params: { profileId: user.id } });
	}, [openRoute, user.id]);

	return (
		<div className="flex items-center gap-3 p-4">
			<button
				type="button"
				onClick={handleOpenProfile}
				className="flex items-center gap-3 flex-1 min-w-0"
			>
				{user.currentAvatar ? (
					<img
						src={user.currentAvatar.url}
						alt={user.nickname}
						className="w-12 h-12 rounded-full object-cover"
					/>
				) : (
					<div className="w-12 h-12 rounded-full bg-gray-700 flex items-center justify-center text-lg font-bold text-gray-300">
						{user.nickname.charAt(0).toUpperCase()}
					</div>
				)}
				<div className="flex-1 min-w-0 text-left">
					<div className="text-base font-semibold text-white truncate">{user.nickname}</div>
					{coinBalance != null && (
						<div className="text-sm text-yellow-400 font-medium">
							{coinBalance.toLocaleString()} {t("coins")}
						</div>
					)}
				</div>
			</button>
		</div>
	);
}
