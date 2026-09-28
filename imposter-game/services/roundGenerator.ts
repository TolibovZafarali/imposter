import { buildRound } from '../game/round.ts';
import { getLanguageOption } from '../constants/languages.ts';
import type { ImposterCount, Player, Round, RoundTimerSetting } from '../game/types.ts';
import {
  hasPlayableCelebrityAnswer,
  isEnglishLanguage,
  resolveRoundWordPlan,
  selectStaticWordEntry,
  type EnglishWordEntry,
  type DynamicCategoryId,
  type RoundWordPlan,
  type StaticCategoryId,
  type WordDifficulty,
} from '../data/wordBank.ts';
import {
  APP_ATTEST_REQUEST_TIMEOUT_MS,
  fetchWithTransportRetry,
  invalidateStoredAppAttestKey,
  prepareRoundRequest,
  type AppAttestAction,
  type JsonValue,
} from './appAttest.ts';

type GeneratedWord = {
  word: string;
  clue: string;
  translations?: { languageId: string; word: string; clue: string }[];
};

type PlayedWordContext = {
  categoryIds: readonly string[];
  languageId: string;
  languageName: string;
};

export type RoundGeneratorInput = {
  players: Player[];
  categoryIds: string[];
  difficulty: WordDifficulty;
  languageId: string;
  languageName: string;
  languageNativeName?: string;
  languageScriptHint?: string;
  additionalLanguageIds?: string[];
  imposterCount?: ImposterCount;
  isImposterHintEnabled?: boolean;
  roundTimerMinutes?: RoundTimerSetting;
  rng?: () => number;
};

export const AI_ROUND_REQUEST_TIMEOUT_MS = APP_ATTEST_REQUEST_TIMEOUT_MS;
export const MAX_PLAYED_WORD_HISTORY = 50;
export const MAX_PLAYED_ENTRY_ID_HISTORY = 50;
export const MAX_PLAYED_WORD_LENGTH = 42;
export const MAX_PLAYED_WORD_HISTORY_BYTES = 2_048;
const DEFAULT_AI_ROUND_API_URL =
  'https://wqryrqffcldnpubcgtyh.supabase.co/functions/v1/generate-round';
const EMERGENCY_STATIC_CATEGORY_ID: StaticCategoryId = 'objects';
let playedRoundWordsByContext = new Map<string, string[]>();
let playedRoundEntryIdsByContext = new Map<string, string[]>();

export const resetRoundGeneratorStateForTesting = () => {
  playedRoundWordsByContext = new Map();
  playedRoundEntryIdsByContext = new Map();
};

const emergencyDynamicWords: Record<DynamicCategoryId, readonly GeneratedWord[]> = {
  movies: [
    { word: 'Titanic', clue: 'iceberg' },
    { word: 'Avatar', clue: 'blue' },
    { word: 'The Matrix', clue: 'simulation' },
    { word: 'Frozen', clue: 'ice' },
    { word: 'Jaws', clue: 'shark' },
    { word: 'Barbie', clue: 'pink' },
    { word: 'Interstellar', clue: 'gravity' },
    { word: 'Inception', clue: 'dream' },
    { word: 'Shrek', clue: 'swamp' },
    { word: 'Spider-Man', clue: 'web' },
  ],
  celebrities: [
    { word: 'Leo Tolstoy', clue: 'beard' },
    { word: 'Taylor Swift', clue: 'eras' },
    { word: 'Cristiano Ronaldo', clue: 'siu' },
    { word: 'Lionel Messi', clue: 'dribble' },
    { word: 'Albert Einstein', clue: 'relativity' },
    { word: 'Michael Jackson', clue: 'moonwalk' },
    { word: 'Beyonce Knowles', clue: 'queen' },
    { word: 'Elon Musk', clue: 'rocket' },
    { word: 'Dwayne Johnson', clue: 'rock' },
    { word: 'Leonardo DiCaprio', clue: 'oscar' },
  ],
};

const normalizeWordKey = (value: string) =>
  value
    .normalize('NFD')
    .replace(/\p{M}+/gu, '')
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .replace(/\s+/g, ' ');

