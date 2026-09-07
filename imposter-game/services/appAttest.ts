export const APP_ATTEST_API_VERSION = 2 as const;
export const APP_ATTEST_FUNCTION_PATH = '/functions/v1/generate-round';
export const APP_ATTEST_REQUEST_TIMEOUT_MS = 15_000;

const APP_ATTEST_KEY_ID_STORAGE_KEY = 'imposter:app-attest-key-id-v1';
const APP_ATTEST_PENDING_KEY_ID_STORAGE_KEY = 'imposter:app-attest-pending-key-id-v1';
const MAX_TRANSPORT_ATTEMPTS = 2;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const BASE64_URL_SHA256_PATTERN = /^[A-Za-z0-9_-]{43}$/u;
const APP_ATTEST_KEY_ID_PATTERN = /^[A-Za-z0-9+/]{43}=$/u;

export type AppAttestAction = 'generate-round' | 'translate-word';
type AppAttestPurpose = 'register' | AppAttestAction;
type JsonPrimitive = boolean | number | string | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

type ChallengeResponse = {
  challengeId: string;
  challenge: string;
  expiresAt: string;
};

type AppIntegrityModule = {
  isSupported: boolean;
  generateKeyAsync: () => Promise<string>;
  attestKeyAsync: (keyId: string, challenge: string) => Promise<string>;
  generateAssertionAsync: (keyId: string, challenge: string) => Promise<string>;
};

type StorageAdapter = {
  getItem: (key: string) => Promise<string | null>;
  setItem: (key: string, value: string) => Promise<void>;
  removeItem: (key: string) => Promise<void>;
};

export type AppAttestDependencies = {
  fetch: typeof fetch;
  loadAppIntegrity: () => Promise<AppIntegrityModule>;
  loadStorage: () => Promise<StorageAdapter>;
  randomUUID: () => Promise<string>;
  sha256Base64: (value: string) => Promise<string>;
};

export type PreparedRoundRequest = {
  requestId: string;
  body: JsonValue;
  appAttested: boolean;
};

export type PrepareRoundRequestInput = {
  apiUrl: string;
  action: AppAttestAction;
  payload: JsonValue;
};

export type RoundRequestPreparer = (
  input: PrepareRoundRequestInput
) => Promise<PreparedRoundRequest>;

const isPlainObject = (value: unknown): value is Record<string, unknown> => {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
};

const canonicalizeJsonValue = (value: unknown): JsonValue => {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') {
    return value;
  }

  if (typeof value === 'number') {
    if (!Number.isFinite(value) || !Number.isSafeInteger(value)) {
      throw new Error('App Attest payload contains an unsafe number');
    }

    return value;
  }

  if (Array.isArray(value)) {
    return value.map(canonicalizeJsonValue);
  }

  if (!isPlainObject(value)) {
    throw new Error('App Attest payload must contain JSON values only');
  }

  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, canonicalizeJsonValue(value[key])])
  );
};

export const canonicalizeJson = (value: unknown) => JSON.stringify(canonicalizeJsonValue(value));

const toBase64Url = (value: string) =>
  value.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/u, '');

export const buildAppAttestClientData = ({
  action,
  requestId,
  challengeId,
  challenge,
  payloadHash,
}: {
  action: AppAttestAction;
  requestId: string;
  challengeId: string;
  challenge: string;
  payloadHash: string;
}) =>
  [
    'imposter-app-attest-v1',
    APP_ATTEST_FUNCTION_PATH,
    action,
    requestId,
    challengeId,
    challenge,
    payloadHash,
  ].join('\n');

const isChallengeResponse = (value: unknown): value is ChallengeResponse => {
  if (!isPlainObject(value)) {
    return false;
  }

  return (
    typeof value.challengeId === 'string' &&
    UUID_PATTERN.test(value.challengeId) &&
    typeof value.challenge === 'string' &&
    BASE64_URL_SHA256_PATTERN.test(value.challenge) &&
    typeof value.expiresAt === 'string' &&
    value.expiresAt.length > 0 &&
    value.expiresAt.length <= 128
  );
};

const parseStoredKeyId = (value: string | null) =>
  value && APP_ATTEST_KEY_ID_PATTERN.test(value) ? value : null;

const getErrorProperty = (error: unknown, property: string) =>
  error && (typeof error === 'object' || typeof error === 'function')
    ? (error as Record<string, unknown>)[property]
    : undefined;

const isAppIntegrityServerUnavailable = (error: unknown) =>
  getErrorProperty(error, 'code') === 'ERR_APP_INTEGRITY_SERVER_UNAVAILABLE';

const isAbortOrTimeoutError = (error: unknown) =>
  getErrorProperty(error, 'name') === 'AbortError' ||
  getErrorProperty(error, 'name') === 'TimeoutError';

const isRetryableTransportError = (error: unknown) =>
  error instanceof TypeError && !isAbortOrTimeoutError(error);

