import { MAX_REQUEST_BYTES } from "./contracts.ts";

export type PublicErrorCode =
  | "invalid_request"
  | "payload_too_large"
  | "unsupported_media_type"
  | "method_not_allowed"
  | "generation_disabled"
  | "service_unavailable"
  | "rate_limited"
  | "concurrency_limited"
  | "budget_exhausted"
  | "idempotency_conflict"
  | "request_in_progress"
  | "integrity_required"
  | "integrity_invalid"
  | "provider_timeout"
  | "provider_failure"
  | "internal_error";

export class ApiError extends Error {
  readonly status: number;
  readonly code: PublicErrorCode;

  constructor(status: number, code: PublicErrorCode, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}

const getAllowedOrigin = (request: Request, configuredOrigins: string) => {
  const allowlist = configuredOrigins
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
  const origin = request.headers.get("origin")?.trim();

  if (!allowlist.length || allowlist.includes("*")) return "*";
  if (origin && allowlist.includes(origin)) return origin;
  return allowlist[0];
};

export const getCorsHeaders = (request: Request, configuredOrigins = "") => ({
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-request-id, x-imposter-action",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Origin": getAllowedOrigin(request, configuredOrigins),
  "Access-Control-Expose-Headers": "X-Imposter-Integrity",
  "Content-Type": "application/json",
  "Vary": "Origin",
});

export const jsonResponse = (
  request: Request,
  body: unknown,
  status = 200,
  configuredOrigins = "",
  extraHeaders: HeadersInit = {},
) =>
  Response.json(body, {
    status,
    headers: {
      ...getCorsHeaders(request, configuredOrigins),
      ...Object.fromEntries(new Headers(extraHeaders)),
    },
  });

export const errorResponse = (
  request: Request,
  error: unknown,
  configuredOrigins = "",
  extraHeaders: HeadersInit = {},
) => {
  const publicError = error instanceof ApiError
    ? error
    : new ApiError(500, "internal_error", "The request could not be completed");

  return jsonResponse(
    request,
    {
      error: publicError.message,
      code: publicError.code,
    },
    publicError.status,
    configuredOrigins,
    extraHeaders,
  );
};

export const readJsonBody = async (
  request: Request,
  maxBytes = MAX_REQUEST_BYTES,
  signal?: AbortSignal,
): Promise<{ value: unknown; byteLength: number }> => {
  const contentType = request.headers.get("content-type")?.split(";", 1)[0]
    ?.trim().toLowerCase();
  if (contentType !== "application/json") {
    throw new ApiError(
      415,
      "unsupported_media_type",
      "Content-Type must be application/json",
    );
  }

  const declaredLength = Number.parseInt(
    request.headers.get("content-length") ?? "",
    10,
  );
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    throw new ApiError(413, "payload_too_large", "Request body is too large");
  }

  if (!request.body) {
    throw new ApiError(
      400,
      "invalid_request",
      "A JSON request body is required",
    );
  }

  const reader = request.body.getReader();
  const cancelOnAbort = () => {
    void reader.cancel(signal?.reason);
  };
  signal?.addEventListener("abort", cancelOnAbort, { once: true });
  const chunks: Uint8Array[] = [];
  let byteLength = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (signal?.aborted) {
        throw new ApiError(
          503,
          "service_unavailable",
          "The request body timed out",
        );
      }
      if (done) break;
      byteLength += value.byteLength;
      if (byteLength > maxBytes) {
        await reader.cancel();
        throw new ApiError(
          413,
          "payload_too_large",
          "Request body is too large",
        );
      }
      chunks.push(value);
    }
  } finally {
    signal?.removeEventListener("abort", cancelOnAbort);
    reader.releaseLock();
  }

  const bytes = new Uint8Array(byteLength);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  try {
    return {
      value: JSON.parse(
        new TextDecoder("utf-8", { fatal: true }).decode(bytes),
      ),
      byteLength,
    };
  } catch {
    throw new ApiError(
      400,
      "invalid_request",
      "Request body must contain valid UTF-8 JSON",
    );
  }
};

const bodyLimitByAction = {
  challenge: 2 * 1024,
  register: 64 * 1024,
  "generate-round": 16 * 1024,
  "translate-word": 16 * 1024,
} as const;

export type RequestActionHeader = keyof typeof bodyLimitByAction;

export const getRequestActionHeader = (
  request: Request,
): RequestActionHeader | null => {
  const action = request.headers.get("x-imposter-action")?.trim();
  if (!action) return null;
  if (!Object.hasOwn(bodyLimitByAction, action)) {
    throw new ApiError(400, "invalid_request", "X-Imposter-Action is invalid");
  }
  return action as RequestActionHeader;
};

export const getStreamingBodyLimit = (request: Request) => {
  const action = getRequestActionHeader(request);
  return action
    ? bodyLimitByAction[action]
    : bodyLimitByAction["generate-round"];
};

export const createDeadlineSignal = (timeoutMs = 10_000) => {
  const controller = new AbortController();
  const timeout = setTimeout(
    () =>
      controller.abort(
        new DOMException("Request deadline exceeded", "TimeoutError"),
      ),
    timeoutMs,
  );

  return {
    signal: controller.signal,
    dispose: () => clearTimeout(timeout),
  };
};

export const assertWithinDeadline = (signal: AbortSignal) => {
  if (signal.aborted) {
    throw new ApiError(
      504,
      "provider_timeout",
      "The generation service timed out",
    );
  }
};
