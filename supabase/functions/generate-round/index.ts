import { z } from "npm:zod@4.4.3";
import {
  base64UrlDigestToHex,
  canonicalJson,
  type ChallengeEnvelope,
  createAppAttestSignedData,
  getPayloadHash,
  type LanguageMetadata,
  type LegacyRoundWordRequest,
  type LegacyTranslationWordRequest,
  MAX_PROMPT_PLAYED_WORDS,
  type PaidEnvelope,
  type RegisterEnvelope,
  type RoundWordRequest,
  sha256Hex,
  type TranslationWordRequest,
  type WireRequest,
  wireRequestSchema,
} from "./contracts.ts";
import {
  type AiWordCandidatesResponse,
  type AllowedModel,
  getProviderReservation,
  OpenAIRoundProvider,
  parseAllowedModel,
  type ProviderPrompt,
  type ProviderResult,
  type RoundProvider,
} from "./provider.ts";
import {
  AppAttestVerificationError,
  type AppIdentity,
  getKeyIdHash,
  verifyAssertion,
  verifyAttestation,
} from "./app-attest.ts";
import {
  ApiError,
  assertWithinDeadline,
  createDeadlineSignal,
  errorResponse,
  getCorsHeaders,
  getRequestActionHeader,
  getStreamingBodyLimit,
  jsonResponse,
  readJsonBody,
} from "./http.ts";
import { normalizePaidPayload } from "./normalize.ts";
import {
  type Lease,
  PersistenceError,
  type RoundPersistence,
  type RpcResult,
  SupabaseRoundPersistence,
} from "./persistence.ts";

const DEFAULT_MODEL = "gpt-5.4-mini";
const DEFAULT_LOCALIZATION_MODEL = "gpt-5.4";
const CANDIDATE_COUNT = 8;

const clueQualitySchema = z.object({
  relatedness: z.number().int().min(1).max(5),
  naturalness: z.number().int().min(1).max(5),
  revealRisk: z.number().int().min(1).max(5),
  genericness: z.number().int().min(1).max(5),
  stretchiness: z.number().int().min(1).max(5),
  verdict: z.enum(["pass", "fail"]),
  reason: z.string().trim().min(1).max(160),
});

const clueQualityJudgmentSchema = clueQualitySchema.extend({
  clue: z.string().trim().min(1).max(42),
});

const clueQualityBatchSchema = z.object({
  judgments: z.array(clueQualityJudgmentSchema).min(1).max(CANDIDATE_COUNT),
});

const normalizeForCloseness = (value: string) =>
  value
    .normalize("NFD")
    .replace(/\p{M}+/gu, "")
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");

type ScriptProfile = {
  label: string;
  promptHint: string;
  pattern: RegExp;
  allowsNoSpaceCelebrityNames?: boolean;
};

const scriptProfiles = {
  arabic: {
    label: "Arabic script",
    promptHint: "Arabic script for normal words and clues",
    pattern: /\p{Script=Arabic}/u,
  },
  armenian: {
    label: "Armenian script",
    promptHint: "Armenian script for normal words and clues",
    pattern: /\p{Script=Armenian}/u,
  },
  bengali: {
    label: "Bengali script",
    promptHint: "Bengali script for normal words and clues",
    pattern: /\p{Script=Bengali}/u,
  },
  cjk: {
    label: "CJK script",
    promptHint: "the natural CJK writing system for this language",
    pattern:
      /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u,
    allowsNoSpaceCelebrityNames: true,
  },
  cyrillic: {
    label: "Cyrillic script",
    promptHint: "Cyrillic script for normal words and clues",
    pattern: /\p{Script=Cyrillic}/u,
  },
  devanagari: {
    label: "Devanagari script",
    promptHint: "Devanagari script for normal words and clues",
    pattern: /\p{Script=Devanagari}/u,
  },
  ethiopic: {
    label: "Ethiopic script",
    promptHint: "Ethiopic script for normal words and clues",
    pattern: /\p{Script=Ethiopic}/u,
  },
  georgian: {
    label: "Georgian script",
    promptHint: "Georgian script for normal words and clues",
    pattern: /\p{Script=Georgian}/u,
  },
  greek: {
    label: "Greek script",
    promptHint: "Greek script for normal words and clues",
    pattern: /\p{Script=Greek}/u,
  },
  gujarati: {
    label: "Gujarati script",
    promptHint: "Gujarati script for normal words and clues",
    pattern: /\p{Script=Gujarati}/u,
  },
  gurmukhi: {
    label: "Gurmukhi script",
    promptHint: "Gurmukhi script for normal words and clues",
    pattern: /\p{Script=Gurmukhi}/u,
  },
  hebrew: {
    label: "Hebrew script",
    promptHint: "Hebrew script for normal words and clues",
    pattern: /\p{Script=Hebrew}/u,
  },
  khmer: {
    label: "Khmer script",
    promptHint: "Khmer script for normal words and clues",
    pattern: /\p{Script=Khmer}/u,
  },
  lao: {
    label: "Lao script",
    promptHint: "Lao script for normal words and clues",
    pattern: /\p{Script=Lao}/u,
  },
  myanmar: {
    label: "Myanmar script",
    promptHint: "Myanmar script for normal words and clues",
    pattern: /\p{Script=Myanmar}/u,
  },
  sinhala: {
    label: "Sinhala script",
    promptHint: "Sinhala script for normal words and clues",
    pattern: /\p{Script=Sinhala}/u,
  },
  tamil: {
    label: "Tamil script",
    promptHint: "Tamil script for normal words and clues",
    pattern: /\p{Script=Tamil}/u,
  },
  telugu: {
    label: "Telugu script",
    promptHint: "Telugu script for normal words and clues",
    pattern: /\p{Script=Telugu}/u,
  },
  thai: {
    label: "Thai script",
    promptHint: "Thai script for normal words and clues",
    pattern: /\p{Script=Thai}/u,
  },
} as const satisfies Record<string, ScriptProfile>;

const scriptProfileByLanguageId = new Map<string, ScriptProfile>([
  ["amharic", scriptProfiles.ethiopic],
  ["arabic", scriptProfiles.arabic],
  ["armenian", scriptProfiles.armenian],
  ["assamese", scriptProfiles.bengali],
  ["belarusian", scriptProfiles.cyrillic],
  ["bengali", scriptProfiles.bengali],
  ["bhojpuri", scriptProfiles.devanagari],
  ["bulgarian", scriptProfiles.cyrillic],
  ["burmese", scriptProfiles.myanmar],
  ["chinese-simplified", scriptProfiles.cjk],
  ["chinese-traditional", scriptProfiles.cjk],
  ["dhivehi", scriptProfiles.arabic],
  ["dogri", scriptProfiles.devanagari],
  ["georgian", scriptProfiles.georgian],
  ["greek", scriptProfiles.greek],
  ["gujarati", scriptProfiles.gujarati],
  ["hebrew", scriptProfiles.hebrew],
  ["hindi", scriptProfiles.devanagari],
  ["japanese", scriptProfiles.cjk],
  ["kannada", {
    label: "Kannada script",
    promptHint: "Kannada script for normal words and clues",
    pattern: /\p{Script=Kannada}/u,
  }],
  ["kazakh", scriptProfiles.cyrillic],
  ["khmer", scriptProfiles.khmer],
  ["konkani", scriptProfiles.devanagari],
  ["korean", scriptProfiles.cjk],
  ["kurdish-sorani", scriptProfiles.arabic],
  ["kyrgyz", scriptProfiles.cyrillic],
  ["lao", scriptProfiles.lao],
  ["macedonian", scriptProfiles.cyrillic],
  ["maithili", scriptProfiles.devanagari],
  ["malayalam", {
    label: "Malayalam script",
    promptHint: "Malayalam script for normal words and clues",
    pattern: /\p{Script=Malayalam}/u,
  }],
  ["marathi", scriptProfiles.devanagari],
  ["mongolian", scriptProfiles.cyrillic],
  ["nepali", scriptProfiles.devanagari],
  ["odia", {
    label: "Odia script",
    promptHint: "Odia script for normal words and clues",
    pattern: /\p{Script=Oriya}/u,
  }],
  ["pashto", scriptProfiles.arabic],
  ["persian", scriptProfiles.arabic],
  ["punjabi", scriptProfiles.gurmukhi],
  ["russian", scriptProfiles.cyrillic],
  ["sanskrit", scriptProfiles.devanagari],
  ["serbian", scriptProfiles.cyrillic],
  ["sindhi", scriptProfiles.arabic],
  ["sinhala", scriptProfiles.sinhala],
  ["tajik", scriptProfiles.cyrillic],
  ["tamil", scriptProfiles.tamil],
  ["tatar", scriptProfiles.cyrillic],
  ["telugu", scriptProfiles.telugu],
  ["thai", scriptProfiles.thai],
  ["tigrinya", scriptProfiles.ethiopic],
  ["ukrainian", scriptProfiles.cyrillic],
  ["urdu", scriptProfiles.arabic],
  ["uyghur", scriptProfiles.arabic],
  ["yiddish", scriptProfiles.hebrew],
]);

