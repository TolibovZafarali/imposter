import assert from 'node:assert/strict';
import test from 'node:test';

import {
  clampImposterCount,
  DEFAULT_ROUND_TIMER_MINUTES,
  formatRoundTimerSetting,
  getMaxImposterCount,
  MIN_PLAYERS_FOR_TWO_IMPOSTERS,
  ROUND_TIMER_MINUTE_OPTIONS,
} from '../game/setupRules.ts';

test('imposter count stays at one for low player counts', () => {
  assert.equal(getMaxImposterCount(MIN_PLAYERS_FOR_TWO_IMPOSTERS - 1), 1);
  assert.equal(clampImposterCount(2, MIN_PLAYERS_FOR_TWO_IMPOSTERS - 1), 1);
});

test('two imposters are allowed when there are enough players', () => {
  assert.equal(getMaxImposterCount(MIN_PLAYERS_FOR_TWO_IMPOSTERS), 2);
  assert.equal(clampImposterCount(2, MIN_PLAYERS_FOR_TWO_IMPOSTERS), 2);
  assert.equal(clampImposterCount(3, MIN_PLAYERS_FOR_TWO_IMPOSTERS), 2);
});

test('round timer options include no timer and minute choices', () => {
  assert.equal(DEFAULT_ROUND_TIMER_MINUTES, 3);
  assert.deepEqual(ROUND_TIMER_MINUTE_OPTIONS, [1, 2, 3, 5, 10]);
  assert.equal(formatRoundTimerSetting(null), 'No timer');
  assert.equal(formatRoundTimerSetting(1), '1 min');
  assert.equal(formatRoundTimerSetting(5), '5 mins');
});
