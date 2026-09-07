import { strict as assert } from "node:assert";
import { LANGUAGES } from "../../../imposter-game/constants/languages.ts";
import { activitiesHobbiesActionsWords } from "../../../imposter-game/data/activitiesHobbiesActionsWords.ts";
import { animalWords } from "../../../imposter-game/data/animalsWords.ts";
import { everydayObjectsWords } from "../../../imposter-game/data/everydayObjectsWords.ts";
import { foodDrinkWords } from "../../../imposter-game/data/foodDrinkWords.ts";
import { placesGeographyWords } from "../../../imposter-game/data/placesGeographyWords.ts";
import { sportsGamesWords } from "../../../imposter-game/data/sportsGamesWords.ts";
import { languageCatalog } from "./catalog/languages.ts";
import { STATIC_WORD_ENTRIES } from "./static-data.ts";

Deno.test("backend language metadata exactly matches all client language IDs/names", () => {
  assert.deepEqual(
    languageCatalog,
    LANGUAGES.map(({ id, name, nativeName }) => [id, name, nativeName]),
  );
  assert.equal(languageCatalog.length, 133);
});

Deno.test("backend static prompt catalog stays in tuple parity with the six client packs", () => {
  const packs = [
    ["activities", activitiesHobbiesActionsWords],
    ["animals", animalWords],
    ["food", foodDrinkWords],
    ["objects", everydayObjectsWords],
    ["places", placesGeographyWords],
    ["sports", sportsGamesWords],
  ] as const;
  const clientEntries = packs.flatMap(([categoryId, pack]) =>
    (["easy", "medium", "hard"] as const).flatMap((difficulty) =>
      pack.difficulties[difficulty].map(({ secret, hint }) => ({
        categoryId,
        difficulty,
        word: secret,
        clue: hint,
      }))
    )
  );
  assert.equal(STATIC_WORD_ENTRIES.length, 2_985);
  assert.deepEqual(
    STATIC_WORD_ENTRIES.map(({ categoryId, difficulty, word, clue }) => ({
      categoryId,
      difficulty,
      word,
      clue,
    })),
    clientEntries,
  );
});
