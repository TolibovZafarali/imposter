// deno-lint-ignore-file require-await
import { strict as assert } from "node:assert";
import { AppAttestVerificationError } from "./app-attest.ts";
import { canonicalJson, sha256Hex } from "./contracts.ts";
import {
  createGenerationProviderPrompt,
  createHandler,
  getClientFingerprint,
  type HandlerDependencies,
} from "./index.ts";
import { PersistenceError, type RoundPersistence } from "./persistence.ts";
import type { RoundProvider } from "./provider.ts";

const REQUEST_ID = "018fe4d2-6c12-7b31-8c25-2c52f83c1f91";
const CHALLENGE_ID = "018fe4d2-6c12-7b31-8c25-2c52f83c1f92";
const KEY_ID = btoa("\0".repeat(32));
const CHALLENGE = "B".repeat(43);

const baseEnvironment: Record<string, string> = {
  AI_ROUND_RATE_LIMIT_SALT: "test-only-rate-limit-salt-with-32-bytes",
  OPENAI_API_KEY: "test-key",
  APPLE_APP_ID_PREFIX: "ABCDE12345",
  APPLE_TEAM_ID: "ABCDE12345",
  APPLE_BUNDLE_ID: "com.cnfstudios.imposter",
  APP_ATTEST_ENVIRONMENT: "production",
  APP_ATTEST_ALLOWED_BUNDLE_VERSIONS: "3",
  APP_ATTEST_ALLOWED_VALIDATION_CATEGORIES: "2,4",
};

const envFor = (overrides: Record<string, string> = {}) => {
  const values = { ...baseEnvironment, ...overrides };
  return (name: string) => values[name] ?? "";
};

const persistenceFor = (
  overrides: Partial<RoundPersistence> = {},
): RoundPersistence => ({
  issueChallenge: async () => ({ status: "issued" }),
  getAttestKey: async () => null,
  registerAttestKey: async () => ({ status: "registered" }),
  beginRequest: async () => ({ status: "service_unavailable" }),
  reserveModelCall: async () => ({ status: "service_unavailable" }),
  recordModelCall: async () => ({ status: "recorded" }),
  completeRequest: async () => ({ status: "completed" }),
  failRequest: async () => ({ status: "failed" }),
  ...overrides,
});

const providerFor = (
  onTranslate: () => void = () => {},
): RoundProvider => ({
  generate: async () => {
    throw new Error("Unexpected generation call");
  },
  translate: async () => {
    onTranslate();
    return {
      value: { word: "chair", clue: "posture" },
      requestId: "provider-request-id",
      inputTokens: 50,
      outputTokens: 10,
    };
  },
});

const translationEnvelope = () => ({
  version: 2,
  action: "translate-word",
  requestId: REQUEST_ID,
  payload: {
    mode: "translate-word",
    languageId: "english",
    playedWords: [],
    sourceEntryId: "objects-easy-chair",
  },
});

const post = (
  body: unknown,
  action?: string,
  headers: Record<string, string> = {},
) =>
  new Request("https://example.test/functions/v1/generate-round", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "cf-connecting-ip": "203.0.113.10",
      "user-agent": "Imposter/3",
      ...(body && typeof body === "object" &&
          typeof (body as Record<string, unknown>).requestId === "string"
        ? { "x-request-id": (body as Record<string, string>).requestId }
        : {}),
      ...(action ? { "x-imposter-action": action } : {}),
      ...headers,
    },
    body: JSON.stringify(body),
  });

