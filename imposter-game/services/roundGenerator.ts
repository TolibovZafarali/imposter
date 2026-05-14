import { buildRound } from '@/game/round';
import type { Player, Round } from '@/game/types';
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

export type RoundGeneratorInput = {
  players: Player[];
  categoryIds: string[];
  difficulty: WordDifficulty;
  languageId: string;
  languageName: string;
  rng?: () => number;
};

const RECENT_WORD_LIMIT = 40;
const RECENT_ENTRY_LIMIT = 80;
const AI_CLIENT_GENERATION_ATTEMPTS = 4;
const DEFAULT_AI_ROUND_API_URL = 'http://localhost:3000/api/generate-round';
let recentRoundWords: string[] = [];
let recentRoundEntryIds: string[] = [];

const normalizeWordKey = (value: string) => value.trim().toLocaleLowerCase().replace(/\s+/g, ' ');

const isRecentlyUsedWord = (word: string, recentWords = recentRoundWords) => {
  const wordKey = normalizeWordKey(word);
  const recentWordKeys = new Set(recentWords.map(normalizeWordKey));

  return recentWordKeys.has(wordKey);
};

const rememberRoundWord = (word: string, entryId?: string) => {
  recentRoundWords = [word, ...recentRoundWords.filter((recentWord) => !isRecentlyUsedWord(word, [recentWord]))].slice(
    0,
    RECENT_WORD_LIMIT
  );

  if (entryId) {
    recentRoundEntryIds = [entryId, ...recentRoundEntryIds.filter((recentEntryId) => recentEntryId !== entryId)].slice(
      0,
      RECENT_ENTRY_LIMIT
    );
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

  for (let attempt = 0; attempt < getAiGenerationAttemptLimit(categoryIds); attempt += 1) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 20000);

    try {
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
          recentWords: [...rejectedWords, ...recentRoundWords].slice(0, RECENT_WORD_LIMIT),
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
  });

  rememberRoundWord(generatedWord.word);

  return round;
}

export async function createRound(input: RoundGeneratorInput): Promise<Round> {
  const wordPlan = resolveRoundWordPlan({
    categoryIds: input.categoryIds,
    difficulty: input.difficulty,
    languageId: input.languageId,
    languageName: input.languageName,
    recentWords: recentRoundWords,
    recentEntryIds: recentRoundEntryIds,
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
    rng: input.rng,
  });

  rememberRoundWord(generatedWord.word, wordPlan.source.type === 'static' ? wordPlan.source.entry.id : undefined);

  return round;
}
