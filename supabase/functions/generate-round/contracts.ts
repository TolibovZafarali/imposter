import { z } from "npm:zod@4.4.3";
import { isCanonicalAppAttestKeyId } from "./encoding.ts";
import { getCanonicalLanguageMetadata } from "./languages.ts";

export const APP_ATTEST_PROTOCOL = "imposter-app-attest-v1";
export const FUNCTION_PATH = "/functions/v1/generate-round";
export const MAX_REQUEST_BYTES = 64 * 1024;
export const MAX_CHALLENGE_REQUEST_BYTES = 2 * 1024;
export const MAX_PAID_REQUEST_BYTES = 16 * 1024;
export const MAX_REGISTER_REQUEST_BYTES = 64 * 1024;
export const MAX_PLAYED_WORDS = 64;
export const MAX_PLAYED_WORDS_BYTES = 2 * 1024;
export const MAX_PROMPT_PLAYED_WORDS = 50;

export const CATEGORY_IDS = [
  "activities",
  "animals",
  "celebrities",
  "food",
  "movies",
  "objects",
  "places",
  "sports",
] as const;
export const DYNAMIC_CATEGORY_IDS = ["celebrities", "movies"] as const;
export const STATIC_CATEGORY_IDS = [
  "activities",
  "animals",
  "food",
  "objects",
  "places",
  "sports",
] as const;

export const LANGUAGE_IDS = [
  "afrikaans",
  "albanian",
  "amharic",
  "arabic",
  "armenian",
  "assamese",
  "aymara",
  "azerbaijani",
  "bambara",
  "basque",
  "belarusian",
  "bengali",
  "bhojpuri",
  "bosnian",
  "bulgarian",
  "burmese",
  "catalan",
  "cebuano",
  "chinese-simplified",
  "chinese-traditional",
  "corsican",
  "croatian",
  "czech",
  "danish",
  "dhivehi",
  "dogri",
  "dutch",
  "english",
  "esperanto",
  "estonian",
  "ewe",
  "filipino",
  "finnish",
  "french",
  "frisian",
  "galician",
  "georgian",
  "german",
  "greek",
  "guarani",
  "gujarati",
  "haitian-creole",
  "hausa",
  "hawaiian",
  "hebrew",
  "hindi",
  "hmong",
  "hungarian",
  "icelandic",
  "igbo",
  "ilocano",
  "indonesian",
  "irish",
  "italian",
  "japanese",
  "javanese",
  "kannada",
  "kazakh",
  "khmer",
  "kinyarwanda",
  "konkani",
  "korean",
  "krio",
  "kurdish-kurmanji",
  "kurdish-sorani",
  "kyrgyz",
  "lao",
  "latin",
  "latvian",
  "lingala",
  "lithuanian",
  "luganda",
  "luxembourgish",
  "macedonian",
  "maithili",
  "malagasy",
  "malay",
  "malayalam",
  "maltese",
  "maori",
  "marathi",
  "meiteilon",
  "mizo",
  "mongolian",
  "nepali",
  "norwegian",
  "nyanja",
  "odia",
  "oromo",
  "pashto",
  "persian",
  "polish",
  "portuguese",
  "punjabi",
  "quechua",
  "romanian",
  "russian",
  "samoan",
  "sanskrit",
  "scots-gaelic",
  "sepedi",
  "serbian",
  "sesotho",
  "shona",
  "sindhi",
  "sinhala",
  "slovak",
  "slovenian",
  "somali",
  "spanish",
  "sundanese",
  "swahili",
  "swedish",
  "tajik",
  "tamil",
  "tatar",
  "telugu",
  "thai",
  "tigrinya",
  "tsonga",
  "turkish",
  "turkmen",
  "twi",
  "ukrainian",
  "urdu",
  "uyghur",
  "uzbek",
  "vietnamese",
  "welsh",
  "xhosa",
  "yiddish",
  "yoruba",
  "zulu",
] as const;

export type CategoryId = (typeof CATEGORY_IDS)[number];
export type LanguageId = (typeof LANGUAGE_IDS)[number];
export type PaidAction = "generate-round" | "translate-word";
export type AttestPurpose = "register" | PaidAction;

export const getCanonicalLanguageName = (languageId: LanguageId) => {
  const language = getCanonicalLanguageMetadata(languageId);
  if (!language) throw new TypeError("Unsupported language ID");
  return language.languageName;
};

export const getCanonicalCategoryLabel = (categoryId: CategoryId) =>
  categoryId.charAt(0).toUpperCase() + categoryId.slice(1);

const safeText = (max: number) =>
  z.string().trim().min(1).max(max).refine((value) =>
    // deno-lint-ignore no-control-regex
    !/[\u0000-\u001f\u007f]/u.test(value)
  );
const requestIdSchema = z.string().uuid();
const challengeIdSchema = z.string().uuid();
const keyIdSchema = z.string().refine(isCanonicalAppAttestKeyId, {
  message: "App Attest key ID must be canonical standard Base64 for 32 bytes",
});
const challengeSchema = z.string().length(43).regex(/^[A-Za-z0-9_-]{43}$/u);
const base64Schema = (max: number) =>
  z.string().trim().min(4).max(max).regex(/^[A-Za-z0-9+/_=-]+$/u);