Deno.test("successful paid request admits, reserves once, calls provider once, and completes", async () => {
  let providerCalls = 0;
  let beginPayloadHash = "";
  let reservation:
    | Parameters<RoundPersistence["reserveModelCall"]>[0]
    | undefined;
  let recorded: Parameters<RoundPersistence["recordModelCall"]>[0] | undefined;
  const persistence = persistenceFor({
    beginRequest: async (input) => {
      beginPayloadHash = input.payloadHashHex;
      return {
        status: "accepted",
        execution_id: "018fe4d2-6c12-7b31-8c25-2c52f83c1f93",
        lease_token: "018fe4d2-6c12-7b31-8c25-2c52f83c1f94",
        lease_fence: 1,
        attestation_class: "legacy",
      };
    },
    reserveModelCall: async (input) => {
      reservation = input;
      return { status: "reserved", duplicate: false, call_id: "call-1" };
    },
    recordModelCall: async (input) => {
      recorded = input;
      return { status: "recorded" };
    },
  });
  const body = translationEnvelope();
  const handler = createHandler({
    env: envFor(),
    createPersistence: () => persistence,
    createProvider: () =>
      providerFor(() => {
        providerCalls += 1;
      }),
  });

  const response = await handler.fetch(post(body, "translate-word"));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { word: "chair", clue: "posture" });
  assert.equal(providerCalls, 1);
  assert.equal(reservation?.stage, "translation");
  assert.equal(reservation?.model, "gpt-5.4");
  assert.ok((reservation?.callUnits ?? 0) > 0);
  assert.equal(reservation?.maxOutputTokens, 160);
  assert.equal(recorded?.providerRequestIdHash?.length, 64);
  assert.equal(beginPayloadHash, await sha256Hex(canonicalJson(body.payload)));
});

Deno.test("an existing or duplicate reservation never calls the provider", async () => {
  let providerCalls = 0;
  let providerCreations = 0;
  const persistence = persistenceFor({
    beginRequest: async () => ({
      status: "accepted",
      execution_id: "execution-1",
      lease_token: "lease-1",
      lease_fence: 1,
      attestation_class: "legacy",
    }),
    reserveModelCall: async () => ({
      status: "already_reserved",
      call_id: "call-1",
    }),
  });
  const handler = createHandler({
    env: envFor(),
    createPersistence: () => persistence,
    createProvider: () => {
      providerCreations += 1;
      return providerFor(() => {
        providerCalls += 1;
      });
    },
  });

  const response = await handler.fetch(
    post(translationEnvelope(), "translate-word"),
  );
  assert.equal(response.status, 502);
  assert.equal((await response.json()).code, "provider_failure");
  assert.equal(providerCreations, 0);
  assert.equal(providerCalls, 0);
});

Deno.test("unknown nonempty model configuration fails closed before reservation/provider", async () => {
  let reserves = 0;
  let providerCalls = 0;
  const persistence = persistenceFor({
    beginRequest: async () => ({
      status: "accepted",
      execution_id: "execution-1",
      lease_token: "lease-1",
      lease_fence: 1,
      attestation_class: "legacy",
    }),
    reserveModelCall: async () => {
      reserves += 1;
      return { status: "reserved", duplicate: false, call_id: "call-1" };
    },
  });
  const handler = createHandler({
    env: envFor({ OPENAI_TRANSLATION_MODEL: "not-an-approved-model" }),
    createPersistence: () => persistence,
    createProvider: () =>
      providerFor(() => {
        providerCalls += 1;
      }),
  });

  const response = await handler.fetch(
    post(translationEnvelope(), "translate-word"),
  );
  assert.equal(response.status, 503);
  assert.equal((await response.json()).code, "service_unavailable");
  assert.equal(reserves, 0);
  assert.equal(providerCalls, 0);
});

Deno.test("registration challenge uses requestId as idempotency key", async () => {
  let issued: Parameters<RoundPersistence["issueChallenge"]>[0] | undefined;
  const persistence = persistenceFor({
    issueChallenge: async (input) => {
      issued = input;
      return {
        status: "issued",
        challenge_id: CHALLENGE_ID,
        challenge: CHALLENGE,
        expires_at: "2026-08-19T20:00:00Z",
        duplicate: false,
      };
    },
  });
  const handler = createHandler({
    env: envFor(),
    createPersistence: () => persistence,
  });
  const response = await handler.fetch(post({
    version: 2,
    action: "challenge",
    requestId: REQUEST_ID,
    keyId: KEY_ID,
    purpose: "register",
  }, "challenge"));

  assert.equal(response.status, 200);
  assert.equal(issued?.idempotencyKey, REQUEST_ID);
  assert.equal(issued?.purpose, "attest");
  assert.match(issued?.requestKeyHash ?? "", /^[0-9a-f]{64}$/u);
});