const getUtf8ByteLength = (value: string) => {
  let byteLength = 0;

  for (const character of value) {
    const codePoint = character.codePointAt(0) ?? 0;
    byteLength += codePoint <= 0x7f ? 1 : codePoint <= 0x7ff ? 2 : codePoint <= 0xffff ? 3 : 4;
  }

  return byteLength;
};

const sanitizePlayedWord = (value: string) => {
  if (/[\u0000-\u001f\u007f]/u.test(value)) {
    return null;
  }

  const characters = [...value.normalize('NFKC').trim().replace(/\s+/gu, ' ')];
  const clippedCharacters = characters.slice(0, MAX_PLAYED_WORD_LENGTH);

  while (clippedCharacters.join('').length > MAX_PLAYED_WORD_LENGTH) {
    clippedCharacters.pop();
  }

  const sanitized = clippedCharacters.join('');
  return sanitized.length > 0 ? sanitized : null;
};

export const sanitizePlayedWordHistory = (words: readonly string[]) => {
  const sanitizedWords: string[] = [];
  const seenWordKeys = new Set<string>();
  let totalByteLength = 0;

  for (const word of words) {
    const sanitized = sanitizePlayedWord(word);

    if (!sanitized) {
      continue;
    }

    const wordKey = normalizeWordKey(sanitized);

    if (!wordKey || seenWordKeys.has(wordKey)) {
      continue;
    }

    const sanitizedByteLength = getUtf8ByteLength(sanitized);

    if (totalByteLength + sanitizedByteLength > MAX_PLAYED_WORD_HISTORY_BYTES) {
      break;
    }

    sanitizedWords.push(sanitized);
    seenWordKeys.add(wordKey);
    totalByteLength += sanitizedByteLength;

    if (sanitizedWords.length >= MAX_PLAYED_WORD_HISTORY) {
      break;
    }
  }

  return sanitizedWords;
};

const isPlayedWord = (word: string, playedWords: readonly string[]) => {
  const wordKey = normalizeWordKey(word);
  const playedWordKeys = new Set(playedWords.map(normalizeWordKey).filter(Boolean));

  return playedWordKeys.has(wordKey);
};

const hashText = (value: string) => {
  let hash = 2166136261;

  for (const character of value) {
    hash ^= character.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 16777619);
  }

  return hash >>> 0;
};

const selectByTextHash = <T,>(items: readonly T[], seed: string) =>
  items[hashText(seed) % items.length];

const getEmergencyDynamicWord = (categoryId: DynamicCategoryId, seed: string) =>
  selectByTextHash(emergencyDynamicWords[categoryId], seed);

const getPlayedWordContextKeys = ({ categoryIds, languageId, languageName }: PlayedWordContext) => {
  const languageKey = normalizeWordKey(languageId) || normalizeWordKey(languageName) || 'unknown-language';

  return categoryIds.map((categoryId) => {
    const categoryKey = normalizeWordKey(categoryId) || 'unknown-category';

    return `${languageKey}:${categoryKey}`;
  });
};

const getPlayedWordsForContext = (context: PlayedWordContext) =>
  sanitizePlayedWordHistory(
    getPlayedWordContextKeys(context).flatMap((contextKey) => playedRoundWordsByContext.get(contextKey) ?? [])
  );

const getPlayedEntryIdsForContext = (context: PlayedWordContext) =>
  [
    ...new Set(
      getPlayedWordContextKeys(context).flatMap(
        (contextKey) => playedRoundEntryIdsByContext.get(contextKey) ?? []
      )
    ),
  ].slice(0, MAX_PLAYED_ENTRY_ID_HISTORY);