const payloadHashSchema = z.string().length(43).regex(/^[A-Za-z0-9_-]{43}$/u);
const difficultySchema = z.enum(["easy", "medium", "hard"]);
const languageIdSchema = z.enum(LANGUAGE_IDS);
const dynamicCategoryIdSchema = z.enum(DYNAMIC_CATEGORY_IDS);
const staticCategoryIdSchema = z.enum(STATIC_CATEGORY_IDS);
const playedWordsSchema = z.array(safeText(42))
  .max(MAX_PLAYED_WORDS)
  .superRefine((words, context) => {
    const byteLength = words.reduce(
      (total, word) => total + new TextEncoder().encode(word).byteLength,
      0,
    );
    if (byteLength > MAX_PLAYED_WORDS_BYTES) {
      context.addIssue({ code: "custom", message: "playedWords is too large" });
    }
  })
  .transform((words) => {
    const seen = new Set<string>();
    return words.filter((word) => {
      const key = word.normalize("NFKC").toLocaleLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  })
  .default([]);

const legacyLanguageMetadataShape = {
  languageId: languageIdSchema,
  languageName: safeText(80).optional(),
  languageNativeName: safeText(120).optional(),
  languageScriptHint: safeText(120).optional(),
} as const;

export const roundWordRequestSchema = z.object({
  mode: z.literal("generate-round").optional(),
  categoryIds: z.tuple([dynamicCategoryIdSchema]),
  difficulty: difficultySchema.default("easy"),
  ...legacyLanguageMetadataShape,
  playerCount: z.number().int().min(3).max(10),
  playedWords: playedWordsSchema,
}).strict();

export const translationRequestSchema = z.object({
  mode: z.literal("translate-word"),
  ...legacyLanguageMetadataShape,
  playedWords: playedWordsSchema,
  source: z.object({
    word: safeText(42),
    clue: safeText(42),
    categoryId: staticCategoryIdSchema,
    categoryLabel: safeText(80).optional(),
    difficulty: difficultySchema.optional(),
    sense: safeText(160).optional(),
  }).strict(),
}).strict();

export const generatePayloadSchema = z.object({
  categoryId: dynamicCategoryIdSchema,
  difficulty: difficultySchema,
  languageId: languageIdSchema,
  playerCount: z.number().int().min(3).max(10),
  playedWords: playedWordsSchema,
}).strict();

export const translatePayloadSchema = z.object({
  mode: z.literal("translate-word"),
  languageId: languageIdSchema,
  playedWords: playedWordsSchema,
  sourceEntryId: safeText(128).regex(/^[a-z0-9-]+$/u),
}).strict();

export const legacyPayloadSchema = z.union([
  translationRequestSchema,
  roundWordRequestSchema,
]);
export const v2PaidPayloadSchema = z.union([
  translatePayloadSchema,
  generatePayloadSchema,
]);

export const challengeEnvelopeSchema = z.object({
  version: z.literal(2),
  action: z.literal("challenge"),
  requestId: requestIdSchema,
  keyId: keyIdSchema,
  purpose: z.enum(["register", "generate-round", "translate-word"]),
  payloadHash: payloadHashSchema.optional(),
}).strict().superRefine((value, context) => {
  if (value.purpose !== "register" && !value.payloadHash) {
    context.addIssue({
      code: "custom",
      message: "Paid challenges require payloadHash",
    });
  }
  if (value.purpose === "register" && value.payloadHash) {
    context.addIssue({
      code: "custom",
      message: "Registration challenges cannot bind payloadHash",
    });
  }
});

export const registerEnvelopeSchema = z.object({
  version: z.literal(2),
  action: z.literal("register"),
  requestId: requestIdSchema,
  keyId: keyIdSchema,
  challengeId: challengeIdSchema,
  challenge: challengeSchema,
  attestation: base64Schema(60 * 1024),
}).strict();

const paidEnvelopeBaseSchema = z.object({
  version: z.literal(2),
  requestId: requestIdSchema,
  challengeId: challengeIdSchema.optional(),
  challenge: challengeSchema.optional(),
  keyId: keyIdSchema.optional(),
  assertion: base64Schema(8 * 1024).optional(),
});

const requireCompleteIntegrityTuple = (
  value: {
    challengeId?: string;
    challenge?: string;
    keyId?: string;
    assertion?: string;
  },
  context: z.RefinementCtx,
) => {
  const supplied =
    [value.challengeId, value.challenge, value.keyId, value.assertion]
      .filter(Boolean).length;
  if (supplied !== 0 && supplied !== 4) {
    context.addIssue({
      code: "custom",
      message: "Integrity fields must be supplied together",
    });
  }
};

export const generateEnvelopeSchema = paidEnvelopeBaseSchema.extend({
  action: z.literal("generate-round"),
  payload: generatePayloadSchema,
}).strict().superRefine(requireCompleteIntegrityTuple);

export const translateEnvelopeSchema = paidEnvelopeBaseSchema.extend({
  action: z.literal("translate-word"),
  payload: translatePayloadSchema,
}).strict().superRefine(requireCompleteIntegrityTuple);

export const paidEnvelopeSchema = z.union([
  generateEnvelopeSchema,
  translateEnvelopeSchema,
]);
export const wireRequestSchema = z.union([
  challengeEnvelopeSchema,
  registerEnvelopeSchema,
  paidEnvelopeSchema,
  translationRequestSchema,
  roundWordRequestSchema,
]);

export type LanguageMetadata = {
  languageId: LanguageId;
  languageName: string;
  languageNativeName: string;
  languageScriptHint: string;
};
export type LegacyRoundWordRequest = z.infer<typeof roundWordRequestSchema>;
export type LegacyTranslationWordRequest = z.infer<
  typeof translationRequestSchema
>;
export type GeneratePayload = z.infer<typeof generatePayloadSchema>;
export type TranslatePayload = z.infer<typeof translatePayloadSchema>;
export type RoundWordRequest = {
  mode: "generate-round";
  categoryIds: [(typeof DYNAMIC_CATEGORY_IDS)[number]];
  difficulty: z.infer<typeof difficultySchema>;
  playerCount: number;
  playedWords: string[];
} & LanguageMetadata;
export type TranslationWordRequest = {
  mode: "translate-word";
  playedWords: string[];
  source: {
    word: string;
    clue: string;
    categoryId: (typeof STATIC_CATEGORY_IDS)[number];
    categoryLabel: string;
    difficulty: z.infer<typeof difficultySchema>;
    sense?: string;
  };
} & LanguageMetadata;
export type PaidPayload = RoundWordRequest | TranslationWordRequest;
export type ChallengeEnvelope = z.infer<typeof challengeEnvelopeSchema>;
export type RegisterEnvelope = z.infer<typeof registerEnvelopeSchema>;
export type PaidEnvelope = z.infer<typeof paidEnvelopeSchema>;
export type WireRequest = z.infer<typeof wireRequestSchema>;

export const getWireRequestMaxBytes = (request: WireRequest) => {
  if (
    "version" in request && request.version === 2 &&
    request.action === "challenge"
  ) {
    return MAX_CHALLENGE_REQUEST_BYTES;
  }
  if (
    "version" in request && request.version === 2 &&
    request.action === "register"
  ) {
    return MAX_REGISTER_REQUEST_BYTES;
  }
  return MAX_PAID_REQUEST_BYTES;
};

const canonicalizeJsonValue = (value: unknown): unknown => {
  if (
    value === null || typeof value === "string" || typeof value === "boolean"
  ) {
    return value;
  }

  if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) {
      throw new TypeError("Canonical JSON accepts safe integers only");
    }
    return value;
  }

  if (Array.isArray(value)) {
    return value.map(canonicalizeJsonValue);
  }

  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    return Object.fromEntries(
      Object.keys(record)
        .filter((key) => record[key] !== undefined)
        .sort()
        .map((key) => [key, canonicalizeJsonValue(record[key])]),
    );
  }

  throw new TypeError("Canonical JSON accepts JSON values only");
};

