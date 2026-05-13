import assert from 'node:assert/strict';
import test from 'node:test';

import { hasPlayableCelebrityAnswer } from '../api/generate-round.ts';

test('celebrity answers require a complete public name', () => {
  assert.equal(hasPlayableCelebrityAnswer('Dilbar'), false);
  assert.equal(hasPlayableCelebrityAnswer('Sherzod'), false);
  assert.equal(hasPlayableCelebrityAnswer('Beyonce'), false);
  assert.equal(hasPlayableCelebrityAnswer('Ozodbek Nazarbekov'), true);
  assert.equal(hasPlayableCelebrityAnswer('Yulduz Usmonova'), true);
});
