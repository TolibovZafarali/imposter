import { buildRound } from '../game/round.ts';
import type { ImposterCount, Player, Round, RoundTimerSetting } from '../game/types.ts';
import {
  CATEGORY_LABELS,
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

type GeneratedWord = {
  word: string;
  clue: string;
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
  imposterCount?: ImposterCount;
  isImposterHintEnabled?: boolean;
  roundTimerMinutes?: RoundTimerSetting;
  rng?: () => number;
};

const AI_CLIENT_GENERATION_ATTEMPTS = 3;
const STATIC_TRANSLATION_ATTEMPTS = 3;
export const AI_ROUND_REQUEST_TIMEOUT_MS = 12000;
const DEFAULT_AI_ROUND_API_URL =
  'https://wqryrqffcldnpubcgtyh.supabase.co/functions/v1/generate-round';
const EMERGENCY_STATIC_CATEGORY_ID: StaticCategoryId = 'objects';
let playedRoundWordsByContext = new Map<string, string[]>();
let playedRoundEntryIdsByContext = new Map<string, string[]>();

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

const isPlayedWord = (word: string, playedWords: readonly string[]) => {
  const wordKey = normalizeWordKey(word);
  const playedWordKeys = new Set(playedWords.map(normalizeWordKey).filter(Boolean));

  return playedWordKeys.has(wordKey);
};

const mergeUniquePlayedWords = (words: readonly string[]) => {
  const seenWordKeys = new Set<string>();

  return words.filter((word) => {
    const wordKey = normalizeWordKey(word);

    if (!wordKey || seenWordKeys.has(wordKey)) {
      return false;
    }

    seenWordKeys.add(wordKey);
    return true;
  });
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
  mergeUniquePlayedWords(
    getPlayedWordContextKeys(context).flatMap((contextKey) => playedRoundWordsByContext.get(contextKey) ?? [])
  );

const getPlayedEntryIdsForContext = (context: PlayedWordContext) =>
  getPlayedWordContextKeys(context).flatMap((contextKey) => playedRoundEntryIdsByContext.get(contextKey) ?? []);

const rememberRoundWord = (word: string, context: PlayedWordContext, entryId?: string) => {
  for (const contextKey of getPlayedWordContextKeys(context)) {
    const playedWords = playedRoundWordsByContext.get(contextKey) ?? [];

    playedRoundWordsByContext.set(
      contextKey,
      mergeUniquePlayedWords([word, ...playedWords.filter((playedWord) => !isPlayedWord(word, [playedWord]))])
    );

    if (entryId) {
      const playedEntryIds = playedRoundEntryIdsByContext.get(contextKey) ?? [];

      playedRoundEntryIdsByContext.set(contextKey, [
        entryId,
        ...playedEntryIds.filter((playedEntryId) => playedEntryId !== entryId),
      ]);
    }
  }
};

const getAiRoundApiUrl = () =>
  process.env.EXPO_PUBLIC_AI_ROUND_API_URL?.trim() || DEFAULT_AI_ROUND_API_URL;

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

const getAiGenerationAttemptLimit = (categoryIds: readonly string[]) =>
  isCelebrityCategory(categoryIds) ? AI_CLIENT_GENERATION_ATTEMPTS : 1;

async function fetchAiGeneratedWord({
  players,
  categoryIds,
  difficulty,
  languageId,
  languageName,
  languageNativeName,
  languageScriptHint,
}: RoundGeneratorInput): Promise<GeneratedWord> {
  const rejectedWords: string[] = [];
  let lastError: unknown;
  const playedWordContext = {
    categoryIds,
    languageId,
    languageName,
  };

  for (let attempt = 0; attempt < getAiGenerationAttemptLimit(categoryIds); attempt += 1) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), AI_ROUND_REQUEST_TIMEOUT_MS);

    try {
      const playedWords = mergeUniquePlayedWords([
        ...rejectedWords,
        ...getPlayedWordsForContext(playedWordContext),
      ]);
      const response = await fetch(getAiRoundApiUrl(), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          categoryIds,
          difficulty,
          languageId,
          languageName,
          languageNativeName,
          languageScriptHint,
          playerCount: players.length,
          playedWords,
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error('AI round generation failed');
      }

      const payload: unknown = await response.json();

      if (!isGeneratedWord(payload)) {
        throw new Error('AI round generation returned an invalid payload');
      }

      const generatedWord = {
        word: payload.word.trim(),
        clue: payload.clue.trim(),
      };

      if (isPlayedWord(generatedWord.word, playedWords)) {
        rejectedWords.unshift(generatedWord.word);
        lastError = new Error('AI round generation returned an already played word');
        continue;
      }

      if (!isGeneratedWordValidForCategories(generatedWord, categoryIds, { languageId, languageName })) {
        rejectedWords.unshift(generatedWord.word);
        lastError = new Error('AI round generation returned an incomplete celebrity name');
        continue;
      }

      return generatedWord;
    } catch (error) {
      throw error instanceof Error ? error : new Error('AI round generation failed');
    } finally {
      clearTimeout(timeoutId);
    }
  }

  throw lastError instanceof Error ? lastError : new Error('AI round generation failed');
}

const getLocalStaticWord = (sourceEntry: EnglishWordEntry): GeneratedWord => ({
  word: sourceEntry.word,
  clue: sourceEntry.hint,
});

