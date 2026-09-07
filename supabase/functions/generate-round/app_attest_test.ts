import { strict as assert } from "node:assert";
import { decode, encode } from "npm:cborg@6.1.1";
import { X509Certificate } from "npm:@peculiar/x509@1.14.3";
import {
  APP_ATTEST_ROOT_PEM,
  APP_ATTEST_ROOT_SHA256,
  AppAttestVerificationError,
  type AppIdentity,
  deriveAppAttestClientDataHash,
  getKeyIdHash,
  parseAuthenticatorData,
  verifyAssertion,
  verifyAttestationWithClientDataHash,
} from "./app-attest.ts";
import { decodeCanonicalAppAttestKeyId } from "./encoding.ts";

const OFFICIAL_ATTESTATION =
  "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";
const OFFICIAL_KEY_ID = "zgSY9YSD+7TaDXssY6WlOPVS1K3Lmk+pFhlcSWE+ZV0=";
const OFFICIAL_CHALLENGE = "example_server_challenge";
const OFFICIAL_IDENTITY: AppIdentity = {
  appIdPrefix: "1234567890",
  bundleId: "com.example.myapp",
  environment: "production",
  requireIdentityExtensions: true,
  // The published binary fixture encodes CFBundleVersion "1" even though the
  // surrounding guide describes the example version as 1.0.
  allowedBundleVersions: ["1", "1.0"],
  allowedValidationCategories: [1],
};
const FIXTURE_NOW = new Date("2026-04-21T18:13:12Z");

const bytesToHex = (bytes: Uint8Array) =>
  [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");

const toBase64Url = (bytes: Uint8Array) => {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/gu, "-").replace(/\//gu, "_").replace(
    /=+$/u,
    "",
  );
};

const fromBase64 = (value: string) =>
  Uint8Array.from(atob(value), (character) => character.charCodeAt(0));

const concat = (...parts: Uint8Array[]) => {
  const bytes = new Uint8Array(
    parts.reduce((sum, part) => sum + part.length, 0),
  );
  let offset = 0;
  for (const part of parts) {
    bytes.set(part, offset);
    offset += part.length;
  }
  return bytes;
};

const rawEcdsaToDer = (raw: Uint8Array) => {
  const integer = (part: Uint8Array) => {
    let start = 0;
    while (start < part.length - 1 && part[start] === 0) start += 1;
    let value = part.slice(start);
    if ((value[0] & 0x80) !== 0) value = concat(new Uint8Array([0]), value);
    return concat(new Uint8Array([0x02, value.length]), value);
  };
  const r = integer(raw.slice(0, 32));
  const s = integer(raw.slice(32));
  return concat(new Uint8Array([0x30, r.length + s.length]), r, s);
};

Deno.test("pinned root has Apple's published SHA-256 fingerprint", async () => {
  const root = new X509Certificate(APP_ATTEST_ROOT_PEM);
  const fingerprint = new Uint8Array(
    await root.getThumbprint({ name: "SHA-256" }),
  );
  assert.equal(bytesToHex(fingerprint), APP_ATTEST_ROOT_SHA256);
});

Deno.test("Apple's official 2026 attestation fixture validates chain and object fields with its raw client-data fixture", async () => {
  const verified = await verifyAttestationWithClientDataHash({
    attestation: OFFICIAL_ATTESTATION,
    // The fixture certificate uses raw challenge bytes despite the guide prose
    // calling this value a hash. Production never uses this test path.
    clientDataHash: new TextEncoder().encode(OFFICIAL_CHALLENGE),
    keyId: OFFICIAL_KEY_ID,
    identity: OFFICIAL_IDENTITY,
    now: FIXTURE_NOW,
  });
  assert.equal(verified.signCount, 0);
  assert.equal(verified.environment, "production");
  assert.ok(verified.publicKeySpki.length > 80);
  assert.ok(verified.receipt.length > 100);
});

