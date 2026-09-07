import { createClient } from "npm:@supabase/supabase-js@2.112.3";

export type RpcResult = Record<string, unknown> & { status: string };

export type AttestKeyRecord = {
  keyIdHash: string;
  publicKeyBase64: string;
  assertionCounter: number;
  environment: "production" | "development";
  status: "active" | "revoked";
};

export type Lease = {
  executionId: string;
  leaseToken: string;
  leaseFence: number;
};

export interface RoundPersistence {
  issueChallenge(input: {
    purpose: "attest" | "assert";
    requestKeyHash: string;
    keyIdHash: string;
    payloadHashHex?: string;
    idempotencyKey?: string;
  }): Promise<RpcResult>;
  getAttestKey(keyIdHash: string): Promise<AttestKeyRecord | null>;
  registerAttestKey(input: {
    keyIdHash: string;
    publicKeyBase64: string;
    receiptBase64: string;
    bundleId: string;
    teamId: string;
    environment: "production" | "development";
    challengeId: string;
    challenge: string;
    requestKeyHash: string;
    idempotencyKey: string;
  }): Promise<RpcResult>;
  beginRequest(input: {
    requestKeyHash: string;
    idempotencyKey: string;
    payloadHashHex: string;
    mode: "generate-round" | "translate-word";
    attestKeyIdHash?: string;
    attestChallengeId?: string;
    attestChallenge?: string;
    attestPreviousCounter?: number;
    attestNewCounter?: number;
  }): Promise<RpcResult>;
  reserveModelCall(
    input: Lease & {
      stage: "generation" | "translation";
      model: "gpt-5.4" | "gpt-5.4-mini";
      callUnits: number;
      maxOutputTokens: number;
    },
  ): Promise<RpcResult>;
  recordModelCall(
    input: Lease & {
      callId: string;
      status: "completed" | "failed";
      inputTokens?: number;
      outputTokens?: number;
      providerRequestIdHash?: string;
    },
  ): Promise<RpcResult>;
  completeRequest(
    input: Lease & { response: Record<string, unknown> },
  ): Promise<RpcResult>;
  failRequest(input: Lease & { errorCode: string }): Promise<RpcResult>;
}

export class PersistenceError extends Error {
  constructor() {
    super("Persistence operation failed");
    this.name = "PersistenceError";
  }
}

type UntypedQuery = {
  select(columns: string): UntypedQuery;
  eq(column: string, value: unknown): UntypedQuery;
  maybeSingle(): Promise<{ data: unknown; error: unknown }>;
};

type UntypedSupabaseClient = {
  rpc(
    name: string,
    parameters: Record<string, unknown>,
  ): Promise<{ data: unknown; error: unknown }>;
  from(name: string): UntypedQuery;
};

const asRpcResult = (value: unknown): RpcResult => {
  if (
    !value || typeof value !== "object" ||
    typeof (value as { status?: unknown }).status !== "string"
  ) {
    throw new PersistenceError();
  }
  return value as RpcResult;
};

export const buildReserveRpcParameters = (
  input: Lease & {
    stage: "generation" | "translation";
    model: "gpt-5.4" | "gpt-5.4-mini";
    callUnits: number;
    maxOutputTokens: number;
  },
) => ({
  p_execution_id: input.executionId,
  p_lease_token: input.leaseToken,
  p_lease_fence: input.leaseFence,
  p_stage: input.stage,
  p_attempt: 1,
  p_model: input.model,
  p_call_units: input.callUnits,
  p_max_output_tokens: input.maxOutputTokens,
});

export class SupabaseRoundPersistence implements RoundPersistence {
  readonly #client: UntypedSupabaseClient;