const rememberRoundWord = (word: string, context: PlayedWordContext, entryId?: string) => {
  for (const contextKey of getPlayedWordContextKeys(context)) {
    const playedWords = playedRoundWordsByContext.get(contextKey) ?? [];

    playedRoundWordsByContext.set(
      contextKey,
      sanitizePlayedWordHistory([
        word,
        ...playedWords.filter((playedWord) => !isPlayedWord(word, [playedWord])),
      ])
    );

    if (entryId) {
      const playedEntryIds = playedRoundEntryIdsByContext.get(contextKey) ?? [];

      playedRoundEntryIdsByContext.set(contextKey, [
        entryId,
        ...playedEntryIds.filter((playedEntryId) => playedEntryId !== entryId),
      ].slice(0, MAX_PLAYED_ENTRY_ID_HISTORY));
    }
  }
};

const getAiRoundApiUrl = () =>
  process.env.EXPO_PUBLIC_AI_ROUND_API_URL?.trim() || DEFAULT_AI_ROUND_API_URL;

const postRoundRequest = async (action: AppAttestAction, payload: JsonValue) => {
  const apiUrl = getAiRoundApiUrl();
  const preparedRequest = await prepareRoundRequest({
    apiUrl,
    action,
    payload,
  });

  const response = await fetchWithTransportRetry(
    fetch,
    apiUrl,
    preparedRequest.requestId,
    preparedRequest.body
  );
  let integrityInvalid = response.headers.get('X-Imposter-Integrity') === 'invalid';

  if (!integrityInvalid && !response.ok) {
    try {
      const errorBody: unknown = await response.clone().json();
      integrityInvalid = Boolean(
        errorBody &&
        typeof errorBody === 'object' &&
        (errorBody as Record<string, unknown>).code === 'integrity_invalid'
      );
    } catch {
      // The caller keeps the existing generic error behavior for malformed errors.
    }
  }

  if (integrityInvalid) {
    try {
      await invalidateStoredAppAttestKey();
    } catch {
      // Key cleanup is best effort and must not turn a successful round into an error.
    }
  }

  return response;
};

const isGeneratedWord = (value: unknown): value is GeneratedWord => {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const candidate = value as Record<string, unknown>;

  return (
    typeof candidate.word === 'string' &&
    candidate.word.trim().length > 0 &&
    typeof candidate.clue === 'string' &&
    candidate.clue.trim().length > 0
  );
};

const isCelebrityCategory = (categoryIds: readonly string[]) => categoryIds.includes('celebrities');

const isGeneratedWordValidForCategories = (
  generatedWord: GeneratedWord,
  categoryIds: readonly string[],
  language: Pick<RoundGeneratorInput, 'languageId' | 'languageName'>
) => !isCelebrityCategory(categoryIds) || hasPlayableCelebrityAnswer(generatedWord.word, language);

const prepareLanguageInput = (input: RoundGeneratorInput): RoundGeneratorInput => {
  const players = input.players.map((player) => ({
    ...player,
    languageId: player.languageId ?? input.languageId,
  }));
  const languageIds = [...new Set(players.map((player) => player.languageId))];
  if (languageIds.some((id) => !getLanguageOption(id))) {
    throw new Error('A player has an unsupported language');
  }
  const primaryId = languageIds.includes(input.languageId) ? input.languageId : languageIds[0];
  const primary = getLanguageOption(primaryId);
  if (!primary) throw new Error('This round needs a supported language');
  return {
    ...input,
    players,
    languageId: primary.id,
    languageName: primary.name,
    additionalLanguageIds: languageIds.filter((id) => id !== primary.id),
  };
};

const readLocalizedWord = (
  payload: unknown,
  languageId: string,
  additionalLanguageIds: readonly string[] = [],
): GeneratedWord => {
  if (!isGeneratedWord(payload)) throw new Error('The round word is invalid');
  const word = { word: payload.word.trim(), clue: payload.clue.trim() };
  if (!additionalLanguageIds.length) return word;
  const translations = payload.translations;
  if (!Array.isArray(translations) || translations.length !== additionalLanguageIds.length ||
    translations.some((entry) => !isGeneratedWord(entry) ||
      typeof entry.languageId !== 'string' || !additionalLanguageIds.includes(entry.languageId)) ||
    new Set(translations.map((entry) => entry.languageId)).size !== additionalLanguageIds.length ||
    translations.some((entry) => entry.languageId === languageId)) {
    throw new Error('A required round translation is missing or invalid');
  }
  return {
    ...word,
    translations: translations.map((entry) => ({
      languageId: entry.languageId, word: entry.word.trim(), clue: entry.clue.trim(),
    })),
  };
};