const getLanguageScriptProfile = (
  language: LanguageMetadata,
): ScriptProfile | null => {
  const languageId = language.languageId.trim().toLocaleLowerCase();
  const explicitHint = language.languageScriptHint?.trim().toLocaleLowerCase();

  if (explicitHint) {
    const hintedProfile = Object.values(scriptProfiles).find((profile) =>
      explicitHint.includes(
        profile.label.toLocaleLowerCase().replace(" script", ""),
      )
    );

    if (hintedProfile) {
      return hintedProfile;
    }
  }

  const mappedProfile = scriptProfileByLanguageId.get(languageId);

  if (mappedProfile) {
    return mappedProfile;
  }

  const nativeName = language.languageNativeName?.trim();

  if (nativeName) {
    return Object.values(scriptProfiles).find((profile) =>
      profile.pattern.test(nativeName)
    ) ?? null;
  }

  return null;
};

const getLanguageScriptHint = (language: LanguageMetadata) =>
  language.languageScriptHint?.trim() ||
  getLanguageScriptProfile(language)?.promptHint ||
  "the writing system real native speakers normally use for this language";

const formatLanguageMetadataLines = (language: LanguageMetadata) => [
  `Language ID: ${language.languageId}`,
  `Language name: ${language.languageName}`,
  language.languageNativeName
    ? `Native language name: ${language.languageNativeName}`
    : null,
  `Expected writing system: ${getLanguageScriptHint(language)}`,
];

const hasLatinLetters = (value: string) => /\p{Script=Latin}/u.test(value);

const countExpectedScriptLetters = (value: string, profile: ScriptProfile) =>
  Array.from(value).filter((character) => profile.pattern.test(character))
    .length;

const isLikelyGlobalProperNoun = (value: string) => {
  const tokens = value.match(/[\p{L}\p{N}]+/gu) ?? [];

  return hasLatinLetters(value) && (tokens.length > 1 || /[A-Z]/.test(value));
};

const categoryClueTokens = new Set([
  "animal",
  "athlete",
  "bird",
  "building",
  "celebrity",
  "city",
  "country",
  "device",
  "drink",
  "film",
  "food",
  "game",
  "instrument",
  "job",
  "meal",
  "movie",
  "object",
  "person",
  "place",
  "plant",
  "school",
  "song",
  "sport",
  "story",
  "structure",
  "tool",
  "vehicle",
  "work",
]);

const genericPlaceClueTokens = new Set([
  "airport",
  "bar",
  "cafe",
  "class",
  "classroom",
  "college",
  "court",
  "desk",
  "farm",
  "field",
  "forest",
  "garage",
  "garden",
  "gym",
  "home",
  "house",
  "jungle",
  "kitchen",
  "museum",
  "ocean",
  "office",
  "park",
  "pool",
  "restaurant",
  "salon",
  "school",
  "sea",
  "shelf",
  "shop",
  "sidewalk",
  "stage",
  "station",
  "store",
  "street",
  "trail",
  "workshop",
  "zoo",
]);

const genericContextClueTokens = new Set([
  "breakfast",
  "creature",
  "dessert",
  "dinner",
  "habitat",
  "land",
  "lunch",
  "mammal",
  "meal",
  "pet",
  "wild",
  "wildlife",
]);

const blockedGenericClueTokens = new Set([
  ...categoryClueTokens,
  ...genericPlaceClueTokens,
  ...genericContextClueTokens,
]);

const directHypernymClueTokens = new Set([
  "category",
  "document",
  "fruit",
  "ingredient",
  "item",
  "location",
  "thing",
]);

const unrelatedFillerClues = new Set([
  "common",
  "concept",
  "edge",
  "essence",
  "familiar",
  "general",
  "known",
  "related",
  "symbol",
  "talisman",
]);

const blockedCluePairs = new Set([
  "banana:fruit",
  "baby goat:talisman",
  "desert kangaroo:talisman",
  "hospital:doctor",
  "knife:kitchen",
  "passport:document",
  "pencil:school",
  "pizza:cheese",
  "sunscreen:edge",
  "sushi:roll",
]);

const getCluePairKey = (word: string, clue: string) =>
  `${normalizeForCloseness(word)}:${normalizeForCloseness(clue)}`;

const getClueTokens = (clue: string) =>
  normalizeForCloseness(clue).split(" ").filter(Boolean);

const disallowedClueSeparatorPattern = /[-\u2010-\u2015/\\|_]/u;

