import { useLuckyCoin } from "~/hooks/use-lucky-coin";
import { useT } from "~/i18n";

export function LuckyDaySection({ onClaimed }: { readonly onClaimed: () => Promise<void> }) {
	const { t } = useT();
	const { attemptsLeft, loading, claiming, lastWin, error, claim } = useLuckyCoin();

	const disabled = loading || claiming || attemptsLeft === 0;

	const handleClaim = async () => {
		await claim();
		await onClaimed();
	};

	return (
		<div className="flex flex-col items-center gap-4 p-6">
			<button
				type="button"
				onClick={handleClaim}
				disabled={disabled}
				className={`w-full max-w-xs py-4 px-8 rounded-2xl text-lg font-bold transition-all ${
					disabled
						? "bg-gray-700 text-gray-500 cursor-not-allowed"
						: "bg-gradient-to-r from-yellow-400 to-orange-500 text-black active:scale-95 hover:shadow-lg hover:shadow-orange-500/30"
				}`}
			>
				{claiming ? t("loading") : t("luckyDay")}
			</button>

			<div className="text-sm text-gray-400">
				{attemptsLeft != null && attemptsLeft > 0 && t("attemptsLeft", { count: attemptsLeft })}
				{attemptsLeft === 0 && t("noAttemptsLeft")}
			</div>

			{lastWin != null && (
				<div className="text-xl font-bold text-yellow-400 animate-bounce">
					{t("coinWon", { count: lastWin })}
				</div>
			)}

			{error && <div className="text-sm text-red-400">{t("error")}</div>}
		</div>
	);
}
