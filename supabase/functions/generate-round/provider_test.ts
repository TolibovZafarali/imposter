import { strict as assert } from "node:assert";
import {
  buildProviderRequest,
  GENERATION_MAX_OUTPUT_TOKENS,
  getProviderReservation,
  parseAllowedModel,
  PROVIDER_COST_SAFETY_MARGIN,
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

Deno.test("model selection defaults only when unset and fails closed when unknown", () => {
  assert.equal(parseAllowedModel("", "gpt-5.4-mini"), "gpt-5.4-mini");
  assert.equal(parseAllowedModel(undefined, "gpt-5.4"), "gpt-5.4");
  assert.equal(parseAllowedModel("gpt-5.4-mini", "gpt-5.4"), "gpt-5.4-mini");
  assert.throws(
    () => parseAllowedModel("future-model", "gpt-5.4-mini"),
    /allowlisted/u,
  );
});
