import { buildRound } from '@/game/round';
import type { ImposterCount, Player, Round, RoundTimerSetting } from '@/game/types';
import {
  CATEGORY_LABELS,
  hasPlayableCelebrityAnswer,
  resolveRoundWordPlan,
  type EnglishWordEntry,
  type WordDifficulty,
} from '@/data/wordBank';

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
  imposterCount?: ImposterCount;
  isImposterHintEnabled?: boolean;
  roundTimerMinutes?: RoundTimerSetting;
  rng?: () => number;
};

const AI_CLIENT_GENERATION_ATTEMPTS = 4;
const DEFAULT_AI_ROUND_API_URL = 'http://localhost:3000/api/generate-round';
let playedRoundWordsByContext = new Map<string, string[]>();
let playedRoundEntryIdsByContext = new Map<string, string[]>();

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

const isGeneratedWordValidForCategories = (generatedWord: GeneratedWord, categoryIds: readonly string[]) =>
  !isCelebrityCategory(categoryIds) || hasPlayableCelebrityAnswer(generatedWord.word);

const getAiGenerationAttemptLimit = (categoryIds: readonly string[]) =>
  isCelebrityCategory(categoryIds) ? AI_CLIENT_GENERATION_ATTEMPTS : 1;

async function fetchAiGeneratedWord({
  players,
  categoryIds,
  difficulty,
  languageId,
  languageName,
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
    const timeoutId = setTimeout(() => controller.abort(), 20000);

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

      if (!isGeneratedWordValidForCategories(generatedWord, categoryIds)) {
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

async function fetchTranslatedStaticWord({
  sourceEntry,
  languageId,
  languageName,
}: {
  sourceEntry: EnglishWordEntry;
  languageId: string;
  languageName: string;
}): Promise<GeneratedWord> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 20000);

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
  const wordPlan = resolveRoundWordPlan({
    categoryIds: input.categoryIds,
    difficulty: input.difficulty,
    languageId: input.languageId,
    languageName: input.languageName,
    playedWords: getPlayedWordsForContext(playedWordContext),
    playedEntryIds: getPlayedEntryIdsForContext(playedWordContext),
    rng: input.rng,
  });

  const generatedWord =
    wordPlan.mode === 'ai'
      ? await fetchAiGeneratedWord({
          ...input,
          categoryIds: [wordPlan.source.categoryId],
        })
      : wordPlan.mode === 'local-static'
        ? {
            word: wordPlan.source.entry.word,
            clue: wordPlan.source.entry.hint,
          }
        : await fetchTranslatedStaticWord({
            sourceEntry: wordPlan.source.entry,
            languageId: input.languageId,
            languageName: input.languageName,
          });

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
    wordPlan.source.type === 'static' ? wordPlan.source.entry.id : undefined
  );

  return round;
}
