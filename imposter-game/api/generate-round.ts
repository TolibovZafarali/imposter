import OpenAI from 'openai';
import { zodTextFormat } from 'openai/helpers/zod';
import { z } from 'zod';

const DEFAULT_MODEL = 'gpt-5.4-mini';
const DEFAULT_LOCALIZATION_MODEL = 'gpt-5.4';
export const MAX_DYNAMIC_GENERATION_ATTEMPTS = 3;
export const MAX_TRANSLATION_ATTEMPTS = 3;
export const CANDIDATE_COUNT = 8;
const difficultySchema = z.enum(['easy', 'medium', 'hard']);
const playedWordSchema = z.string().trim().min(1).max(42);
const languageMetadataSchema = {
  languageId: z.string().trim().min(1).max(80),
  languageName: z.string().trim().min(1).max(80),
  languageNativeName: z.string().trim().min(1).max(120).optional(),
  languageScriptHint: z.string().trim().min(1).max(120).optional(),
} as const;

const createDefaultOpenAIClient = (apiKey: string) => new OpenAI({ apiKey });
let createOpenAIClient = createDefaultOpenAIClient;

export const setOpenAIClientFactoryForTesting = (factory?: (apiKey: string) => OpenAI) => {
  createOpenAIClient = factory ?? createDefaultOpenAIClient;
};

const roundWordRequestSchema = z.object({
  mode: z.literal('generate-round').optional(),
  categoryIds: z.array(z.string().trim().min(1).max(40)).min(1).max(3),
  difficulty: difficultySchema.default('easy'),
  ...languageMetadataSchema,
  playerCount: z.number().int().min(3).max(10),
  playedWords: z.array(playedWordSchema).default([]),
});

const translationRequestSchema = z.object({
  mode: z.literal('translate-word'),
  ...languageMetadataSchema,
  playedWords: z.array(playedWordSchema).default([]),
  source: z.object({
    word: z.string().trim().min(1).max(42),
    clue: z.string().trim().min(1).max(42),
    categoryId: z.string().trim().min(1).max(40),
    categoryLabel: z.string().trim().min(1).max(80),
    difficulty: difficultySchema.optional(),
    sense: z.string().trim().min(1).max(160).optional(),
  }),
});

const staticWordRequestSchema = z.object({
  mode: z.literal('prepare-static-word'),
  ...languageMetadataSchema,
  playedWords: z.array(playedWordSchema).default([]),
  source: z.object({
    word: z.string().trim().min(1).max(42),
    categoryId: z.string().trim().min(1).max(40),
    categoryLabel: z.string().trim().min(1).max(80),
    difficulty: difficultySchema.optional(),
    sense: z.string().trim().min(1).max(160).optional(),
    storedClue: z.string().trim().min(1).max(42).optional(),
  }),
});

const requestSchema = z.union([translationRequestSchema, staticWordRequestSchema, roundWordRequestSchema]);

const aiWordSchema = z.object({
  word: z.string(),
  clue: z.string(),
});

const aiWordCandidatesSchema = z.object({
  word: z.string(),
  clues: z.array(z.string()).length(CANDIDATE_COUNT),
});

