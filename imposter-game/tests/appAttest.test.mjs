import assert from 'node:assert/strict';
import test from 'node:test';

import {
  APP_ATTEST_FUNCTION_PATH,
  buildAppAttestClientData,
  canonicalizeJson,
  createAppAttestRequestPreparer,
  fetchWithTransportRetry,
} from '../services/appAttest.ts';

const ROUND_REQUEST_ID = '11111111-1111-4111-8111-111111111111';
const REGISTER_REQUEST_ID = '22222222-2222-4222-8222-222222222222';
const REGISTER_CHALLENGE_ID = '33333333-3333-4333-8333-333333333333';
const ROUND_CHALLENGE_ID = '44444444-4444-4444-8444-444444444444';
const KEY_ID = `${'A'.repeat(43)}=`;
const PAYLOAD_HASH = 'A'.repeat(43);
const REGISTER_CHALLENGE = 'B'.repeat(43);
const ROUND_CHALLENGE = 'C'.repeat(43);

const createStorage = (initialEntries = []) => {
  const values = new Map(initialEntries);

  return {
    values,
    adapter: {
      getItem: async (key) => values.get(key) ?? null,
      setItem: async (key, value) => {
        values.set(key, value);
      },
      removeItem: async (key) => {
        values.delete(key);
      },
    },
  };
};

test('canonical JSON recursively sorts keys and rejects non-JSON or unsafe numbers', () => {
  assert.equal(
    canonicalizeJson({ z: [3, { z: 2, a: 1 }], a: true }),
    '{"a":true,"z":[3,{"a":1,"z":2}]}'
  );
  assert.throws(() => canonicalizeJson({ value: Number.NaN }), /unsafe number/);
  assert.throws(() => canonicalizeJson({ value: 1.5 }), /unsafe number/);
  assert.throws(() => canonicalizeJson({ value: undefined }), /JSON values only/);
});

test('App Attest signs the canonical payload and emits the complete v2 wire tuple', async () => {
  const storage = createStorage([
    ['imposter:app-attest-key-id-v1', 'invalid persisted key'],
  ]);
  const requestIds = [ROUND_REQUEST_ID, REGISTER_REQUEST_ID];
  const networkCalls = [];
  const attestedChallenges = [];
  const assertedClientData = [];
  let generatedKeyCount = 0;
  const appIntegrity = {
    isSupported: true,
    generateKeyAsync: async () => {
      generatedKeyCount += 1;
      return KEY_ID;
    },
    attestKeyAsync: async (keyId, challenge) => {
      attestedChallenges.push({ keyId, challenge });
      return 'base64-attestation';
    },
    generateAssertionAsync: async (keyId, clientData) => {
      assertedClientData.push({ keyId, clientData });
      return 'base64-assertion';
    },
  };
  const fetchImplementation = async (_url, init) => {
    const body = JSON.parse(init.body);
    networkCalls.push({ body, headers: init.headers });

    if (body.action === 'challenge' && body.purpose === 'register') {
      return Response.json({
        challengeId: REGISTER_CHALLENGE_ID,
        challenge: REGISTER_CHALLENGE,
        expiresAt: '2026-08-19T12:00:00.000Z',
      });
    }

    if (body.action === 'register') {
      return Response.json({ registered: true });
    }

    return Response.json({
      challengeId: ROUND_CHALLENGE_ID,
      challenge: ROUND_CHALLENGE,
      expiresAt: '2026-08-19T12:01:00.000Z',
    });
  };
  const prepare = createAppAttestRequestPreparer({
    fetch: fetchImplementation,
    loadAppIntegrity: async () => appIntegrity,
    loadStorage: async () => storage.adapter,
    randomUUID: async () => requestIds.shift(),
    sha256Base64: async (canonicalPayload) => {
      assert.equal(canonicalPayload, '{"categoryId":"movies","playedWords":[]}');
      return `${PAYLOAD_HASH}=`;
    },
  });

  const prepared = await prepare({
    apiUrl: 'https://example.test/functions/v1/generate-round',
    action: 'generate-round',
    payload: { playedWords: [], categoryId: 'movies' },
  });

  assert.equal(prepared.requestId, ROUND_REQUEST_ID);
  assert.equal(prepared.appAttested, true);
  assert.deepEqual(prepared.body, {
    version: 2,
    action: 'generate-round',
    requestId: ROUND_REQUEST_ID,
    challengeId: ROUND_CHALLENGE_ID,
    challenge: ROUND_CHALLENGE,
    keyId: KEY_ID,
    assertion: 'base64-assertion',
    payload: { categoryId: 'movies', playedWords: [] },
  });
  assert.deepEqual(attestedChallenges, [
    { keyId: KEY_ID, challenge: REGISTER_CHALLENGE },
  ]);
  assert.equal(
    assertedClientData[0].clientData,
    [
      'imposter-app-attest-v1',
      APP_ATTEST_FUNCTION_PATH,
      'generate-round',
      ROUND_REQUEST_ID,
      ROUND_CHALLENGE_ID,
      ROUND_CHALLENGE,
      PAYLOAD_HASH,
    ].join('\n')
  );
  assert.deepEqual(networkCalls.map(({ body }) => body.action), [
    'challenge',
    'register',
    'challenge',
  ]);
  assert.equal(networkCalls[0].body.purpose, 'register');
  assert.equal(networkCalls[2].body.purpose, 'generate-round');
  assert.equal(networkCalls[2].body.payloadHash, PAYLOAD_HASH);
  assert.equal(networkCalls[1].body.challenge, REGISTER_CHALLENGE);
  assert.equal(networkCalls[0].headers['X-Imposter-Action'], 'challenge');
  assert.equal(networkCalls[1].headers['X-Imposter-Action'], 'register');
  assert.equal(networkCalls[2].headers['X-Imposter-Action'], 'challenge');
  assert.equal(generatedKeyCount, 1);
  assert.deepEqual([...storage.values.entries()], [
    ['imposter:app-attest-key-id-v1', KEY_ID],
  ]);
});

