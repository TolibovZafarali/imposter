import { strict as assert } from "node:assert";
import { generatePayloadSchema, translatePayloadSchema } from "./contracts.ts";
import {
  createGenerationProviderPrompt,
  createTranslationProviderPrompt,
  generateRoundWord,
  parseLocalizedRound,
} from "./index.ts";
import {
  normalizeGeneratePayload,
  normalizeTranslatePayload,
} from "./normalize.ts";
import {
  buildProviderRequest,
  getProviderReservation,
  type RoundProvider,
} from "./provider.ts";
import { getStaticWordEntry } from "./static-data.ts";

const sourcePayload = () => ({
  mode: "translate-word" as const,
  languageId: "english" as const,
  sourceEntryId: "objects-easy-chair",
  playedWords: [],
  additionalLanguageIds: ["russian" as const, "uzbek" as const],
});

const result = () => ({
  word: "chair",
  clue: "posture",
  translations: [
    { languageId: "russian", word: "стул", clue: "осанка" },
    { languageId: "uzbek", word: "stul", clue: "qomat" },
  ],
});

Deno.test("mixed-language contracts limit canonical IDs and preserve canonical source data", () => {
  const payload = translatePayloadSchema.parse(sourcePayload());
  const normalized = normalizeTranslatePayload(payload);
  assert.deepEqual(normalized.additionalLanguageIds, ["russian", "uzbek"]);
  assert.equal(normalized.source.word, "chair");
  for (
    const additionalLanguageIds of [
      [],
      ["unknown"],
      ["russian", "russian"],
      Array(10).fill("russian"),
    ]
  ) {
    assert.equal(
      translatePayloadSchema.safeParse({ ...payload, additionalLanguageIds })
        .success,
      false,
    );
  }
});

Deno.test("mixed-language parsing preserves every translation and rejects incomplete or unsafe cards", () => {
  const input = normalizeTranslatePayload(sourcePayload());
  assert.deepEqual(parseLocalizedRound(result(), input), result());
  for (
    const translations of [undefined, [], [
      result().translations[0],
      result().translations[0],
    ], [
      { languageId: "russian", word: "chair", clue: "posture" },
      result().translations[1],
    ], [
      { languageId: "russian", word: "стул", clue: "стул" },
      result().translations[1],
    ], [result().translations[0], {
      languageId: "spanish",
      word: "silla",
      clue: "postura",
    }]]
  ) {
    assert.throws(() =>
      parseLocalizedRound({ ...result(), translations }, input)
    );
  }
  assert.throws(() =>
    parseLocalizedRound({ ...result(), word: "table" }, input)
  );
});

Deno.test("mixed-language English cards preserve trusted catalog entries exactly", () => {
  for (
    const sourceEntryId of [
      "activities-hard-knife-sharpening",
      "objects-easy-perfume",
      "sports-easy-fortnite",
    ]
  ) {
    const source = getStaticWordEntry(sourceEntryId)!;
    const input = normalizeTranslatePayload({
      ...sourcePayload(),
      sourceEntryId,
    });
    const translated = { ...result(), word: source.word, clue: source.clue };
    assert.equal(parseLocalizedRound(translated, input).word, source.word);
    const primaryUzbek = normalizeTranslatePayload({
      ...sourcePayload(),
      sourceEntryId,
      languageId: "uzbek",
      additionalLanguageIds: ["english"],
    });
    const output = parseLocalizedRound({
      word: "stul",
      clue: "qomat",
      translations: [
        { languageId: "english", word: source.word, clue: source.clue },
      ],
    }, primaryUzbek);
    assert.equal(output.translations?.[0].word, source.word);
  }
});

Deno.test("multilingual generation selects one internationally recognizable answer in one call", async () => {
  const input = normalizeGeneratePayload(generatePayloadSchema.parse({
    categoryId: "movies",
    difficulty: "easy",
    playerCount: 3,
    languageId: "english",
    additionalLanguageIds: ["russian"],
  }));
  const prompt = createGenerationProviderPrompt(
    input,
    "gpt-5.4-mini",
    "example",
  );
  assert.ok(prompt.userPrompt.includes("SAME object"));
  assert.ok(prompt.userPrompt.includes("International"));
  assert.ok(!prompt.userPrompt.includes("Return exactly 8"));
  const value = {
    word: "Titanic",
    clue: "iceberg",
    translations: [
      { languageId: "russian", word: "Титаник", clue: "айсберг" },
    ],
  };
  let calls = 0;
  const provider: RoundProvider = {
    generate: () => {
      calls++;
      return Promise.resolve({ value });
    },
    translate: () => {
      throw new Error("Unexpected second call");
    },
  };
  const generated = await generateRoundWord(
    input,
    provider,
    "gpt-5.4-mini",
    new AbortController().signal,
    prompt,
  );
  assert.deepEqual(generated.word, value);
  assert.equal(calls, 1);
});

Deno.test("multilingual provider reservations cover the full response limit and schema", () => {
  const input = normalizeTranslatePayload(sourcePayload());
  const prompt = createTranslationProviderPrompt(input, "gpt-5.4");
  const request = buildProviderRequest("translation", prompt);
  const reservation = getProviderReservation("translation", prompt);
  assert.equal(reservation.maxOutputTokens, request.max_output_tokens);
  assert.ok(request.max_output_tokens > 160);
  assert.ok(JSON.stringify(request.text.format).includes("translations"));
  const single = getProviderReservation("translation", {
    ...prompt,
    additionalLanguageIds: undefined,
  });
  assert.ok(reservation.callUnits > single.callUnits);
});