export async function fetchWithTransportRetry(
  fetchImplementation: typeof fetch,
  url: string,
  requestId: string,
  body: JsonValue
) {
  const serializedBody = JSON.stringify(body);
  const imposterAction =
    isPlainObject(body) && typeof body.action === 'string' ? body.action : undefined;
  let lastError: unknown;
  const deadline = Date.now() + APP_ATTEST_REQUEST_TIMEOUT_MS;

  for (let attempt = 0; attempt < MAX_TRANSPORT_ATTEMPTS; attempt += 1) {
    const remainingTimeMs = deadline - Date.now();

    if (remainingTimeMs <= 0) {
      const timeoutError = new Error('Network request timed out');
      timeoutError.name = 'TimeoutError';
      throw timeoutError;
    }

    const controller = new AbortController();
    let didTimeout = false;
    const timeoutId = setTimeout(() => {
      didTimeout = true;
      controller.abort();
    }, remainingTimeMs);

    try {
      return await fetchImplementation(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Request-Id': requestId,
          ...(imposterAction ? { 'X-Imposter-Action': imposterAction } : {}),
        },
        body: serializedBody,
        signal: controller.signal,
      });
    } catch (error) {
      lastError = error;

      if (
        didTimeout ||
        isAbortOrTimeoutError(error) ||
        !isRetryableTransportError(error) ||
        attempt + 1 >= MAX_TRANSPORT_ATTEMPTS
      ) {
        throw error;
      }
    } finally {
      clearTimeout(timeoutId);
    }
  }

  throw lastError instanceof Error ? lastError : new Error('Network request failed');
}

const defaultDependencies: AppAttestDependencies = {
  fetch: (...args) => fetch(...args),
  loadAppIntegrity: async () => {
    const [AppIntegrity, { Platform }] = await Promise.all([
      import('@expo/app-integrity'),
      import('react-native'),
    ]);

    return {
      ...AppIntegrity,
      isSupported: Platform.OS === 'ios' && AppIntegrity.isSupported,
    };
  },
  loadStorage: async () => (await import('@react-native-async-storage/async-storage')).default,
  randomUUID: async () => (await import('expo-crypto')).randomUUID(),
  sha256Base64: async (value) => {
    const Crypto = await import('expo-crypto');

    return Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, value, {
      encoding: Crypto.CryptoEncoding.BASE64,
    });
  },
};

