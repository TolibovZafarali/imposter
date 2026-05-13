import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DYNAMIC_CATEGORY_IDS,
  ENGLISH_WORD_BANK,
  ENGLISH_WORD_BANK_BY_CATEGORY,
  STATIC_CATEGORY_IDS,
  WORD_BANK_TARGET_SIZE,
  hasPlayableCelebrityAnswer,
  normalizeWordKey,
  resolveRoundWordPlan,
} from '../data/wordBank.ts';

const CATEGORY_HINT_TOKENS = new Set([
  'food',
  'animal',
  'animals',
  'job',
  'jobs',
  'country',
  'countries',
  'object',
  'objects',
  'sport',
  'sports',
  'school',
  'fantasy',
  'movie',
  'movies',
  'celebrity',
  'celebrities',
]);

const isOneWordHint = (hint) => {
  const normalizedHint = normalizeWordKey(hint);

  return (
    normalizedHint.split(' ').filter(Boolean).length === 1 &&
    !/[-\u2010-\u2015/]/u.test(hint)
  );
};

test('static word bank has exactly 100 entries per MVP category', () => {
  assert.equal(ENGLISH_WORD_BANK.length, STATIC_CATEGORY_IDS.length * WORD_BANK_TARGET_SIZE);

  for (const categoryId of STATIC_CATEGORY_IDS) {
    assert.equal(
      ENGLISH_WORD_BANK_BY_CATEGORY[categoryId].length,
      WORD_BANK_TARGET_SIZE,
      categoryId
    );
  }
});

test('static word bank entries are valid and do not include dynamic categories', () => {
  const entryIds = new Set();
  const dynamicCategoryIds = new Set(DYNAMIC_CATEGORY_IDS);

  for (const entry of ENGLISH_WORD_BANK) {
    assert.ok(entry.id, `Missing id for ${entry.word}`);
    assert.ok(entry.word.trim(), `Missing word for ${entry.id}`);
    assert.ok(entry.hint.trim(), `Missing hint for ${entry.id}`);
    assert.ok(!entryIds.has(entry.id), `Duplicate id ${entry.id}`);
    assert.ok(!dynamicCategoryIds.has(entry.categoryId), `Dynamic category data found: ${entry.id}`);
    assert.ok(isOneWordHint(entry.hint), `Hint must be exactly one word: ${entry.id}`);

    const wordKey = normalizeWordKey(entry.word);
    const hintKey = normalizeWordKey(entry.hint);

    assert.notEqual(wordKey, hintKey, `Hint equals word: ${entry.id}`);
    assert.ok(!wordKey.includes(hintKey), `Word contains hint: ${entry.id}`);
    assert.ok(!hintKey.includes(wordKey), `Hint contains word: ${entry.id}`);
    assert.ok(!CATEGORY_HINT_TOKENS.has(hintKey), `Hint is a category token: ${entry.id}`);

    entryIds.add(entry.id);
  }
});

test('round word plan uses local static data for English static categories', () => {
  const plan = resolveRoundWordPlan({
    categoryIds: ['food'],
    languageId: 'english',
    languageName: 'English',
    rng: () => 0,
  });

  assert.equal(plan.mode, 'local-static');
  assert.equal(plan.source.type, 'static');
  assert.equal(plan.source.categoryId, 'food');
});

test('round word plan uses translation for non-English static categories', () => {
  const plan = resolveRoundWordPlan({
    categoryIds: ['animals'],
    languageId: 'spanish',
    languageName: 'Spanish',
    rng: () => 0,
  });

  assert.equal(plan.mode, 'translate-static');
  assert.equal(plan.source.type, 'static');
  assert.equal(plan.source.categoryId, 'animals');
});

test('round word plan keeps movies and celebrities on AI generation', () => {
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

test('celebrity answer helper rejects first-name-only output', () => {
  assert.equal(hasPlayableCelebrityAnswer('Dilbar'), false);
  assert.equal(hasPlayableCelebrityAnswer('Sherzod'), false);
  assert.equal(hasPlayableCelebrityAnswer('Dilbar Qosimova'), true);
  assert.equal(hasPlayableCelebrityAnswer('Ozodbek Nazarbekov'), true);
});

test('mixed category selection chooses category first, then source', () => {
  const staticPlan = resolveRoundWordPlan({
    categoryIds: ['food', 'movies'],
    languageId: 'english',
    languageName: 'English',
    rng: () => 0,
  });
  const dynamicPlan = resolveRoundWordPlan({
    categoryIds: ['food', 'movies'],
    languageId: 'english',
    languageName: 'English',
    rng: () => 0.75,
  });

  assert.equal(staticPlan.mode, 'local-static');
  assert.equal(staticPlan.source.categoryId, 'food');
  assert.equal(dynamicPlan.mode, 'ai');
  assert.equal(dynamicPlan.source.categoryId, 'movies');
});

test('recent static entries are avoided when alternatives exist', () => {
  const firstEntry = ENGLISH_WORD_BANK_BY_CATEGORY.food[0];
  const plan = resolveRoundWordPlan({
    categoryIds: ['food'],
    languageId: 'english',
    languageName: 'English',
    recentEntryIds: [firstEntry.id],
    rng: () => 0,
  });

  assert.equal(plan.mode, 'local-static');
  assert.notEqual(plan.source.entry.id, firstEntry.id);
});

test('recent static words are avoided when alternatives exist', () => {
  const firstEntry = ENGLISH_WORD_BANK_BY_CATEGORY.animals[0];
  const plan = resolveRoundWordPlan({
    categoryIds: ['animals'],
    languageId: 'english',
    languageName: 'English',
    recentWords: [firstEntry.word],
    rng: () => 0,
  });

  assert.equal(plan.mode, 'local-static');
  assert.notEqual(plan.source.entry.id, firstEntry.id);
});