test('a persisted registered key survives a new preparer without re-attestation', async () => {
  const storage = createStorage([
    ['imposter:app-attest-key-id-v1', KEY_ID],
  ]);
  const actions = [];
  let generatedKeyCount = 0;
  let attestationCount = 0;
  let assertionCount = 0;
  const prepare = createAppAttestRequestPreparer({
    fetch: async (_url, init) => {
      const body = JSON.parse(init.body);
      actions.push(body.action);

      return Response.json({
        challengeId: ROUND_CHALLENGE_ID,
        challenge: ROUND_CHALLENGE,
        expiresAt: '2026-08-19T12:01:00.000Z',
      });
    },
    loadAppIntegrity: async () => ({
      isSupported: true,
      generateKeyAsync: async () => {
        generatedKeyCount += 1;
        return KEY_ID;
      },
      attestKeyAsync: async () => {
        attestationCount += 1;
        return 'unexpected-attestation';
      },
      generateAssertionAsync: async (keyId) => {
        assert.equal(keyId, KEY_ID);
        assertionCount += 1;
        return 'base64-assertion';
      },
    }),
    loadStorage: async () => storage.adapter,
    randomUUID: async () => ROUND_REQUEST_ID,
    sha256Base64: async () => `${PAYLOAD_HASH}=`,
  });

  const prepared = await prepare({
    apiUrl: 'https://example.test/functions/v1/generate-round',
    action: 'generate-round',
    payload: { categoryId: 'movies', playedWords: [] },
  });

  assert.equal(prepared.appAttested, true);
  assert.deepEqual(actions, ['challenge']);
  assert.equal(generatedKeyCount, 0);
  assert.equal(attestationCount, 0);
  assert.equal(assertionCount, 1);
});

