import type {
  GeneratePayload,
  LanguageId,
  LegacyRoundWordRequest,
  LegacyTranslationWordRequest,
  PaidPayload,
  RoundWordRequest,
  TranslatePayload,
  TranslationWordRequest,
} from "./contracts.ts";
import { ApiError } from "./http.ts";
import { getCanonicalLanguageMetadata } from "./languages.ts";
import {
  getStaticWordEntry,
  resolveLegacyStaticWordEntry,
} from "./static-data.ts";

const getLanguage = (languageId: LanguageId) => {
  const language = getCanonicalLanguageMetadata(languageId);
  if (!language) {
    throw new ApiError(400, "invalid_request", "The language is not supported");
  }
  return language as {
    languageId: LanguageId;
    languageName: string;
    languageNativeName: string;
    languageScriptHint: string;
  };
};

export const normalizeGeneratePayload = (
  payload: GeneratePayload | LegacyRoundWordRequest,
): RoundWordRequest => {
  const categoryId = "categoryId" in payload
    ? payload.categoryId
    : payload.categoryIds[0];

  return {
    mode: "generate-round",
    categoryIds: [categoryId],
    difficulty: payload.difficulty,
    playerCount: payload.playerCount,
    playedWords: payload.playedWords,
    ...getLanguage(payload.languageId),
  };
};

export const normalizeTranslatePayload = (
  payload: TranslatePayload | LegacyTranslationWordRequest,
): TranslationWordRequest => {
  const entry = "sourceEntryId" in payload
    ? getStaticWordEntry(payload.sourceEntryId)
    : resolveLegacyStaticWordEntry(payload.source);

  if (!entry) {
    throw new ApiError(
      400,
      "invalid_request",
      "The static source entry is not recognized",
    );
  }

  return {
    mode: "translate-word",
    playedWords: payload.playedWords,
    source: {
      word: entry.word,
      clue: entry.clue,
      categoryId: entry.categoryId,
      categoryLabel: entry.categoryLabel,
      difficulty: entry.difficulty,
      ...(entry.sense ? { sense: entry.sense } : {}),
    },
    ...getLanguage(payload.languageId),
  };
};

export const normalizePaidPayload = (
  action: "generate-round" | "translate-word",
  payload:
    | GeneratePayload
    | TranslatePayload
    | LegacyRoundWordRequest
    | LegacyTranslationWordRequest,
): PaidPayload =>
  action === "translate-word"
    ? normalizeTranslatePayload(
      payload as TranslatePayload | LegacyTranslationWordRequest,
    )
    : normalizeGeneratePayload(
      payload as GeneratePayload | LegacyRoundWordRequest,
    );
