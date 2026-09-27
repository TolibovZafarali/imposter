import assert from 'node:assert/strict';
import test from 'node:test';

import { getTutorialSwipeDirection } from '../game/tutorialNavigation.ts';

function swipe(overrides = {}) {
  return getTutorialSwipeDirection({ dx: 0, dy: 0, vx: 0, width: 390, ...overrides });
}

test('taps and small hand movements never advance the tutorial', () => {
  assert.equal(swipe(), 0);
  assert.equal(swipe({ dx: -8, dy: 3 }), 0);
  assert.equal(swipe({ dx: -19, vx: -2 }), 0);
  assert.equal(swipe({ dx: 19, vx: 2 }), 0);
});

test('vertical and diagonal gestures do not change pages even when fast', () => {
  assert.equal(swipe({ dx: -8, dy: 100, vx: -2 }), 0);
  assert.equal(swipe({ dx: -100, dy: 90, vx: -2 }), 0);
  assert.equal(swipe({ dx: 130, dy: 100, vx: 2 }), 0);
  assert.equal(swipe({ dx: -131, dy: 100 }), 1);
});

test('deliberate left and right swipes navigate forward and back', () => {
  assert.equal(swipe({ dx: -90, dy: 8 }), 1);
  assert.equal(swipe({ dx: 90, dy: -8 }), -1);
  assert.equal(swipe({ dx: -90, vx: 0.1 }), 1);
});

test('short flicks require sufficient travel and velocity in the same direction', () => {
  assert.equal(swipe({ dx: -20, vx: -0.6 }), 1);
  assert.equal(swipe({ dx: 20, vx: 0.6 }), -1);
  assert.equal(swipe({ dx: -30, vx: -0.5 }), 0);
  assert.equal(swipe({ dx: 30, vx: 0.5 }), 0);
  assert.equal(swipe({ dx: -30, vx: 1 }), 0);
  assert.equal(swipe({ dx: 30, vx: -1 }), 0);
});

test('distance threshold has a safe minimum and scales to larger screens', () => {
  assert.equal(swipe({ dx: -43, width: 200 }), 0);
  assert.equal(swipe({ dx: -44, width: 200 }), 1);
  assert.equal(swipe({ dx: 63, width: 400 }), 0);
  assert.equal(swipe({ dx: 64, width: 400 }), -1);
  assert.equal(swipe({ dx: -127, width: 800 }), 0);
  assert.equal(swipe({ dx: -128, width: 800 }), 1);
  assert.equal(swipe({ dx: -20, vx: -0.6, width: 800 }), 1);
});

test('invalid gesture readings and layout widths cannot dismiss the tutorial', () => {
  for (const field of ['dx', 'dy', 'vx', 'width']) {
    for (const value of [NaN, Infinity, -Infinity, undefined, null, '100']) {
      assert.equal(swipe({ dx: -100, [field]: value }), 0, `${field}: ${String(value)}`);
    }
  }
  assert.equal(swipe({ dx: -100, width: 0 }), 0);
  assert.equal(swipe({ dx: -100, width: -390 }), 0);
});