  constructor(url: string, secretKey: string, deadlineSignal?: AbortSignal) {
    this.#client = createClient(url, secretKey, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: {
        fetch: (input, init) =>
          fetch(input, {
            ...init,
            ...(deadlineSignal ? { signal: deadlineSignal } : {}),
          }),
      },
    }) as unknown as UntypedSupabaseClient;
  }

  async #rpc(name: string, parameters: Record<string, unknown>) {
    const { data, error } = await this.#client.rpc(name, parameters);
    if (error) throw new PersistenceError();
    return asRpcResult(data);
  }

  issueChallenge(input: {
    purpose: "attest" | "assert";
    requestKeyHash: string;
    keyIdHash: string;
    payloadHashHex?: string;
    idempotencyKey?: string;
  }) {
    return this.#rpc("issue_ai_app_attest_challenge", {
      p_purpose: input.purpose,
      p_request_key_hash: input.requestKeyHash,
      p_key_id_hash: input.keyIdHash,
      p_payload_hash: input.payloadHashHex ?? null,
      p_idempotency_key: input.idempotencyKey ?? null,
    });
  }

  async getAttestKey(keyIdHash: string): Promise<AttestKeyRecord | null> {
    const { data, error } = await this.#client
      .from("app_attest_keys")
      .select(
        "key_id_hash,public_key_base64,assertion_counter,environment,status",
      )
      .eq("key_id_hash", keyIdHash)
      .maybeSingle();
    if (error) throw new PersistenceError();
    if (!data || typeof data !== "object") return null;
    const record = data as Record<string, unknown>;
    if (
      typeof record.key_id_hash !== "string" ||
      typeof record.public_key_base64 !== "string" ||
      typeof record.assertion_counter !== "number" ||
      (record.environment !== "production" &&
        record.environment !== "development") ||
      (record.status !== "active" && record.status !== "revoked")
    ) {
      throw new PersistenceError();
    }
    return {
      keyIdHash: record.key_id_hash,
      publicKeyBase64: record.public_key_base64,
      assertionCounter: record.assertion_counter,
      environment: record.environment,
      status: record.status,
    };
  }

  registerAttestKey(input: {
    keyIdHash: string;
    publicKeyBase64: string;
    receiptBase64: string;
    bundleId: string;
    teamId: string;
    environment: "production" | "development";
    challengeId: string;
    challenge: string;
    requestKeyHash: string;
    idempotencyKey: string;
  }) {
    return this.#rpc("register_ai_app_attest_key", {
      p_key_id_hash: input.keyIdHash,
      p_public_key_base64: input.publicKeyBase64,
      p_receipt_base64: input.receiptBase64,
      p_bundle_id: input.bundleId,
      p_team_id: input.teamId,
      p_environment: input.environment,
      p_challenge_id: input.challengeId,
      p_challenge: input.challenge,
      p_request_key_hash: input.requestKeyHash,
      p_idempotency_key: input.idempotencyKey,
    });
  }

  beginRequest(input: {
    requestKeyHash: string;
    idempotencyKey: string;
    payloadHashHex: string;
    mode: "generate-round" | "translate-word";
    attestKeyIdHash?: string;
    attestChallengeId?: string;
    attestChallenge?: string;
    attestPreviousCounter?: number;
    attestNewCounter?: number;
  }) {
    return this.#rpc("begin_ai_round_request", {
      p_request_key_hash: input.requestKeyHash,
      p_idempotency_key: input.idempotencyKey,
      p_payload_hash: input.payloadHashHex,
      p_mode: input.mode,
      p_attest_key_id_hash: input.attestKeyIdHash ?? null,
      p_attest_challenge_id: input.attestChallengeId ?? null,
      p_attest_challenge: input.attestChallenge ?? null,
      p_attest_previous_counter: input.attestPreviousCounter ?? null,
      p_attest_new_counter: input.attestNewCounter ?? null,
    });
  }

  reserveModelCall(
    input: Lease & {
      stage: "generation" | "translation";
      model: "gpt-5.4" | "gpt-5.4-mini";
      callUnits: number;
      maxOutputTokens: number;
    },
  ) {
    return this.#rpc("reserve_ai_model_call", buildReserveRpcParameters(input));
  }

  recordModelCall(
    input: Lease & {
      callId: string;
      status: "completed" | "failed";
      inputTokens?: number;
      outputTokens?: number;
      providerRequestIdHash?: string;
    },
  ) {
    return this.#rpc("record_ai_model_call", {
      p_call_id: input.callId,
      p_execution_id: input.executionId,
      p_lease_token: input.leaseToken,
      p_lease_fence: input.leaseFence,
      p_status: input.status,
      p_input_tokens: input.inputTokens ?? null,
      p_output_tokens: input.outputTokens ?? null,
      p_provider_request_id_hash: input.providerRequestIdHash ?? null,
    });
  }

  completeRequest(input: Lease & { response: Record<string, unknown> }) {
    return this.#rpc("complete_ai_round_request", {
      p_execution_id: input.executionId,
      p_lease_token: input.leaseToken,
      p_lease_fence: input.leaseFence,
      p_response: input.response,
    });
  }

  failRequest(input: Lease & { errorCode: string }) {
    return this.#rpc("fail_ai_round_request", {
      p_execution_id: input.executionId,
      p_lease_token: input.leaseToken,
      p_lease_fence: input.leaseFence,
      p_error_code: input.errorCode,
    });
  }
}