Deno.test("invalid supplied proof downgrades to legacy in observe and emits self-heal header", async () => {
  let beginInput: Parameters<RoundPersistence["beginRequest"]>[0] | undefined;
  const persistence = persistenceFor({
    getAttestKey: async (keyIdHash) => ({
      keyIdHash,
      publicKeyBase64: "AAAA",
      assertionCounter: 2,
      environment: "production",
      status: "active",
    }),
    beginRequest: async (input) => {
      beginInput = input;
      return {
        status: "completed",
        response: { word: "chair", clue: "posture" },
      };
    },
  });
  const body = {
    ...translationEnvelope(),
    challengeId: CHALLENGE_ID,
    challenge: CHALLENGE,
    keyId: KEY_ID,
    assertion: "AAAA",
  };
  const handler = createHandler({
    env: envFor(),
    createPersistence: () => persistence,
    createProvider: () => providerFor(),
    verifyAssertion: async () => {
      throw new AppAttestVerificationError("invalid fixture assertion");
    },
  });

  const response = await handler.fetch(post(body, "translate-word"));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("x-imposter-integrity"), "invalid");
  assert.equal(beginInput?.attestKeyIdHash, undefined);
  assert.match(beginInput?.requestKeyHash ?? "", /^[0-9a-f]{64}$/u);
});

Deno.test("stalled admission shares the overall deadline and makes zero provider calls", async () => {
  let providerCalls = 0;
  let deadlineSignal: AbortSignal | undefined;
  const handler = createHandler({
    env: envFor(),
    deadlineMs: 20,
    createPersistence: (signal) => {
      deadlineSignal = signal;
      return persistenceFor({
        beginRequest: () =>
          new Promise((_, reject) => {
            signal.addEventListener("abort", () => reject(signal.reason), {
              once: true,
            });
          }),
      });
    },
    createProvider: () =>
      providerFor(() => {
        providerCalls += 1;
      }),
  });

  const response = await handler.fetch(
    post(translationEnvelope(), "translate-word"),
  );
  assert.equal(response.status, 503);
  assert.equal((await response.json()).code, "service_unavailable");
  assert.equal(deadlineSignal?.aborted, true);
  assert.equal(providerCalls, 0);
});

Deno.test("version 2 action header is required and challenge cap is applied while streaming", async () => {
  let persistenceCreations = 0;
  const dependencies: HandlerDependencies = {
    env: envFor(),
    createPersistence: () => {
      persistenceCreations += 1;
      return persistenceFor();
    },
  };
  const handler = createHandler(dependencies);
  const missingHeader = await handler.fetch(post(translationEnvelope()));
  assert.equal(missingHeader.status, 400);
  assert.equal((await missingHeader.json()).code, "invalid_request");

  const oversized = await handler.fetch(post({
    version: 2,
    action: "challenge",
    requestId: REQUEST_ID,
    keyId: `${KEY_ID}${"A".repeat(500)}`,
    purpose: "register",
    padding: "x".repeat(2_048),
  }, "challenge"));
  assert.equal(oversized.status, 413);
  assert.equal((await oversized.json()).code, "payload_too_large");
  assert.equal(persistenceCreations, 0);
});

Deno.test("version 2 request ID header is required and must match the signed body ID", async () => {
  let persistenceCreations = 0;
  const handler = createHandler({
    env: envFor(),
    createPersistence: () => {
      persistenceCreations += 1;
      return persistenceFor();
    },
  });
  const body = translationEnvelope();
  const missing = new Request(
    "https://example.test/functions/v1/generate-round",
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-imposter-action": "translate-word",
      },
      body: JSON.stringify(body),
    },
  );
  const mismatch = post(body, "translate-word", {
    "x-request-id": "018fe4d2-6c12-7b31-8c25-2c52f83c1f99",
  });
  for (const request of [missing, mismatch]) {
    const response = await handler.fetch(request);
    assert.equal(response.status, 400);
    assert.equal((await response.json()).code, "invalid_request");
  }
  assert.equal(persistenceCreations, 0);
});