Deno.test("official attestation rejects wrong nonce, RP ID, environment, key, extension policy, and time", async () => {
  const clientDataHash = new TextEncoder().encode(OFFICIAL_CHALLENGE);
  const cases: Parameters<typeof verifyAttestationWithClientDataHash>[0][] = [
    {
      attestation: OFFICIAL_ATTESTATION,
      clientDataHash: new TextEncoder().encode("wrong_server_challenge"),
      keyId: OFFICIAL_KEY_ID,
      identity: OFFICIAL_IDENTITY,
      now: FIXTURE_NOW,
    },
    {
      attestation: OFFICIAL_ATTESTATION,
      clientDataHash,
      keyId: OFFICIAL_KEY_ID,
      identity: { ...OFFICIAL_IDENTITY, bundleId: "com.example.other" },
      now: FIXTURE_NOW,
    },
    {
      attestation: OFFICIAL_ATTESTATION,
      clientDataHash,
      keyId: OFFICIAL_KEY_ID,
      identity: { ...OFFICIAL_IDENTITY, environment: "development" },
      now: FIXTURE_NOW,
    },
    {
      attestation: OFFICIAL_ATTESTATION,
      clientDataHash,
      keyId: btoa("\0".repeat(32)),
      identity: OFFICIAL_IDENTITY,
      now: FIXTURE_NOW,
    },
    {
      attestation: OFFICIAL_ATTESTATION,
      clientDataHash,
      keyId: OFFICIAL_KEY_ID,
      identity: { ...OFFICIAL_IDENTITY, allowedBundleVersions: ["3"] },
      now: FIXTURE_NOW,
    },
    {
      attestation: OFFICIAL_ATTESTATION,
      clientDataHash,
      keyId: OFFICIAL_KEY_ID,
      identity: { ...OFFICIAL_IDENTITY, allowedValidationCategories: [4] },
      now: FIXTURE_NOW,
    },
    {
      attestation: OFFICIAL_ATTESTATION,
      clientDataHash,
      keyId: OFFICIAL_KEY_ID,
      identity: OFFICIAL_IDENTITY,
      now: new Date("2026-05-01T00:00:00Z"),
    },
  ];
  for (const input of cases) {
    await assert.rejects(
      () => verifyAttestationWithClientDataHash(input),
      AppAttestVerificationError,
    );
  }
  await assert.rejects(() =>
    verifyAttestationWithClientDataHash({
      attestation: "AAAA",
      clientDataHash,
      keyId: OFFICIAL_KEY_ID,
      identity: OFFICIAL_IDENTITY,
      now: FIXTURE_NOW,
    }), AppAttestVerificationError);
});

Deno.test("official attestation rejects a chain replaced with the pinned root", async () => {
  const object = decode(fromBase64(OFFICIAL_ATTESTATION)) as {
    fmt: string;
    authData: Uint8Array;
    attStmt: { x5c: Uint8Array[]; receipt: Uint8Array };
  };
  const rootDer = fromBase64(
    APP_ATTEST_ROOT_PEM.replace(/-----[^-]+-----/gu, "").replace(/\s+/gu, ""),
  );
  const altered = toBase64Url(encode({
    ...object,
    attStmt: { ...object.attStmt, x5c: [object.attStmt.x5c[0], rootDer] },
  }));
  await assert.rejects(
    () =>
      verifyAttestationWithClientDataHash({
        attestation: altered,
        clientDataHash: new TextEncoder().encode(OFFICIAL_CHALLENGE),
        keyId: OFFICIAL_KEY_ID,
        identity: OFFICIAL_IDENTITY,
        now: FIXTURE_NOW,
      }),
    AppAttestVerificationError,
  );
});

Deno.test("production attestation derives the exact SHA-256 Expo client-data hash", async () => {
  const expected = new Uint8Array(
    await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(OFFICIAL_CHALLENGE),
    ),
  );
  assert.deepEqual(
    await deriveAppAttestClientDataHash(OFFICIAL_CHALLENGE),
    expected,
  );
});

