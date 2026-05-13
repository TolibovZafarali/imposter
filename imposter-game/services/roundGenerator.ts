import { buildRound } from '@/game/round';
import type { Player, Round } from '@/game/types';

type MockWord = {
  word: string;
  hint: string;
};

type GeneratedWord = {
  word: string;
  clue: string;
};

export type RoundGeneratorInput = {
  players: Player[];
  categoryIds: string[];
  languageId: string;
  languageName: string;
};

type RoundGeneratorMode = 'mock' | 'ai';

const MOCK_WORDS_BY_CATEGORY: Record<string, MockWord[]> = {
  food: [
    { word: 'Pizza', hint: 'Cheese' },
    { word: 'Sushi', hint: 'Rice' },
  ],
  animals: [
    { word: 'Elephant', hint: 'Large' },
    { word: 'Penguin', hint: 'Cold' },
  ],
  jobs: [
    { word: 'Doctor', hint: 'Hospital' },
    { word: 'Pilot', hint: 'Sky' },
  ],
  countries: [
    { word: 'Japan', hint: 'Island' },
    { word: 'Brazil', hint: 'Carnival' },
  ],
  objects: [
    { word: 'Umbrella', hint: 'Rain' },
    { word: 'Camera', hint: 'Photo' },
  ],
  sports: [
    { word: 'Soccer', hint: 'Goal' },
    { word: 'Tennis', hint: 'Racket' },
  ],
  school: [
    { word: 'Notebook', hint: 'Class' },
    { word: 'Teacher', hint: 'Lesson' },
  ],
  movies: [
    { word: 'Titanic', hint: 'Ship' },
    { word: 'Avatar', hint: 'Blue' },
  ],
  celebrities: [
    { word: 'Beyonce', hint: 'Singer' },
    { word: 'Messi', hint: 'Football' },
  ],
  fantasy: [
    { word: 'Dragon', hint: 'Fire' },
    { word: 'Wizard', hint: 'Magic' },
  ],
};

const FALLBACK_WORDS: MockWord[] = [
  { word: 'Moon', hint: 'Night' },
  { word: 'Bridge', hint: 'Crossing' },
];

const DEFAULT_AI_ROUND_API_URL = 'http://localhost:3000/api/generate-round';

const chooseMockWord = (categoryIds: string[]) => {
  const selectedCategoryId = categoryIds[0];
  const categoryWords = selectedCategoryId ? MOCK_WORDS_BY_CATEGORY[selectedCategoryId] : null;
  const words = categoryWords ?? FALLBACK_WORDS;

  return words[Math.floor(Math.random() * words.length)];
};

const getRoundGeneratorMode = (): RoundGeneratorMode =>
  process.env.EXPO_PUBLIC_ROUND_GENERATOR === 'ai' ? 'ai' : 'mock';

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

async function fetchAiGeneratedWord({
  players,
  categoryIds,
  languageId,
  languageName,
}: RoundGeneratorInput): Promise<GeneratedWord> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 8000);

  try {
    const response = await fetch(getAiRoundApiUrl(), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        categoryIds,
        languageId,
        languageName,
        playerCount: players.length,
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

    return {
      word: payload.word.trim(),
      clue: payload.clue.trim(),
    };
  } finally {
    clearTimeout(timeoutId);
  }
}

export function createMockRound({
  players,
  categoryIds,
  languageId,
  languageName,
}: RoundGeneratorInput): Round {
  const mockWord = chooseMockWord(categoryIds);

  return buildRound({
    players,
    categoryIds,
    languageId,
    languageName,
    secretWord: mockWord.word,
    imposterHint: mockWord.hint,
  });
}

export async function createAiRound(input: RoundGeneratorInput): Promise<Round> {
  const generatedWord = await fetchAiGeneratedWord(input);

  return buildRound({
    players: input.players,
    categoryIds: input.categoryIds,
    languageId: input.languageId,
    languageName: input.languageName,
    secretWord: generatedWord.word,
    imposterHint: generatedWord.clue,
  });
}

export async function createRound(input: RoundGeneratorInput): Promise<Round> {
  if (getRoundGeneratorMode() !== 'ai') {
    return createMockRound(input);
  }

  try {
    return await createAiRound(input);
  } catch {
    return createMockRound(input);
  }
}
