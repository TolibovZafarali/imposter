import { strict as assert } from "node:assert";
import { ApiError, getRequestActionHeader, readJsonBody } from "./http.ts";

const exactJson = (bytes: number) => `{"x":"${"a".repeat(bytes - 8)}"}`;

const requestWithBody = (body: string, contentType = "application/json") =>
  new Request("https://example.test", {
    method: "POST",
    headers: { "content-type": contentType },
    body,
  });

Deno.test("streaming reader accepts exact 2/16/64 KiB caps and rejects one byte more", async () => {
  for (const limit of [2 * 1024, 16 * 1024, 64 * 1024]) {
    const exact = await readJsonBody(requestWithBody(exactJson(limit)), limit);
    assert.equal(exact.byteLength, limit);
    await assert.rejects(
      () => readJsonBody(requestWithBody(exactJson(limit + 1)), limit),
      (error) =>
        error instanceof ApiError && error.code === "payload_too_large",
    );
  }
});

Deno.test("streaming reader rejects malformed JSON, wrong media type, and unknown action", async () => {
  await assert.rejects(
    () => readJsonBody(requestWithBody("{"), 100),
    (error) => error instanceof ApiError && error.code === "invalid_request",
  );
  await assert.rejects(
    () => readJsonBody(requestWithBody("{}", "text/plain"), 100),
    (error) =>
      error instanceof ApiError && error.code === "unsupported_media_type",
  );
  assert.throws(
    () =>
      getRequestActionHeader(
        new Request("https://example.test", {
          headers: { "x-imposter-action": "unknown" },
        }),
      ),
    (error) => error instanceof ApiError && error.code === "invalid_request",
  );
});
