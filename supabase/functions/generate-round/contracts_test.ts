import { strict as assert } from "node:assert";
import {
  base64UrlDigestToHex,
  canonicalJson,
  createAppAttestSignedData,
  DYNAMIC_CATEGORY_IDS,
  generateEnvelopeSchema,
  generatePayloadSchema,
  getPayloadHash,
  LANGUAGE_IDS,
  roundWordRequestSchema,
  STATIC_CATEGORY_IDS,
  translatePayloadSchema,
  translationRequestSchema,
} from "./contracts.ts";

const REQUEST_ID = "018fe4d2-6c12-7b31-8c25-2c52f83c1f91";
const CHALLENGE_ID = "018fe4d2-6c12-7b31-8c25-2c52f83c1f92";

Deno.test("playedWords accepts exactly 2048 UTF-8 bytes and rejects 2049", () => {
  const exact = Array.from(
    { length: 64 },
    (_, index) => `${index.toString().padStart(2, "0")}${"a".repeat(30)}`,
  );
  const oneOver = [...exact];
  oneOver[0] += "b";
  const base = {
    categoryId: "movies",
    difficulty: "easy",
    languageId: "english",
    playerCount: 4,
  } as const;
  assert.equal(
    generatePayloadSchema.safeParse({ ...base, playedWords: exact }).success,
    true,
  );
  assert.equal(
    generatePayloadSchema.safeParse({ ...base, playedWords: oneOver }).success,
    false,
  );
});

Deno.test("paid generation accepts one dynamic category and translation accepts only entry ID", () => {
  assert.equal(
    generatePayloadSchema.safeParse({
      categoryId: "movies",
      difficulty: "medium",
      languageId: "english",
      playerCount: 4,
      playedWords: [],
    }).success,
    true,
  );
  assert.equal(
    generatePayloadSchema.safeParse({
      categoryId: "objects",
      difficulty: "medium",
      languageId: "english",
      playerCount: 4,
      playedWords: [],
    }).success,
    false,
  );
  assert.equal(
    translatePayloadSchema.safeParse({
      mode: "translate-word",
      languageId: "spanish",
      playedWords: [],
      sourceEntryId: "objects-easy-chair",
    }).success,
    true,
  );
  assert.equal(
    translatePayloadSchema.safeParse({
      mode: "translate-word",
      languageId: "spanish",
      playedWords: [],
      sourceEntryId: "objects-easy-chair",
      source: { word: "injected prompt" },
    }).success,
    false,
  );
  assert.equal(
    roundWordRequestSchema.safeParse({
      categoryIds: ["movies", "celebrities"],
      difficulty: "easy",
      languageId: "english",
      playerCount: 4,
      playedWords: [],
    }).success,
    false,
  );
});

Deno.test("paid integrity tuple is all-or-none", () => {
  const base = {
    version: 2,
    action: "generate-round",
    requestId: REQUEST_ID,
    payload: {
      categoryId: "movies",
      difficulty: "easy",
      languageId: "english",
      playerCount: 4,
      playedWords: [],
    },
  } as const;
  assert.equal(generateEnvelopeSchema.safeParse(base).success, true);
  assert.equal(
    generateEnvelopeSchema.safeParse({
      ...base,
      keyId: btoa("\0".repeat(32)),
    })
      .success,
    false,
  );
  assert.equal(
    generateEnvelopeSchema.safeParse({
      ...base,
      keyId: btoa("\0".repeat(32)),
      challengeId: CHALLENGE_ID,
      challenge: "B".repeat(43),
      assertion: "AAAA",
    }).success,
    true,
  );
});

Deno.test("canonical payload digest and signed data bind the literal function path", async () => {
  const payload = {
    playedWords: [],
    languageId: "english",
    playerCount: 4,
    difficulty: "easy",
    categoryId: "movies",
  };
  const payloadHash = await getPayloadHash(payload);
  assert.match(payloadHash, /^[A-Za-z0-9_-]{43}$/u);
  assert.match(base64UrlDigestToHex(payloadHash), /^[0-9a-f]{64}$/u);
  assert.equal(
    createAppAttestSignedData({
      action: "generate-round",
      requestId: REQUEST_ID,
      challengeId: CHALLENGE_ID,
      challenge: "B".repeat(43),
      payloadHash,
    }),
    [
      "imposter-app-attest-v1",
      "/functions/v1/generate-round",
      "generate-round",
      REQUEST_ID,
      CHALLENGE_ID,
      "B".repeat(43),
      payloadHash,
    ].join("\n"),
  );
});

