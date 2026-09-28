import assert from 'node:assert/strict';
import test from 'node:test';
import { gameReducer, initialState } from '../game/state.ts';
import { buildRound } from '../game/round.ts';
import { remainingRoundSeconds } from '../game/timer.ts';

const makeRound = (count = 3, imposters = 1) => buildRound({
  players: Array.from({ length: count }, (_, i) => ({ id: `p${i}`, name: `Player ${i}` })),
  categoryIds: ['food'], difficulty: 'easy', languageId: 'en', languageName: 'English',
  secretWord: 'Apple', imposterHint: 'Orchard', imposterCount: imposters, rng: () => 0.4,
});

test('full reveal, discussion, completion and replay preserve setup and clear role progress', () => {
  const round = makeRound();
  let state = gameReducer(initialState, { type: 'startRound', round });
  assert.equal(gameReducer(state, { type: 'startPlaying', now: 1 }), state);
  assert.equal(gameReducer(state, { type: 'completeRound' }), state);
  state = gameReducer(state, { type: 'advanceReveal' });
  state = gameReducer(state, { type: 'advanceReveal' });
  assert.equal(gameReducer(state, { type: 'advanceReveal' }).currentRevealIndex, 2);
  state = gameReducer(state, { type: 'startPlaying', now: 1000 });
  assert.equal(state.phase, 'playing');
  assert.equal(gameReducer(state, { type: 'startPlaying', now: 2000 }).playStartedAt, 1000);
  assert.equal(gameReducer(state, { type: 'advanceReveal' }), state);
  state = gameReducer(state, { type: 'completeRound' });
  assert.equal(state.phase, 'completed');
  assert.equal(gameReducer(state, { type: 'completeRound' }), state);
  const replay = gameReducer(state, { type: 'startRound', round: makeRound() });
  assert.equal(replay.phase, 'reveal');
  assert.equal(replay.currentRevealIndex, 0);
  assert.equal(replay.playStartedAt, null);
  assert.equal(replay.setupPreferences, state.setupPreferences);
  const reset = gameReducer(state, { type: 'resetGame' });
  assert.equal(reset.round, null);
  assert.equal(reset.setupPreferences, state.setupPreferences);
});

test('three to ten players keep unique assignments and regular players share one word', () => {
  for (let count = 3; count <= 10; count++) {
    const round = makeRound(count, 2);
    assert.equal(round.cards.filter((card) => card.role === 'imposter').length, count >= 5 ? 2 : 1);
    assert.equal(new Set(round.imposterPlayerIds).size, round.imposterPlayerIds.length);
    assert.ok(round.cards.filter((card) => card.role === 'regular').every((card) => card.word === 'Apple' && card.hint === null));
    assert.ok(round.cards.filter((card) => card.role === 'imposter').every((card) => card.word === null));
    assert.ok(round.players.some((player) => player.id === round.firstSpeakerId));
  }
});

test('timer uses a deadline across backgrounding and clamps clock changes', () => {
  assert.equal(remainingRoundSeconds(1000, 180, 1000), 180);
  assert.equal(remainingRoundSeconds(1000, 180, 121001), 60);
  assert.equal(remainingRoundSeconds(1000, 180, 181000), 0);
  assert.equal(remainingRoundSeconds(1000, 180, 900000), 0);
  assert.equal(remainingRoundSeconds(1000, 180, 0), 180);
});