test('an interrupted enrollment reuses the persisted pending key', async () => {
  const storage = createStorage();
  let generatedKeyCount = 0;
  let attestationCount = 0;
  const appIntegrity = {
    isSupported: true,
    generateKeyAsync: async () => {
      generatedKeyCount += 1;
      return KEY_ID;
    },
    attestKeyAsync: async () => {
      attestationCount += 1;

      if (attestationCount === 1) {
        throw Object.assign(new Error('temporarily unavailable'), {
          code: 'ERR_APP_INTEGRITY_SERVER_UNAVAILABLE',
        });
      }

      return 'base64-attestation';
    },
    generateAssertionAsync: async () => 'base64-assertion',
  };
  const fetchImplementation = async (_url, init) => {
    const body = JSON.parse(init.body);

    if (body.action === 'register') {
      return Response.json({ registered: true });
    }

    return Response.json({
      challengeId: body.purpose === 'register' ? REGISTER_CHALLENGE_ID : ROUND_CHALLENGE_ID,
      challenge: body.purpose === 'register' ? REGISTER_CHALLENGE : ROUND_CHALLENGE,
      expiresAt: '2026-08-19T12:01:00.000Z',
    });
  };
  const createPreparer = () => createAppAttestRequestPreparer({
    fetch: fetchImplementation,
    loadAppIntegrity: async () => appIntegrity,
    loadStorage: async () => storage.adapter,
    randomUUID: async () => ROUND_REQUEST_ID,
    sha256Base64: async () => `${PAYLOAD_HASH}=`,
  });

  const first = await createPreparer()({
    apiUrl: 'https://example.test/functions/v1/generate-round',
    action: 'generate-round',
    payload: { categoryId: 'movies', playedWords: [] },
  });
  const second = await createPreparer()({
    apiUrl: 'https://example.test/functions/v1/generate-round',
    action: 'generate-round',
    payload: { categoryId: 'movies', playedWords: [] },
  });

  assert.equal(first.appAttested, false);
  assert.equal(second.appAttested, true);
  assert.equal(generatedKeyCount, 1);
  assert.equal(attestationCount, 2);
  assert.deepEqual([...storage.values.entries()], [
    ['imposter:app-attest-key-id-v1', KEY_ID],
  ]);
});

test('unsupported App Attest uses an observe-only v2 envelope without native enrollment calls', async () => {
  let fetchCallCount = 0;
  let storageCallCount = 0;
  let hashCallCount = 0;
  const prepare = createAppAttestRequestPreparer({
    fetch: async () => {
      fetchCallCount += 1;
      throw new Error('unexpected fetch');
    },
    loadAppIntegrity: async () => ({
      isSupported: false,
      generateKeyAsync: async () => {
        throw new Error('unexpected key generation');
      },
      attestKeyAsync: async () => {
        throw new Error('unexpected attestation');
      },
      generateAssertionAsync: async () => {
        throw new Error('unexpected assertion');
      },
    }),
    loadStorage: async () => {
      storageCallCount += 1;
      throw new Error('unexpected storage');
    },
    randomUUID: async () => ROUND_REQUEST_ID,
    sha256Base64: async () => {
      hashCallCount += 1;
      return `${PAYLOAD_HASH}=`;
    },
  });

  const prepared = await prepare({
    apiUrl: 'https://example.test/functions/v1/generate-round',
    action: 'translate-word',
    payload: { mode: 'translate-word', languageId: 'spanish', playedWords: [], sourceEntryId: 'entry-1' },
  });

  assert.equal(prepared.appAttested, false);
  assert.deepEqual(prepared.body, {
    version: 2,
    action: 'translate-word',
    requestId: ROUND_REQUEST_ID,
    payload: {
      languageId: 'spanish',
      mode: 'translate-word',
      playedWords: [],
      sourceEntryId: 'entry-1',
    },
  });
  assert.equal(fetchCallCount, 0);
  assert.equal(storageCallCount, 0);
  assert.equal(hashCallCount, 0);
});

test('assertion failure falls back to an all-or-none observe envelope', async () => {
  const storage = createStorage([
    ['imposter:app-attest-key-id-v1', KEY_ID],
  ]);
  const requestIds = [ROUND_REQUEST_ID, REGISTER_REQUEST_ID];
  const prepare = createAppAttestRequestPreparer({
    fetch: async (_url, init) => {
      const body = JSON.parse(init.body);

      if (body.action === 'register') {
        return Response.json({ registered: true });
      }

      return Response.json({
        challengeId: body.purpose === 'register' ? REGISTER_CHALLENGE_ID : ROUND_CHALLENGE_ID,
        challenge:
          body.purpose === 'register'
            ? REGISTER_CHALLENGE
            : ROUND_CHALLENGE,
        expiresAt: '2026-08-19T12:01:00.000Z',
      });
    },
    loadAppIntegrity: async () => ({
      isSupported: true,
      generateKeyAsync: async () => KEY_ID,
      attestKeyAsync: async () => 'unused',
      generateAssertionAsync: async () => {
        throw Object.assign(new Error('key no longer exists'), { code: 'ERR_INVALID_KEY' });
      },
    }),
    loadStorage: async () => storage.adapter,
    randomUUID: async () => requestIds.shift(),
    sha256Base64: async () => `${PAYLOAD_HASH}=`,
  });

  const prepared = await prepare({
    apiUrl: 'https://example.test/functions/v1/generate-round',
    action: 'generate-round',
    payload: { categoryId: 'movies' },
  });

  assert.equal(prepared.appAttested, false);
  assert.deepEqual(Object.keys(prepared.body).sort(), ['action', 'payload', 'requestId', 'version']);
  assert.equal(storage.values.size, 0);
});

