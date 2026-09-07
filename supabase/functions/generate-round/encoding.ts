export const decodeCanonicalAppAttestKeyId = (value: string) => {
  if (!/^[A-Za-z0-9+/]{43}=$/u.test(value)) {
    throw new TypeError("App Attest key ID must use canonical standard Base64");
  }
  let binary: string;
  try {
    binary = atob(value);
  } catch {
    throw new TypeError("App Attest key ID is invalid Base64");
  }
  if (binary.length !== 32 || btoa(binary) !== value) {
    throw new TypeError(
      "App Attest key ID must encode exactly 32 bytes canonically",
    );
  }
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
};

export const isCanonicalAppAttestKeyId = (value: string) => {
  try {
    decodeCanonicalAppAttestKeyId(value);
    return true;
  } catch {
    return false;
  }
};