export const createAppAttestRequestPreparer = (dependencies: AppAttestDependencies) => {
  let registrationPromise: Promise<string> | null = null;
  let pendingKeyId: string | null = null;

  const clearStoredKey = async () => {
    const storage = await dependencies.loadStorage();
    await Promise.all([
      storage.removeItem(APP_ATTEST_KEY_ID_STORAGE_KEY),
      storage.removeItem(APP_ATTEST_PENDING_KEY_ID_STORAGE_KEY),
    ]);
    pendingKeyId = null;
  };

  const postJson = async (apiUrl: string, requestId: string, body: JsonValue) => {
    const response = await fetchWithTransportRetry(dependencies.fetch, apiUrl, requestId, body);

    if (!response.ok) {
      let code: unknown;
      try {
        const errorBody: unknown = await response.clone().json();
        code = isPlainObject(errorBody) ? errorBody.code : undefined;
      } catch {
        // Keep the status-only error when the server response is not JSON.
      }
      throw Object.assign(
        new Error(`App Attest request failed with status ${response.status}`),
        typeof code === 'string' ? { code } : {}
      );
    }

    return response;
  };

  const requestChallenge = async ({
    apiUrl,
    purpose,
    requestId,
    keyId,
    payloadHash,
  }: {
    apiUrl: string;
    purpose: AppAttestPurpose;
    requestId: string;
    keyId: string;
    payloadHash?: string;
  }) => {
    const body: JsonValue = {
      version: APP_ATTEST_API_VERSION,
      action: 'challenge',
      purpose,
      requestId,
      keyId,
      ...(payloadHash ? { payloadHash } : {}),
    };
    const response = await postJson(apiUrl, requestId, body);
    const value: unknown = await response.json();

    if (!isChallengeResponse(value)) {
      throw new Error('App Attest challenge response was invalid');
    }

    return value;
  };

  const ensureRegisteredKey = async (apiUrl: string, appIntegrity: AppIntegrityModule) => {
    if (registrationPromise) {
      return registrationPromise;
    }

    registrationPromise = (async () => {
      const storage = await dependencies.loadStorage();
      let keyId = parseStoredKeyId(await storage.getItem(APP_ATTEST_KEY_ID_STORAGE_KEY));

      // The registered slot is the durable server-confirmation marker.
      if (keyId) {
        return keyId;
      }

      keyId =
        parseStoredKeyId(await storage.getItem(APP_ATTEST_PENDING_KEY_ID_STORAGE_KEY)) ??
        pendingKeyId ??
        await appIntegrity.generateKeyAsync();
      pendingKeyId = keyId;
      await storage.setItem(APP_ATTEST_PENDING_KEY_ID_STORAGE_KEY, keyId);

      const requestId = await dependencies.randomUUID();
      const challenge = await requestChallenge({
        apiUrl,
        purpose: 'register',
        requestId,
        keyId,
      });
      let attestation: string;

      try {
        attestation = await appIntegrity.attestKeyAsync(keyId, challenge.challenge);
      } catch (error) {
        if (!isAppIntegrityServerUnavailable(error)) {
          await storage.removeItem(APP_ATTEST_PENDING_KEY_ID_STORAGE_KEY);
          pendingKeyId = null;
        }

        throw error;
      }

      await postJson(apiUrl, requestId, {
        version: APP_ATTEST_API_VERSION,
        action: 'register',
        requestId,
        keyId,
        challengeId: challenge.challengeId,
        challenge: challenge.challenge,
        attestation,
      });
      await storage.setItem(APP_ATTEST_KEY_ID_STORAGE_KEY, keyId);
      await storage.removeItem(APP_ATTEST_PENDING_KEY_ID_STORAGE_KEY);
      pendingKeyId = null;

      return keyId;
    })();

    try {
      return await registrationPromise;
    } finally {
      registrationPromise = null;
    }
  };

  return async ({ apiUrl, action, payload }: PrepareRoundRequestInput): Promise<PreparedRoundRequest> => {
    const requestId = await dependencies.randomUUID();
    const canonicalPayload = canonicalizeJsonValue(payload);
    const observeOnlyRequest: PreparedRoundRequest = {
      requestId,
      appAttested: false,
      body: {
        version: APP_ATTEST_API_VERSION,
        action,
        requestId,
        payload: canonicalPayload,
      },
    };
    let appIntegrity: AppIntegrityModule;

    try {
      appIntegrity = await dependencies.loadAppIntegrity();
    } catch {
      return observeOnlyRequest;
    }

    if (!appIntegrity.isSupported) {
      return observeOnlyRequest;
    }

    try {
      const payloadHash = toBase64Url(
        await dependencies.sha256Base64(JSON.stringify(canonicalPayload))
      );
      const keyId = await ensureRegisteredKey(apiUrl, appIntegrity);
      const challenge = await requestChallenge({
        apiUrl,
        purpose: action,
        requestId,
        keyId,
        payloadHash,
      });
      const clientData = buildAppAttestClientData({
        action,
        requestId,
        challengeId: challenge.challengeId,
        challenge: challenge.challenge,
        payloadHash,
      });
      let assertion: string;

      try {
        assertion = await appIntegrity.generateAssertionAsync(keyId, clientData);
      } catch (error) {
        if (!isAppIntegrityServerUnavailable(error)) {
          const storage = await dependencies.loadStorage();
          await storage.removeItem(APP_ATTEST_KEY_ID_STORAGE_KEY);
          await storage.removeItem(APP_ATTEST_PENDING_KEY_ID_STORAGE_KEY);
          pendingKeyId = null;
        }

        throw error;
      }

      return {
        requestId,
        appAttested: true,
        body: {
          version: APP_ATTEST_API_VERSION,
          action,
          requestId,
          challengeId: challenge.challengeId,
          challenge: challenge.challenge,
          keyId,
          assertion,
          payload: canonicalPayload,
        },
      };
    } catch (error) {
      if (getErrorProperty(error, 'code') === 'integrity_invalid') {
        try {
          await clearStoredKey();
        } catch {
          // Key cleanup is best effort; this request still uses the legacy lane.
        }
      }
      return observeOnlyRequest;
    }
  };
};

const defaultRoundRequestPreparer = createAppAttestRequestPreparer(defaultDependencies);
let roundRequestPreparerForTesting: RoundRequestPreparer | null = null;
let appAttestKeyInvalidatorForTesting: (() => Promise<void>) | null = null;

export const setRoundRequestPreparerForTesting = (preparer?: RoundRequestPreparer) => {
  roundRequestPreparerForTesting = preparer ?? null;
};

export const setAppAttestKeyInvalidatorForTesting = (invalidator?: () => Promise<void>) => {
  appAttestKeyInvalidatorForTesting = invalidator ?? null;
};

export const invalidateStoredAppAttestKey = async () => {
  if (appAttestKeyInvalidatorForTesting) {
    await appAttestKeyInvalidatorForTesting();
    return;
  }

  const storage = await defaultDependencies.loadStorage();
  await Promise.all([
    storage.removeItem(APP_ATTEST_KEY_ID_STORAGE_KEY),
    storage.removeItem(APP_ATTEST_PENDING_KEY_ID_STORAGE_KEY),
  ]);
};

export const prepareRoundRequest: RoundRequestPreparer = (input) =>
  (roundRequestPreparerForTesting ?? defaultRoundRequestPreparer)(input);