test('a server-rejected stored key is cleared before legacy fallback', async () => {
  const storage = createStorage([
    ['imposter:app-attest-key-id-v1', KEY_ID],
  ]);
  let fetchCallCount = 0;
  const prepare = createAppAttestRequestPreparer({
    fetch: async () => {
      fetchCallCount += 1;
      return Response.json(
        { error: 'App integrity validation failed', code: 'integrity_invalid' },
        { status: 401 }
      );
    },
    loadAppIntegrity: async () => ({
      isSupported: true,
      generateKeyAsync: async () => {
        throw new Error('unexpected key generation');
      },
      attestKeyAsync: async () => {
        throw new Error('unexpected attestation');
      },
      generateAssertionAsync: async () => {
        throw new Error('unexpected assertion');
      },
    }),
    loadStorage: async () => storage.adapter,
    randomUUID: async () => ROUND_REQUEST_ID,
    sha256Base64: async () => `${PAYLOAD_HASH}=`,
  });

  const prepared = await prepare({
    apiUrl: 'https://example.test/functions/v1/generate-round',
    action: 'generate-round',
    payload: { categoryId: 'movies', playedWords: [] },
  });

  assert.equal(prepared.appAttested, false);
  assert.equal(fetchCallCount, 1);
  assert.equal(storage.values.size, 0);
});

test('transport retry reuses byte-identical v2 body, request ID, and action header', async () => {
  const calls = [];
  const body = {
    version: 2,
    action: 'generate-round',
    requestId: ROUND_REQUEST_ID,
    payload: { categoryId: 'movies' },
  };
  const response = await fetchWithTransportRetry(
    async (_url, init) => {
      calls.push(init);

      if (calls.length === 1) {
        throw new TypeError('Network request failed');
      }

      return Response.json({ word: 'Arrival', clue: 'language' });
    },
    'https://example.test/functions/v1/generate-round',
    ROUND_REQUEST_ID,
    body
  );

  assert.equal(response.status, 200);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].body, calls[1].body);
  assert.equal(calls[0].headers['X-Request-Id'], ROUND_REQUEST_ID);
  assert.equal(calls[1].headers['X-Request-Id'], ROUND_REQUEST_ID);
  assert.equal(calls[0].headers['X-Imposter-Action'], 'generate-round');
  assert.equal(calls[1].headers['X-Imposter-Action'], 'generate-round');
});

test('abort or timeout errors are never retried because server work may have started', async () => {
  let callCount = 0;

  await assert.rejects(
    () => fetchWithTransportRetry(
      async () => {
        callCount += 1;
        throw Object.assign(new Error('request aborted'), { name: 'AbortError' });
      },
      'https://example.test/functions/v1/generate-round',
      ROUND_REQUEST_ID,
      { version: 2, action: 'generate-round', requestId: ROUND_REQUEST_ID, payload: {} }
    ),
    /request aborted/
  );
  assert.equal(callCount, 1);
});

test('client-data helper uses the exact LF-delimited protocol string', () => {
  assert.equal(
    buildAppAttestClientData({
      action: 'translate-word',
      requestId: ROUND_REQUEST_ID,
      challengeId: ROUND_CHALLENGE_ID,
      challenge: 'opaque-challenge',
      payloadHash: PAYLOAD_HASH,
    }),
    `imposter-app-attest-v1\n${APP_ATTEST_FUNCTION_PATH}\ntranslate-word\n${ROUND_REQUEST_ID}\n${ROUND_CHALLENGE_ID}\nopaque-challenge\n${PAYLOAD_HASH}`
  );
});
