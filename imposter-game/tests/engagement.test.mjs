import assert from 'node:assert/strict';
import test from 'node:test';
import { canShowAd, canRequestReview, createEngagementStore, DAY_MS, newEngagement, parseEngagement, recordCompletion } from '../game/engagement.ts';

const now = 200 * DAY_MS;
const returning = { ...newEngagement(now - 7 * DAY_MS), completedRounds: 4 };

test('first-day players and unfinished milestones never qualify for ads or reviews', () => {
  for (const completedRounds of [0, 1, 2, 10]) {
    const fresh = { ...newEngagement(now), completedRounds };
    assert.equal(canShowAd(fresh, now, false), false);
    assert.equal(canRequestReview(fresh, now, '2'), false);
  }
  assert.equal(canShowAd({ ...returning, completedRounds: 2 }, now, false), false);
  assert.equal(canRequestReview({ ...returning, completedRounds: 3 }, now, '2'), false);
});

test('ads respect round spacing, elapsed time, rolling daily cap, purchases and reviews', () => {
  assert.equal(canShowAd(returning, now, false), true);
  for (const value of [
    { ...returning, lastAdRound: 2 },
    { ...returning, lastAdAt: now - 599_999 },
    { ...returning, adTimes: [now - 60_000, now - DAY_MS + 1] },
    { ...returning, reviewTimes: [now - 1000] },
  ]) assert.equal(canShowAd(value, now, false), false);
  assert.equal(canShowAd(returning, now, true), false);
  assert.equal(canShowAd({ ...returning, adTimes: [now - DAY_MS] }, now, false), true);
});

test('review attempts are spaced 120 days, once per version, and never overlap ads', () => {
  assert.equal(canRequestReview(returning, now, '2'), true);
  for (const value of [
    { ...returning, lastReviewVersion: '2' },
    { ...returning, reviewTimes: [now - 119 * DAY_MS] },
    { ...returning, reviewTimes: [1, 2, 3] },
    { ...returning, lastAdAt: now - 1000 },
  ]) assert.equal(canRequestReview(value, now, '2'), false);
});

test('completions survive reload and concurrent duplicate writes without double counting', async () => {
  let raw = null;
  const storage = { getItem: async () => raw, setItem: async (_, value) => { raw = value; } };
  const store = createEngagementStore(storage, () => now);
  await Promise.all([store.complete('a'), store.complete('a'), store.complete('b')]);
  const reloaded = createEngagementStore(storage, () => now);
  assert.equal((await reloaded.complete('a')).completedRounds, 2);
  assert.equal(recordCompletion(returning, 'x').completedRounds, 5);
});

test('corrupt history fails conservatively and storage errors do not poison subsequent operations', async () => {
  for (const raw of ['{', 'null', '{}', JSON.stringify({ ...returning, adTimes: [null] })]) {
    const result = parseEngagement(raw, now);
    assert.equal(result.completedRounds, 0);
    assert.equal(canShowAd(result, now, false), false);
  }
  let fail = true;
  const store = createEngagementStore({ getItem: async () => { if (fail) throw Error('disk'); return null; }, setItem: async () => {} }, () => now);
  await assert.rejects(store.complete('a'));
  fail = false;
  assert.equal((await store.complete('b')).completedRounds, 1);
});
