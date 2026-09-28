import assert from 'node:assert/strict';
import test, { afterEach } from 'node:test';

import { selectStaticWordEntry } from '../data/wordBank.ts';
import {
  AI_ROUND_REQUEST_TIMEOUT_MS,
  createAiRound,
  createRound,
  MAX_PLAYED_WORD_HISTORY,
  MAX_PLAYED_WORD_HISTORY_BYTES,
  resetRoundGeneratorStateForTesting,
  sanitizePlayedWordHistory,
} from '../services/roundGenerator.ts';
import {
  setAppAttestKeyInvalidatorForTesting,
  setRoundRequestPreparerForTesting,
} from '../services/appAttest.ts';

const originalFetch = globalThis.fetch;
const REQUEST_ID = '55555555-5555-4555-8555-555555555555';

const buildPlayers = () => [
  { id: 'player-1', name: 'A' },
  { id: 'player-2', name: 'B' },
  { id: 'player-3', name: 'C' },
];

const installObserveOnlyPreparer = (calls = []) => {
  setRoundRequestPreparerForTesting(async ({ action, payload }) => {
    calls.push({ action, payload });

    return {
      requestId: REQUEST_ID,
      appAttested: false,
      body: {
        version: 2,
        action,
        requestId: REQUEST_ID,
        payload,
      },
    };
  });

  return calls;
};

afterEach(() => {
  globalThis.fetch = originalFetch;
  setAppAttestKeyInvalidatorForTesting();
  setRoundRequestPreparerForTesting();
  resetRoundGeneratorStateForTesting();
});

test('English static rounds make zero fetch and zero App Attest calls', async () => {
  let fetchCallCount = 0;
  let appAttestCallCount = 0;
  const expectedEntry = selectStaticWordEntry({
    categoryId: 'objects',
    difficulty: 'medium',
    rng: () => 0,
  });

  globalThis.fetch = async () => {
    fetchCallCount += 1;
    throw new Error('English static rounds should not fetch');
  };
  setRoundRequestPreparerForTesting(async () => {
    appAttestCallCount += 1;
    throw new Error('English static rounds should not enroll or assert');
  });

  const round = await createRound({
    players: buildPlayers(),
    categoryIds: ['objects'],
    difficulty: 'medium',
    languageId: 'english',
    languageName: 'English',
    rng: () => 0,
  });

  assert.equal(round.secretWord, expectedEntry.word);
  assert.equal(round.imposterHint, expectedEntry.hint);
  assert.equal(fetchCallCount, 0);
  assert.equal(appAttestCallCount, 0);
});

test('translated static rounds send only canonical IDs in the v2 payload', async () => {
  const prepareCalls = installObserveOnlyPreparer();
  const requestBodies = [];

  globalThis.fetch = async (_url, init) => {
    requestBodies.push(JSON.parse(init.body));
    return Response.json({ word: 'edredon', clue: 'capullo' });
  };

  const round = await createRound({
    players: buildPlayers(),
    categoryIds: ['objects'],
    difficulty: 'medium',
    languageId: 'spanish',
    languageName: 'Spanish',
    languageNativeName: 'Español',
    languageScriptHint: 'Latin',
    rng: () => 0,
  });

  assert.equal(round.secretWord, 'edredon');
  assert.equal(round.imposterHint, 'capullo');
  assert.equal(prepareCalls.length, 1);
  assert.equal(prepareCalls[0].action, 'translate-word');
  assert.deepEqual(Object.keys(prepareCalls[0].payload).sort(), [
    'languageId',
    'mode',
    'playedWords',
    'sourceEntryId',
  ]);
  assert.equal(prepareCalls[0].payload.languageId, 'spanish');
  assert.equal(typeof prepareCalls[0].payload.sourceEntryId, 'string');
  assert.equal(requestBodies[0].action, 'translate-word');
});

test('dynamic rounds send the strict canonical payload and do not semantically retry', async () => {
  const prepareCalls = installObserveOnlyPreparer();
  let fetchCallCount = 0;

  globalThis.fetch = async () => {
    fetchCallCount += 1;
    return Response.json({ word: 'Single', clue: 'stage' });
  };

  await assert.rejects(
    () => createAiRound({
      players: buildPlayers(),
      categoryIds: ['celebrities'],
      difficulty: 'easy',
      languageId: 'spanish',
      languageName: 'Spanish',
    }),
    /incomplete celebrity name/
  );

  assert.equal(fetchCallCount, 1);
  assert.equal(prepareCalls.length, 1);
  assert.deepEqual(prepareCalls[0].payload, {
    categoryId: 'celebrities',
    difficulty: 'easy',
    languageId: 'spanish',
    playerCount: 3,
    playedWords: [],
  });
});