export const canonicalJson = (value: unknown) =>
  JSON.stringify(canonicalizeJsonValue(value));

const bytesToBase64Url = (bytes: Uint8Array) => {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/gu, "-").replace(/\//gu, "_").replace(
    /=+$/u,
    "",
  );
};

const bytesToHex = (bytes: Uint8Array) =>
  [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");

const digestBytes = async (value: string | Uint8Array) => {
  const bytes = typeof value === "string"
    ? new TextEncoder().encode(value)
    : value;
  return new Uint8Array(
    await crypto.subtle.digest("SHA-256", bytes.slice().buffer),
  );
};

export const sha256Base64Url = async (value: string | Uint8Array) => {
  return bytesToBase64Url(await digestBytes(value));
};

export const sha256Hex = async (value: string | Uint8Array) =>
  bytesToHex(await digestBytes(value));

export const base64UrlDigestToHex = (value: string) => {
  if (!/^[A-Za-z0-9_-]{43}$/u.test(value)) {
    throw new TypeError("Digest must be unpadded base64url SHA-256");
  }
  const normalized = value.replace(/-/gu, "+").replace(/_/gu, "/") + "=";
  const bytes = Uint8Array.from(
    atob(normalized),
    (character) => character.charCodeAt(0),
  );
  if (bytes.byteLength !== 32) {
    throw new TypeError("Digest must contain 32 bytes");
  }
  return bytesToHex(bytes);
};

export const getPayloadHash = (payload: unknown) =>
  sha256Base64Url(canonicalJson(payload));

export const createAppAttestSignedData = ({
  action,
  requestId,
  challengeId,
  challenge,
  payloadHash,
}: {
  action: PaidAction;
  requestId: string;
  challengeId: string;
  challenge: string;
  payloadHash: string;
}) =>
  [
    APP_ATTEST_PROTOCOL,
    FUNCTION_PATH,
    action,
    requestId,
    challengeId,
    challenge,
    payloadHash,
  ].join("\n");
