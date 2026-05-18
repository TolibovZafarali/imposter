import { activitiesHobbiesActionsWords } from './activitiesHobbiesActionsWords.ts';
import animalWords from './animalsWords.ts';
import { everydayObjectsWords } from './everydayObjectsWords.ts';
import { foodDrinkWords } from './foodDrinkWords.ts';
import placesGeographyWords from './placesGeographyWords.ts';
import sportsGamesWords from './sportsGamesWords.ts';

export type WordDifficulty = 'easy' | 'medium' | 'hard';

export type StaticCategoryId =
  | 'activities'
  | 'food'
  | 'animals'
  | 'objects'
  | 'places'
  | 'sports';

export type DynamicCategoryId = 'movies' | 'celebrities';
export type CategoryId = StaticCategoryId | DynamicCategoryId;

export type EnglishWordEntry = {
  id: string;
  word: string;
  hint: string;
  categoryId: StaticCategoryId;
  difficulty: WordDifficulty;
  sense?: string;
};

export type RoundWordSource =
  | {
      type: 'static';
      categoryId: StaticCategoryId;
      entry: EnglishWordEntry;
    }
  | {
      type: 'ai';
      categoryId: DynamicCategoryId;
    };

export type RoundWordPlan =
  | {
      mode: 'local-static';
      source: Extract<RoundWordSource, { type: 'static' }>;
    }
  | {
      mode: 'translate-static';
      source: Extract<RoundWordSource, { type: 'static' }>;
    }
  | {
      mode: 'ai';
      source: Extract<RoundWordSource, { type: 'ai' }>;
    };

export const STATIC_CATEGORY_IDS = [
  'activities',
  'food',
  'animals',
  'objects',
  'places',
  'sports',
] as const satisfies readonly StaticCategoryId[];

export const DYNAMIC_CATEGORY_IDS = [
  'movies',
  'celebrities',
] as const satisfies readonly DynamicCategoryId[];

// A 100-point playability table, not a word-bank-size table.
export const RANDOM_CATEGORY_WEIGHTS = {
  objects: 25,
  animals: 22,
  activities: 19,
  places: 11,
  sports: 10,
  food: 7,
  movies: 3,
  celebrities: 3,
} as const satisfies Record<CategoryId, number>;

export const CATEGORY_LABELS = {
  activities: 'Activities',
  food: 'Food',
  animals: 'Animals',
  objects: 'Objects',
  places: 'Places',
  sports: 'Sports',
  movies: 'Movies',
  celebrities: 'Celebrities',
} as const satisfies Record<StaticCategoryId | DynamicCategoryId, string>;

export const normalizeWordKey = (value: string) =>
  value
    .normalize('NFD')
    .replace(/\p{M}+/gu, '')
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .replace(/\s+/g, ' ');

export const hasPlayableCelebrityAnswer = (word: string) =>
  normalizeWordKey(word).split(' ').filter(Boolean).length >= 2;

export const WORD_DIFFICULTIES = ['easy', 'medium', 'hard'] as const satisfies readonly WordDifficulty[];

const buildStaticWordEntries = ({
  categoryId,
  difficulties,
}: {
  categoryId: StaticCategoryId;
  difficulties: Record<WordDifficulty, readonly { secret: string; hint: string }[]>;
}): EnglishWordEntry[] =>
  WORD_DIFFICULTIES.flatMap((difficulty) =>
    difficulties[difficulty].map(({ secret, hint }) => ({
      id: `${categoryId}-${difficulty}-${normalizeWordKey(secret).replace(/\s+/g, '-')}`,
      word: secret,
      hint,
      categoryId,
      difficulty,
    }))
  );

export const ENGLISH_WORD_BANK: EnglishWordEntry[] = [
  ...buildStaticWordEntries({
    categoryId: 'activities',
    difficulties: activitiesHobbiesActionsWords.difficulties,
  }),
  ...buildStaticWordEntries({
    categoryId: 'food',
    difficulties: foodDrinkWords.difficulties,
  }),
  ...buildStaticWordEntries({
    categoryId: 'animals',
    difficulties: animalWords.difficulties,
  }),
  ...buildStaticWordEntries({
    categoryId: 'objects',
    difficulties: everydayObjectsWords.difficulties,
  }),
  ...buildStaticWordEntries({
    categoryId: 'places',
    difficulties: placesGeographyWords.difficulties,
  }),
  ...buildStaticWordEntries({
    categoryId: 'sports',
    difficulties: sportsGamesWords.difficulties,
  }),
];

export const ENGLISH_WORD_BANK_BY_CATEGORY = STATIC_CATEGORY_IDS.reduce(
  (entriesByCategory, categoryId) => ({
    ...entriesByCategory,
    [categoryId]: ENGLISH_WORD_BANK.filter((entry) => entry.categoryId === categoryId),
  }),
  {} as Record<StaticCategoryId, EnglishWordEntry[]>
);

export const isStaticCategoryId = (categoryId: string): categoryId is StaticCategoryId =>
  (STATIC_CATEGORY_IDS as readonly string[]).includes(categoryId);

export const isDynamicCategoryId = (categoryId: string): categoryId is DynamicCategoryId =>
  (DYNAMIC_CATEGORY_IDS as readonly string[]).includes(categoryId);

