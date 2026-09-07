import { strict as assert } from "node:assert";
import { ApiError } from "./http.ts";
import { normalizePaidPayload } from "./normalize.ts";

Deno.test("version 2 sourceEntryId resolves only backend-owned canonical prompt data", () => {
  const normalized = normalizePaidPayload("translate-word", {
    mode: "translate-word",
    languageId: "spanish",
    playedWords: [],
    sourceEntryId: "objects-easy-chair",
  });
  assert.equal(normalized.mode, "translate-word");
  if (normalized.mode !== "translate-word") throw new Error("wrong mode");
  assert.deepEqual(normalized.source, {
    word: "chair",
    clue: "posture",
    categoryId: "objects",
    categoryLabel: "Objects",
    difficulty: "easy",
  });
  assert.throws(
    () =>
      normalizePaidPayload("translate-word", {
        mode: "translate-word",
        languageId: "spanish",
        playedWords: [],
        sourceEntryId: "objects-easy-injected",
      }),
    ApiError,
  );
});

Deno.test("legacy build-3 translation tuple is exact-validated and metadata is canonicalized", () => {
  const legacy = {
    mode: "translate-word" as const,
    languageId: "spanish" as const,
    languageName: "attacker supplied label",
    languageNativeName: "attacker supplied native label",
    languageScriptHint: "attacker supplied script",
    playedWords: [],
    source: {
      word: "chair",
      clue: "posture",
      categoryId: "objects" as const,
      categoryLabel: "Objects",
      difficulty: "easy" as const,
    },
  };
  const normalized = normalizePaidPayload("translate-word", legacy);
  assert.equal(normalized.languageName, "Spanish");
  assert.equal(normalized.languageNativeName, "Español");
  assert.throws(
    () =>
      normalizePaidPayload("translate-word", {
        ...legacy,
        source: { ...legacy.source, clue: "injected" },
      }),
    ApiError,
  );
});

Deno.test("legacy build-3 generation is one dynamic category with canonical language metadata", () => {
  const normalized = normalizePaidPayload("generate-round", {
    mode: "generate-round",
    categoryIds: ["movies"],
    difficulty: "medium",
    languageId: "filipino",
    languageName: "wrong",
    playerCount: 5,
    playedWords: ["Titanic"],
  });
  assert.equal(normalized.mode, "generate-round");
  assert.equal(normalized.languageName, "Filipino");
  assert.deepEqual(normalized.categoryIds, ["movies"]);
});
