export type StaticCategoryId =
  | 'food'
  | 'animals'
  | 'jobs'
  | 'countries'
  | 'objects'
  | 'sports'
  | 'school'
  | 'fantasy';

export type DynamicCategoryId = 'movies' | 'celebrities';

export type EnglishWordEntry = {
  id: string;
  word: string;
  hint: string;
  categoryId: StaticCategoryId;
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
  'food',
  'animals',
  'jobs',
  'countries',
  'objects',
  'sports',
  'school',
  'fantasy',
] as const satisfies readonly StaticCategoryId[];

export const DYNAMIC_CATEGORY_IDS = [
  'movies',
  'celebrities',
] as const satisfies readonly DynamicCategoryId[];

export const CATEGORY_LABELS = {
  food: 'Food',
  animals: 'Animals',
  jobs: 'Jobs',
  countries: 'Countries',
  objects: 'Objects',
  sports: 'Sports',
  school: 'School',
  movies: 'Movies',
  celebrities: 'Celebrities',
  fantasy: 'Fantasy',
} as const satisfies Record<StaticCategoryId | DynamicCategoryId, string>;

export const normalizeWordKey = (value: string) =>
  value
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .replace(/\s+/g, ' ');

export const hasPlayableCelebrityAnswer = (word: string) =>
  normalizeWordKey(word).split(' ').filter(Boolean).length >= 2;

export const ENGLISH_WORD_BANK: EnglishWordEntry[] = [];

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
  recentWords = [],
  recentEntryIds = [],
  rng = Math.random,
}: {
  categoryId: StaticCategoryId;
  recentWords?: readonly string[];
  recentEntryIds?: readonly string[];
  rng?: () => number;
}): EnglishWordEntry {
  const selectionEntries = ENGLISH_WORD_BANK_BY_CATEGORY[categoryId];
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
  recentWords = [],
  recentEntryIds = [],
  rng = Math.random,
}: {
  categoryIds: readonly string[];
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
  languageId,
  languageName,
  recentWords = [],
  recentEntryIds = [],
  rng = Math.random,
}: {
  categoryIds: readonly string[];
  languageId: string;
  languageName: string;
  recentWords?: readonly string[];
  recentEntryIds?: readonly string[];
  rng?: () => number;
}): RoundWordPlan {
  const source = resolveRoundWordSource({
    categoryIds,
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