Deno.test("fingerprint prefers platform address headers and normalized rightmost XFF fallback", () => {
  const direct = new Request("https://example.test", {
    headers: {
      "cf-connecting-ip": "2001:DB8::1",
      "x-forwarded-for": "198.51.100.1, 198.51.100.2",
      "user-agent": "Imposter/3",
    },
  });
  assert.equal(getClientFingerprint(direct), "2001:db8::1\nImposter/3");

  const forwarded = new Request("https://example.test", {
    headers: {
      "x-forwarded-for": "malformed, 198.51.100.2",
      "user-agent": "Imposter/3",
    },
  });
  assert.equal(getClientFingerprint(forwarded), "198.51.100.2\nImposter/3");
});

Deno.test("generation prompt keeps the newest 50 words from newest-first history", () => {
  const playedWords = Array.from(
    { length: 64 },
    (_, index) => `recent-${index.toString().padStart(2, "0")}`,
  );
  const prompt = createGenerationProviderPrompt(
    {
      mode: "generate-round",
      categoryIds: ["movies"],
      difficulty: "easy",
      playerCount: 4,
      playedWords,
      languageId: "english",
      languageName: "English",
      languageNativeName: "English",
      languageScriptHint: "Latin script",
    },
    "gpt-5.4-mini",
    "fixed-variety",
  ).userPrompt;
  assert.ok(prompt.includes("recent-00"));
  assert.ok(prompt.includes("recent-49"));
  assert.equal(prompt.includes("recent-50"), false);
  assert.equal(prompt.includes("recent-63"), false);
});

Deno.test("hard kill returns before persistence or provider construction", async () => {
  let persistenceCreations = 0;
  let providerCreations = 0;
  const handler = createHandler({
    env: envFor({ AI_ROUND_HARD_DISABLED: "true" }),
    createPersistence: () => {
      persistenceCreations += 1;
      return persistenceFor();
    },
    createProvider: () => {
      providerCreations += 1;
      return providerFor();
    },
  });
  const response = await handler.fetch(
    post(translationEnvelope(), "translate-word"),
  );
  assert.equal(response.status, 503);
  assert.equal((await response.json()).code, "generation_disabled");
  assert.equal(persistenceCreations, 0);
  assert.equal(providerCreations, 0);
});

Deno.test("database failure is fail-closed and never reaches provider", async () => {
  let providerCalls = 0;
  const handler = createHandler({
    env: envFor(),
    createPersistence: () =>
      persistenceFor({
        beginRequest: async () => {
          throw new PersistenceError();
        },
      }),
    createProvider: () =>
      providerFor(() => {
        providerCalls += 1;
      }),
  });
  const response = await handler.fetch(
    post(translationEnvelope(), "translate-word"),
  );
  assert.equal(response.status, 503);
  assert.equal((await response.json()).code, "service_unavailable");
  assert.equal(providerCalls, 0);
});

Deno.test("admission replay and conflict statuses map to stable public codes without provider calls", async () => {
  const cases = [
    [
      { status: "completed", response: { word: "chair", clue: "posture" } },
      200,
      undefined,
    ],
    [{ status: "in_progress" }, 409, "request_in_progress"],
    [
      { status: "failed", error_code: "provider_timeout" },
      504,
      "provider_timeout",
    ],
    [{ status: "conflict" }, 409, "idempotency_conflict"],
  ] as const;
  for (const [admission, status, code] of cases) {
    let providerCalls = 0;
    const handler = createHandler({
      env: envFor(),
      createPersistence: () =>
        persistenceFor({ beginRequest: async () => admission }),
      createProvider: () =>
        providerFor(() => {
          providerCalls += 1;
        }),
    });
    const response = await handler.fetch(
      post(translationEnvelope(), "translate-word"),
    );
    assert.equal(response.status, status);
    const body = await response.json();
    if (code) assert.equal(body.code, code);
    assert.equal(providerCalls, 0);
  }
});

