import { useFlutterBridge } from "@playneta/flutter-js-bridge";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";

import i18n, { RTL_LANGUAGES, SUPPORTED_LANGUAGES, type SupportedLanguage } from "./config";

export {
	default as i18n,
	RTL_LANGUAGES,
	SUPPORTED_LANGUAGES,
	type SupportedLanguage,
} from "./config";

/**
 * Resolve a raw `Accept-Language` value (e.g. "en-US,en;q=0.9", "ru", "sr-Latn-RS")
 * to one of our SUPPORTED_LANGUAGES, or "en" as the ultimate fallback.
 */
export function resolveLanguage(raw: string | undefined | null): SupportedLanguage {
	if (!raw) return "en";
	const primary = raw.split(",")[0]?.trim() ?? "";
	if (!primary) return "en";

	if ((SUPPORTED_LANGUAGES as readonly string[]).includes(primary)) {
		return primary as SupportedLanguage;
	}

	const lower = primary.toLowerCase();
	const baseLower = lower.split("-")[0] ?? "";

	if (baseLower === "sr") return "sr-Latn";
	if (baseLower === "no" || baseLower === "nn") return "nb";
	if (baseLower === "iw") return "he";
	if (baseLower === "in") return "id";

	const baseMatch = (SUPPORTED_LANGUAGES as readonly string[]).find(
		(s) => s.toLowerCase() === baseLower,
	);
	if (baseMatch) return baseMatch as SupportedLanguage;

	return "en";
}

/**
 * Read the active language from the Flutter bridge (Accept-Language header)
 * and keep i18next in sync. Use the returned `t` for translations.
 */
export function useT() {
	const { state } = useFlutterBridge();
	const lang = resolveLanguage(state.headers?.["Accept-Language"]);
	const { t } = useTranslation();

	useEffect(() => {
		if (i18n.language !== lang) void i18n.changeLanguage(lang);
	}, [lang]);

	return { t, lang };
}
