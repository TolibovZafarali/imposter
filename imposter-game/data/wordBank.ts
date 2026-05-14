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
  | 'sports'

export type DynamicCategoryId = 'movies' | 'celebrities';

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

const buildUnsplitStaticWordEntries = ({
  categoryId,
  words,
}: {
  categoryId: StaticCategoryId;
  words: readonly { secret: string; hint: string }[];
}): EnglishWordEntry[] =>
  WORD_DIFFICULTIES.flatMap((difficulty) =>
    words.map(({ secret, hint }) => ({
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
  ...buildUnsplitStaticWordEntries({
    categoryId: 'sports',
    words: sportsGamesWords.words,
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

const getRandomIndex = (itemCount: number, rng: () => number) =>
  Math.min(Math.floor(rng() * itemCount), itemCount - 1);

const isRecentlyUsedEntry = (
  entry: EnglishWordEntry,
  recentWords: readonly string[],
  recentEntryIds: readonly string[]
) => {
  if (recentEntryIds.includes(entry.id)) {
    return true;
  }

  const entryWordKey = normalizeWordKey(entry.word);
  const recentWordKeys = new Set(recentWords.map(normalizeWordKey).filter(Boolean));

  return recentWordKeys.has(entryWordKey);
};

export function selectStaticWordEntry({
  categoryId,
  difficulty = 'easy',
  recentWords = [],
  recentEntryIds = [],
  rng = Math.random,
}: {
  categoryId: StaticCategoryId;
  difficulty?: WordDifficulty;
  recentWords?: readonly string[];
  recentEntryIds?: readonly string[];
  rng?: () => number;
}): EnglishWordEntry {
  const selectionEntries = ENGLISH_WORD_BANK_BY_CATEGORY[categoryId].filter(
    (entry) => entry.difficulty === difficulty
  );
  const freshEntries = selectionEntries.filter(
    (entry) => !isRecentlyUsedEntry(entry, recentWords, recentEntryIds)
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

  return categoryIds[getRandomIndex(categoryIds.length, rng)];
}

export function resolveRoundWordSource({
  categoryIds,
  difficulty = 'easy',
  recentWords = [],
  recentEntryIds = [],
  rng = Math.random,
}: {
  categoryIds: readonly string[];
  difficulty?: WordDifficulty;
  recentWords?: readonly string[];
  recentEntryIds?: readonly string[];
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
        recentWords,
        recentEntryIds,
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
  recentWords = [],
  recentEntryIds = [],
  rng = Math.random,
}: {
  categoryIds: readonly string[];
  difficulty?: WordDifficulty;
  languageId: string;
  languageName: string;
  recentWords?: readonly string[];
  recentEntryIds?: readonly string[];
  rng?: () => number;
}): RoundWordPlan {
  const source = resolveRoundWordSource({
    categoryIds,
    difficulty,
    recentWords,
    recentEntryIds,
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