Deno.test("model-call cost quota maps to budget and call quota maps to rate limit", async () => {
  const cases = [
    ["global_daily_cost_microusd", "budget_exhausted"],
    ["legacy_daily_model_calls", "rate_limited"],
  ] as const;
  for (const [scope, expectedCode] of cases) {
    let providerCalls = 0;
    const handler = createHandler({
      env: envFor(),
      createPersistence: () =>
        persistenceFor({
          beginRequest: async () => ({
            status: "accepted",
            execution_id: "execution-1",
            lease_token: "lease-1",
            lease_fence: 1,
            attestation_class: "legacy",
            attestation_status: "missing",
          }),
          reserveModelCall: async () => ({ status: "quota_exhausted", scope }),
        }),
      createProvider: () =>
        providerFor(() => {
          providerCalls += 1;
        }),
    });
    const response = await handler.fetch(
      post(translationEnvelope(), "translate-word"),
    );
    assert.equal(response.status, 429);
    assert.equal((await response.json()).code, expectedCode);
    assert.equal(providerCalls, 0);
  }
});

Deno.test("provider failure is called once, cached as failed, and retry makes zero new calls", async () => {
  let providerCalls = 0;
  let failed = false;
  const persistence = persistenceFor({
    beginRequest: async () =>
      failed ? { status: "failed", error_code: "provider_failure" } : {
        status: "accepted",
        execution_id: "execution-1",
        lease_token: "lease-1",
        lease_fence: 1,
        attestation_class: "legacy",
        attestation_status: "missing",
      },
    reserveModelCall: async () => ({
      status: "reserved",
      duplicate: false,
      call_id: "call-1",
    }),
    failRequest: async () => {
      failed = true;
      return { status: "failed" };
    },
  });
  const invalidProvider: RoundProvider = {
    generate: async () => {
      throw new Error("unexpected");
    },
    translate: async () => {
      providerCalls += 1;
      return { value: { word: "chair", clue: "chair" } };
    },
  };
  const handler = createHandler({
    env: envFor(),
    createPersistence: () => persistence,
    createProvider: () => invalidProvider,
  });

  const first = await handler.fetch(
    post(translationEnvelope(), "translate-word"),
  );
  assert.equal(first.status, 502);
  assert.equal((await first.json()).code, "provider_failure");
  const second = await handler.fetch(
    post(translationEnvelope(), "translate-word"),
  );
  assert.equal(second.status, 502);
  assert.equal((await second.json()).code, "provider_failure");
  assert.equal(providerCalls, 1);
});

Deno.test("provider deadline aborts one call and returns provider_timeout", async () => {
  let providerCalls = 0;
  const persistence = persistenceFor({
    beginRequest: async () => ({
      status: "accepted",
      execution_id: "execution-1",
      lease_token: "lease-1",
      lease_fence: 1,
      attestation_class: "legacy",
      attestation_status: "missing",
    }),
    reserveModelCall: async () => ({
      status: "reserved",
      duplicate: false,
      call_id: "call-1",
    }),
  });
  const provider: RoundProvider = {
    generate: async () => {
      throw new Error("unexpected");
    },
    translate: ({ signal }) => {
      providerCalls += 1;
      return new Promise((_, reject) => {
        signal.addEventListener("abort", () => reject(signal.reason), {
          once: true,
        });
      });
    },
  };
  const handler = createHandler({
    env: envFor(),
    deadlineMs: 20,
    createPersistence: () => persistence,
    createProvider: () => provider,
  });
  const response = await handler.fetch(
    post(translationEnvelope(), "translate-word"),
  );
  assert.equal(response.status, 504);
  assert.equal((await response.json()).code, "provider_timeout");
  assert.equal(providerCalls, 1);
});

