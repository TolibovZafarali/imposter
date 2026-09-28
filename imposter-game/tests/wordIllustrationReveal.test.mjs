import assert from 'node:assert/strict';
import test from 'node:test';

import {
  getWordIllustrationSize,
  loadRoundIllustration,
  selectRevealIllustration,
} from '../components/word-illustration-state.ts';

const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
};

const imageReference = () => ({ releases: 0, release() { this.releases += 1; } });

test('artwork fits around three text lines and shrinks before being omitted', () => {
  assert.equal(getWordIllustrationSize({ cardHeight: 480, contentWidth: 294, fontScale: 1 }), 200);
  assert.equal(getWordIllustrationSize({ cardHeight: 357, contentWidth: 279, fontScale: 1 }), 121);
  assert.equal(getWordIllustrationSize({ cardHeight: 300, contentWidth: 224, fontScale: 1 }), 0);
  assert.equal(getWordIllustrationSize({ cardHeight: 480, contentWidth: 294, fontScale: 2 }), 0);
  assert.equal(getWordIllustrationSize({ cardHeight: 480, contentWidth: 150, fontScale: 1 }), 150);
});

test('imposters and unrelated or unavailable image references never reach the reveal', () => {
  const image = imageReference();
  const input = {
    ready: { roundId: 'round-a', entryId: 'objects:umbrella', image },
    roundId: 'round-a',
    entryId: 'objects:umbrella',
    role: 'regular',
    size: 200,
  };
  assert.equal(selectRevealIllustration(input), image);
  assert.equal(selectRevealIllustration({ ...input, role: 'imposter' }), null);
  assert.equal(selectRevealIllustration({ ...input, roundId: 'round-b' }), null);
  assert.equal(selectRevealIllustration({ ...input, entryId: 'objects:camera' }), null);
  assert.equal(selectRevealIllustration({ ...input, entryId: null }), null);
  assert.equal(selectRevealIllustration({ ...input, ready: null }), null);
  assert.equal(selectRevealIllustration({ ...input, size: 0 }), null);
});

test('an old round finishing after the next round cannot publish its image', async () => {
  const oldLoad = deferred();
  const newLoad = deferred();
  const oldImage = imageReference();
  const newImage = imageReference();
  const published = [];
  const disposeOld = loadRoundIllustration(1, () => oldLoad.promise, (image) => published.push(image));
  disposeOld();
  const disposeNew = loadRoundIllustration(2, () => newLoad.promise, (image) => published.push(image));
  newLoad.resolve(newImage);
  await newLoad.promise;
  oldLoad.resolve(oldImage);
  await oldLoad.promise;
  assert.deepEqual(published, [newImage]);
  assert.equal(oldImage.releases, 1);
  assert.equal(newImage.releases, 0);
  disposeNew();
  disposeNew();
  assert.equal(newImage.releases, 1);
});

test('unmount releases a decoded image and discards any pending result', async () => {
  const pending = deferred();
  const image = imageReference();
  let published = false;
  const dispose = loadRoundIllustration(1, () => pending.promise, () => { published = true; });
  dispose();
  pending.resolve(image);
  await pending.promise;
  assert.equal(published, false);
  assert.equal(image.releases, 1);
});

test('missing sources and decode failures remain text-only without retries', async () => {
  let loads = 0;
  const published = [];
  const load = async () => { loads += 1; throw new Error('Unavailable image'); };
  const disposeMissing = loadRoundIllustration(undefined, load, (image) => published.push(image));
  const disposeFailure = loadRoundIllustration(1, load, (image) => published.push(image));
  await Promise.resolve();
  assert.equal(loads, 1);
  assert.deepEqual(published, []);
  disposeMissing();
  disposeFailure();
});

test('a reveal taken before decoding stays text-only until the next reveal', async () => {
  const pending = deferred();
  const image = imageReference();
  let ready = null;
  const input = { roundId: 'round-a', entryId: 'objects:umbrella', role: 'regular', size: 200 };
  const dispose = loadRoundIllustration(1, () => pending.promise, (decoded) => {
    ready = { roundId: input.roundId, entryId: input.entryId, image: decoded };
  });
  const heldReveal = selectRevealIllustration({ ...input, ready });
  pending.resolve(image);
  await pending.promise;
  assert.equal(heldReveal, null);
  assert.equal(selectRevealIllustration({ ...input, ready }), image);
  dispose();
});
