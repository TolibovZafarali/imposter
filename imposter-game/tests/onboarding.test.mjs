import assert from 'node:assert/strict';
import test from 'node:test';

import { createOnboardingStore, ONBOARDING_STORAGE_KEY } from '../game/onboarding.ts';

function memoryStorage(initial = []) {
  const items = new Map(initial);
  return {
    items,
    getItem: async (key) => items.get(key) ?? null,
    setItem: async (key, value) => { items.set(key, value); },
  };
}

test('a new install shows the walkthrough again after an unfinished session', async () => {
  const storage = memoryStorage();
  assert.equal(await createOnboardingStore(storage).isDismissed(), false);
  assert.equal(storage.items.size, 0);
  assert.equal(await createOnboardingStore(storage).isDismissed(), false);
});

for (const outcome of ['completed', 'skipped']) {
  test(`${outcome} is remembered across restarts without changing game data`, async () => {
    const savedGame = ['imposter:engagement:v1', '{"completedRounds":4}'];
    const savedLanguage = ['imposter:selected-language-id', 'es'];
    const storage = memoryStorage([savedGame, savedLanguage]);
    const store = createOnboardingStore(storage);
    await store.finish(outcome);
    assert.equal(await store.isDismissed(), true);
    assert.equal(await createOnboardingStore(storage).isDismissed(), true);
    assert.deepEqual(JSON.parse(storage.items.get(ONBOARDING_STORAGE_KEY)), { version: 1, outcome });
    assert.equal(storage.items.get(savedGame[0]), savedGame[1]);
    assert.equal(storage.items.get(savedLanguage[0]), savedLanguage[1]);
    assert.equal(storage.items.size, 3);
  });
}

test('malformed, unfinished, and unsupported records do not bypass the walkthrough', async () => {
  for (const raw of [
    '{', 'null', '{}', 'true',
    JSON.stringify({ version: 1, outcome: 'started' }),
    JSON.stringify({ version: 2, outcome: 'completed' }),
    JSON.stringify({ outcome: 'completed' }),
  ]) {
    const storage = memoryStorage([[ONBOARDING_STORAGE_KEY, raw]]);
    assert.equal(await createOnboardingStore(storage).isDismissed(), false);
    assert.equal(storage.items.get(ONBOARDING_STORAGE_KEY), raw);
  }
});

test('read and write failures still allow dismissal for the rest of the session', async () => {
  const storage = {
    getItem: async () => { throw new Error('Read unavailable'); },
    setItem: async () => { throw new Error('Write unavailable'); },
  };
  const store = createOnboardingStore(storage);
  assert.equal(await store.isDismissed(), false);
  await store.finish('skipped');
  assert.equal(await store.isDismissed(), true);
  assert.equal(await createOnboardingStore(storage).isDismissed(), false);
});

test('dismissal is immediate while a device write is still pending', async () => {
  let releaseWrite;
  const pendingWrite = new Promise((resolve) => { releaseWrite = resolve; });
  const store = createOnboardingStore({
    getItem: async () => null,
    setItem: async () => pendingWrite,
  });
  const finishing = store.finish('completed');
  assert.equal(await store.isDismissed(), true);
  releaseWrite();
  await finishing;
});

test('a stale read cannot undo a dismissal made while storage was loading', async () => {
  let releaseRead;
  const pendingRead = new Promise((resolve) => { releaseRead = resolve; });
  const store = createOnboardingStore({
    getItem: async () => pendingRead,
    setItem: async () => {},
  });
  const reading = store.isDismissed();
  await store.finish('completed');
  releaseRead(null);
  assert.equal(await reading, true);
});