Deno.test("canonical JSON sorts object keys and rejects non-safe numeric inputs", () => {
  assert.equal(
    canonicalJson({ z: 1, a: { y: 2, b: 3 } }),
    '{"a":{"b":3,"y":2},"z":1}',
  );
  assert.throws(() => canonicalJson({ value: 1.5 }), /safe integers/u);
  assert.throws(
    () => canonicalJson({ value: Number.MAX_SAFE_INTEGER + 1 }),
    /safe integers/u,
  );
});

Deno.test("all language/category/difficulty allowlists parse only in intended schemas", () => {
  for (const languageId of LANGUAGE_IDS) {
    assert.equal(
      generatePayloadSchema.safeParse({
        categoryId: "movies",
        difficulty: "easy",
        languageId,
        playerCount: 4,
        playedWords: [],
      }).success,
      true,
      languageId,
    );
  }
  for (const categoryId of DYNAMIC_CATEGORY_IDS) {
    for (const difficulty of ["easy", "medium", "hard"] as const) {
      assert.equal(
        generatePayloadSchema.safeParse({
          categoryId,
          difficulty,
          languageId: "english",
          playerCount: 4,
          playedWords: [],
        }).success,
        true,
      );
    }
  }
  for (const categoryId of STATIC_CATEGORY_IDS) {
    assert.equal(
      generatePayloadSchema.safeParse({
        categoryId,
        difficulty: "easy",
        languageId: "english",
        playerCount: 4,
        playedWords: [],
      }).success,
      false,
    );
    assert.equal(
      translationRequestSchema.safeParse({
        mode: "translate-word",
        languageId: "spanish",
        playedWords: [],
        source: {
          word: "chair",
          clue: "posture",
          categoryId,
          difficulty: "easy",
        },
      }).success,
      true,
    );
  }
  assert.equal(LANGUAGE_IDS.length, 133);
});

Deno.test("string, count, control-character, canonical-key, and unknown-key bounds reject", () => {
  const base = {
    categoryId: "movies",
    difficulty: "easy",
    languageId: "english",
    playerCount: 4,
  } as const;
  assert.equal(
    generatePayloadSchema.safeParse({
      ...base,
      playedWords: ["a".repeat(42)],
    }).success,
    true,
  );
  assert.equal(
    generatePayloadSchema.safeParse({
      ...base,
      playedWords: ["a".repeat(43)],
    }).success,
    false,
  );
  assert.equal(
    generatePayloadSchema.safeParse({
      ...base,
      playedWords: Array.from({ length: 65 }, (_, index) => String(index)),
    }).success,
    false,
  );
  assert.equal(
    generatePayloadSchema.safeParse({
      ...base,
      playedWords: ["line\nbreak"],
    }).success,
    false,
  );
  assert.equal(
    generatePayloadSchema.safeParse({
      ...base,
      playedWords: [],
      unexpected: true,
    }).success,
    false,
  );

  const envelope = {
    version: 2,
    action: "generate-round",
    requestId: REQUEST_ID,
    keyId: "zgSY9YSD+7TaDXssY6WlOPVS1K3Lmk+pFhlcSWE+ZV0=",
    challengeId: CHALLENGE_ID,
    challenge: "B".repeat(43),
    assertion: "AAAA",
    payload: { ...base, playedWords: [] },
  } as const;
  assert.equal(generateEnvelopeSchema.safeParse(envelope).success, true);
  assert.equal(
    generateEnvelopeSchema.safeParse({
      ...envelope,
      keyId: envelope.keyId.replace(/\+/gu, "-"),
    }).success,
    false,
  );
  assert.equal(
    generateEnvelopeSchema.safeParse({
      ...envelope,
      keyId: envelope.keyId.slice(0, -1),
    }).success,
    false,
  );
});