test('one retry is allowed only for transport failure and reuses the same request body', async () => {
  installObserveOnlyPreparer();
  const calls = [];

  globalThis.fetch = async (_url, init) => {
    calls.push(init);

    if (calls.length === 1) {
      throw new TypeError('Network request failed');
    }

    return Response.json({ word: 'Arrival', clue: 'language' });
  };

  const round = await createAiRound({
    players: buildPlayers(),
    categoryIds: ['movies'],
    difficulty: 'easy',
    languageId: 'english',
    languageName: 'English',
  });

  assert.equal(round.secretWord, 'Arrival');
  assert.equal(calls.length, 2);
  assert.equal(calls[0].body, calls[1].body);
  assert.equal(calls[0].headers['X-Request-Id'], REQUEST_ID);
  assert.equal(calls[1].headers['X-Request-Id'], REQUEST_ID);
  assert.equal(calls[0].headers['X-Imposter-Action'], 'generate-round');
});

test('HTTP and abort failures are not retried', async (t) => {
  await t.test('HTTP status', async () => {
    installObserveOnlyPreparer();
    let callCount = 0;
    globalThis.fetch = async () => {
      callCount += 1;
      return Response.json({ error: 'unavailable' }, { status: 503 });
    };

    await assert.rejects(
      () => createAiRound({
        players: buildPlayers(),
        categoryIds: ['movies'],
        difficulty: 'easy',
        languageId: 'spanish',
        languageName: 'Spanish',
      }),
      /AI round generation failed/
    );
    assert.equal(callCount, 1);
  });

  await t.test('abort', async () => {
    installObserveOnlyPreparer();
    let callCount = 0;
    globalThis.fetch = async () => {
      callCount += 1;
      throw Object.assign(new Error('aborted'), { name: 'AbortError' });
    };

    await assert.rejects(
      () => createAiRound({
        players: buildPlayers(),
        categoryIds: ['movies'],
        difficulty: 'easy',
        languageId: 'spanish',
        languageName: 'Spanish',
      }),
      /aborted/
    );
    assert.equal(callCount, 1);
  });
});

test('server integrity rejection clears the stored key without retrying paid work', async () => {
  installObserveOnlyPreparer();
  let fetchCallCount = 0;
  let invalidationCount = 0;
  globalThis.fetch = async () => {
    fetchCallCount += 1;
    return Response.json(
      { error: 'The integrity assertion was invalid', code: 'integrity_invalid' },
      { status: 401 }
    );
  };
  setAppAttestKeyInvalidatorForTesting(async () => {
    invalidationCount += 1;
  });

  await assert.rejects(
    () => createAiRound({
      players: buildPlayers(),
      categoryIds: ['movies'],
      difficulty: 'easy',
      languageId: 'spanish',
      languageName: 'Spanish',
    }),
    /AI round generation failed/
  );

  assert.equal(fetchCallCount, 1);
  assert.equal(invalidationCount, 1);
});

test('observe-mode integrity downgrade self-heals after preserving a successful round', async () => {
  installObserveOnlyPreparer();
  let invalidationCount = 0;
  globalThis.fetch = async () => Response.json(
    { word: 'Arrival', clue: 'language' },
    { headers: { 'X-Imposter-Integrity': 'invalid' } }
  );
  setAppAttestKeyInvalidatorForTesting(async () => {
    invalidationCount += 1;
  });

  const round = await createAiRound({
    players: buildPlayers(),
    categoryIds: ['movies'],
    difficulty: 'easy',
    languageId: 'english',
    languageName: 'English',
  });

  assert.equal(round.secretWord, 'Arrival');
  assert.equal(invalidationCount, 1);
});

test('duplicate translated output fails without selecting and charging another source', async () => {
  installObserveOnlyPreparer();
  let fetchCallCount = 0;

  globalThis.fetch = async () => {
    fetchCallCount += 1;
    return Response.json({ word: 'sol', clue: 'calor' });
  };

  const input = {
    players: buildPlayers(),
    categoryIds: ['objects'],
    difficulty: 'easy',
    languageId: 'spanish',
    languageName: 'Spanish',
    rng: () => 0,
  };

  await createRound(input);
  await assert.rejects(() => createRound(input), /already played word/);
  assert.equal(fetchCallCount, 2);
});

test('played-word history is newest-first, deduplicated, bounded, and UTF-8 safe', () => {
  const asciiHistory = sanitizePlayedWordHistory([
    ' newest ',
    'NEWEST',
    'invalid\nvalue',
    'x'.repeat(80),
    ...Array.from({ length: 60 }, (_, index) => `word-${index}`),
  ]);

  assert.equal(asciiHistory[0], 'newest');
  assert.equal(asciiHistory[1], 'x'.repeat(42));
  assert.equal(asciiHistory.length, MAX_PLAYED_WORD_HISTORY);
  assert.ok(asciiHistory.every((word) => word.length <= 42));

  const multibyteHistory = sanitizePlayedWordHistory(
    Array.from({ length: 50 }, (_, index) => `${'界'.repeat(39)}${index}`)
  );
  const encodedBytes = multibyteHistory.reduce(
    (total, word) => total + new TextEncoder().encode(word).byteLength,
    0
  );

  assert.ok(encodedBytes <= MAX_PLAYED_WORD_HISTORY_BYTES);
  assert.ok(multibyteHistory.length < MAX_PLAYED_WORD_HISTORY);
});

test('network request timeout is 15 seconds', () => {
  assert.equal(AI_ROUND_REQUEST_TIMEOUT_MS, 15_000);
});
