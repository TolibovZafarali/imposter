import OpenAI from "npm:openai@6.37.0";
import { zodTextFormat } from "npm:openai@6.37.0/helpers/zod";
import { z } from "npm:zod@4.4.3";

export const ALLOWED_MODELS = ["gpt-5.4", "gpt-5.4-mini"] as const;
export type AllowedModel = (typeof ALLOWED_MODELS)[number];
export const GENERATION_MAX_OUTPUT_TOKENS = 260;
export const TRANSLATION_MAX_OUTPUT_TOKENS = 160;
export const PROVIDER_COST_SAFETY_MARGIN = 1.25;

const CANDIDATE_COUNT = 8;

const aiWordSchema = z.object({
  word: z.string(),
  clue: z.string(),
});

const aiWordCandidatesSchema = z.object({
  word: z.string(),
  clues: z.array(z.string()).length(CANDIDATE_COUNT),
});

export type AiWordCandidatesResponse = z.infer<typeof aiWordCandidatesSchema>;
export type AiWordResponse = z.infer<typeof aiWordSchema>;

export type ProviderResult<T> = {
  value: T;
  requestId?: string;
  inputTokens?: number;
  outputTokens?: number;
};

export type ProviderOperation = "generation" | "translation";
export type ProviderPrompt = {
  model: AllowedModel;
  systemPrompt: string;
  userPrompt: string;
};

export interface RoundProvider {
  generate(input: {
    model: AllowedModel;
    systemPrompt: string;
    userPrompt: string;
    signal: AbortSignal;
  }): Promise<ProviderResult<AiWordCandidatesResponse>>;
  translate(input: {
    model: AllowedModel;
    systemPrompt: string;
    userPrompt: string;
    signal: AbortSignal;
  }): Promise<ProviderResult<AiWordResponse>>;
}

const providerResult = <T>(
  response: {
    _request_id?: string | null;
    output_parsed?: T | null;
    usage?: { input_tokens?: number; output_tokens?: number } | null;
  },
): ProviderResult<T> => {
  if (!response.output_parsed) {
    throw new Error("Provider returned no parsed output");
  }
  return {
    value: response.output_parsed,
    ...(response._request_id ? { requestId: response._request_id } : {}),
    ...(typeof response.usage?.input_tokens === "number"
      ? { inputTokens: response.usage.input_tokens }
      : {}),
    ...(typeof response.usage?.output_tokens === "number"
      ? { outputTokens: response.usage.output_tokens }
      : {}),
  };
};

export const buildProviderRequest = (
  operation: ProviderOperation,
  input: ProviderPrompt,
) =>
  operation === "generation"
    ? {
      model: input.model,
      reasoning: { effort: "none" as const },
      temperature: 1,
      max_output_tokens: GENERATION_MAX_OUTPUT_TOKENS,
      store: false,
      input: [
        { role: "system" as const, content: input.systemPrompt },
        { role: "user" as const, content: input.userPrompt },
      ],
      text: {
        format: zodTextFormat(aiWordCandidatesSchema, "imposter_round_word"),
      },
    }
    : {
      model: input.model,
      reasoning: { effort: "none" as const },
      temperature: 0.2,
      max_output_tokens: TRANSLATION_MAX_OUTPUT_TOKENS,
      store: false,
      input: [
        { role: "system" as const, content: input.systemPrompt },
        { role: "user" as const, content: input.userPrompt },
      ],
      text: { format: zodTextFormat(aiWordSchema, "imposter_translated_word") },
    };

export class OpenAIRoundProvider implements RoundProvider {
  readonly #client: OpenAI;

  constructor(apiKey: string) {
    this.#client = new OpenAI({
      apiKey,
      maxRetries: 0,
      timeout: 8_000,
    });
  }

  async generate(input: {
    model: AllowedModel;
    systemPrompt: string;
    userPrompt: string;
    signal: AbortSignal;
  }): Promise<ProviderResult<AiWordCandidatesResponse>> {
    const response = await this.#client.responses.parse(
      buildProviderRequest("generation", input),
      { signal: input.signal },
    );
    return providerResult<AiWordCandidatesResponse>(
      response as typeof response & {
        output_parsed?: AiWordCandidatesResponse | null;
      },
    );
  }

  async translate(input: {
    model: AllowedModel;
    systemPrompt: string;
    userPrompt: string;
    signal: AbortSignal;
  }): Promise<ProviderResult<AiWordResponse>> {
    const response = await this.#client.responses.parse(
      buildProviderRequest("translation", input),
      { signal: input.signal },
    );
    return providerResult<AiWordResponse>(
      response as typeof response & {
        output_parsed?: AiWordResponse | null;
      },
    );
  }
}

export const parseAllowedModel = (
  value: string | undefined,
  fallback: AllowedModel,
): AllowedModel => {
  const configured = value?.trim();
  if (!configured) return fallback;
  if ((ALLOWED_MODELS as readonly string[]).includes(configured)) {
    return configured as AllowedModel;
  }
  throw new TypeError("Configured model is not allowlisted");
};

const standardPricePerMillionTokens = {
  "gpt-5.4": { input: 2.5, output: 15 },
  "gpt-5.4-mini": { input: 0.75, output: 4.5 },
} as const;

export type ProviderReservation = {
  callUnits: number;
  maxOutputTokens: number;
  requestBytes: number;
  inputTokenCeiling: number;
};

export const getProviderReservation = (
  operation: ProviderOperation,
  input: ProviderPrompt,
): ProviderReservation => {
  const request = buildProviderRequest(operation, input);
  const requestBytes =
    new TextEncoder().encode(JSON.stringify(request)).byteLength;
  const inputTokenCeiling = requestBytes;
  const maxOutputTokens = operation === "generation"
    ? GENERATION_MAX_OUTPUT_TOKENS
    : TRANSLATION_MAX_OUTPUT_TOKENS;
  const prices = standardPricePerMillionTokens[input.model];
  const callUnits = Math.ceil(
    PROVIDER_COST_SAFETY_MARGIN * (
      inputTokenCeiling * prices.input + maxOutputTokens * prices.output
    ),
  );

  return { callUnits, maxOutputTokens, requestBytes, inputTokenCeiling };
};
