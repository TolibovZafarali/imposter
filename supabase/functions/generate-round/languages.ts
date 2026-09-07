import { languageCatalog } from "./catalog/languages.ts";

export type CanonicalLanguageMetadata = {
  languageId: string;
  languageName: string;
  languageNativeName: string;
  languageScriptHint: string;
};

const scriptHintByLanguageId: Readonly<Record<string, string>> = {
  amharic: "Ethiopic script",
  arabic: "Arabic script",
  armenian: "Armenian script",
  assamese: "Bengali script",
  belarusian: "Cyrillic script",
  bengali: "Bengali script",
  bhojpuri: "Devanagari script",
  bulgarian: "Cyrillic script",
  burmese: "Myanmar script",
  "chinese-simplified": "Simplified Han characters",
  "chinese-traditional": "Traditional Han characters",
  dhivehi: "Thaana script",
  dogri: "Devanagari script",
  georgian: "Georgian script",
  greek: "Greek script",
  gujarati: "Gujarati script",
  hebrew: "Hebrew script",
  hindi: "Devanagari script",
  japanese: "Japanese Kanji and Kana",
  kannada: "Kannada script",
  kazakh: "Cyrillic script",
  khmer: "Khmer script",
  konkani: "Devanagari script",
  korean: "Hangul script",
  "kurdish-sorani": "Arabic-based Sorani script",
  kyrgyz: "Cyrillic script",
  lao: "Lao script",
  macedonian: "Cyrillic script",
  maithili: "Devanagari script",
  malayalam: "Malayalam script",
  marathi: "Devanagari script",
  meiteilon: "Meitei Mayek script",
  mongolian: "Cyrillic script",
  nepali: "Devanagari script",
  odia: "Odia script",
  pashto: "Arabic-based Pashto script",
  persian: "Persian script",
  punjabi: "Gurmukhi script",
  russian: "Cyrillic script",
  sanskrit: "Devanagari script",
  serbian: "Cyrillic script",
  sindhi: "Arabic-based Sindhi script",
  sinhala: "Sinhala script",
  tajik: "Cyrillic script",
  tamil: "Tamil script",
  tatar: "Cyrillic script",
  telugu: "Telugu script",
  thai: "Thai script",
  tigrinya: "Ethiopic script",
  ukrainian: "Cyrillic script",
  urdu: "Arabic-based Urdu script",
  uyghur: "Arabic-based Uyghur script",
  yiddish: "Hebrew script",
};

export const CANONICAL_LANGUAGES: readonly CanonicalLanguageMetadata[] =
  languageCatalog.map(
    ([id, name, nativeName]) => ({
      languageId: id,
      languageName: name,
      languageNativeName: nativeName,
      languageScriptHint: scriptHintByLanguageId[id] ?? "Latin script",
    }),
  );

const canonicalLanguagesById = new Map(
  CANONICAL_LANGUAGES.map((language) => [language.languageId, language]),
);

if (canonicalLanguagesById.size !== CANONICAL_LANGUAGES.length) {
  throw new Error("Canonical language IDs must be unique");
}

export const getCanonicalLanguageMetadata = (languageId: string) =>
  canonicalLanguagesById.get(languageId) ?? null;
