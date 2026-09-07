import { activitiesCatalog } from "./catalog/activities.ts";
import { animalsCatalog } from "./catalog/animals.ts";
import { foodCatalog } from "./catalog/food.ts";
import { objectsCatalog } from "./catalog/objects.ts";
import { placesCatalog } from "./catalog/places.ts";
import { sportsCatalog } from "./catalog/sports.ts";
import { type CategoryId, getCanonicalCategoryLabel } from "./contracts.ts";

export type StaticCategoryId = Extract<
  CategoryId,
  "activities" | "animals" | "food" | "objects" | "places" | "sports"
>;
export type WordDifficulty = "easy" | "medium" | "hard";

export type StaticWordEntry = {
  id: string;
  word: string;
  clue: string;
  categoryId: StaticCategoryId;
  categoryLabel: string;
  difficulty: WordDifficulty;
  sense?: string;
};

const normalizeWordKey = (value: string) =>
  value
    .normalize("NFD")
    .replace(/\p{M}+/gu, "")
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/gu, "-");

const buildEntries = (
  categoryId: StaticCategoryId,
  catalog: readonly (readonly [string, string, string, WordDifficulty])[],
): StaticWordEntry[] =>
  catalog.map(([id, word, clue, difficulty]) => ({
    id,
    word,
    clue,
    categoryId,
    categoryLabel: getCanonicalCategoryLabel(categoryId),
    difficulty,
  }));

export const STATIC_WORD_ENTRIES: readonly StaticWordEntry[] = [
  ...buildEntries("activities", activitiesCatalog),
  ...buildEntries("animals", animalsCatalog),
  ...buildEntries("food", foodCatalog),
  ...buildEntries("objects", objectsCatalog),
  ...buildEntries("places", placesCatalog),
  ...buildEntries("sports", sportsCatalog),
];

const entriesById = new Map(
  STATIC_WORD_ENTRIES.map((entry) => [entry.id, entry]),
);

if (entriesById.size !== STATIC_WORD_ENTRIES.length) {
  throw new Error("Static word entry IDs must be unique");
}

export const getStaticWordEntry = (entryId: string) =>
  entriesById.get(entryId) ?? null;

export const resolveLegacyStaticWordEntry = ({
  word,
  clue,
  categoryId,
  categoryLabel,
  difficulty,
  sense,
}: {
  word: string;
  clue: string;
  categoryId: StaticCategoryId;
  categoryLabel?: string;
  difficulty?: WordDifficulty;
  sense?: string;
}) => {
  if (!difficulty) return null;
  const id = `${categoryId}-${difficulty}-${normalizeWordKey(word)}`;
  const entry = entriesById.get(id);

  if (
    !entry ||
    entry.word !== word ||
    entry.clue !== clue ||
    (categoryLabel !== undefined && categoryLabel !== entry.categoryLabel) ||
    (sense ?? undefined) !== (entry.sense ?? undefined)
  ) {
    return null;
  }

  return entry;
};
