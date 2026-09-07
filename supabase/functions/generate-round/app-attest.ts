import { decode, decodeFirst } from "npm:cborg@6.1.1";
import {
  BasicConstraintsExtension,
  KeyUsageFlags,
  KeyUsagesExtension,
  X509Certificate,
} from "npm:@peculiar/x509@1.14.3";
import { decodeCanonicalAppAttestKeyId } from "./encoding.ts";

const APP_ATTEST_NONCE_OID = "1.2.840.113635.100.8.2";
const AUTH_DATA_MIN_BYTES = 37;
const AUTH_DATA_ATTESTED_CREDENTIAL_FLAG = 0x40;
const AUTH_DATA_EXTENSION_FLAG = 0x80;

export const APP_ATTEST_ROOT_SHA256 =
  "1cb9823ba28ba6ad2d33a006941de2ae4f513ef1d4e831b9f7e0fa7b6242c932";

export const APP_ATTEST_ROOT_PEM = `-----BEGIN CERTIFICATE-----
MIICITCCAaegAwIBAgIQC/O+DvHN0uD7jG5yH2IXmDAKBggqhkjOPQQDAzBSMSYw
JAYDVQQDDB1BcHBsZSBBcHAgQXR0ZXN0YXRpb24gUm9vdCBDQTETMBEGA1UECgwK
QXBwbGUgSW5jLjETMBEGA1UECAwKQ2FsaWZvcm5pYTAeFw0yMDAzMTgxODMyNTNa
Fw00NTAzMTUwMDAwMDBaMFIxJjAkBgNVBAMMHUFwcGxlIEFwcCBBdHRlc3RhdGlv
biBSb290IENBMRMwEQYDVQQKDApBcHBsZSBJbmMuMRMwEQYDVQQIDApDYWxpZm9y
bmlhMHYwEAYHKoZIzj0CAQYFK4EEACIDYgAERTHhmLW07ATaFQIEVwTtT4dyctdh
NbJhFs/Ii2FdCgAHGbpphY3+d8qjuDngIN3WVhQUBHAoMeQ/cLiP1sOUtgjqK9au
Yen1mMEvRq9Sk3Jm5X8U62H+xTD3FE9TgS41o0IwQDAPBgNVHRMBAf8EBTADAQH/
MB0GA1UdDgQWBBSskRBTM72+aEH/pwyp5frq5eWKoTAOBgNVHQ8BAf8EBAMCAQYw
CgYIKoZIzj0EAwMDaAAwZQIwQgFGnByvsiVbpTKwSga0kP0e8EeDS4+sQmTvb7vn
53O5+FRXgeLhpJ06ysC5PrOyAjEAp5U4xDgEgllF7En3VcE3iexZZtKeYnpqtijV
oyFraWVIyd/dganmrduC1bmTBGwD
-----END CERTIFICATE-----`;

export class AppAttestVerificationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AppAttestVerificationError";
  }
}

export type AppIdentity = {
  appIdPrefix: string;
  bundleId: string;
  environment: "production" | "development";
  requireIdentityExtensions: boolean;
  allowedBundleVersions: readonly string[];
  allowedValidationCategories: readonly number[];
};

export type VerifiedAttestation = {
  publicKeySpki: string;
  receipt: string;
  signCount: number;
  environment: AppIdentity["environment"];
};

export type VerifiedAssertion = {
  signCount: number;
};

const asBytes = (value: unknown, field: string) => {
  if (!(value instanceof Uint8Array)) {
    throw new AppAttestVerificationError(`${field} must be a byte string`);
  }
  return value;
};

const asRecord = (value: unknown, field: string): Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new AppAttestVerificationError(`${field} must be a map`);
  }
  return value as Record<string, unknown>;
};

const decodeBase64 = (value: string) => {
  const normalized = value.replace(/-/gu, "+").replace(/_/gu, "/");
  const paddingLength = (4 - (normalized.length % 4)) % 4;
  let binary: string;
  try {
    binary = atob(normalized + "=".repeat(paddingLength));
  } catch {
    throw new AppAttestVerificationError("Invalid base64 data");
  }
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
};

const encodeBase64Url = (bytes: Uint8Array) => {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/gu, "-").replace(/\//gu, "_").replace(
    /=+$/u,
    "",
  );
};

const toArrayBuffer = (bytes: Uint8Array) => bytes.slice().buffer;

