import { strict as assert } from "node:assert";
import {
  buildProviderRequest,
  GENERATION_MAX_OUTPUT_TOKENS,
  getProviderReservation,
  OpenAIRoundProvider,
  parseAllowedModel,
  parseTranslationOutput,
  PROVIDER_COST_SAFETY_MARGIN,
  TRANSLATION_MAX_OUTPUT_TOKENS,
} from "./provider.ts";

Deno.test("reservation measures the complete serialized request and applies safety margin", () => {
  const prompt = {
    model: "gpt-5.4-mini" as const,
    systemPrompt: "system π",
    userPrompt: "user 世界",
  };
  const request = buildProviderRequest("generation", prompt);
  const serializedBytes =
    new TextEncoder().encode(JSON.stringify(request)).byteLength;
  const reservation = getProviderReservation("generation", prompt);
  const expected = Math.ceil(
    PROVIDER_COST_SAFETY_MARGIN * (
      serializedBytes * 0.75 + GENERATION_MAX_OUTPUT_TOKENS * 4.5
    ),
  );
  assert.equal(reservation.requestBytes, serializedBytes);
  assert.equal(reservation.inputTokenCeiling, serializedBytes);
  assert.equal(reservation.callUnits, expected);
  assert.equal(request.store, false);
  assert.equal(request.max_output_tokens, GENERATION_MAX_OUTPUT_TOKENS);
  assert.ok(JSON.stringify(request).includes("imposter_round_word"));
});

Deno.test("translation requests require concept matching without changing generation fields", () => {
  const prompt = {
    model: "gpt-5.4" as const,
    systemPrompt: "system",
    userPrompt: "user",
  };
  const translation = buildProviderRequest("translation", prompt);
  const schema = translation.text.format.schema as {
    properties: Record<string, { enum?: string[] }>;
    required: string[];
  };
  assert.deepEqual(schema.required, ["word", "clue", "sourceConceptMatch"]);
  assert.deepEqual(schema.properties.sourceConceptMatch.enum, [
    "same_concept",
    "broader_compatible",
    "different_or_uncertain",
  ]);
  assert.equal(translation.max_output_tokens, TRANSLATION_MAX_OUTPUT_TOKENS);
  const generation = buildProviderRequest("generation", prompt);
  const generationSchema = generation.text.format.schema as {
    required: string[];
  };
  assert.deepEqual(generationSchema.required, ["word", "clues"]);
  assert.ok(getProviderReservation("translation", prompt).requestBytes > 0);
});

Deno.test("translation parser retains text and disables artwork for missing or malformed matching metadata", () => {
  for (const sourceConceptMatch of [undefined, null, true, "same", 1, {}]) {
    assert.deepEqual(
      parseTranslationOutput({
        word: "silla",
        clue: "postura",
        sourceConceptMatch,
      }),
      {
        word: "silla",
        clue: "postura",
        sourceConceptMatch: "different_or_uncertain",
      },
    );
  }
  for (
    const sourceConceptMatch of [
      "same_concept",
      "broader_compatible",
      "different_or_uncertain",
    ]
  ) {
    assert.equal(
      parseTranslationOutput({
        word: "silla",
        clue: "postura",
        sourceConceptMatch,
      })
        .sourceConceptMatch,
      sourceConceptMatch,
    );
  }
  assert.throws(() =>
    parseTranslationOutput({ sourceConceptMatch: "same_concept" })
  );
});

Deno.test("translation adapter accepts older text output in one request and retains usage metadata", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = () => {
    calls += 1;
    return Promise.resolve(
      new Response(
        JSON.stringify({
          id: "response-1",
          object: "response",
          status: "completed",
          output: [{
            type: "message",
            id: "message-1",
            role: "assistant",
            status: "completed",
            content: [{
              type: "output_text",
              text: JSON.stringify({ word: "silla", clue: "postura" }),
              annotations: [],
            }],
          }],
          usage: { input_tokens: 50, output_tokens: 20 },
        }),
        {
          headers: {
            "content-type": "application/json",
            "x-request-id": "request-1",
          },
        },
      ),
    );
  };
  try {
    const result = await new OpenAIRoundProvider("test-key").translate({
      model: "gpt-5.4",
      systemPrompt: "system",
      userPrompt: "user",
      signal: new AbortController().signal,
    });
    assert.equal(calls, 1);
    assert.deepEqual(result, {
      value: {
        word: "silla",
        clue: "postura",
        sourceConceptMatch: "different_or_uncertain",
      },
      requestId: "request-1",
      inputTokens: 50,
      outputTokens: 20,
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test("model selection defaults only when unset and fails closed when unknown", () => {
  assert.equal(parseAllowedModel("", "gpt-5.4-mini"), "gpt-5.4-mini");
  assert.equal(parseAllowedModel(undefined, "gpt-5.4"), "gpt-5.4");
  assert.equal(parseAllowedModel("gpt-5.4-mini", "gpt-5.4"), "gpt-5.4-mini");
  assert.throws(
    () => parseAllowedModel("future-model", "gpt-5.4-mini"),
    /allowlisted/u,
  );
});
