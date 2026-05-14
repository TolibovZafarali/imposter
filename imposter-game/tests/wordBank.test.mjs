import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DYNAMIC_CATEGORY_IDS,
  ENGLISH_WORD_BANK,
  ENGLISH_WORD_BANK_BY_CATEGORY,
  STATIC_CATEGORY_IDS,
  hasPlayableCelebrityAnswer,
  resolveRoundWordPlan,
  selectStaticWordEntry,
} from '../data/wordBank.ts';

test('static word bank is intentionally empty', () => {
  assert.equal(ENGLISH_WORD_BANK.length, 0);

  for (const categoryId of STATIC_CATEGORY_IDS) {
    assert.deepEqual(ENGLISH_WORD_BANK_BY_CATEGORY[categoryId], []);
  }
});

test('static category selection fails clearly while word data is absent', () => {
  assert.throws(
    () => selectStaticWordEntry({ categoryId: 'food' }),
    /No static word data available/
  );
});

test('round word plan keeps dynamic categories on AI generation', () => {
  for (const categoryId of DYNAMIC_CATEGORY_IDS) {
    const plan = resolveRoundWordPlan({
      categoryIds: [categoryId],
      languageId: 'english',
      languageName: 'English',
      rng: () => 0,
    });

    assert.equal(plan.mode, 'ai');
    assert.equal(plan.source.type, 'ai');
    assert.equal(plan.source.categoryId, categoryId);
  }
});

test('celebrity answer helper rejects incomplete output', () => {
  assert.equal(hasPlayableCelebrityAnswer('Single'), false);
  assert.equal(hasPlayableCelebrityAnswer('First Last'), true);
});