async function fetchTranslatedStaticWord({
  sourceEntry,
  languageId,
  languageName,
  languageNativeName,
  languageScriptHint,
  playedWords,
}: {
  sourceEntry: EnglishWordEntry;
  languageId: string;
  languageName: string;
  languageNativeName?: string;
  languageScriptHint?: string;
  playedWords: readonly string[];
}): Promise<GeneratedWord> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), AI_ROUND_REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(getAiRoundApiUrl(), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        mode: 'translate-word',
        languageId,
        languageName,
        languageNativeName,
        languageScriptHint,
        playedWords,
        source: {
          word: sourceEntry.word,
          clue: sourceEntry.hint,
          categoryId: sourceEntry.categoryId,
          categoryLabel: CATEGORY_LABELS[sourceEntry.categoryId],
          difficulty: sourceEntry.difficulty,
          sense: sourceEntry.sense,
        },
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error('Static word translation failed');
    }

    const payload: unknown = await response.json();

    if (!isGeneratedWord(payload)) {
      throw new Error('Static word translation returned an invalid payload');
    }

    return {
      word: payload.word.trim(),
      clue: payload.clue.trim(),
    };
  } finally {
    clearTimeout(timeoutId);
  }
}

async function fetchTranslatedStaticWordWithRetry({
  input,
  categoryId,
  initialEntry,
  playedWords,
  playedEntryIds,
}: {
  input: RoundGeneratorInput;
  categoryId: StaticCategoryId;
  initialEntry: EnglishWordEntry;
  playedWords: readonly string[];
  playedEntryIds: readonly string[];
}): Promise<{ generatedWord: GeneratedWord; sourceEntry: EnglishWordEntry }> {
  const rejectedWords: string[] = [];
  const rejectedEntryIds: string[] = [];
  let lastError: unknown;

  for (let attempt = 0; attempt < STATIC_TRANSLATION_ATTEMPTS; attempt += 1) {
    const sourceEntry =
      attempt === 0
        ? initialEntry
        : selectStaticWordEntry({
            categoryId,
            difficulty: input.difficulty,
            playedWords: mergeUniquePlayedWords([...playedWords, ...rejectedWords]),
            playedEntryIds: [...playedEntryIds, ...rejectedEntryIds],
            rng: input.rng,
          });

    try {
      const wordsToAvoid = mergeUniquePlayedWords([...playedWords, ...rejectedWords]);
      const generatedWord = await fetchTranslatedStaticWord({
        sourceEntry,
        languageId: input.languageId,
        languageName: input.languageName,
        languageNativeName: input.languageNativeName,
        languageScriptHint: input.languageScriptHint,
        playedWords: wordsToAvoid,
      });

      if (isPlayedWord(generatedWord.word, wordsToAvoid)) {
        rejectedWords.unshift(generatedWord.word);
        rejectedEntryIds.unshift(sourceEntry.id);
        lastError = new Error('Static word translation returned an already played word');
        continue;
      }

      return { generatedWord, sourceEntry };
    } catch (error) {
      rejectedEntryIds.unshift(sourceEntry.id);
      lastError = error;
    }
  }

  throw lastError instanceof Error ? lastError : new Error('Static word translation failed');
}

export async function createAiRound(input: RoundGeneratorInput): Promise<Round> {
  const generatedWord = await fetchAiGeneratedWord(input);
  const round = buildRound({
    players: input.players,
    categoryIds: input.categoryIds,
    difficulty: input.difficulty,
    languageId: input.languageId,
    languageName: input.languageName,
    secretWord: generatedWord.word,
    imposterHint: generatedWord.clue,
    imposterCount: input.imposterCount,
    isImposterHintEnabled: input.isImposterHintEnabled,
    roundTimerMinutes: input.roundTimerMinutes,
  });

  rememberRoundWord(generatedWord.word, {
    categoryIds: input.categoryIds,
    languageId: input.languageId,
    languageName: input.languageName,
  });

  return round;
}

export async function createRound(input: RoundGeneratorInput): Promise<Round> {
  const playedWordContext = {
    categoryIds: input.categoryIds,
    languageId: input.languageId,
    languageName: input.languageName,
  };
  const playedWords = getPlayedWordsForContext(playedWordContext);
  const playedEntryIds = getPlayedEntryIdsForContext(playedWordContext);
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
      if (!isEnglishLanguage(input)) {
        throw error instanceof Error ? error : new Error('AI round generation failed');
      }

      generatedWord = getEmergencyDynamicWord(
        wordPlan.source.categoryId,
        `${wordPlan.source.categoryId}:${input.languageId}:${playedWords.length}:${Date.now()}`
      );
    }
  } else {
    if (isEnglishLanguage(input)) {
      generatedWord = getLocalStaticWord(wordPlan.source.entry);
    } else {
      const translatedStaticWord = await fetchTranslatedStaticWordWithRetry({
        input,
        categoryId: wordPlan.source.categoryId,
        initialEntry: wordPlan.source.entry,
        playedWords,
        playedEntryIds,
      });
      generatedWord = translatedStaticWord.generatedWord;
      rememberedStaticEntryId = translatedStaticWord.sourceEntry.id;
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
    imposterCount: input.imposterCount,
    isImposterHintEnabled: input.isImposterHintEnabled,
    roundTimerMinutes: input.roundTimerMinutes,
    rng: input.rng,
  });

  rememberRoundWord(
    generatedWord.word,
    {
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
