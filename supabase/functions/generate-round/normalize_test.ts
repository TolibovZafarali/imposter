import { strict as assert } from "node:assert";
import { getIllustrationSense } from "./catalog/illustration-senses.ts";
import { ApiError } from "./http.ts";
import { normalizePaidPayload } from "./normalize.ts";
import { createTranslationProviderPrompt } from "./index.ts";

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
    sense: getIllustrationSense("objects-easy-chair"),
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
  if (normalized.mode !== "translate-word") throw new Error("wrong mode");
  assert.equal(
    normalized.source.sense,
    getIllustrationSense("objects-easy-chair"),
  );
  assert.throws(
    () =>
      normalizePaidPayload("translate-word", {
        ...legacy,
        source: { ...legacy.source, clue: "injected" },
      }),
    ApiError,
  );
  assert.throws(
    () =>
      normalizePaidPayload("translate-word", {
        ...legacy,
        source: {
          ...legacy.source,
          sense: getIllustrationSense("objects-easy-chair"),
        },
      }),
    ApiError,
  );
});

Deno.test("both translation protocols use the exact depicted sense after catalog validation", () => {
  const payloads = [
    {
      mode: "translate-word" as const,
      languageId: "spanish" as const,
      playedWords: [],
      sourceEntryId: "sports-easy-bat",
    },
    {
      mode: "translate-word" as const,
      languageId: "spanish" as const,
      playedWords: [],
      source: {
        word: "bat",
        clue: "swing",
        categoryId: "sports" as const,
        categoryLabel: "Sports",
        difficulty: "easy" as const,
      },
    },
  ];
  for (const payload of payloads) {
    const normalized = normalizePaidPayload("translate-word", payload);
    if (normalized.mode !== "translate-word") throw new Error("wrong mode");
    assert.equal(normalized.source.sense, "A baseball bat; not an animal.");
    const prompt = createTranslationProviderPrompt(normalized, "gpt-5.4");
    assert.ok(prompt.userPrompt.includes(
      "English source sense: A baseball bat; not an animal.",
    ));
    assert.ok(prompt.userPrompt.includes(
      "it defines the pictured subject and takes precedence",
    ));
  }
});

Deno.test("excluded entries retain their existing text-only translation source", () => {
  const normalized = normalizePaidPayload("translate-word", {
    mode: "translate-word",
    languageId: "spanish",
    playedWords: [],
    sourceEntryId: "activities-easy-thinking",
  });
  if (normalized.mode !== "translate-word") throw new Error("wrong mode");
  assert.equal(normalized.source.word, "thinking");
  assert.equal(normalized.source.sense, undefined);
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