const concatBytes = (...parts: readonly Uint8Array[]) => {
  const result = new Uint8Array(
    parts.reduce((total, part) => total + part.byteLength, 0),
  );
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.byteLength;
  }
  return result;
};

const sha256 = async (value: Uint8Array) =>
  new Uint8Array(await crypto.subtle.digest("SHA-256", toArrayBuffer(value)));

const equalBytes = (left: Uint8Array, right: Uint8Array) => {
  if (left.byteLength !== right.byteLength) return false;
  let difference = 0;
  for (let index = 0; index < left.byteLength; index += 1) {
    difference |= left[index] ^ right[index];
  }
  return difference === 0;
};

const toHex = (bytes: Uint8Array) =>
  [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");

type DerElement = {
  tag: number;
  valueStart: number;
  valueEnd: number;
  next: number;
};

const readDerElement = (bytes: Uint8Array, offset: number): DerElement => {
  if (offset + 2 > bytes.byteLength) {
    throw new AppAttestVerificationError("Malformed DER value");
  }
  const tag = bytes[offset];
  const firstLength = bytes[offset + 1];
  let length = firstLength;
  let headerBytes = 2;
  if ((firstLength & 0x80) !== 0) {
    const lengthBytes = firstLength & 0x7f;
    if (
      !lengthBytes || lengthBytes > 4 ||
      offset + 2 + lengthBytes > bytes.byteLength
    ) {
      throw new AppAttestVerificationError("Malformed DER length");
    }
    length = 0;
    for (let index = 0; index < lengthBytes; index += 1) {
      length = (length * 256) + bytes[offset + 2 + index];
    }
    headerBytes += lengthBytes;
  }
  const valueStart = offset + headerBytes;
  const valueEnd = valueStart + length;
  if (valueEnd > bytes.byteLength) {
    throw new AppAttestVerificationError("Truncated DER value");
  }
  return { tag, valueStart, valueEnd, next: valueEnd };
};

const findDerValues = (
  bytes: Uint8Array,
  wantedTag: number,
  wantedLength: number,
  start = 0,
  end = bytes.byteLength,
): Uint8Array[] => {
  const matches: Uint8Array[] = [];
  let offset = start;
  while (offset < end) {
    const element = readDerElement(bytes, offset);
    if (element.next > end) {
      throw new AppAttestVerificationError("Invalid nested DER value");
    }
    if (
      element.tag === wantedTag &&
      element.valueEnd - element.valueStart === wantedLength
    ) {
      matches.push(bytes.slice(element.valueStart, element.valueEnd));
    }
    if ((element.tag & 0x20) !== 0 || (element.tag & 0xc0) === 0x80) {
      matches.push(...findDerValues(
        bytes,
        wantedTag,
        wantedLength,
        element.valueStart,
        element.valueEnd,
      ));
    }
    offset = element.next;
  }
  return matches;
};

export const extractAppAttestNonce = (extensionValue: Uint8Array) => {
  const nonces = findDerValues(extensionValue, 0x04, 32);
  if (nonces.length !== 1) {
    throw new AppAttestVerificationError(
      "App Attest nonce extension is malformed",
    );
  }
  return nonces[0];
};

const extractP256Point = (spki: Uint8Array) => {
  const bitStrings = findDerValues(spki, 0x03, 66);
  const points = bitStrings
    .filter((value) => value[0] === 0 && value[1] === 0x04)
    .map((value) => value.slice(1));
  if (points.length !== 1) {
    throw new AppAttestVerificationError(
      "Attestation certificate key is not P-256",
    );
  }
  return points[0];
};

const derEcdsaSignatureToRaw = (signature: Uint8Array) => {
  const sequence = readDerElement(signature, 0);
  if (sequence.tag !== 0x30 || sequence.next !== signature.byteLength) {
    throw new AppAttestVerificationError(
      "Assertion signature is not DER ECDSA",
    );
  }
  const r = readDerElement(signature, sequence.valueStart);
  const s = readDerElement(signature, r.next);
  if (r.tag !== 0x02 || s.tag !== 0x02 || s.next !== sequence.valueEnd) {
    throw new AppAttestVerificationError(
      "Assertion signature has invalid integers",
    );
  }
  const normalizeInteger = (element: DerElement) => {
    let integer = signature.slice(element.valueStart, element.valueEnd);
    if (!integer.length || integer.length > 33) {
      throw new AppAttestVerificationError(
        "Assertion signature integer is invalid",
      );
    }
    if (integer[0] === 0) {
      if (integer.length === 1 || (integer[1] & 0x80) === 0) {
        throw new AppAttestVerificationError(
          "Assertion signature integer is not canonical DER",
        );
      }
      integer = integer.slice(1);
    } else if ((integer[0] & 0x80) !== 0) {
      throw new AppAttestVerificationError(
        "Assertion signature integer is negative",
      );
    }
    if (integer.length > 32) {
      throw new AppAttestVerificationError(
        "Assertion signature integer is too large",
      );
    }
    const result = new Uint8Array(32);
    result.set(integer, 32 - integer.length);
    return result;
  };
  return concatBytes(normalizeInteger(r), normalizeInteger(s));
};

type ParsedAuthenticatorData = {
  rpIdHash: Uint8Array;
  flags: number;
  signCount: number;
  aaguid?: Uint8Array;
  credentialId?: Uint8Array;
  credentialPublicKeyPoint?: Uint8Array;
  bundleVersion?: string;
  validationCategory?: number;
};

const decodeAuthenticatorExtensions = (bytes: Uint8Array) => {
  let value: unknown;
  try {
    value = decode(bytes, {
      allowIndefinite: false,
      allowBigInt: false,
      allowInfinity: false,
      allowNaN: false,
      allowUndefined: false,
      rejectDuplicateMapKeys: true,
      strict: true,
    });
  } catch {
    throw new AppAttestVerificationError(
      "Authenticator extensions are invalid CBOR",
    );
  }
  const extensions = asRecord(value, "authenticator extensions");
  const allowedKeys = new Set([
    "apple_bundle_version_01",
    "apple_validation_category_01",
    "bundleVersion",
    "validationCategory",
  ]);
  if (Object.keys(extensions).some((key) => !allowedKeys.has(key))) {
    throw new AppAttestVerificationError(
      "Authenticator extensions contain unsupported fields",
    );
  }
  const rawBundleVersion = extensions.apple_bundle_version_01 ??
    extensions.bundleVersion;
  const rawValidationCategory = extensions.apple_validation_category_01 ??
    extensions.validationCategory;
  if (
    typeof rawBundleVersion !== "string" ||
    !/^\d+(?:\.\d+)*$/u.test(rawBundleVersion)
  ) {
    throw new AppAttestVerificationError(
      "Authenticator bundle version is invalid",
    );
  }
  let validationCategory: number;
  if (
    typeof rawValidationCategory === "number" &&
    Number.isInteger(rawValidationCategory)
  ) {
    validationCategory = rawValidationCategory;
  } else if (
    rawValidationCategory instanceof Uint8Array &&
    rawValidationCategory.length === 4
  ) {
    validationCategory = new DataView(
      rawValidationCategory.buffer,
      rawValidationCategory.byteOffset,
      rawValidationCategory.byteLength,
    ).getUint32(0, true);
  } else {
    throw new AppAttestVerificationError(
      "Authenticator validation category is invalid",
    );
  }
  if (
    validationCategory < 1 || validationCategory > 10 ||
    [7, 8, 9].includes(validationCategory)
  ) {
    throw new AppAttestVerificationError(
      "Authenticator validation category is not allowed",
    );
  }
  return { bundleVersion: rawBundleVersion, validationCategory };
};

export const parseAuthenticatorData = (
  authData: Uint8Array,
  requireAttestedCredential: boolean,
): ParsedAuthenticatorData => {
  if (authData.byteLength < AUTH_DATA_MIN_BYTES) {
    throw new AppAttestVerificationError("Authenticator data is truncated");
  }
  const view = new DataView(
    authData.buffer,
    authData.byteOffset,
    authData.byteLength,
  );
  const result: ParsedAuthenticatorData = {
    rpIdHash: authData.slice(0, 32),
    flags: authData[32],
    signCount: view.getUint32(33, false),
  };
  if (!requireAttestedCredential) {
    const hasExtensions = (result.flags & AUTH_DATA_EXTENSION_FLAG) !== 0;
    const appendedExtensions = authData.slice(AUTH_DATA_MIN_BYTES);
    if (appendedExtensions.length) {
      Object.assign(
        result,
        decodeAuthenticatorExtensions(appendedExtensions),
      );
    } else if (hasExtensions) {
      throw new AppAttestVerificationError(
        "Assertion extension flag has no CBOR data",
      );
    }
    return result;
  }
  if (
    (result.flags & AUTH_DATA_ATTESTED_CREDENTIAL_FLAG) === 0 ||
    authData.byteLength < 55
  ) {
    throw new AppAttestVerificationError("Attested credential data is missing");
  }
  const credentialIdLength = view.getUint16(53, false);
  const credentialEnd = 55 + credentialIdLength;
  if (!credentialIdLength || credentialEnd >= authData.byteLength) {
    throw new AppAttestVerificationError("Credential ID is malformed");
  }
  result.aaguid = authData.slice(37, 53);
  result.credentialId = authData.slice(55, credentialEnd);
  let credentialPublicKey: unknown;
  let remainder: Uint8Array;
  try {
    [credentialPublicKey, remainder] = decodeFirst(
      authData.slice(credentialEnd),
      {
        allowIndefinite: false,
        allowBigInt: false,
        allowInfinity: false,
        allowNaN: false,
        allowUndefined: false,
        rejectDuplicateMapKeys: true,
        strict: true,
        useMaps: true,
      },
    );
  } catch {
    throw new AppAttestVerificationError(
      "Credential public key is invalid CBOR",
    );
  }
  if (!(credentialPublicKey instanceof Map) || credentialPublicKey.size !== 5) {
    throw new AppAttestVerificationError(
      "Credential public key must be a canonical P-256 COSE key",
    );
  }
  const expectedCoseValues = [[1, 2], [3, -7], [-1, 1]] as const;
  for (const [key, expected] of expectedCoseValues) {
    if (credentialPublicKey.get(key) !== expected) {
      throw new AppAttestVerificationError(
        "Credential public key has an unsupported COSE parameter",
      );
    }
  }
  const x = asBytes(credentialPublicKey.get(-2), "credential public key x");
  const y = asBytes(credentialPublicKey.get(-3), "credential public key y");
  if (x.byteLength !== 32 || y.byteLength !== 32) {
    throw new AppAttestVerificationError(
      "Credential public key coordinates must be P-256",
    );
  }
  result.credentialPublicKeyPoint = concatBytes(new Uint8Array([0x04]), x, y);
  const hasExtensions = (result.flags & AUTH_DATA_EXTENSION_FLAG) !== 0;
  if (remainder.length) {
    Object.assign(result, decodeAuthenticatorExtensions(remainder));
  } else if (hasExtensions) {
    throw new AppAttestVerificationError(
      "Attestation extension flag has no CBOR data",
    );
  }
  return result;
};

const assertIdentityExtensions = (
  parsed: ParsedAuthenticatorData,
  identity: AppIdentity,
) => {
  const hasBundleVersion = parsed.bundleVersion !== undefined;
  const hasValidationCategory = parsed.validationCategory !== undefined;
  if (
    !hasBundleVersion && !hasValidationCategory &&
    !identity.requireIdentityExtensions
  ) {
    return;
  }
  if (!hasBundleVersion || !hasValidationCategory) {
    throw new AppAttestVerificationError(
      "Authenticator identity extensions are incomplete",
    );
  }
  if (
    !parsed.bundleVersion ||
    !identity.allowedBundleVersions.includes(parsed.bundleVersion)
  ) {
    throw new AppAttestVerificationError(
      "Authenticator bundle version does not match",
    );
  }
  if (
    parsed.validationCategory === undefined ||
    !identity.allowedValidationCategories.includes(parsed.validationCategory)
  ) {
    throw new AppAttestVerificationError(
      "Authenticator validation category does not match",
    );
  }
};

const expectedAppIdHash = (identity: AppIdentity) =>
  sha256(
    new TextEncoder().encode(`${identity.appIdPrefix}.${identity.bundleId}`),
  );

const expectedAaguid = (environment: AppIdentity["environment"]) => {
  if (environment === "development") {
    return new TextEncoder().encode("appattestdevelop");
  }
  return concatBytes(new TextEncoder().encode("appattest"), new Uint8Array(7));
};

const verifyCertificateChain = async (
  certificates: Uint8Array[],
  now: Date,
) => {
  if (certificates.length !== 2) {
    throw new AppAttestVerificationError(
      "Attestation certificate chain must contain two certificates",
    );
  }
  const leaf = new X509Certificate(toArrayBuffer(certificates[0]));
  const intermediate = new X509Certificate(toArrayBuffer(certificates[1]));
  const root = new X509Certificate(APP_ATTEST_ROOT_PEM);
  const rootFingerprint = new Uint8Array(
    await root.getThumbprint({ name: "SHA-256" }),
  );
  if (toHex(rootFingerprint) !== APP_ATTEST_ROOT_SHA256) {
    throw new AppAttestVerificationError(
      "Pinned App Attest root fingerprint mismatch",
    );
  }
  for (const certificate of [leaf, intermediate, root]) {
    if (now < certificate.notBefore || now > certificate.notAfter) {
      throw new AppAttestVerificationError(
        "Attestation certificate is outside its validity period",
      );
    }
  }
  if (
    leaf.issuer !== intermediate.subject || intermediate.issuer !== root.subject
  ) {
    throw new AppAttestVerificationError(
      "Attestation certificate issuers do not match",
    );
  }
  if (!await leaf.verify({ publicKey: intermediate.publicKey, date: now })) {
    throw new AppAttestVerificationError(
      "Attestation leaf certificate signature is invalid",
    );
  }
  if (!await intermediate.verify({ publicKey: root.publicKey, date: now })) {
    throw new AppAttestVerificationError(
      "Attestation intermediate certificate signature is invalid",
    );
  }
  const intermediateConstraints = intermediate.getExtension(
    BasicConstraintsExtension,
  );
  if (!intermediateConstraints?.ca) {
    throw new AppAttestVerificationError(
      "Attestation intermediate is not a CA certificate",
    );
  }
  const intermediateKeyUsage = intermediate.getExtension(KeyUsagesExtension);
  if (
    intermediateKeyUsage &&
    (intermediateKeyUsage.usages & KeyUsageFlags.keyCertSign) === 0
  ) {
    throw new AppAttestVerificationError(
      "Attestation intermediate cannot sign certificates",
    );
  }
  const leafConstraints = leaf.getExtension(BasicConstraintsExtension);
  if (leafConstraints?.ca) {
    throw new AppAttestVerificationError(
      "Attestation leaf cannot be a CA certificate",
    );
  }
  return leaf;
};

export const deriveAppAttestClientDataHash = (challenge: string) =>
  sha256(new TextEncoder().encode(challenge));

export const verifyAttestationWithClientDataHash = async ({
  attestation,
  clientDataHash,
  keyId,
  identity,
  now = new Date(),
}: {
  attestation: string;
  clientDataHash: Uint8Array;
  keyId: string;
  identity: AppIdentity;
  now?: Date;
}): Promise<VerifiedAttestation> => {
  let decoded: unknown;
  try {
    decoded = decode(decodeBase64(attestation), {
      allowIndefinite: false,
      rejectDuplicateMapKeys: true,
      strict: true,
    });
  } catch (error) {
    if (error instanceof AppAttestVerificationError) throw error;
    throw new AppAttestVerificationError("Attestation object is invalid CBOR");
  }
  const object = asRecord(decoded, "attestation");
  if (object.fmt !== "apple-appattest") {
    throw new AppAttestVerificationError(
      "Attestation format is not apple-appattest",
    );
  }
  const statement = asRecord(object.attStmt, "attStmt");
  if (!Array.isArray(statement.x5c)) {
    throw new AppAttestVerificationError(
      "Attestation certificate chain is missing",
    );
  }
  const certificates = statement.x5c.map((certificate, index) =>
    asBytes(certificate, `attStmt.x5c[${index}]`)
  );
  const receipt = asBytes(statement.receipt, "attStmt.receipt");
  const authData = asBytes(object.authData, "authData");
  const parsed = parseAuthenticatorData(authData, true);
  const expectedRpHash = await expectedAppIdHash(identity);
  if (!equalBytes(parsed.rpIdHash, expectedRpHash)) {
    throw new AppAttestVerificationError(
      "Attestation app identity does not match",
    );
  }
  if (
    !parsed.aaguid ||
    !equalBytes(parsed.aaguid, expectedAaguid(identity.environment))
  ) {
    throw new AppAttestVerificationError(
      "Attestation environment does not match",
    );
  }
  if (parsed.signCount !== 0) {
    throw new AppAttestVerificationError(
      "Initial attestation counter must be zero",
    );
  }
  assertIdentityExtensions(parsed, identity);
  let decodedKeyId: Uint8Array;
  try {
    decodedKeyId = decodeCanonicalAppAttestKeyId(keyId);
  } catch {
    throw new AppAttestVerificationError(
      "App Attest key ID is not canonical",
    );
  }
  if (!parsed.credentialId || !equalBytes(parsed.credentialId, decodedKeyId)) {
    throw new AppAttestVerificationError("Credential ID does not match key ID");
  }
  const leaf = await verifyCertificateChain(certificates, now);
  const nonceExtension = leaf.getExtension(APP_ATTEST_NONCE_OID);
  if (!nonceExtension) {
    throw new AppAttestVerificationError(
      "App Attest nonce extension is missing",
    );
  }
  const expectedNonce = await sha256(concatBytes(authData, clientDataHash));
  const certificateNonce = extractAppAttestNonce(
    new Uint8Array(nonceExtension.value),
  );
  if (!equalBytes(certificateNonce, expectedNonce)) {
    throw new AppAttestVerificationError(
      "Attestation nonce does not match challenge",
    );
  }
  const spki = new Uint8Array(leaf.publicKey.rawData);
  const certificatePublicKeyPoint = extractP256Point(spki);
  if (
    !parsed.credentialPublicKeyPoint ||
    !equalBytes(parsed.credentialPublicKeyPoint, certificatePublicKeyPoint)
  ) {
    throw new AppAttestVerificationError(
      "Credential public key does not match attestation certificate",
    );
  }
  const publicKeyHash = await sha256(certificatePublicKeyPoint);
  if (!equalBytes(publicKeyHash, decodedKeyId)) {
    throw new AppAttestVerificationError(
      "Attestation public key does not match key ID",
    );
  }
  return {
    publicKeySpki: encodeBase64Url(spki),
    receipt: encodeBase64Url(receipt),
    signCount: parsed.signCount,
    environment: identity.environment,
  };
};

export const verifyAttestation = async ({
  attestation,
  challenge,
  keyId,
  identity,
  now = new Date(),
}: {
  attestation: string;
  challenge: string;
  keyId: string;
  identity: AppIdentity;
  now?: Date;
}) =>
  verifyAttestationWithClientDataHash({
    attestation,
    clientDataHash: await deriveAppAttestClientDataHash(challenge),
    keyId,
    identity,
    now,
  });

export const verifyAssertion = async ({
  assertion,
  signedData,
  publicKeySpki,
  previousSignCount,
  identity,
  allowEqualSignCount = false,
}: {
  assertion: string;
  signedData: string;
  publicKeySpki: string;
  previousSignCount: number;
  identity: AppIdentity;
  allowEqualSignCount?: boolean;
}): Promise<VerifiedAssertion> => {
  let decoded: unknown;
  try {
    decoded = decode(decodeBase64(assertion), {
      allowIndefinite: false,
      rejectDuplicateMapKeys: true,
      strict: true,
    });
  } catch (error) {
    if (error instanceof AppAttestVerificationError) throw error;
    throw new AppAttestVerificationError("Assertion object is invalid CBOR");
  }
  const object = asRecord(decoded, "assertion");
  const signature = asBytes(object.signature, "signature");
  const authData = asBytes(object.authenticatorData, "authenticatorData");
  const parsed = parseAuthenticatorData(authData, false);
  if (!equalBytes(parsed.rpIdHash, await expectedAppIdHash(identity))) {
    throw new AppAttestVerificationError(
      "Assertion app identity does not match",
    );
  }
  if (
    parsed.signCount < previousSignCount ||
    (parsed.signCount === previousSignCount && !allowEqualSignCount)
  ) {
    throw new AppAttestVerificationError("Assertion counter did not advance");
  }
  assertIdentityExtensions(parsed, identity);
  const publicKey = await crypto.subtle.importKey(
    "spki",
    toArrayBuffer(decodeBase64(publicKeySpki)),
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["verify"],
  );
  const clientDataHash = await sha256(new TextEncoder().encode(signedData));
  const verificationData = concatBytes(authData, clientDataHash);
  const signatureIsValid = await crypto.subtle.verify(
    { name: "ECDSA", hash: "SHA-256" },
    publicKey,
    toArrayBuffer(derEcdsaSignatureToRaw(signature)),
    toArrayBuffer(verificationData),
  );
  if (!signatureIsValid) {
    throw new AppAttestVerificationError("Assertion signature is invalid");
  }
  return { signCount: parsed.signCount };
};

export const getKeyIdHash = async (keyId: string) =>
  toHex(await sha256(decodeCanonicalAppAttestKeyId(keyId)));
