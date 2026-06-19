import i18n from "i18next";
import { initReactI18next } from "react-i18next";

import ar from "./locales/ar.json";
import bg from "./locales/bg.json";
import cs from "./locales/cs.json";
import da from "./locales/da.json";
import de from "./locales/de.json";
import el from "./locales/el.json";
import en from "./locales/en.json";
import es from "./locales/es.json";
import fi from "./locales/fi.json";
import fr from "./locales/fr.json";
import he from "./locales/he.json";
import hu from "./locales/hu.json";
import id from "./locales/id.json";
import it from "./locales/it.json";
import ms from "./locales/ms.json";
import nb from "./locales/nb.json";
import pl from "./locales/pl.json";
import pt from "./locales/pt.json";
import ro from "./locales/ro.json";
import ru from "./locales/ru.json";
import sk from "./locales/sk.json";
import srLatn from "./locales/sr-Latn.json";
import sv from "./locales/sv.json";
import th from "./locales/th.json";
import tr from "./locales/tr.json";
import vi from "./locales/vi.json";

export const SUPPORTED_LANGUAGES = [
	"ar",
	"bg",
	"cs",
	"da",
	"de",
	"el",
	"en",
	"es",
	"fi",
	"fr",
	"he",
	"hu",
	"id",
	"it",
	"ms",
	"nb",
	"pl",
	"pt",
	"ro",
	"ru",
	"sk",
	"sr-Latn",
	"sv",
	"th",
	"tr",
	"vi",
] as const;

export type SupportedLanguage = (typeof SUPPORTED_LANGUAGES)[number];

export const RTL_LANGUAGES: ReadonlySet<SupportedLanguage> = new Set(["ar", "he"]);

const resources = {
	ar: { translation: ar },
	bg: { translation: bg },
	cs: { translation: cs },
	da: { translation: da },
	de: { translation: de },
	el: { translation: el },
	en: { translation: en },
	es: { translation: es },
	fi: { translation: fi },
	fr: { translation: fr },
	he: { translation: he },
	hu: { translation: hu },
	id: { translation: id },
	it: { translation: it },
	ms: { translation: ms },
	nb: { translation: nb },
	pl: { translation: pl },
	pt: { translation: pt },
	ro: { translation: ro },
	ru: { translation: ru },
	sk: { translation: sk },
	"sr-Latn": { translation: srLatn },
	sv: { translation: sv },
	th: { translation: th },
	tr: { translation: tr },
	vi: { translation: vi },
};

if (!i18n.isInitialized) {
	void i18n.use(initReactI18next).init({
		resources,
		fallbackLng: "en",
		supportedLngs: SUPPORTED_LANGUAGES as unknown as string[],
		nonExplicitSupportedLngs: true,
		interpolation: { escapeValue: false },
		returnNull: false,
	});
}

export default i18n;