Deno.test("key IDs require canonical 44-character standard Base64 and hash decoded bytes", async () => {
  const bytes = decodeCanonicalAppAttestKeyId(OFFICIAL_KEY_ID);
  assert.equal(bytes.length, 32);
  const expected = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  assert.equal(await getKeyIdHash(OFFICIAL_KEY_ID), bytesToHex(expected));
  await assert.rejects(() =>
    getKeyIdHash(OFFICIAL_KEY_ID.replace(/\+/gu, "-"))
  );
  await assert.rejects(() => getKeyIdHash(OFFICIAL_KEY_ID.slice(0, -1)));
  await assert.rejects(() => getKeyIdHash(OFFICIAL_KEY_ID.slice(0, -2) + "1="));
});

Deno.test("authenticator parser allows legacy absence only by caller policy and rejects malformed trailing data", () => {
  const authData = new Uint8Array(37);
  const parsed = parseAuthenticatorData(authData, false);
  assert.equal(parsed.signCount, 0);
  assert.throws(
    () => parseAuthenticatorData(concat(authData, new Uint8Array([0])), false),
    AppAttestVerificationError,
  );
  const extensionData = new Uint8Array(authData);
  extensionData[32] = 0x80;
  const valid = parseAuthenticatorData(
    concat(
      extensionData,
      encode({ bundleVersion: "3", validationCategory: 4 }),
    ),
    false,
  );
  assert.equal(valid.bundleVersion, "3");
  assert.equal(valid.validationCategory, 4);
  assert.throws(
    () =>
      parseAuthenticatorData(
        concat(extensionData, encode({ bundleVersion: "3", unexpected: true })),
        false,
      ),
    AppAttestVerificationError,
  );
});

Deno.test("assertion verifier checks RP ID, signature, strict counter, retry equality, and extension rollout", async () => {
  const identity: AppIdentity = {
    appIdPrefix: "ABCDE12345",
    bundleId: "com.cnfstudios.imposter",
    environment: "production",
    requireIdentityExtensions: false,
    allowedBundleVersions: ["3"],
    allowedValidationCategories: [4],
  };
  const pair = await crypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["sign", "verify"],
  );
  const spki = new Uint8Array(
    await crypto.subtle.exportKey("spki", pair.publicKey),
  );
  const rpId = new TextEncoder().encode(
    identity.appIdPrefix + "." + identity.bundleId,
  );
  const rpIdHash = new Uint8Array(await crypto.subtle.digest("SHA-256", rpId));
  const authData = new Uint8Array(37);
  authData.set(rpIdHash);
  new DataView(authData.buffer).setUint32(33, 3, false);
  const signedData = "bound request body";
  const clientHash = new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(signedData)),
  );
  const rawSignature = new Uint8Array(
    await crypto.subtle.sign(
      { name: "ECDSA", hash: "SHA-256" },
      pair.privateKey,
      concat(authData, clientHash),
    ),
  );
  assert.equal(rawSignature.length, 64);
  const assertion = toBase64Url(encode({
    signature: rawEcdsaToDer(rawSignature),
    authenticatorData: authData,
  }));
  const input = {
    assertion,
    signedData,
    publicKeySpki: toBase64Url(spki),
    identity,
  };

  assert.equal(
    (await verifyAssertion({ ...input, previousSignCount: 2 })).signCount,
    3,
  );
  await assert.rejects(
    () => verifyAssertion({ ...input, previousSignCount: 3 }),
    AppAttestVerificationError,
  );
  assert.equal(
    (await verifyAssertion({
      ...input,
      previousSignCount: 3,
      allowEqualSignCount: true,
    })).signCount,
    3,
  );
  await assert.rejects(
    () =>
      verifyAssertion({
        ...input,
        previousSignCount: 4,
        allowEqualSignCount: true,
      }),
    AppAttestVerificationError,
  );
  await assert.rejects(
    () =>
      verifyAssertion({
        ...input,
        signedData: "different body",
        previousSignCount: 2,
      }),
    AppAttestVerificationError,
  );
  await assert.rejects(
    () =>
      verifyAssertion({
        ...input,
        previousSignCount: 2,
        identity: { ...identity, bundleId: "com.cnfstudios.other" },
      }),
    AppAttestVerificationError,
  );
  await assert.rejects(
    () =>
      verifyAssertion({
        ...input,
        previousSignCount: 2,
        identity: { ...identity, requireIdentityExtensions: true },
      }),
    AppAttestVerificationError,
  );
});