const localizedWordsFor = (word: GeneratedWord, input: RoundGeneratorInput) =>
  Object.fromEntries([
    [input.languageId, { word: word.word, clue: word.clue }],
    ...(word.translations ?? []).map((entry) => [entry.languageId, { word: entry.word, clue: entry.clue }]),
  ]) as Record<string, { word: string; clue: string }>;

const rememberLocalizedWord = (word: GeneratedWord, input: RoundGeneratorInput, entryId?: string) => {
  for (const [languageId, localized] of Object.entries(localizedWordsFor(word, input))) {
    rememberRoundWord(localized.word, {
      categoryIds: input.categoryIds,
      languageId,
      languageName: getLanguageOption(languageId)!.name,
    }, entryId);
  }
};

async function fetchAiGeneratedWord({
  players,
  categoryIds,
  difficulty,
  languageId,
  languageName,
  additionalLanguageIds,
}: RoundGeneratorInput): Promise<GeneratedWord> {
  const categoryId = categoryIds[0];

  if (categoryIds.length !== 1 || (categoryId !== 'movies' && categoryId !== 'celebrities')) {
    throw new Error('AI round generation requires one dynamic category');
  }

  const playedWordContext = {
    categoryIds,
    languageId,
    languageName,
  };
  const playedWords = getPlayedWordsForContext(playedWordContext).slice(0, MAX_PLAYED_WORD_HISTORY);
  const requestPayload: JsonValue = {
    categoryId,
    difficulty,
    languageId,
    playerCount: players.length,
    playedWords: sanitizePlayedWordHistory(playedWords),
    ...(additionalLanguageIds?.length ? { additionalLanguageIds } : {}),
  };
  const response = await postRoundRequest('generate-round', requestPayload);

  if (!response.ok) {
    throw new Error('AI round generation failed');
  }

  const payload: unknown = await response.json();

  if (!isGeneratedWord(payload)) {
    throw new Error('AI round generation returned an invalid payload');
  }

  const generatedWord = readLocalizedWord(payload, languageId, additionalLanguageIds);

  if (isPlayedWord(generatedWord.word, playedWords)) {
    throw new Error('AI round generation returned an already played word');
  }

  if (!isGeneratedWordValidForCategories(generatedWord, categoryIds, { languageId, languageName })) {
    throw new Error('AI round generation returned an incomplete celebrity name');
  }

  return generatedWord;
}

const getLocalStaticWord = (sourceEntry: EnglishWordEntry): GeneratedWord => ({
  word: sourceEntry.word,
  clue: sourceEntry.hint,
});

async function fetchTranslatedStaticWord({
  sourceEntry,
  languageId,
  playedWords,
  additionalLanguageIds,
}: {
  sourceEntry: EnglishWordEntry;
  languageId: string;
  playedWords: readonly string[];
  additionalLanguageIds?: string[];
}): Promise<GeneratedWord> {
  const requestPayload: JsonValue = {
    mode: 'translate-word',
    languageId,
    playedWords: sanitizePlayedWordHistory(playedWords),
    sourceEntryId: sourceEntry.id,
    ...(additionalLanguageIds?.length ? { additionalLanguageIds } : {}),
  };
  const response = await postRoundRequest('translate-word', requestPayload);

  if (!response.ok) {
    throw new Error('Static word translation failed');
  }

  const payload: unknown = await response.json();

  if (!isGeneratedWord(payload)) {
    throw new Error('Static word translation returned an invalid payload');
  }

  return readLocalizedWord(payload, languageId, additionalLanguageIds);
}

