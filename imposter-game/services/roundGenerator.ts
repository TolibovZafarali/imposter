import { buildRound } from '@/game/round';
import type { Player, Round } from '@/game/types';

type MockWord = {
  word: string;
  hint: string;
};

type RoundGeneratorInput = {
  players: Player[];
  categoryIds: string[];
  languageId: string;
  languageName: string;
};

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

const chooseMockWord = (categoryIds: string[]) => {
  const selectedCategoryId = categoryIds[0];
  const categoryWords = selectedCategoryId ? MOCK_WORDS_BY_CATEGORY[selectedCategoryId] : null;
  const words = categoryWords ?? FALLBACK_WORDS;

  return words[Math.floor(Math.random() * words.length)];
};

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