const isCategoryId = (categoryId: string): categoryId is CategoryId =>
  isStaticCategoryId(categoryId) || isDynamicCategoryId(categoryId);

const getRandomIndex = (itemCount: number, rng: () => number) =>
  Math.min(Math.floor(rng() * itemCount), itemCount - 1);

const getRandomCategoryWeight = (categoryId: string) =>
  isCategoryId(categoryId) ? RANDOM_CATEGORY_WEIGHTS[categoryId] : 1;

const getWeightedRandomIndex = (weights: readonly number[], rng: () => number) => {
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);

  if (totalWeight <= 0) {
    return getRandomIndex(weights.length, rng);
  }

  let cursor = rng() * totalWeight;

  for (let index = 0; index < weights.length; index += 1) {
    cursor -= weights[index];

    if (cursor < 0) {
      return index;
    }
  }

  return weights.length - 1;
};

export function selectRandomCategoryIds({
  categoryIds,
  count,
  rng = Math.random,
}: {
  categoryIds: readonly string[];
  count: number;
  rng?: () => number;
}) {
  const availableCategoryIds = [...categoryIds];
  const selectedCategoryIds: string[] = [];

  while (selectedCategoryIds.length < count && availableCategoryIds.length > 0) {
    const selectedIndex = getWeightedRandomIndex(
      availableCategoryIds.map(getRandomCategoryWeight),
      rng
    );
    const [selectedCategoryId] = availableCategoryIds.splice(selectedIndex, 1);

    selectedCategoryIds.push(selectedCategoryId);
  }

  return selectedCategoryIds;
}

const isPlayedEntry = (
  entry: EnglishWordEntry,
  playedWords: readonly string[],
  playedEntryIds: readonly string[]
) => {
  if (playedEntryIds.includes(entry.id)) {
    return true;
  }

  const entryWordKey = normalizeWordKey(entry.word);
  const playedWordKeys = new Set(playedWords.map(normalizeWordKey).filter(Boolean));

  return playedWordKeys.has(entryWordKey);
};

export function selectStaticWordEntry({
  categoryId,
  difficulty = 'easy',
  playedWords = [],
  playedEntryIds = [],
  rng = Math.random,
}: {
  categoryId: StaticCategoryId;
  difficulty?: WordDifficulty;
  playedWords?: readonly string[];
  playedEntryIds?: readonly string[];
  rng?: () => number;
}): EnglishWordEntry {
  const selectionEntries = ENGLISH_WORD_BANK_BY_CATEGORY[categoryId].filter(
    (entry) => entry.difficulty === difficulty
  );
  const freshEntries = selectionEntries.filter(
    (entry) => !isPlayedEntry(entry, playedWords, playedEntryIds)
  );
  const wordPool = freshEntries.length ? freshEntries : selectionEntries;

  if (!wordPool.length) {
    throw new Error(`No static word data available for category: ${categoryId}`);
  }

  return wordPool[getRandomIndex(wordPool.length, rng)];
}

export function chooseRoundCategory(categoryIds: readonly string[], rng = Math.random) {
  if (!categoryIds.length) {
    throw new Error('At least one category is required');
  }

  const selectedIndex = getWeightedRandomIndex(categoryIds.map(getRandomCategoryWeight), rng);

  return categoryIds[selectedIndex];
}

export function resolveRoundWordSource({
  categoryIds,
  difficulty = 'easy',
  playedWords = [],
  playedEntryIds = [],
  rng = Math.random,
}: {
  categoryIds: readonly string[];
  difficulty?: WordDifficulty;
  playedWords?: readonly string[];
  playedEntryIds?: readonly string[];
  rng?: () => number;
}): RoundWordSource {
  const selectedCategoryId = chooseRoundCategory(categoryIds, rng);

  if (isStaticCategoryId(selectedCategoryId)) {
    return {
      type: 'static',
      categoryId: selectedCategoryId,
      entry: selectStaticWordEntry({
        categoryId: selectedCategoryId,
        difficulty,
        playedWords,
        playedEntryIds,
        rng,
      }),
    };
  }

  if (isDynamicCategoryId(selectedCategoryId)) {
    return {
      type: 'ai',
      categoryId: selectedCategoryId,
    };
  }

  throw new Error(`Unsupported category: ${selectedCategoryId}`);
}

export const isEnglishLanguage = ({
  languageId,
  languageName,
}: {
  languageId: string;
  languageName: string;
}) => languageId === 'english' || languageName.trim().toLocaleLowerCase() === 'english';

export function resolveRoundWordPlan({
  categoryIds,
  difficulty = 'easy',
  languageId,
  languageName,
  playedWords = [],
  playedEntryIds = [],
  rng = Math.random,
}: {
  categoryIds: readonly string[];
  difficulty?: WordDifficulty;
  languageId: string;
  languageName: string;
  playedWords?: readonly string[];
  playedEntryIds?: readonly string[];
  rng?: () => number;
}): RoundWordPlan {
  const source = resolveRoundWordSource({
    categoryIds,
    difficulty,
    playedWords,
    playedEntryIds,
    rng,
  });

  if (source.type === 'ai') {
    return {
      mode: 'ai',
      source,
    };
  }

  return {
    mode: isEnglishLanguage({ languageId, languageName }) ? 'local-static' : 'translate-static',
    source,
  };
}
