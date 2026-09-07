import { strict as assert } from "node:assert";
import { buildReserveRpcParameters } from "./persistence.ts";

Deno.test("model-call reservation sends SQL attempt 1 and exact lease arguments", () => {
  assert.deepEqual(
    buildReserveRpcParameters({
      executionId: "execution-id",
      leaseToken: "lease-token",
      leaseFence: 7,
      stage: "generation",
      model: "gpt-5.4-mini",
      callUnits: 12345,
      maxOutputTokens: 260,
    }),
    {
      p_execution_id: "execution-id",
      p_lease_token: "lease-token",
      p_lease_fence: 7,
      p_stage: "generation",
      p_attempt: 1,
      p_model: "gpt-5.4-mini",
      p_call_units: 12345,
      p_max_output_tokens: 260,
    },
  );
});
