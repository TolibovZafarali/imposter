import assert from 'node:assert/strict';
import test from 'node:test';

import { hasPlayableCelebrityAnswer } from '../api/generate-round.ts';

test('celebrity answers require a complete public name', () => {
  assert.equal(hasPlayableCelebrityAnswer('Single'), false);
  assert.equal(hasPlayableCelebrityAnswer('First Last'), true);
});