const clueQualitySchema = z.object({
  relatedness: z.number().int().min(1).max(5),
  naturalness: z.number().int().min(1).max(5),
  revealRisk: z.number().int().min(1).max(5),
  genericness: z.number().int().min(1).max(5),
  stretchiness: z.number().int().min(1).max(5),
  verdict: z.enum(['pass', 'fail']),
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
    .normalize('NFD')
    .replace(/\p{M}+/gu, '')
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .replace(/\s+/g, ' ');

type LanguageMetadata = {
  languageId: string;
  languageName: string;
  languageNativeName?: string;
  languageScriptHint?: string;
};

type ScriptProfile = {
  label: string;
  promptHint: string;
  pattern: RegExp;
  allowsNoSpaceCelebrityNames?: boolean;
};

const scriptProfiles = {
  arabic: {
    label: 'Arabic script',
    promptHint: 'Arabic script for normal words and clues',
    pattern: /\p{Script=Arabic}/u,
  },
  armenian: {
    label: 'Armenian script',
    promptHint: 'Armenian script for normal words and clues',
    pattern: /\p{Script=Armenian}/u,
  },
  bengali: {
    label: 'Bengali script',
    promptHint: 'Bengali script for normal words and clues',
    pattern: /\p{Script=Bengali}/u,
  },
  cjk: {
    label: 'CJK script',
    promptHint: 'the natural CJK writing system for this language',
    pattern: /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u,
    allowsNoSpaceCelebrityNames: true,
  },
  cyrillic: {
    label: 'Cyrillic script',
    promptHint: 'Cyrillic script for normal words and clues',
    pattern: /\p{Script=Cyrillic}/u,
  },
  devanagari: {
    label: 'Devanagari script',
    promptHint: 'Devanagari script for normal words and clues',
    pattern: /\p{Script=Devanagari}/u,
  },
  ethiopic: {
    label: 'Ethiopic script',
    promptHint: 'Ethiopic script for normal words and clues',
    pattern: /\p{Script=Ethiopic}/u,
  },
  georgian: {
    label: 'Georgian script',
    promptHint: 'Georgian script for normal words and clues',
    pattern: /\p{Script=Georgian}/u,
  },
  greek: {
    label: 'Greek script',
    promptHint: 'Greek script for normal words and clues',
    pattern: /\p{Script=Greek}/u,
  },
  gujarati: {
    label: 'Gujarati script',
    promptHint: 'Gujarati script for normal words and clues',
    pattern: /\p{Script=Gujarati}/u,
  },
  gurmukhi: {
    label: 'Gurmukhi script',
    promptHint: 'Gurmukhi script for normal words and clues',
    pattern: /\p{Script=Gurmukhi}/u,
  },
  hebrew: {
    label: 'Hebrew script',
    promptHint: 'Hebrew script for normal words and clues',
    pattern: /\p{Script=Hebrew}/u,
  },
  khmer: {
    label: 'Khmer script',
    promptHint: 'Khmer script for normal words and clues',
    pattern: /\p{Script=Khmer}/u,
  },
  lao: {
    label: 'Lao script',
    promptHint: 'Lao script for normal words and clues',
    pattern: /\p{Script=Lao}/u,
  },
  myanmar: {
    label: 'Myanmar script',
    promptHint: 'Myanmar script for normal words and clues',
    pattern: /\p{Script=Myanmar}/u,
  },
  sinhala: {
    label: 'Sinhala script',
    promptHint: 'Sinhala script for normal words and clues',
    pattern: /\p{Script=Sinhala}/u,
  },
  tamil: {
    label: 'Tamil script',
    promptHint: 'Tamil script for normal words and clues',
    pattern: /\p{Script=Tamil}/u,
  },
  telugu: {
    label: 'Telugu script',
    promptHint: 'Telugu script for normal words and clues',
    pattern: /\p{Script=Telugu}/u,
  },
  thai: {
    label: 'Thai script',
    promptHint: 'Thai script for normal words and clues',
    pattern: /\p{Script=Thai}/u,
  },
} as const satisfies Record<string, ScriptProfile>;

const scriptProfileByLanguageId = new Map<string, ScriptProfile>([
  ['amharic', scriptProfiles.ethiopic],
  ['arabic', scriptProfiles.arabic],
  ['armenian', scriptProfiles.armenian],
  ['assamese', scriptProfiles.bengali],
  ['belarusian', scriptProfiles.cyrillic],
  ['bengali', scriptProfiles.bengali],
  ['bhojpuri', scriptProfiles.devanagari],
  ['bulgarian', scriptProfiles.cyrillic],
  ['burmese', scriptProfiles.myanmar],
  ['chinese-simplified', scriptProfiles.cjk],
  ['chinese-traditional', scriptProfiles.cjk],
  ['dhivehi', scriptProfiles.arabic],
  ['dogri', scriptProfiles.devanagari],
  ['georgian', scriptProfiles.georgian],
  ['greek', scriptProfiles.greek],
  ['gujarati', scriptProfiles.gujarati],
  ['hebrew', scriptProfiles.hebrew],
  ['hindi', scriptProfiles.devanagari],
  ['japanese', scriptProfiles.cjk],
  ['kannada', {
    label: 'Kannada script',
    promptHint: 'Kannada script for normal words and clues',
    pattern: /\p{Script=Kannada}/u,
  }],
  ['kazakh', scriptProfiles.cyrillic],
  ['khmer', scriptProfiles.khmer],
  ['konkani', scriptProfiles.devanagari],
  ['korean', scriptProfiles.cjk],
  ['kurdish-sorani', scriptProfiles.arabic],
  ['kyrgyz', scriptProfiles.cyrillic],
  ['lao', scriptProfiles.lao],
  ['macedonian', scriptProfiles.cyrillic],
  ['maithili', scriptProfiles.devanagari],
  ['malayalam', {
    label: 'Malayalam script',
    promptHint: 'Malayalam script for normal words and clues',
    pattern: /\p{Script=Malayalam}/u,
  }],
  ['marathi', scriptProfiles.devanagari],
  ['mongolian', scriptProfiles.cyrillic],
  ['nepali', scriptProfiles.devanagari],
  ['odia', {
    label: 'Odia script',
    promptHint: 'Odia script for normal words and clues',
    pattern: /\p{Script=Oriya}/u,
  }],
  ['pashto', scriptProfiles.arabic],
  ['persian', scriptProfiles.arabic],
  ['punjabi', scriptProfiles.gurmukhi],
  ['russian', scriptProfiles.cyrillic],
  ['sanskrit', scriptProfiles.devanagari],
  ['serbian', scriptProfiles.cyrillic],
  ['sindhi', scriptProfiles.arabic],
  ['sinhala', scriptProfiles.sinhala],
  ['tajik', scriptProfiles.cyrillic],
  ['tamil', scriptProfiles.tamil],
  ['tatar', scriptProfiles.cyrillic],
  ['telugu', scriptProfiles.telugu],
  ['thai', scriptProfiles.thai],
  ['tigrinya', scriptProfiles.ethiopic],
  ['ukrainian', scriptProfiles.cyrillic],
  ['urdu', scriptProfiles.arabic],
  ['uyghur', scriptProfiles.arabic],
  ['yiddish', scriptProfiles.hebrew],
]);

const getLanguageScriptProfile = (language: LanguageMetadata): ScriptProfile | null => {
  const languageId = language.languageId.trim().toLocaleLowerCase();
  const explicitHint = language.languageScriptHint?.trim().toLocaleLowerCase();

  if (explicitHint) {
    const hintedProfile = Object.values(scriptProfiles).find((profile) =>
      explicitHint.includes(profile.label.toLocaleLowerCase().replace(' script', ''))
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
    return Object.values(scriptProfiles).find((profile) => profile.pattern.test(nativeName)) ?? null;
  }

  return null;
};

const getLanguageScriptHint = (language: LanguageMetadata) =>
  language.languageScriptHint?.trim() ||
  getLanguageScriptProfile(language)?.promptHint ||
  'the writing system real native speakers normally use for this language';

const formatLanguageMetadataLines = (language: LanguageMetadata) => [
  `Language ID: ${language.languageId}`,
  `Language name: ${language.languageName}`,
  language.languageNativeName ? `Native language name: ${language.languageNativeName}` : null,
  `Expected writing system: ${getLanguageScriptHint(language)}`,
];

const hasLatinLetters = (value: string) => /\p{Script=Latin}/u.test(value);

const countExpectedScriptLetters = (value: string, profile: ScriptProfile) =>
  Array.from(value).filter((character) => profile.pattern.test(character)).length;

const isLikelyGlobalProperNoun = (value: string) => {
  const tokens = value.match(/[\p{L}\p{N}]+/gu) ?? [];

  return hasLatinLetters(value) && (tokens.length > 1 || /[A-Z]/.test(value));
};

const categoryClueTokens = new Set([
  'animal',
  'athlete',
  'bird',
  'building',
  'celebrity',
  'city',
  'country',
  'device',
  'drink',
  'film',
  'food',
  'game',
  'instrument',
  'job',
  'meal',
  'movie',
  'object',
  'person',
  'place',
  'plant',
  'school',
  'song',
  'sport',
  'story',
  'structure',
  'tool',
  'vehicle',
  'work',
]);

const genericPlaceClueTokens = new Set([
  'airport',
  'bar',
  'cafe',
  'class',
  'classroom',
  'college',
  'court',
  'desk',
  'farm',
  'field',
  'forest',
  'garage',
  'garden',
  'gym',
  'home',
  'house',
  'jungle',
  'kitchen',
  'museum',
  'ocean',
  'office',
  'park',
  'pool',
  'restaurant',
  'salon',
  'school',
  'sea',
  'shelf',
  'shop',
  'sidewalk',
  'stage',
  'station',
  'store',
  'street',
  'trail',
  'workshop',
  'zoo',
]);

const genericContextClueTokens = new Set([
  'breakfast',
  'creature',
  'dessert',
  'dinner',
  'habitat',
  'land',
  'lunch',
  'mammal',
  'meal',
  'pet',
  'wild',
  'wildlife',
]);

const blockedGenericClueTokens = new Set([
  ...categoryClueTokens,
  ...genericPlaceClueTokens,
  ...genericContextClueTokens,
]);

const directHypernymClueTokens = new Set([
  'category',
  'document',
  'fruit',
  'ingredient',
  'item',
  'location',
  'thing',
]);

const unrelatedFillerClues = new Set([
  'common',
  'concept',
  'edge',
  'essence',
  'familiar',
  'general',
  'known',
  'related',
  'symbol',
  'talisman',
]);

const blockedCluePairs = new Set([
  'banana:fruit',
  'baby goat:talisman',
  'desert kangaroo:talisman',
  'hospital:doctor',
  'knife:kitchen',
  'passport:document',
  'pencil:school',
  'pizza:cheese',
  'sunscreen:edge',
  'sushi:roll',
]);

const getCluePairKey = (word: string, clue: string) =>
  `${normalizeForCloseness(word)}:${normalizeForCloseness(clue)}`;

const getClueTokens = (clue: string) =>
  normalizeForCloseness(clue).split(' ').filter(Boolean);

const disallowedClueSeparatorPattern = /[-\u2010-\u2015/\\|_]/u;

const hasPunctuationHeavyClue = (clue: string) => {
  const punctuation = clue.match(/[^\p{L}\p{M}\p{N}\s'’]/gu) ?? [];

  return punctuation.length > 2 || punctuation.join('').length > Math.max(2, Math.floor(clue.length / 4));
};

const hasShortPhraseClue = (clue: string) => {
  const clueTokens = normalizeForCloseness(clue).split(' ').filter(Boolean);

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

  return getClueTokens(clue).some((token) => blockedGenericClueTokens.has(token));
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

  const wordTokens = normalizedWord.split(' ');
  const clueTokens = normalizedClue.split(' ');
  const sharesMeaningfulToken = clueTokens.some(
    (clueToken) => clueToken.length >= 4 && wordTokens.includes(clueToken)
  );

  if (sharesMeaningfulToken) {
    return true;
  }

  return (
    Math.min(normalizedWord.length, normalizedClue.length) >= 4 &&
    (normalizedWord.includes(normalizedClue) || normalizedClue.includes(normalizedWord))
  );
};

export const hasPlayableCelebrityAnswer = (word: string, language?: LanguageMetadata) => {
  if (normalizeForCloseness(word).split(' ').filter(Boolean).length >= 2) {
    return true;
  }

  const profile = language ? getLanguageScriptProfile(language) : null;

  return Boolean(
    profile?.allowsNoSpaceCelebrityNames && countExpectedScriptLetters(word, profile) >= 2
  );
};

const isCelebrityRequest = (categoryIds: readonly string[]) => categoryIds.includes('celebrities');
const isMovieRequest = (categoryIds: readonly string[]) => categoryIds.includes('movies');
const isEnglishLanguage = ({ languageId, languageName }: LanguageMetadata) =>
  languageId === 'english' || languageName.trim().toLocaleLowerCase() === 'english';

const getEnv = (name: string) => process.env[name]?.trim() || '';

export const getRoundGenerationModel = (language: LanguageMetadata) =>
  isEnglishLanguage(language)
    ? getEnv('OPENAI_MODEL') || DEFAULT_MODEL
    : getEnv('OPENAI_LOCALIZED_GENERATION_MODEL') ||
      getEnv('OPENAI_LOCALIZATION_MODEL') ||
      getEnv('OPENAI_MODEL') ||
      DEFAULT_LOCALIZATION_MODEL;

export const getTranslationModel = () =>
  getEnv('OPENAI_TRANSLATION_MODEL') ||
  getEnv('OPENAI_LOCALIZATION_MODEL') ||
  getEnv('OPENAI_MODEL') ||
  DEFAULT_LOCALIZATION_MODEL;

const canUseGlobalLatinTitleOrName = (word: string, categoryIds: readonly string[]) =>
  (isMovieRequest(categoryIds) || isCelebrityRequest(categoryIds)) && isLikelyGlobalProperNoun(word);

const assertExpectedScriptForField = ({
  field,
  value,
  language,
  categoryIds,
}: {
  field: 'word' | 'clue';
  value: string;
  language: LanguageMetadata;
  categoryIds: readonly string[];
}) => {
  const profile = getLanguageScriptProfile(language);

  if (!profile || profile.pattern.test(value)) {
    return;
  }

  if (field === 'word' && canUseGlobalLatinTitleOrName(value, categoryIds)) {
    return;
  }

  if (hasLatinLetters(value)) {
    throw new Error(
      `OpenAI returned English/Latin-only ${field} text for ${language.languageName}; expected ${profile.label}`
    );
  }

  throw new Error(
    `OpenAI returned ${field} text outside the expected ${profile.label} for ${language.languageName}`
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

  const wordMatchesSource = normalizeForCloseness(word) === normalizeForCloseness(source.word);
  const clueMatchesSource = normalizeForCloseness(clue) === normalizeForCloseness(source.clue);

  if (wordMatchesSource && clueMatchesSource) {
    throw new Error('OpenAI returned unchanged English source text for a non-English round');
  }
};

const responseSchema = z
  .object({
    word: z.string().trim().min(1).max(42),
    clue: z.string().trim().min(1).max(42),
  })
  .refine((value) => hasShortPhraseClue(value.clue), {
    message: 'The clue must be one or two clean words',
    path: ['clue'],
  })
  .refine((value) => !hasGenericClue(value.word, value.clue), {
    message: 'The clue must not be generic, unrelated, or an over-direct clue',
    path: ['clue'],
  })
  .refine(
    (value) => !hasLexicallyCloseClue(value.word, value.clue),
    'The clue must be broader than and lexically separate from the word'
  );

type RoundWordRequest = z.infer<typeof roundWordRequestSchema>;
type TranslationWordRequest = z.infer<typeof translationRequestSchema>;
type StaticWordRequest = z.infer<typeof staticWordRequestSchema>;
type RoundWordResponse = z.infer<typeof responseSchema>;
type AiWordCandidatesResponse = z.infer<typeof aiWordCandidatesSchema>;
type ClueQuality = z.infer<typeof clueQualitySchema>;
type ClueQualityJudgment = z.infer<typeof clueQualityJudgmentSchema>;
export type PopularityScope = 'international' | 'local';
let serverPlayedWordsByContext = new Map<string, string[]>();

const corsHeaders = {
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Origin': '*',
  'Content-Type': 'application/json',
};

const categoryLabel = (categoryId: string) =>
  categoryId
    .split('-')
    .map((part) => part.charAt(0).toLocaleUpperCase() + part.slice(1))
    .join(' ');

const normalizeGeneratedText = (value: string) => value.trim().replace(/\s+/g, ' ');

const jsonResponse = (body: unknown, status = 200) =>
  Response.json(body, {
    status,
    headers: corsHeaders,
  });

const isAlreadyPlayedWord = (word: string, playedWords: readonly string[]) => {
  const wordKey = normalizeForCloseness(word);
  const playedWordKeys = new Set(playedWords.map(normalizeForCloseness).filter(Boolean));

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

const getPlayedWordContextKey = ({
  categoryIds,
  languageId,
  languageName,
}: Pick<RoundWordRequest, 'categoryIds' | 'languageId' | 'languageName'>) => {
  const languageKey = normalizeForCloseness(languageId) || normalizeForCloseness(languageName) || 'unknown-language';
  const categoryKey = categoryIds.map(normalizeForCloseness).filter(Boolean).sort().join('|') || 'unknown-category';

  return `${languageKey}:${categoryKey}`;
};

const getServerPlayedWords = (input: RoundWordRequest) =>
  serverPlayedWordsByContext.get(getPlayedWordContextKey(input)) ?? [];

const getAlreadyPlayedWords = (input: RoundWordRequest, extraWords: readonly string[] = []) =>
  mergeUniquePlayedWords([
    ...extraWords,
    ...input.playedWords,
    ...getServerPlayedWords(input),
  ]);

const rememberGeneratedWord = (input: RoundWordRequest, word: string) => {
  const contextKey = getPlayedWordContextKey(input);
  const playedWords = getServerPlayedWords(input);

  serverPlayedWordsByContext.set(
    contextKey,
    mergeUniquePlayedWords([word, ...playedWords.filter((playedWord) => !isAlreadyPlayedWord(word, [playedWord]))])
  );
};

const createVarietyKey = (attempt: number) =>
  `${Date.now().toString(36)}-${attempt}-${Math.random().toString(36).slice(2, 10)}`;

const hashVarietyKey = (varietyKey: string) => {
  let hash = 2166136261;

  for (const character of varietyKey) {
    hash ^= character.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 16777619);
  }

  return hash >>> 0;
};

export const selectPopularityScope = (varietyKey: string): PopularityScope =>
  hashVarietyKey(varietyKey) % 2 === 0 ? 'international' : 'local';

const formatPopularityScope = (popularityScope: PopularityScope) =>
  popularityScope === 'international' ? 'International' : 'Local to the selected language/culture';

const difficultyInstructions = {
  easy: 'Difficulty target: easy. Choose a highly familiar, everyday answer most casual players recognize immediately.',
  medium: 'Difficulty target: medium. Choose a familiar but less obvious answer that still works for casual players.',
  hard: 'Difficulty target: hard. Choose a more specific or less common answer, but avoid obscure trivia.',
} as const;

const distinctiveClueRules = (hasCelebrityCategory = false) => [
  '- The imposter clue must be one or two words.',
  '- Optimize for a natural clue that gives the imposter a believable talking angle without directly revealing the answer.',
  '- Good clues are often cause/effect, use, setting, risk, sensation, material, behavior, or situation related.',
  '- Good examples: sunscreen -> burn, sunscreen -> beach, flag -> wind, dough -> elasticity, volcano -> pressure, passport -> border, chess -> strategy, desert -> thirst, piano -> rhythm, camera -> memory, library -> silence, hospital -> recovery, detective -> suspicion, umbrella -> forecast, train -> schedule, airport -> departure, jungle -> humidity, diamond -> pressure, prison -> escape, wedding -> promise, castle -> royalty.',
  '- Bad examples: sunscreen -> edge, baby goat -> talisman, desert kangaroo -> talisman, sushi -> roll, pizza -> cheese, passport -> document, hospital -> doctor, banana -> fruit, pencil -> school, knife -> kitchen.',
  '- Avoid generic places unless the place is one of the most natural, specific, and useful associations for the exact word; for example, sunscreen -> beach is acceptable, but pencil -> school is too generic.',
  '- Do not use a synonym, translation, direct category, or any meaningful text contained in the answer.',
  '- The clue should help the imposter talk naturally, but should not let regular players guess the answer immediately.',
  hasCelebrityCategory
    ? '- For Celebrities, prefer recognizable traits, visual trademarks, symbols, or public persona clues, such as Leo Tolstoy -> beard.'
    : null,
  hasCelebrityCategory
    ? "- For Celebrities, avoid using the person's most famous work as the clue unless no better iconic trait exists."
    : null,
  '- The clue must not use hyphens, slashes, punctuation-heavy text, or more than two words.',
];

export const buildPrompt = (
  input: RoundWordRequest,
  varietyKey: string,
  alreadyPlayedWords: readonly string[],
  popularityScope: PopularityScope = selectPopularityScope(varietyKey)
) => {
  const { categoryIds, difficulty, languageName, playerCount } = input;
  const categories = categoryIds.map(categoryLabel).join(', ');
  const playedWordList = alreadyPlayedWords.length ? alreadyPlayedWords.join(', ') : 'None';
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
    '',
    `Generate one secret word and ${CANDIDATE_COUNT} imposter clue candidates for this round.`,
    'Choose a fair, broadly playable answer that casual players can discuss.',
    difficultyInstructions[difficulty],
    '',
    'Popularity rules:',
    '- If Popularity scope is International, choose something extremely famous worldwide. Most casual players should recognize it, even if they are not experts.',
    '- If Popularity scope is Local, choose something extremely famous among speakers of the requested language or people from the main culture/country associated with that language.',
    '- Do not choose obscure, niche, old, regional-only, or expert-level answers.',
    '- The answer should feel obvious and playable for a casual party game.',
    '',
    'Localization rules:',
    '- Localize naturally for real native speakers; do not directly translate if direct translation sounds weird.',
    '- The secret word must be what casual players would actually say in the selected language.',
    '- The clue must be simple, natural, and playable for normal speakers of the selected language.',
    '- Avoid stiff literal translations, rare dictionary words, overly formal wording, and awkward machine-translation phrasing.',
    '- If several translations are possible, choose the most common everyday version.',
    '- For non-English languages, do not silently return English text unless that exact title or public name is commonly used that way by speakers of the selected language.',
    '',
    'Repeat-prevention rules:',
    '- Never choose any word from the already played secret words list.',
    '- Choose a different valid word each request.',
    '- Treat minor spelling, punctuation, spacing, casing, diacritic, or transliteration differences as the same word when avoiding repeats.',
    '',
    'Category rules:',
    hasMovieCategory
      ? '- For Movies, return a well-known movie title in the requested language when there is a natural/common localized title. Otherwise use the title most commonly recognized by speakers of that language.'
      : null,
    hasCelebrityCategory
      ? '- For Celebrities, return only widely recognizable public figures.'
      : null,
    hasCelebrityCategory
      ? '- For Celebrities, the secret word must be a complete public name. Use first and last name or a complete multi-word stage/public name in languages that separate names with spaces; for CJK and other no-space scripts, a complete commonly recognized written public name is valid.'
      : null,
    hasCelebrityCategory
      ? '- For Celebrities, never return a first name, nickname, or partial name by itself.'
      : null,
    '- These rules apply to every language. Do not add special exceptions for any specific language.',
    '',
    'Clue rules:',
    ...distinctiveClueRules(hasCelebrityCategory),
    '',
    'Output rules:',
    '- Return short answers only.',
    '- Return one secret word or short phrase.',
    `- Return exactly ${CANDIDATE_COUNT} clue candidates in the clues array.`,
    '- Every clue candidate must be one or two words.',
    '- Both fields must be in the requested language, using the natural script for that language.',
    '- Treat the variety key as a random seed; do not output it.',
    '- Do not output the popularity scope.',
    '- Do not copy wording from these instructions as the answer.',
  ]
    .filter((line): line is string => line !== null)
    .join('\n');
};

export const buildStaticWordPrompt = (input: StaticWordRequest, varietyKey = createVarietyKey(0)) => {
  const { languageId, languageName, source } = input;
  const shouldTranslateWord = !isEnglishLanguage({ languageId, languageName });
  const storedClue = source.storedClue?.trim() || 'None';

  return [
    ...formatLanguageMetadataLines(input),
    `Target language: ${languageName}`,
    `English source word: ${source.word}`,
    `English source category: ${source.categoryLabel}`,
    source.difficulty ? `English source difficulty: ${source.difficulty}` : null,
    source.sense ? `English source sense: ${source.sense}` : null,
    `English source imposter clue: ${storedClue}`,
    `Variety key: ${varietyKey}`,
    '',
    shouldTranslateWord
      ? 'Translate the source word naturally for native speakers in the target language.'
      : 'Keep the source word exactly as the returned word.',
    shouldTranslateWord ? 'Do not replace the source word with a different example.' : null,
    shouldTranslateWord
      ? 'Localize naturally, do not directly translate if direct translation sounds weird.'
      : null,
    shouldTranslateWord
      ? 'Use the common everyday word a native speaker would naturally say in a casual party game.'
      : null,
    shouldTranslateWord ? 'Translate meaning, not spelling, and use the natural script for the target language.' : null,
    shouldTranslateWord
      ? 'Prefer common native/common-use words over English spellings, loanword-looking forms, scientific names, or raw transliterations.'
      : null,
    shouldTranslateWord
      ? 'Never transliterate the English spelling unless that transliteration is truly the normal everyday word in the target language.'
      : null,
    shouldTranslateWord
      ? 'If the exact term is uncommon or sounds borrowed, use the closest common everyday term that native speakers recognize, even if it is slightly broader.'
      : null,
    shouldTranslateWord
      ? 'If the source word cannot be localized into a natural playable word, do not force an awkward dictionary translation.'
      : null,
    '',
    shouldTranslateWord
      ? 'Translate the source imposter clue naturally for native speakers in the target language.'
      : 'Keep the source imposter clue exactly as the returned clue.',
    'Do not generate a fresh clue or change the clue relationship.',
    'The translated clue must preserve the same relationship as the English source clue.',
    '',
    'Output rules:',
    '- Return short answers only.',
    shouldTranslateWord
      ? '- Return one translated secret word or short phrase.'
      : '- Return the original source word as the word.',
    shouldTranslateWord
      ? '- Return one translated imposter clue.'
      : '- Return the original source imposter clue as the clue.',
    '- The clue must be one or two words.',
    '- Both fields must be in the target language, using the natural script for that language.',
    '- Treat the variety key as a random seed; do not output it.',
    '- Do not copy wording from these instructions as the answer.',
  ]
    .filter((line): line is string => line !== null)
    .join('\n');
};

const buildTranslationPrompt = (input: TranslationWordRequest) => {
  const { languageName, source } = input;
  const isAnimalTranslation = source.categoryId === 'animals';

  return [
    ...formatLanguageMetadataLines(input),
    `Target language: ${languageName}`,
    `English source word: ${source.word}`,
    `English source category: ${source.categoryLabel}`,
    source.difficulty ? `English source difficulty: ${source.difficulty}` : null,
    source.sense ? `English source sense: ${source.sense}` : null,
    `English imposter clue: ${source.clue}`,
    '',
    'Translate the source word naturally for native speakers in the target language.',
    'Do not replace the source word with a different example.',
    'Localize naturally, do not directly translate if direct translation sounds weird.',
    'Use the common everyday word a native speaker would naturally say in a casual party game.',
    'Translate meaning, not spelling, and use the natural script for the target language.',
    'Prefer common native/common-use words over English spellings, loanword-looking forms, scientific names, or raw transliterations.',
    'Never transliterate the English spelling unless that transliteration is truly the normal everyday word in the target language.',
    'If the exact species/object term is uncommon or sounds borrowed, use the closest common everyday term that native speakers recognize, even if it is slightly broader.',
    isAnimalTranslation
      ? 'For animals, prefer natural everyday animal names over scientific or taxonomy-level precision.'
      : null,
    'If the exact English concept is awkward or uncommon in the target language, use the closest commonly used playable word in that language.',
    'If no natural playable localization exists, avoid forcing a rare or literal dictionary term.',
    'Translate the English imposter clue without generating a new clue relationship.',
    'Do not replace the source clue with a different association.',
    'Return one translated secret word or short phrase, and one translated imposter clue.',
    'The imposter clue must be one or two words. No hyphens, slashes, or punctuation-heavy text.',
    'The clue must stay distinctive, simple, common, and playable like the English source clue.',
    'If a literal clue translation sounds unnatural, choose the closest natural equivalent that preserves the same relationship.',
  ]
    .filter((line): line is string => line !== null)
    .join('\n');
};

type ParseGeneratedWordOptions = {
  alreadyPlayedWords?: readonly string[];
  categoryIds?: readonly string[];
  language?: LanguageMetadata;
  source?: { word?: string; clue?: string };
};

const isPlayedWordsArgument = (
  value: readonly string[] | ParseGeneratedWordOptions
): value is readonly string[] => Array.isArray(value);

export const parseGeneratedWord = (
  value: RoundWordResponse,
  alreadyPlayedWordsOrOptions: readonly string[] | ParseGeneratedWordOptions = [],
  categoryIds: readonly string[] = []
): RoundWordResponse => {
  const options: ParseGeneratedWordOptions = isPlayedWordsArgument(alreadyPlayedWordsOrOptions)
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
    throw new Error('OpenAI returned an incomplete celebrity name');
  }

  if (options.language && !isEnglishLanguage(options.language)) {
    assertNotUnchangedEnglishSource({
      word: parsedWord.word,
      clue: parsedWord.clue,
      source: options.source,
      language: options.language,
    });
    assertExpectedScriptForField({
      field: 'word',
      value: parsedWord.word,
      language: options.language,
      categoryIds: parsedCategoryIds,
    });
    assertExpectedScriptForField({
      field: 'clue',
      value: parsedWord.clue,
      language: options.language,
      categoryIds: parsedCategoryIds,
    });
  }

  if (isAlreadyPlayedWord(parsedWord.word, parsedAlreadyPlayedWords)) {
    throw new Error('OpenAI returned an already played round word');
  }

  return parsedWord;
};

export const isPassingClueQuality = (quality: ClueQuality) =>
  quality.verdict === 'pass' &&
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
  submittedClues: readonly string[]
): ClueQualityJudgment[] => {
  const parsed = clueQualityBatchSchema.safeParse(value);

  if (!parsed.success) {
    throw new Error('OpenAI returned malformed clue quality judgments');
  }

  if (parsed.data.judgments.length !== submittedClues.length) {
    throw new Error('OpenAI returned an incomplete clue quality judgment batch');
  }

  const submittedClueKeys = new Set(submittedClues.map(getClueJudgmentKey).filter(Boolean));
  const seenJudgmentKeys = new Set<string>();

  for (const judgment of parsed.data.judgments) {
    const judgmentKey = getClueJudgmentKey(judgment.clue);

    if (!judgmentKey || !submittedClueKeys.has(judgmentKey)) {
      throw new Error('OpenAI judged a clue that was not submitted');
    }

    if (seenJudgmentKeys.has(judgmentKey)) {
      throw new Error('OpenAI returned duplicate clue quality judgments');
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
    '',
    'Return one judgment for every submitted candidate clue, using the exact clue string in each judgment.',
    'Use 1-5 integer scores.',
    'relatedness: 5 means clearly and naturally connected to the exact word.',
    'naturalness: 5 means an imposter could easily say something believable from it in the first round.',
    'revealRisk: 5 means it gives away the answer too directly.',
    'genericness: 5 means it is only a broad category, generic place, hypernym, ingredient, occupant, or obvious component.',
    'stretchiness: 5 means the connection needs weird, poetic, niche, or cultural-trivia reasoning.',
    'Pass only if relatedness >= 4, naturalness >= 4, revealRisk <= 3, genericness <= 3, and stretchiness <= 2.',
  ].join('\n');

const judgeClueBatchQuality = async ({
  openai,
  model,
  word,
  clues,
  languageName,
  categoryLabel,
}: {
  openai: OpenAI;
  model: string;
  word: string;
  clues: readonly string[];
  languageName: string;
  categoryLabel: string;
}): Promise<ClueQualityJudgment[]> => {
  const response = await openai.responses.parse({
    model,
    reasoning: {
      effort: 'none',
    },
    temperature: 0,
    max_output_tokens: 1200,
    input: [
      {
        role: 'system',
        content: [
          'You are a strict clue-quality judge for a pass-and-play Imposter party game.',
          'Regular players see the secret word. The imposter sees only the clue.',
          'Score whether the clue is clearly related, natural to talk from, not too revealing, not generic, and not a stretched association.',
          'Judge all submitted candidates in one batch.',
          'Return only the requested JSON fields.',
        ].join(' '),
      },
      {
        role: 'user',
        content: buildClueBatchJudgePrompt({ word, clues, languageName, categoryLabel }),
      },
    ],
    text: {
      format: zodTextFormat(clueQualityBatchSchema, 'imposter_clue_quality_batch'),
    },
  });

  if (!response.output_parsed) {
    throw new Error('OpenAI returned no clue quality judgments');
  }

  return parseClueQualityJudgments(response.output_parsed, clues);
};

export async function selectBestGeneratedClue({
  openai,
  model,
  candidateWord,
  alreadyPlayedWords = [],
  categoryIds = [],
  language,
  languageName,
  categoryLabel,
}: {
  openai: OpenAI;
  model: string;
  candidateWord: AiWordCandidatesResponse;
  alreadyPlayedWords?: readonly string[];
  categoryIds?: readonly string[];
  language?: LanguageMetadata;
  languageName: string;
  categoryLabel: string;
}): Promise<RoundWordResponse> {
  let bestCandidate: { word: string; clue: string; score: number } | null = null;
  let lastError: unknown;
  const locallyValidCandidates: RoundWordResponse[] = [];

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
        }
      );
      locallyValidCandidates.push(parsedWord);
    } catch (error) {
      lastError = error;
    }
  }

  if (!locallyValidCandidates.length) {
    throw lastError instanceof Error
      ? lastError
      : new Error('OpenAI returned no locally valid clue candidates');
  }

  const judgments = await judgeClueBatchQuality({
    openai,
    model,
    word: locallyValidCandidates[0].word,
    clues: locallyValidCandidates.map((candidate) => candidate.clue),
    languageName,
    categoryLabel,
  });
  const candidatesByClueKey = new Map(
    locallyValidCandidates.map((candidate) => [getClueJudgmentKey(candidate.clue), candidate])
  );

  for (const quality of judgments) {
    if (!isPassingClueQuality(quality)) {
      lastError = new Error(`Generated clue failed quality judgment: ${quality.reason}`);
      continue;
    }

    const parsedWord = candidatesByClueKey.get(getClueJudgmentKey(quality.clue));

    if (!parsedWord) {
      throw new Error('OpenAI judged a clue that was not submitted');
    }

    const score = scoreClueQuality(quality);

    if (!bestCandidate || score > bestCandidate.score) {
      bestCandidate = {
        ...parsedWord,
        score,
      };
    }
  }

  if (!bestCandidate) {
    throw lastError instanceof Error
      ? lastError
      : new Error('OpenAI returned no playable clue candidates');
  }

  return {
    word: bestCandidate.word,
    clue: bestCandidate.clue,
  };
}

async function generateRoundWord(input: RoundWordRequest): Promise<RoundWordResponse> {
  const openAiApiKey = getEnv('OPENAI_API_KEY');

  if (!openAiApiKey) {
    throw new Error('OpenAI API key is not configured');
  }

  const openai = createOpenAIClient(openAiApiKey);

  let lastError: unknown;

  for (let attempt = 0; attempt < MAX_DYNAMIC_GENERATION_ATTEMPTS; attempt += 1) {
    try {
      const varietyKey = createVarietyKey(attempt);
      const popularityScope = selectPopularityScope(varietyKey);
      const alreadyPlayedWords = getAlreadyPlayedWords(input);
      const model = getRoundGenerationModel(input);
      const response = await openai.responses.parse({
        model,
        reasoning: {
          effort: 'none',
        },
        temperature: 1,
        max_output_tokens: 260,
        input: [
          {
            role: 'system',
            content: [
              'You generate safe, family-friendly words for a pass-and-play Imposter party game.',
              'Regular players see the secret word. The imposter sees only the clue.',
              'The imposter clue must be one or two simple, common words and related through a distinctive association.',
              'Use properties, uses, behavior, shape links, visual traits, iconic traits, or cultural associations that are playable in conversation.',
              'Never use generic categories, synonyms, translations, common places, or text from the answer.',
              'Never make the clue category-level or place-level, such as "animal", "food", "school", or "kitchen".',
              'If a typical player could guess the word immediately from the clue, make the clue less direct.',
              'If an imposter could not use the clue in conversation, make the clue simpler and more common.',
              'Avoid adult content, slurs, gore, politics, religion, tragedies, and obscure niche references.',
              'Avoid multi-sentence output, punctuation-heavy answers, translations, romanization, and explanations.',
              'Use proper nouns only when the chosen category naturally asks for them.',
            ].join(' '),
          },
          {
            role: 'user',
            content: buildPrompt(input, varietyKey, alreadyPlayedWords, popularityScope),
          },
        ],
        text: {
          format: zodTextFormat(aiWordCandidatesSchema, 'imposter_round_word'),
        },
      });

      if (!response.output_parsed) {
        throw new Error('OpenAI returned no parsed round word');
      }

      const generatedWord = await selectBestGeneratedClue({
        openai,
        model,
        candidateWord: response.output_parsed,
        alreadyPlayedWords: getAlreadyPlayedWords(input),
        categoryIds: input.categoryIds,
        language: input,
        languageName: input.languageName,
        categoryLabel: input.categoryIds.map(categoryLabel).join(', '),
      });

      rememberGeneratedWord(input, generatedWord.word);

      return generatedWord;
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError instanceof Error ? lastError : new Error('OpenAI round generation failed');
}

const withStaticWordMetadata = (input: StaticWordRequest, word: RoundWordResponse, fallback = false) => ({
  ...word,
  categoryId: input.source.categoryId,
  difficulty: input.source.difficulty,
  fallback,
});

const parseStaticSourceWord = (input: StaticWordRequest): RoundWordResponse => {
  const word = normalizeGeneratedText(input.source.word);
  const clue = normalizeGeneratedText(input.source.storedClue ?? '');

  if (!word || !clue) {
    throw new Error('Static word request is missing a stored clue');
  }

  if (!hasShortPhraseClue(clue) || hasLexicallyCloseClue(word, clue)) {
    throw new Error('Static word request has an invalid stored clue');
  }

  return { word, clue };
};

export async function prepareStaticWordWithFallback(input: StaticWordRequest) {
  const sourceWord = parseStaticSourceWord(input);

  if (isEnglishLanguage(input)) {
    if (isAlreadyPlayedWord(sourceWord.word, input.playedWords ?? [])) {
      throw new Error('Static word request selected an already played word');
    }

    return withStaticWordMetadata(input, sourceWord);
  }

  return withStaticWordMetadata(
    input,
    await translateStaticWord({
      mode: 'translate-word',
      languageId: input.languageId,
      languageName: input.languageName,
      languageNativeName: input.languageNativeName,
      languageScriptHint: input.languageScriptHint,
      playedWords: input.playedWords ?? [],
      source: {
        word: sourceWord.word,
        clue: sourceWord.clue,
        categoryId: input.source.categoryId,
        categoryLabel: input.source.categoryLabel,
        difficulty: input.source.difficulty,
        sense: input.source.sense,
      },
    })
  );
}

async function translateStaticWord(input: TranslationWordRequest): Promise<RoundWordResponse> {
  const openAiApiKey = getEnv('OPENAI_API_KEY');

  if (!openAiApiKey) {
    throw new Error('OpenAI API key is not configured');
  }

  const openai = createOpenAIClient(openAiApiKey);

  let lastError: unknown;

  for (let attempt = 0; attempt < MAX_TRANSLATION_ATTEMPTS; attempt += 1) {
    try {
      const response = await openai.responses.parse({
        model: getTranslationModel(),
        reasoning: {
          effort: 'none',
        },
        temperature: 0.2,
        max_output_tokens: 160,
        input: [
          {
            role: 'system',
            content: [
              'You translate words for a pass-and-play Imposter party game.',
              'Regular players see the secret word. The imposter sees only the clue.',
              'The output must be in the requested target language and natural script.',
              'The imposter clue must be one or two simple, common words and stay distinctively related to the secret word.',
              'Never return explanations, romanization, punctuation-heavy answers, or multi-sentence output.',
            ].join(' '),
          },
          {
            role: 'user',
            content: buildTranslationPrompt(input),
          },
        ],
        text: {
          format: zodTextFormat(aiWordSchema, 'imposter_translated_word'),
        },
      });

      if (!response.output_parsed) {
        throw new Error('OpenAI returned no parsed translation');
      }

      return parseGeneratedWord(response.output_parsed, {
        alreadyPlayedWords: input.playedWords ?? [],
        language: input,
        source: input.source,
      });
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError instanceof Error ? lastError : new Error('OpenAI translation failed');
}

export default {
  async fetch(request: Request) {
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: corsHeaders,
      });
    }

    if (request.method !== 'POST') {
      return jsonResponse({ error: 'Method not allowed' }, 405);
    }

    let payload: unknown;

    try {
      payload = await request.json();
    } catch {
      return jsonResponse({ error: 'Invalid JSON body' }, 400);
    }

    const parsedRequest = requestSchema.safeParse(payload);

    if (!parsedRequest.success) {
      return jsonResponse({ error: 'Invalid round generation request' }, 400);
    }

    try {
      if (parsedRequest.data.mode === 'translate-word') {
        try {
          return jsonResponse(await translateStaticWord(parsedRequest.data));
        } catch (error) {
          return jsonResponse(
            {
              error: error instanceof Error ? error.message : 'Static word translation failed',
            },
            502
          );
        }
      }

      if (parsedRequest.data.mode === 'prepare-static-word') {
        try {
          return jsonResponse(await prepareStaticWordWithFallback(parsedRequest.data));
        } catch (error) {
          return jsonResponse(
            {
              error: error instanceof Error ? error.message : 'Static word preparation failed',
            },
            502
          );
        }
      }

      return jsonResponse(await generateRoundWord(parsedRequest.data));
    } catch {
      return jsonResponse({ error: 'Round generation failed' }, 502);
    }
  },
};