export async function createAiRound(input: RoundGeneratorInput): Promise<Round> {
  input = prepareLanguageInput(input);
  const generatedWord = await fetchAiGeneratedWord(input);
  const round = buildRound({
    players: input.players,
    categoryIds: input.categoryIds,
    difficulty: input.difficulty,
    languageId: input.languageId,
    languageName: input.languageName,
    secretWord: generatedWord.word,
    imposterHint: generatedWord.clue,
    localizedWords: localizedWordsFor(generatedWord, input),
    imposterCount: input.imposterCount,
    isImposterHintEnabled: input.isImposterHintEnabled,
    roundTimerMinutes: input.roundTimerMinutes,
  });

  rememberLocalizedWord(generatedWord, input);

  return round;
}

export async function createRound(input: RoundGeneratorInput): Promise<Round> {
  input = prepareLanguageInput(input);
  const playedWordContext = {
    categoryIds: input.categoryIds,
    languageId: input.languageId,
    languageName: input.languageName,
  };
  const playedWords = getPlayedWordsForContext(playedWordContext);
  const playedEntryIds = [...new Set([input.languageId, ...input.additionalLanguageIds ?? []]
    .flatMap((languageId) => getPlayedEntryIdsForContext({ ...playedWordContext, languageId })))];
  let wordPlan: RoundWordPlan;

  try {
    wordPlan = resolveRoundWordPlan({
      categoryIds: input.categoryIds,
      difficulty: input.difficulty,
      languageId: input.languageId,
      languageName: input.languageName,
      playedWords,
      playedEntryIds,
      rng: input.rng,
    });
  } catch {
    wordPlan = {
      mode: 'local-static',
      source: {
        type: 'static',
        categoryId: EMERGENCY_STATIC_CATEGORY_ID,
        entry: selectStaticWordEntry({
          categoryId: EMERGENCY_STATIC_CATEGORY_ID,
          difficulty: input.difficulty,
          playedWords,
          playedEntryIds,
          rng: input.rng,
        }),
      },
    };
  }

  let generatedWord: GeneratedWord;
  let shouldRememberStaticEntry = false;
  let rememberedStaticEntryId: string | undefined;

  if (wordPlan.mode === 'ai') {
    try {
      generatedWord = await fetchAiGeneratedWord({
        ...input,
        categoryIds: [wordPlan.source.categoryId],
      });
    } catch (error) {
      if (!isEnglishLanguage(input) || input.additionalLanguageIds?.length) {
        throw error instanceof Error ? error : new Error('AI round generation failed');
      }

      generatedWord = getEmergencyDynamicWord(
        wordPlan.source.categoryId,
        `${wordPlan.source.categoryId}:${input.languageId}:${playedWords.length}:${Date.now()}`
      );
    }
  } else {
    if (isEnglishLanguage(input) && !input.additionalLanguageIds?.length) {
      generatedWord = getLocalStaticWord(wordPlan.source.entry);
    } else {
      generatedWord = await fetchTranslatedStaticWord({
        sourceEntry: wordPlan.source.entry,
        languageId: input.languageId,
        playedWords,
        additionalLanguageIds: input.additionalLanguageIds,
      });

      if (isPlayedWord(generatedWord.word, playedWords)) {
        throw new Error('Static word translation returned an already played word');
      }

      rememberedStaticEntryId = wordPlan.source.entry.id;
    }
    shouldRememberStaticEntry = true;
  }

  const round = buildRound({
    players: input.players,
    categoryIds: [wordPlan.source.categoryId],
    difficulty: input.difficulty,
    languageId: input.languageId,
    languageName: input.languageName,
    secretWord: generatedWord.word,
    imposterHint: generatedWord.clue,
    localizedWords: localizedWordsFor(generatedWord, input),
    imposterCount: input.imposterCount,
    isImposterHintEnabled: input.isImposterHintEnabled,
    roundTimerMinutes: input.roundTimerMinutes,
    rng: input.rng,
  });

  rememberLocalizedWord(
    generatedWord,
    {
      ...input,
      categoryIds: [wordPlan.source.categoryId],
      languageId: input.languageId,
      languageName: input.languageName,
    },
    wordPlan.source.type === 'static' && shouldRememberStaticEntry
      ? rememberedStaticEntryId ?? wordPlan.source.entry.id
      : undefined
  );

  return round;
}