Deno.test("valid proof under policy off preserves the key and emits no invalid header", async () => {
  let providerCalls = 0;
  const persistence = persistenceFor({
    getAttestKey: async (keyIdHash) => ({
      keyIdHash,
      publicKeyBase64: "AAAA",
      assertionCounter: 2,
      environment: "production",
      status: "active",
    }),
    beginRequest: async () => ({
      status: "accepted",
      execution_id: "execution-1",
      lease_token: "lease-1",
      lease_fence: 1,
      attestation_class: "legacy",
      attestation_status: "off",
    }),
    reserveModelCall: async () => ({
      status: "reserved",
      duplicate: false,
      call_id: "call-1",
    }),
  });
  const body = {
    ...translationEnvelope(),
    challengeId: CHALLENGE_ID,
    challenge: CHALLENGE,
    keyId: KEY_ID,
    assertion: "AAAA",
  };
  const handler = createHandler({
    env: envFor(),
    createPersistence: () => persistence,
    createProvider: () =>
      providerFor(() => {
        providerCalls += 1;
      }),
    verifyAssertion: async () => ({ signCount: 3 }),
  });
  const response = await handler.fetch(post(body, "translate-word"));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("x-imposter-integrity"), null);
  assert.equal(providerCalls, 1);
});

Deno.test("byte-identical lost-response retry permits equal counter and returns cached result", async () => {
  let keyCounter = 2;
  let completed = false;
  let providerCalls = 0;
  let assertionChecks = 0;
  const persistence = persistenceFor({
    getAttestKey: async (keyIdHash) => ({
      keyIdHash,
      publicKeyBase64: "AAAA",
      assertionCounter: keyCounter,
      environment: "production",
      status: "active",
    }),
    beginRequest: async (input) => {
      if (completed) {
        return {
          status: "completed",
          response: { word: "chair", clue: "posture" },
        };
      }
      assert.equal(input.attestPreviousCounter, 2);
      assert.equal(input.attestNewCounter, 3);
      keyCounter = 3;
      return {
        status: "accepted",
        execution_id: "execution-1",
        lease_token: "lease-1",
        lease_fence: 1,
        attestation_class: "attested",
        attestation_status: "valid",
      };
    },
    reserveModelCall: async () => ({
      status: "reserved",
      duplicate: false,
      call_id: "call-1",
    }),
    completeRequest: async () => {
      completed = true;
      return { status: "completed" };
    },
  });
  const body = {
    ...translationEnvelope(),
    challengeId: CHALLENGE_ID,
    challenge: CHALLENGE,
    keyId: KEY_ID,
    assertion: "AAAA",
  };
  const handler = createHandler({
    env: envFor(),
    createPersistence: () => persistence,
    createProvider: () =>
      providerFor(() => {
        providerCalls += 1;
      }),
    verifyAssertion: async (input) => {
      assertionChecks += 1;
      assert.equal(input.allowEqualSignCount, true);
      return { signCount: 3 };
    },
  });

  const first = await handler.fetch(post(body, "translate-word"));
  const retry = await handler.fetch(post(body, "translate-word"));
  assert.equal(first.status, 200);
  assert.equal(retry.status, 200);
  assert.equal(retry.headers.get("x-imposter-integrity"), null);
  assert.equal(providerCalls, 1);
  assert.equal(assertionChecks, 2);
});

Deno.test("stalled request body is cancelled by the same overall deadline", async () => {
  let persistenceCreations = 0;
  const stream = new ReadableStream<Uint8Array>({ start() {} });
  const request = new Request(
    "https://example.test/functions/v1/generate-round",
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-imposter-action": "challenge",
      },
      body: stream,
    },
  );
  const handler = createHandler({
    env: envFor(),
    deadlineMs: 20,
    createPersistence: () => {
      persistenceCreations += 1;
      return persistenceFor();
    },
  });
  const response = await handler.fetch(request);
  assert.equal(response.status, 503);
  assert.equal((await response.json()).code, "service_unavailable");
  assert.equal(persistenceCreations, 0);
});