const hasPunctuationHeavyClue = (clue: string) => {
  const punctuation = clue.match(/[^\p{L}\p{M}\p{N}\s'’]/gu) ?? [];

  return punctuation.length > 2 ||
    punctuation.join("").length > Math.max(2, Math.floor(clue.length / 4));
};

const hasShortPhraseClue = (clue: string) => {
  const clueTokens = normalizeForCloseness(clue).split(" ").filter(Boolean);

  return (
    clueTokens.length >= 1 &&
    clueTokens.length <= 2 &&
    !disallowedClueSeparatorPattern.test(clue) &&
    !hasPunctuationHeavyClue(clue)
  );
};

const hasGenericClue = (word: string, clue: string) => {
  const normalizedClue = normalizeForCloseness(clue);

  if (
    directHypernymClueTokens.has(normalizedClue) ||
    unrelatedFillerClues.has(normalizedClue) ||
    blockedCluePairs.has(getCluePairKey(word, clue))
  ) {
    return true;
  }

  return getClueTokens(clue).some((token) =>
    blockedGenericClueTokens.has(token)
  );
};

const hasLexicallyCloseClue = (word: string, clue: string) => {
  const normalizedWord = normalizeForCloseness(word);
  const normalizedClue = normalizeForCloseness(clue);

  if (!normalizedWord || !normalizedClue) {
    return true;
  }

  if (normalizedWord === normalizedClue) {
    return true;
  }

  const wordTokens = normalizedWord.split(" ");
  const clueTokens = normalizedClue.split(" ");
  const sharesMeaningfulToken = clueTokens.some(
    (clueToken) => clueToken.length >= 4 && wordTokens.includes(clueToken),
  );

  if (sharesMeaningfulToken) {
    return true;
  }

  return (
    Math.min(normalizedWord.length, normalizedClue.length) >= 4 &&
    (normalizedWord.includes(normalizedClue) ||
      normalizedClue.includes(normalizedWord))
  );
};

export const hasPlayableCelebrityAnswer = (
  word: string,
  language?: LanguageMetadata,
) => {
  if (normalizeForCloseness(word).split(" ").filter(Boolean).length >= 2) {
    return true;
  }

  const profile = language ? getLanguageScriptProfile(language) : null;

  return Boolean(
    profile?.allowsNoSpaceCelebrityNames &&
      countExpectedScriptLetters(word, profile) >= 2,
  );
};

const isCelebrityRequest = (categoryIds: readonly string[]) =>
  categoryIds.includes("celebrities");
const isMovieRequest = (categoryIds: readonly string[]) =>
  categoryIds.includes("movies");
const isEnglishLanguage = ({ languageId, languageName }: LanguageMetadata) =>
  languageId === "english" ||
  languageName.trim().toLocaleLowerCase() === "english";

const canUseGlobalLatinTitleOrName = (
  word: string,
  categoryIds: readonly string[],
) =>
  (isMovieRequest(categoryIds) || isCelebrityRequest(categoryIds)) &&
  isLikelyGlobalProperNoun(word);

const assertExpectedScriptForField = ({
  field,
  value,
  language,
  categoryIds,
}: {
  field: "word" | "clue";
  value: string;
  language: LanguageMetadata;
  categoryIds: readonly string[];
}) => {
  const profile = getLanguageScriptProfile(language);

  if (!profile || profile.pattern.test(value)) {
    return;
  }

  if (field === "word" && canUseGlobalLatinTitleOrName(value, categoryIds)) {
    return;
  }

  if (hasLatinLetters(value)) {
    throw new Error(
      `OpenAI returned English/Latin-only ${field} text for ${language.languageName}; expected ${profile.label}`,
    );
  }

  throw new Error(
    `OpenAI returned ${field} text outside the expected ${profile.label} for ${language.languageName}`,
  );
};

const assertNotUnchangedEnglishSource = ({
  word,
  clue,
  source,
  language,
}: {
  word: string;
  clue: string;
  source?: { word?: string; clue?: string };
  language: LanguageMetadata;
}) => {
  if (isEnglishLanguage(language) || !source?.word || !source?.clue) {
    return;
  }

  const wordMatchesSource =
    normalizeForCloseness(word) === normalizeForCloseness(source.word);
  const clueMatchesSource =
    normalizeForCloseness(clue) === normalizeForCloseness(source.clue);

  if (wordMatchesSource && clueMatchesSource) {
    throw new Error(
      "OpenAI returned unchanged English source text for a non-English round",
    );
  }
};

const responseSchema = z
  .object({
    word: z.string().trim().min(1).max(42),
    clue: z.string().trim().min(1).max(42),
  })
  .refine((value) => hasShortPhraseClue(value.clue), {
    message: "The clue must be one or two clean words",
    path: ["clue"],
  })
  .refine((value) => !hasGenericClue(value.word, value.clue), {
    message: "The clue must not be generic, unrelated, or an over-direct clue",
    path: ["clue"],
  })
  .refine(
    (value) => !hasLexicallyCloseClue(value.word, value.clue),
    "The clue must be broader than and lexically separate from the word",
  );

type RoundWordResponse = z.infer<typeof responseSchema>;
type ClueQuality = z.infer<typeof clueQualitySchema>;
type ClueQualityJudgment = z.infer<typeof clueQualityJudgmentSchema>;
export type PopularityScope = "international" | "local";

type EnvGetter = (name: string) => string;
const getEnv: EnvGetter = (name) => Deno.env.get(name)?.trim() || "";

export const getRoundGenerationModel = (
  language: LanguageMetadata,
  env: EnvGetter = getEnv,
) =>
  parseAllowedModel(
    isEnglishLanguage(language)
      ? env("OPENAI_MODEL")
      : env("OPENAI_LOCALIZED_GENERATION_MODEL") ||
        env("OPENAI_LOCALIZATION_MODEL") ||
        env("OPENAI_MODEL"),
    isEnglishLanguage(language) ? DEFAULT_MODEL : DEFAULT_LOCALIZATION_MODEL,
  );

export const getTranslationModel = (env: EnvGetter = getEnv) =>
  parseAllowedModel(
    env("OPENAI_TRANSLATION_MODEL") ||
      env("OPENAI_LOCALIZATION_MODEL") ||
      env("OPENAI_MODEL"),
    DEFAULT_LOCALIZATION_MODEL,
  );

const getSupabaseSecretKey = (env: EnvGetter = getEnv) => {
  const legacyServiceRoleKey = env("SUPABASE_SERVICE_ROLE_KEY");

  if (legacyServiceRoleKey) {
    return legacyServiceRoleKey;
  }

  const localSecretKey = env("SUPABASE_SECRET_KEY");

  if (localSecretKey) {
    return localSecretKey;
  }

  const secretKeysJson = env("SUPABASE_SECRET_KEYS");

  if (!secretKeysJson) {
    return "";
  }

  try {
    const secretKeys = JSON.parse(secretKeysJson) as Record<string, unknown>;
    const defaultSecretKey = secretKeys.default;

    return typeof defaultSecretKey === "string" ? defaultSecretKey : "";
  } catch {
    return "";
  }
};

const categoryLabel = (categoryId: string) =>
  categoryId
    .split("-")
    .map((part) => part.charAt(0).toLocaleUpperCase() + part.slice(1))
    .join(" ");

const normalizeGeneratedText = (value: string) =>
  value.trim().replace(/\s+/g, " ");

const isAlreadyPlayedWord = (word: string, playedWords: readonly string[]) => {
  const wordKey = normalizeForCloseness(word);
  const playedWordKeys = new Set(
    playedWords.map(normalizeForCloseness).filter(Boolean),
  );

  return playedWordKeys.has(wordKey);
};

const mergeUniquePlayedWords = (words: readonly string[]) => {
  const seenWordKeys = new Set<string>();

  return words.filter((word) => {
    const wordKey = normalizeForCloseness(word);

    if (!wordKey || seenWordKeys.has(wordKey)) {
      return false;
    }

    seenWordKeys.add(wordKey);
    return true;
  });
};

const getAlreadyPlayedWords = (
  input: RoundWordRequest,
  extraWords: readonly string[] = [],
) =>
  mergeUniquePlayedWords([
    ...extraWords,
    ...input.playedWords,
  ]).slice(0, MAX_PROMPT_PLAYED_WORDS);

const createVarietyKey = (attempt: number) =>
  `${Date.now().toString(36)}-${attempt}-${
    Math.random().toString(36).slice(2, 10)
  }`;

const hashVarietyKey = (varietyKey: string) => {
  let hash = 2166136261;

  for (const character of varietyKey) {
    hash ^= character.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 16777619);
  }

  return hash >>> 0;
};

export const selectPopularityScope = (varietyKey: string): PopularityScope =>
  hashVarietyKey(varietyKey) % 2 === 0 ? "international" : "local";

const formatPopularityScope = (popularityScope: PopularityScope) =>
  popularityScope === "international"
    ? "International"
    : "Local to the selected language/culture";

const difficultyInstructions = {
  easy:
    "Difficulty target: easy. Choose a highly familiar, everyday answer most casual players recognize immediately.",
  medium:
    "Difficulty target: medium. Choose a familiar but less obvious answer that still works for casual players.",
  hard:
    "Difficulty target: hard. Choose a more specific or less common answer, but avoid obscure trivia.",
} as const;

const distinctiveClueRules = (hasCelebrityCategory = false) => [
  "- The imposter clue must be one or two words.",
  "- Optimize for a natural clue that gives the imposter a believable talking angle without directly revealing the answer.",
  "- Good clues are often cause/effect, use, setting, risk, sensation, material, behavior, or situation related.",
  "- Good examples: sunscreen -> burn, sunscreen -> beach, flag -> wind, dough -> elasticity, volcano -> pressure, passport -> border, chess -> strategy, desert -> thirst, piano -> rhythm, camera -> memory, library -> silence, hospital -> recovery, detective -> suspicion, umbrella -> forecast, train -> schedule, airport -> departure, jungle -> humidity, diamond -> pressure, prison -> escape, wedding -> promise, castle -> royalty.",
  "- Bad examples: sunscreen -> edge, baby goat -> talisman, desert kangaroo -> talisman, sushi -> roll, pizza -> cheese, passport -> document, hospital -> doctor, banana -> fruit, pencil -> school, knife -> kitchen.",
  "- Avoid generic places unless the place is one of the most natural, specific, and useful associations for the exact word; for example, sunscreen -> beach is acceptable, but pencil -> school is too generic.",
  "- Do not use a synonym, translation, direct category, or any meaningful text contained in the answer.",
  "- The clue should help the imposter talk naturally, but should not let regular players guess the answer immediately.",
  hasCelebrityCategory
    ? "- For Celebrities, prefer recognizable traits, visual trademarks, symbols, or public persona clues, such as Leo Tolstoy -> beard."
    : null,
  hasCelebrityCategory
    ? "- For Celebrities, avoid using the person's most famous work as the clue unless no better iconic trait exists."
    : null,
  "- The clue must not use hyphens, slashes, punctuation-heavy text, or more than two words.",
];

export const buildPrompt = (
  input: RoundWordRequest,
  varietyKey: string,
  alreadyPlayedWords: readonly string[],
  popularityScope: PopularityScope = selectPopularityScope(varietyKey),
) => {
  const { categoryIds, difficulty, playerCount } = input;
  const categories = categoryIds.map(categoryLabel).join(", ");
  const playedWordList = alreadyPlayedWords.length
    ? alreadyPlayedWords.join(", ")
    : "None";
  const hasCelebrityCategory = isCelebrityRequest(categoryIds);
  const hasMovieCategory = isMovieRequest(categoryIds);

  return [
    ...formatLanguageMetadataLines(input),
    `Categories: ${categories}`,
    `Difficulty: ${difficulty}`,
    `Player count: ${playerCount}`,
    `Popularity scope: ${formatPopularityScope(popularityScope)}`,
    `Variety key: ${varietyKey}`,
    `Already played secret words to avoid: ${playedWordList}`,
    "",
    `Generate one secret word and ${CANDIDATE_COUNT} imposter clue candidates for this round.`,
    "Choose a fair, broadly playable answer that casual players can discuss.",
    difficultyInstructions[difficulty],
    "",
    "Popularity rules:",
    "- If Popularity scope is International, choose something extremely famous worldwide. Most casual players should recognize it, even if they are not experts.",
    "- If Popularity scope is Local, choose something extremely famous among speakers of the requested language or people from the main culture/country associated with that language.",
    "- Do not choose obscure, niche, old, regional-only, or expert-level answers.",
    "- The answer should feel obvious and playable for a casual party game.",
    "",
    "Localization rules:",
    "- Localize naturally for real native speakers; do not directly translate if direct translation sounds weird.",
    "- The secret word must be what casual players would actually say in the selected language.",
    "- The clue must be simple, natural, and playable for normal speakers of the selected language.",
    "- Avoid stiff literal translations, rare dictionary words, overly formal wording, and awkward machine-translation phrasing.",
    "- If several translations are possible, choose the most common everyday version.",
    "- For non-English languages, do not silently return English text unless that exact title or public name is commonly used that way by speakers of the selected language.",
    "",
    "Repeat-prevention rules:",
    "- Never choose any word from the already played secret words list.",
    "- Choose a different valid word each request.",
    "- Treat minor spelling, punctuation, spacing, casing, diacritic, or transliteration differences as the same word when avoiding repeats.",
    "",
    "Category rules:",
    hasMovieCategory
      ? "- For Movies, return a well-known movie title in the requested language when there is a natural/common localized title. Otherwise use the title most commonly recognized by speakers of that language."
      : null,
    hasCelebrityCategory
      ? "- For Celebrities, return only widely recognizable public figures."
      : null,
    hasCelebrityCategory
      ? "- For Celebrities, the secret word must be a complete public name. Use first and last name or a complete multi-word stage/public name in languages that separate names with spaces; for CJK and other no-space scripts, a complete commonly recognized written public name is valid."
      : null,
    hasCelebrityCategory
      ? "- For Celebrities, never return a first name, nickname, or partial name by itself."
      : null,
    "- These rules apply to every language. Do not add special exceptions for any specific language.",
    "",
    "Clue rules:",
    ...distinctiveClueRules(hasCelebrityCategory),
    "",
    "Output rules:",
    "- Return short answers only.",
    "- Return one secret word or short phrase.",
    `- Return exactly ${CANDIDATE_COUNT} clue candidates in the clues array.`,
    "- Every clue candidate must be one or two words.",
    "- Both fields must be in the requested language, using the natural script for that language.",
    "- Treat the variety key as a random seed; do not output it.",
    "- Do not output the popularity scope.",
    "- Do not copy wording from these instructions as the answer.",
  ]
    .filter((line): line is string => line !== null)
    .join("\n");
};

const buildTranslationPrompt = (input: TranslationWordRequest) => {
  const { languageName, source } = input;
  const isAnimalTranslation = source.categoryId === "animals";

  return [
    ...formatLanguageMetadataLines(input),
    `Target language: ${languageName}`,
    `English source word: ${source.word}`,
    `English source category: ${source.categoryLabel}`,
    source.difficulty
      ? `English source difficulty: ${source.difficulty}`
      : null,
    source.sense ? `English source sense: ${source.sense}` : null,
    `English imposter clue: ${source.clue}`,
    "",
    "Translate the source word naturally for native speakers in the target language.",
    "Do not replace the source word with a different example.",
    "Localize naturally, do not directly translate if direct translation sounds weird.",
    "Use the common everyday word a native speaker would naturally say in a casual party game.",
    "Translate meaning, not spelling, and use the natural script for the target language.",
    "Prefer common native/common-use words over English spellings, loanword-looking forms, scientific names, or raw transliterations.",
    "Never transliterate the English spelling unless that transliteration is truly the normal everyday word in the target language.",
    "If the exact species/object term is uncommon or sounds borrowed, use the closest common everyday term that native speakers recognize, even if it is slightly broader.",
    isAnimalTranslation
      ? "For animals, prefer natural everyday animal names over scientific or taxonomy-level precision."
      : null,
    "If the exact English concept is awkward or uncommon in the target language, use the closest commonly used playable word in that language.",
    "If no natural playable localization exists, avoid forcing a rare or literal dictionary term.",
    "Translate the English imposter clue without generating a new clue relationship.",
    "Do not replace the source clue with a different association.",
    "Return one translated secret word or short phrase, and one translated imposter clue.",
    "The imposter clue must be one or two words. No hyphens, slashes, or punctuation-heavy text.",
    "The clue must stay distinctive, simple, common, and playable like the English source clue.",
    "If a literal clue translation sounds unnatural, choose the closest natural equivalent that preserves the same relationship.",
  ]
    .filter((line): line is string => line !== null)
    .join("\n");
};

type ParseGeneratedWordOptions = {
  alreadyPlayedWords?: readonly string[];
  categoryIds?: readonly string[];
  language?: LanguageMetadata;
  source?: { word?: string; clue?: string };
};

const isPlayedWordsArgument = (
  value: readonly string[] | ParseGeneratedWordOptions,
): value is readonly string[] => Array.isArray(value);

export const parseGeneratedWord = (
  value: RoundWordResponse,
  alreadyPlayedWordsOrOptions: readonly string[] | ParseGeneratedWordOptions =
    [],
  categoryIds: readonly string[] = [],
): RoundWordResponse => {
  const options: ParseGeneratedWordOptions =
    isPlayedWordsArgument(alreadyPlayedWordsOrOptions)
      ? { alreadyPlayedWords: alreadyPlayedWordsOrOptions, categoryIds }
      : alreadyPlayedWordsOrOptions;
  const parsedCategoryIds = options.categoryIds ?? [];
  const parsedAlreadyPlayedWords = options.alreadyPlayedWords ?? [];
  const parsedWord = responseSchema.parse({
    word: normalizeGeneratedText(value.word),
    clue: normalizeGeneratedText(value.clue),
  });

  if (
    isCelebrityRequest(parsedCategoryIds) &&
    !hasPlayableCelebrityAnswer(parsedWord.word, options.language)
  ) {
    throw new Error("OpenAI returned an incomplete celebrity name");
  }

  if (options.language && !isEnglishLanguage(options.language)) {
    assertNotUnchangedEnglishSource({
      word: parsedWord.word,
      clue: parsedWord.clue,
      source: options.source,
      language: options.language,
    });
    assertExpectedScriptForField({
      field: "word",
      value: parsedWord.word,
      language: options.language,
      categoryIds: parsedCategoryIds,
    });
    assertExpectedScriptForField({
      field: "clue",
      value: parsedWord.clue,
      language: options.language,
      categoryIds: parsedCategoryIds,
    });
  }

  if (isAlreadyPlayedWord(parsedWord.word, parsedAlreadyPlayedWords)) {
    throw new Error("OpenAI returned an already played round word");
  }

  return parsedWord;
};

export const isPassingClueQuality = (quality: ClueQuality) =>
  quality.verdict === "pass" &&
  quality.relatedness >= 4 &&
  quality.naturalness >= 4 &&
  quality.revealRisk <= 3 &&
  quality.genericness <= 3 &&
  quality.stretchiness <= 2;

export const scoreClueQuality = (quality: ClueQuality) =>
  quality.relatedness * 3 +
  quality.naturalness * 2 -
  quality.revealRisk * 2 -
  quality.genericness -
  quality.stretchiness * 3;

export const getUniqueClueCandidates = (clues: readonly string[]) => {
  const seenClues = new Set<string>();

  return clues
    .map(normalizeGeneratedText)
    .filter((clue) => {
      const clueKey = normalizeForCloseness(clue);

      if (!clueKey || seenClues.has(clueKey)) {
        return false;
      }

      seenClues.add(clueKey);
      return true;
    });
};

const getClueJudgmentKey = (clue: string) => normalizeForCloseness(clue);

export const parseClueQualityJudgments = (
  value: unknown,
  submittedClues: readonly string[],
): ClueQualityJudgment[] => {
  const parsed = clueQualityBatchSchema.safeParse(value);

  if (!parsed.success) {
    throw new Error("OpenAI returned malformed clue quality judgments");
  }

  if (parsed.data.judgments.length !== submittedClues.length) {
    throw new Error(
      "OpenAI returned an incomplete clue quality judgment batch",
    );
  }

  const submittedClueKeys = new Set(
    submittedClues.map(getClueJudgmentKey).filter(Boolean),
  );
  const seenJudgmentKeys = new Set<string>();

  for (const judgment of parsed.data.judgments) {
    const judgmentKey = getClueJudgmentKey(judgment.clue);

    if (!judgmentKey || !submittedClueKeys.has(judgmentKey)) {
      throw new Error("OpenAI judged a clue that was not submitted");
    }

    if (seenJudgmentKeys.has(judgmentKey)) {
      throw new Error("OpenAI returned duplicate clue quality judgments");
    }

    seenJudgmentKeys.add(judgmentKey);
  }

  return parsed.data.judgments;
};

export const buildClueBatchJudgePrompt = ({
  word,
  clues,
  languageName,
  categoryLabel,
}: {
  word: string;
  clues: readonly string[];
  languageName: string;
  categoryLabel: string;
}) =>
  [
    `Language: ${languageName}`,
    `Category: ${categoryLabel}`,
    `Secret word: ${word}`,
    `Candidate clues: ${JSON.stringify(clues)}`,
    "",
    "Return one judgment for every submitted candidate clue, using the exact clue string in each judgment.",
    "Use 1-5 integer scores.",
    "relatedness: 5 means clearly and naturally connected to the exact word.",
    "naturalness: 5 means an imposter could easily say something believable from it in the first round.",
    "revealRisk: 5 means it gives away the answer too directly.",
    "genericness: 5 means it is only a broad category, generic place, hypernym, ingredient, occupant, or obvious component.",
    "stretchiness: 5 means the connection needs weird, poetic, niche, or cultural-trivia reasoning.",
    "Pass only if relatedness >= 4, naturalness >= 4, revealRisk <= 3, genericness <= 3, and stretchiness <= 2.",
  ].join("\n");

export function selectBestGeneratedClue({
  candidateWord,
  alreadyPlayedWords = [],
  categoryIds = [],
  language,
}: {
  candidateWord: AiWordCandidatesResponse;
  alreadyPlayedWords?: readonly string[];
  categoryIds?: readonly string[];
  language?: LanguageMetadata;
}): RoundWordResponse {
  let lastError: unknown;
  const locallyValidCandidates: {
    candidate: RoundWordResponse;
    score: number;
  }[] = [];

  for (const clue of getUniqueClueCandidates(candidateWord.clues)) {
    try {
      const parsedWord = parseGeneratedWord(
        {
          word: candidateWord.word,
          clue,
        },
        {
          alreadyPlayedWords,
          categoryIds,
          language,
        },
      );
      const tokenCount =
        normalizeForCloseness(parsedWord.clue).split(" ").filter(Boolean)
          .length;
      const letterCount = [...parsedWord.clue].filter((character) =>
        /\p{L}/u.test(character)
      ).length;
      locallyValidCandidates.push({
        candidate: parsedWord,
        score: (tokenCount === 1 ? 4 : 0) - Math.abs(letterCount - 8),
      });
    } catch (error) {
      lastError = error;
    }
  }

  if (!locallyValidCandidates.length) {
    throw lastError instanceof Error
      ? lastError
      : new Error("OpenAI returned no locally valid clue candidates");
  }

  locallyValidCandidates.sort((left, right) => right.score - left.score);
  return locallyValidCandidates[0].candidate;
}

export const GENERATION_SYSTEM_PROMPT = [
  "You generate safe, family-friendly words for a pass-and-play Imposter party game.",
  "Regular players see the secret word. The imposter sees only the clue.",
  "The imposter clue must be one or two simple, common words and related through a distinctive association.",
  "Use properties, uses, behavior, shape links, visual traits, iconic traits, or cultural associations that are playable in conversation.",
  "Never use generic categories, synonyms, translations, common places, or text from the answer.",
  'Never make the clue category-level or place-level, such as "animal", "food", "school", or "kitchen".',
  "If a typical player could guess the word immediately from the clue, make the clue less direct.",
  "If an imposter could not use the clue in conversation, make the clue simpler and more common.",
  "Avoid adult content, slurs, gore, politics, religion, tragedies, and obscure niche references.",
  "Avoid multi-sentence output, punctuation-heavy answers, translations, romanization, and explanations.",
  "Use proper nouns only when the chosen category naturally asks for them.",
].join(" ");

export type GeneratedRoundResult = {
  word: RoundWordResponse;
  provider: Omit<ProviderResult<unknown>, "value">;
};

export const createGenerationProviderPrompt = (
  input: RoundWordRequest,
  model: AllowedModel,
  varietyKey = createVarietyKey(1),
): ProviderPrompt => ({
  model,
  systemPrompt: GENERATION_SYSTEM_PROMPT,
  userPrompt: buildPrompt(
    input,
    varietyKey,
    getAlreadyPlayedWords(input),
    selectPopularityScope(varietyKey),
  ),
});

export async function generateRoundWord(
  input: RoundWordRequest,
  provider: RoundProvider,
  model: AllowedModel,
  signal: AbortSignal,
  preparedPrompt = createGenerationProviderPrompt(input, model),
): Promise<GeneratedRoundResult> {
  const alreadyPlayedWords = getAlreadyPlayedWords(input);
  const response = await provider.generate({
    ...preparedPrompt,
    signal,
  });
  const word = selectBestGeneratedClue({
    candidateWord: response.value,
    alreadyPlayedWords,
    categoryIds: input.categoryIds,
    language: input,
  });
  const { value: _value, ...providerMetadata } = response;
  return { word, provider: providerMetadata };
}

export const TRANSLATION_SYSTEM_PROMPT = [
  "You translate words for a pass-and-play Imposter party game.",
  "Regular players see the secret word. The imposter sees only the clue.",
  "The output must be in the requested target language and natural script.",
  "The imposter clue must be one or two simple, common words and stay distinctively related to the secret word.",
  "Never return explanations, romanization, punctuation-heavy answers, or multi-sentence output.",
].join(" ");

export const createTranslationProviderPrompt = (
  input: TranslationWordRequest,
  model: AllowedModel,
): ProviderPrompt => ({
  model,
  systemPrompt: TRANSLATION_SYSTEM_PROMPT,
  userPrompt: buildTranslationPrompt(input),
});

export async function translateStaticWord(
  input: TranslationWordRequest,
  provider: RoundProvider,
  model: AllowedModel,
  signal: AbortSignal,
  preparedPrompt = createTranslationProviderPrompt(input, model),
): Promise<GeneratedRoundResult> {
  const response = await provider.translate({ ...preparedPrompt, signal });
  const word = parseGeneratedWord(response.value, {
    alreadyPlayedWords: input.playedWords,
    language: input,
    source: input.source,
  });
  const { value: _value, ...providerMetadata } = response;
  return { word, provider: providerMetadata };
}

export type HandlerDependencies = {
  env?: EnvGetter;
  createPersistence?: (signal: AbortSignal) => RoundPersistence;
  createProvider?: (apiKey: string) => RoundProvider;
  now?: () => Date;
  verifyAttestation?: typeof verifyAttestation;
  verifyAssertion?: typeof verifyAssertion;
  deadlineMs?: number;
};

const isTruthyEnv = (value: string) => /^(?:1|true|yes|on)$/iu.test(value);

const getRequiredEnv = (env: EnvGetter, name: string) => {
  const value = env(name);
  if (!value) {
    throw new ApiError(
      503,
      "service_unavailable",
      "The generation service is unavailable",
    );
  }
  return value;
};

const parseCsv = (value: string) =>
  value.split(",").map((item) => item.trim()).filter(Boolean);

const getAppIdentity = (env: EnvGetter): AppIdentity => {
  const environment = env("APP_ATTEST_ENVIRONMENT") || "production";
  if (environment !== "production" && environment !== "development") {
    throw new ApiError(
      503,
      "service_unavailable",
      "The generation service is unavailable",
    );
  }
  const defaultCategories = environment === "production" ? "2,4" : "3";
  const configuredCategories = env("APP_ATTEST_ALLOWED_VALIDATION_CATEGORIES");
  const categories = parseCsv(configuredCategories || defaultCategories)
    .map((value) => Number(value));
  if (
    !categories.length ||
    new Set(categories).size !== categories.length ||
    categories.some((value) =>
      !Number.isInteger(value) || value < 1 || value > 10 ||
      [7, 8, 9].includes(value)
    )
  ) {
    throw new ApiError(
      503,
      "service_unavailable",
      "The generation service is unavailable",
    );
  }
  const configuredVersions = env("APP_ATTEST_ALLOWED_BUNDLE_VERSIONS");
  const allowedBundleVersions = parseCsv(configuredVersions || "3");
  if (
    !allowedBundleVersions.length ||
    allowedBundleVersions.some((value) => !/^\d+(?:\.\d+)*$/u.test(value))
  ) {
    throw new ApiError(
      503,
      "service_unavailable",
      "The generation service is unavailable",
    );
  }
  const requireExtensions = env("APP_ATTEST_REQUIRE_IDENTITY_EXTENSIONS");
  if (
    requireExtensions &&
    !/^(?:0|1|false|true|no|yes|off|on)$/iu.test(requireExtensions)
  ) {
    throw new ApiError(
      503,
      "service_unavailable",
      "The generation service is unavailable",
    );
  }
  return {
    appIdPrefix: getRequiredEnv(env, "APPLE_APP_ID_PREFIX"),
    bundleId: getRequiredEnv(env, "APPLE_BUNDLE_ID"),
    environment,
    requireIdentityExtensions: isTruthyEnv(requireExtensions),
    allowedBundleVersions,
    allowedValidationCategories: categories,
  };
};

const normalizeAddress = (value: string | null | undefined) => {
  const address = value?.trim().toLocaleLowerCase();
  return address && /^[0-9a-f:.]{3,64}$/u.test(address) ? address : "";
};

export const getClientFingerprint = (request: Request) => {
  const forwardedFor = request.headers.get("x-forwarded-for")?.split(",").at(
    -1,
  );
  const address = normalizeAddress(request.headers.get("cf-connecting-ip")) ||
    normalizeAddress(request.headers.get("x-real-ip")) ||
    normalizeAddress(forwardedFor) || "unknown";
  const userAgent = request.headers.get("user-agent")?.trim().slice(0, 512) ||
    "unknown";
  return `${address}\n${userAgent}`;
};

export const getLegacyRequestKeyHash = async (
  request: Request,
  salt: string,
) => {
  if (!salt) {
    throw new ApiError(
      503,
      "service_unavailable",
      "The generation service is unavailable",
    );
  }
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(salt),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = new Uint8Array(
    await crypto.subtle.sign(
      "HMAC",
      key,
      new TextEncoder().encode(getClientFingerprint(request)),
    ),
  );
  return [...signature].map((byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
};

const getString = (result: RpcResult, ...names: string[]) => {
  for (const name of names) {
    if (typeof result[name] === "string") return result[name] as string;
  }
  return undefined;
};

const getNumber = (result: RpcResult, ...names: string[]) => {
  for (const name of names) {
    if (typeof result[name] === "number") return result[name] as number;
  }
  return undefined;
};

const mapControlStatus = (
  result: RpcResult,
  integrityWasInvalid = false,
): never => {
  switch (result.status) {
    case "disabled":
      throw new ApiError(
        503,
        "generation_disabled",
        "Round generation is temporarily disabled",
      );
    case "rate_limited":
    case "challenge_limited":
      throw new ApiError(429, "rate_limited", "Too many requests");
    case "concurrency_limited":
      throw new ApiError(
        429,
        "concurrency_limited",
        "Too many rounds are being generated",
      );
    case "conflict":
    case "idempotency_expired":
      throw new ApiError(
        409,
        "idempotency_conflict",
        "The request ID conflicts with another request",
      );
    case "in_progress":
      throw new ApiError(
        409,
        "request_in_progress",
        "This request is already in progress",
      );
    case "attestation_required":
      throw new ApiError(
        401,
        integrityWasInvalid ? "integrity_invalid" : "integrity_required",
        integrityWasInvalid
          ? "App integrity validation failed"
          : "App integrity is required",
      );
    case "attestation_invalid":
    case "key_revoked":
      throw new ApiError(
        401,
        "integrity_invalid",
        "App integrity validation failed",
      );
    case "invalid_request":
      throw new ApiError(400, "invalid_request", "The request is invalid");
    default:
      throw new ApiError(
        503,
        "service_unavailable",
        "The generation service is unavailable",
      );
  }
};

const failedReplayError = (result: RpcResult) => {
  const code = getString(result, "error_code");
  switch (code) {
    case "provider_timeout":
      return new ApiError(504, "provider_timeout", "The provider timed out");
    case "budget_exhausted":
      return new ApiError(
        429,
        "budget_exhausted",
        "The generation budget is exhausted",
      );
    case "rate_limited":
      return new ApiError(429, "rate_limited", "Too many requests");
    case "concurrency_limited":
      return new ApiError(
        429,
        "concurrency_limited",
        "Too many rounds are being generated",
      );
    case "generation_disabled":
      return new ApiError(
        503,
        "generation_disabled",
        "Round generation is temporarily disabled",
      );
    case "integrity_required":
      return new ApiError(
        401,
        "integrity_required",
        "App integrity is required",
      );
    case "integrity_invalid":
      return new ApiError(
        401,
        "integrity_invalid",
        "App integrity validation failed",
      );
    case "service_unavailable":
      return new ApiError(
        503,
        "service_unavailable",
        "The generation service is unavailable",
      );
    default:
      return new ApiError(502, "provider_failure", "Round generation failed");
  }
};

const parseLease = (result: RpcResult): Lease => {
  const executionId = getString(result, "execution_id");
  const leaseToken = getString(result, "lease_token");
  const leaseFence = getNumber(result, "lease_fence");
  if (!executionId || !leaseToken || !Number.isSafeInteger(leaseFence)) {
    throw new ApiError(
      503,
      "service_unavailable",
      "The generation service is unavailable",
    );
  }
  return { executionId, leaseToken, leaseFence: leaseFence! };
};

const challengeResponse = (result: RpcResult) => {
  const challengeId = getString(result, "challengeId", "challenge_id");
  const challenge = getString(result, "challenge");
  const expiresAt = getString(result, "expiresAt", "expires_at");
  if (!challengeId || !challenge || !expiresAt) {
    throw new ApiError(
      503,
      "service_unavailable",
      "The generation service is unavailable",
    );
  }
  return { challengeId, challenge, expiresAt };
};

const actionForLegacy = (
  value: LegacyRoundWordRequest | LegacyTranslationWordRequest,
) =>
  value.mode === "translate-word"
    ? "translate-word" as const
    : "generate-round" as const;

const isV2Request = (
  value: WireRequest,
): value is ChallengeEnvelope | RegisterEnvelope | PaidEnvelope =>
  "version" in value && value.version === 2;

const isV2PaidRequest = (
  value: PaidEnvelope | LegacyRoundWordRequest | LegacyTranslationWordRequest,
): value is PaidEnvelope => "version" in value && value.version === 2;

const assertActionHeader = (
  actionHeader: ReturnType<typeof getRequestActionHeader>,
  parsed: WireRequest,
) => {
  const action = isV2Request(parsed) ? parsed.action : actionForLegacy(parsed);
  if (isV2Request(parsed) && !actionHeader) {
    throw new ApiError(
      400,
      "invalid_request",
      "X-Imposter-Action is required for version 2",
    );
  }
  if (actionHeader && actionHeader !== action) {
    throw new ApiError(
      400,
      "invalid_request",
      "X-Imposter-Action does not match the request",
    );
  }
};

const assertRequestIdHeader = (request: Request, parsed: WireRequest) => {
  if (!isV2Request(parsed)) return;
  if (request.headers.get("x-request-id")?.trim() !== parsed.requestId) {
    throw new ApiError(
      400,
      "invalid_request",
      "X-Request-Id must match the version 2 request body",
    );
  }
};

const getDefaultPersistence = (env: EnvGetter, signal: AbortSignal) => {
  const secretKey = getSupabaseSecretKey(env);
  if (!secretKey) {
    throw new ApiError(
      503,
      "service_unavailable",
      "The generation service is unavailable",
    );
  }
  return new SupabaseRoundPersistence(
    getRequiredEnv(env, "SUPABASE_URL"),
    secretKey,
    signal,
  );
};

const handleChallenge = async ({
  request,
  envelope,
  persistence,
  env,
}: {
  request: Request;
  envelope: ChallengeEnvelope;
  persistence: RoundPersistence;
  env: EnvGetter;
}) => {
  const keyIdHash = await getKeyIdHash(envelope.keyId);
  let requestKeyHash: string;
  if (envelope.purpose === "register") {
    requestKeyHash = await getLegacyRequestKeyHash(
      request,
      getRequiredEnv(env, "AI_ROUND_RATE_LIMIT_SALT"),
    );
  } else {
    const key = await persistence.getAttestKey(keyIdHash);
    if (!key || key.status !== "active") {
      throw new ApiError(
        401,
        "integrity_invalid",
        "App integrity validation failed",
      );
    }
    requestKeyHash = keyIdHash;
  }
  const result = await persistence.issueChallenge({
    purpose: envelope.purpose === "register" ? "attest" : "assert",
    requestKeyHash,
    keyIdHash,
    ...(envelope.payloadHash
      ? { payloadHashHex: base64UrlDigestToHex(envelope.payloadHash) }
      : {}),
    idempotencyKey: envelope.requestId,
  });
  if (!["issued", "replayed"].includes(result.status)) mapControlStatus(result);
  return challengeResponse(result);
};

const handleRegistration = async ({
  request,
  envelope,
  persistence,
  env,
  now,
  verifier,
}: {
  request: Request;
  envelope: RegisterEnvelope;
  persistence: RoundPersistence;
  env: EnvGetter;
  now: Date;
  verifier: typeof verifyAttestation;
}) => {
  const identity = getAppIdentity(env);
  const teamId = getRequiredEnv(env, "APPLE_TEAM_ID");
  const requestKeyHash = await getLegacyRequestKeyHash(
    request,
    getRequiredEnv(env, "AI_ROUND_RATE_LIMIT_SALT"),
  );
  const keyIdHash = await getKeyIdHash(envelope.keyId);
  let verified;
  try {
    verified = await verifier({
      attestation: envelope.attestation,
      challenge: envelope.challenge,
      keyId: envelope.keyId,
      identity,
      now,
    });
  } catch (error) {
    if (error instanceof AppAttestVerificationError) {
      throw new ApiError(
        401,
        "integrity_invalid",
        "App integrity validation failed",
      );
    }
    throw error;
  }
  const result = await persistence.registerAttestKey({
    keyIdHash,
    publicKeyBase64: verified.publicKeySpki,
    receiptBase64: verified.receipt,
    bundleId: identity.bundleId,
    teamId,
    environment: identity.environment,
    challengeId: envelope.challengeId,
    challenge: envelope.challenge,
    requestKeyHash,
    idempotencyKey: envelope.requestId,
  });
  if (result.status !== "registered") mapControlStatus(result);
  return { registered: true };
};

const reservationError = (result: RpcResult): ApiError => {
  if (result.status === "disabled") {
    return new ApiError(
      503,
      "generation_disabled",
      "Round generation is temporarily disabled",
    );
  }
  if (result.status === "quota_exhausted") {
    const scope = getString(result, "scope") || "";
    return scope.includes("cost")
      ? new ApiError(
        429,
        "budget_exhausted",
        "The generation budget is exhausted",
      )
      : new ApiError(429, "rate_limited", "Too many model calls");
  }
  if (result.status === "already_reserved" || result.status === "reserved") {
    return new ApiError(
      502,
      "provider_failure",
      "A prior provider call may already exist",
    );
  }
  return new ApiError(
    503,
    "service_unavailable",
    "The generation service is unavailable",
  );
};

const safelyFailRequest = async (
  persistence: RoundPersistence,
  lease: Lease,
  errorCode: string,
) => {
  try {
    await persistence.failRequest({ ...lease, errorCode });
  } catch { /* best effort */ }
};

const handlePaidRequest = async ({
  request,
  parsed,
  rawBody,
  persistence,
  createProvider,
  env,
  signal,
  assertionVerifier,
  onIntegrityInvalid,
}: {
  request: Request;
  parsed: PaidEnvelope | LegacyRoundWordRequest | LegacyTranslationWordRequest;
  rawBody: unknown;
  persistence: RoundPersistence;
  createProvider: () => RoundProvider;
  env: EnvGetter;
  signal: AbortSignal;
  assertionVerifier: typeof verifyAssertion;
  onIntegrityInvalid: () => void;
}): Promise<{ body: RoundWordResponse; integrityInvalid: boolean }> => {
  const isV2 = isV2PaidRequest(parsed);
  const action = isV2 ? parsed.action : actionForLegacy(parsed);
  const rawPayload = isV2 && rawBody && typeof rawBody === "object"
    ? (rawBody as Record<string, unknown>).payload
    : rawBody;
  const payloadHash = await getPayloadHash(rawPayload);
  const payloadHashHex = await sha256Hex(canonicalJson(rawPayload));
  const requestId = isV2
    ? parsed.requestId
    : request.headers.get("x-request-id")?.trim().match(
      /^[A-Za-z0-9_-]{8,128}$/u,
    )?.[0] ||
      crypto.randomUUID();
  const normalized = normalizePaidPayload(
    action,
    isV2 ? parsed.payload : parsed,
  );
  const legacyRequestKeyHash = await getLegacyRequestKeyHash(
    request,
    getRequiredEnv(env, "AI_ROUND_RATE_LIMIT_SALT"),
  );
  const requestKeyHash = legacyRequestKeyHash;
  let attestInput: {
    attestKeyIdHash: string;
    attestChallengeId: string;
    attestChallenge: string;
    attestPreviousCounter: number;
    attestNewCounter: number;
  } | undefined;
  let integrityInvalid = false;

  if (
    isV2 && parsed.keyId && parsed.challengeId && parsed.challenge &&
    parsed.assertion
  ) {
    try {
      const keyIdHash = await getKeyIdHash(parsed.keyId);
      const key = await persistence.getAttestKey(keyIdHash);
      if (!key || key.status !== "active") {
        throw new AppAttestVerificationError("App Attest key is not active");
      }
      const identity = getAppIdentity(env);
      if (key.environment !== identity.environment) {
        throw new AppAttestVerificationError(
          "App Attest key environment does not match",
        );
      }
      const verified = await assertionVerifier({
        assertion: parsed.assertion,
        signedData: createAppAttestSignedData({
          action,
          requestId,
          challengeId: parsed.challengeId,
          challenge: parsed.challenge,
          payloadHash,
        }),
        publicKeySpki: key.publicKeyBase64,
        previousSignCount: key.assertionCounter,
        identity,
        allowEqualSignCount: true,
      });
      attestInput = {
        attestKeyIdHash: keyIdHash,
        attestChallengeId: parsed.challengeId,
        attestChallenge: parsed.challenge,
        attestPreviousCounter: key.assertionCounter,
        attestNewCounter: verified.signCount,
      };
    } catch (error) {
      if (!(error instanceof AppAttestVerificationError)) throw error;
      integrityInvalid = true;
      onIntegrityInvalid();
    }
  }

  const admission = await persistence.beginRequest({
    requestKeyHash,
    idempotencyKey: requestId,
    payloadHashHex,
    mode: action,
    ...attestInput,
  });
  if (getString(admission, "attestation_status") === "invalid") {
    integrityInvalid = true;
    onIntegrityInvalid();
  }
  if (admission.status === "completed") {
    const response = admission.response;
    if (!response || typeof response !== "object") {
      throw new ApiError(
        503,
        "service_unavailable",
        "The generation service is unavailable",
      );
    }
    const parsedResponse = responseSchema.safeParse(response);
    if (!parsedResponse.success) {
      throw new ApiError(
        503,
        "service_unavailable",
        "The generation service is unavailable",
      );
    }
    return { body: parsedResponse.data, integrityInvalid };
  }
  if (admission.status === "failed") throw failedReplayError(admission);
  if (admission.status !== "accepted") {
    mapControlStatus(admission, integrityInvalid);
  }
  const lease = parseLease(admission);

  let model: AllowedModel;
  let prompt: ProviderPrompt;
  let operation: "generation" | "translation";
  try {
    if (normalized.mode === "translate-word") {
      model = getTranslationModel(env);
      prompt = createTranslationProviderPrompt(normalized, model);
      operation = "translation";
    } else {
      model = getRoundGenerationModel(normalized, env);
      prompt = createGenerationProviderPrompt(normalized, model);
      operation = "generation";
    }
  } catch {
    await safelyFailRequest(persistence, lease, "service_unavailable");
    throw new ApiError(
      503,
      "service_unavailable",
      "The generation service is unavailable",
    );
  }
  const reservation = getProviderReservation(operation, prompt);
  const reserved = await persistence.reserveModelCall({
    ...lease,
    stage: operation,
    model,
    callUnits: reservation.callUnits,
    maxOutputTokens: reservation.maxOutputTokens,
  });
  if (reserved.status !== "reserved" || reserved.duplicate !== false) {
    const error = reservationError(reserved);
    await safelyFailRequest(persistence, lease, error.code);
    throw error;
  }
  const callId = getString(reserved, "call_id");
  if (!callId) {
    await safelyFailRequest(persistence, lease, "service_unavailable");
    throw new ApiError(
      503,
      "service_unavailable",
      "The generation service is unavailable",
    );
  }

  let generated: GeneratedRoundResult;
  try {
    assertWithinDeadline(signal);
    const provider = createProvider();
    generated = normalized.mode === "translate-word"
      ? await translateStaticWord(normalized, provider, model, signal, prompt)
      : await generateRoundWord(normalized, provider, model, signal, prompt);
  } catch (error) {
    const timedOut = signal.aborted ||
      (error instanceof Error &&
        (error.name === "AbortError" || error.name === "TimeoutError"));
    const code = timedOut ? "provider_timeout" : "provider_failure";
    try {
      await persistence.recordModelCall({ ...lease, callId, status: "failed" });
    } catch { /* best effort */ }
    await safelyFailRequest(persistence, lease, code);
    throw new ApiError(
      timedOut ? 504 : 502,
      code,
      timedOut ? "The provider timed out" : "Round generation failed",
    );
  }

  const providerRequestIdHash = generated.provider.requestId
    ? await sha256Hex(generated.provider.requestId)
    : undefined;
  const recorded = await persistence.recordModelCall({
    ...lease,
    callId,
    status: "completed",
    ...(generated.provider.inputTokens === undefined
      ? {}
      : { inputTokens: generated.provider.inputTokens }),
    ...(generated.provider.outputTokens === undefined
      ? {}
      : { outputTokens: generated.provider.outputTokens }),
    ...(providerRequestIdHash ? { providerRequestIdHash } : {}),
  });
  if (recorded.status !== "recorded") {
    await safelyFailRequest(persistence, lease, "service_unavailable");
    throw new ApiError(
      503,
      "service_unavailable",
      "The generation service is unavailable",
    );
  }
  const completed = await persistence.completeRequest({
    ...lease,
    response: generated.word,
  });
  if (completed.status !== "completed") {
    throw new ApiError(
      503,
      "service_unavailable",
      "The generation service is unavailable",
    );
  }
  return { body: generated.word, integrityInvalid };
};

export const createHandler = (dependencies: HandlerDependencies = {}) => {
  const env = dependencies.env ?? getEnv;
  return {
    async fetch(request: Request) {
      const corsOrigins = env("AI_ROUND_CORS_ORIGINS");
      if (request.method === "OPTIONS") {
        return new Response(null, {
          status: 204,
          headers: getCorsHeaders(request, corsOrigins),
        });
      }
      if (request.method !== "POST") {
        return errorResponse(
          request,
          new ApiError(405, "method_not_allowed", "Only POST is supported"),
          corsOrigins,
        );
      }
      const deadline = createDeadlineSignal(dependencies.deadlineMs ?? 10_000);
      let integrityInvalid = false;
      try {
        if (isTruthyEnv(env("AI_ROUND_HARD_DISABLED"))) {
          throw new ApiError(
            503,
            "generation_disabled",
            "Round generation is temporarily disabled",
          );
        }
        const actionHeader = getRequestActionHeader(request);
        const { value: rawBody } = await readJsonBody(
          request,
          getStreamingBodyLimit(request),
          deadline.signal,
        );
        const parsedResult = wireRequestSchema.safeParse(rawBody);
        if (!parsedResult.success) {
          throw new ApiError(400, "invalid_request", "The request is invalid");
        }
        const parsed = parsedResult.data;
        assertActionHeader(actionHeader, parsed);
        assertRequestIdHeader(request, parsed);
        assertWithinDeadline(deadline.signal);
        const persistence = dependencies.createPersistence?.(deadline.signal) ??
          getDefaultPersistence(env, deadline.signal);

        if (isV2Request(parsed) && parsed.action === "challenge") {
          const body = await handleChallenge({
            request,
            envelope: parsed,
            persistence,
            env,
          });
          return jsonResponse(request, body, 200, corsOrigins);
        }
        if (isV2Request(parsed) && parsed.action === "register") {
          const body = await handleRegistration({
            request,
            envelope: parsed,
            persistence,
            env,
            now: dependencies.now?.() ?? new Date(),
            verifier: dependencies.verifyAttestation ?? verifyAttestation,
          });
          return jsonResponse(request, body, 200, corsOrigins);
        }
        const apiKey = getRequiredEnv(env, "OPENAI_API_KEY");
        const result = await handlePaidRequest({
          request,
          parsed: parsed as
            | PaidEnvelope
            | LegacyRoundWordRequest
            | LegacyTranslationWordRequest,
          rawBody,
          persistence,
          createProvider: () =>
            dependencies.createProvider?.(apiKey) ??
              new OpenAIRoundProvider(apiKey),
          env,
          signal: deadline.signal,
          assertionVerifier: dependencies.verifyAssertion ?? verifyAssertion,
          onIntegrityInvalid: () => {
            integrityInvalid = true;
          },
        });
        integrityInvalid = result.integrityInvalid;
        return jsonResponse(
          request,
          result.body,
          200,
          corsOrigins,
          integrityInvalid ? { "X-Imposter-Integrity": "invalid" } : {},
        );
      } catch (error) {
        if (deadline.signal.aborted && !(error instanceof ApiError)) {
          return errorResponse(
            request,
            new ApiError(
              503,
              "service_unavailable",
              "The generation service timed out",
            ),
            corsOrigins,
            integrityInvalid ? { "X-Imposter-Integrity": "invalid" } : {},
          );
        }
        if (error instanceof PersistenceError) {
          return errorResponse(
            request,
            new ApiError(
              503,
              "service_unavailable",
              "The generation service is unavailable",
            ),
            corsOrigins,
            integrityInvalid ? { "X-Imposter-Integrity": "invalid" } : {},
          );
        }
        return errorResponse(
          request,
          error,
          corsOrigins,
          integrityInvalid ? { "X-Imposter-Integrity": "invalid" } : {},
        );
      } finally {
        deadline.dispose();
      }
    },
  };
};

export default createHandler();
