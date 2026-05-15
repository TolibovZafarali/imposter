import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DYNAMIC_CATEGORY_IDS,
  ENGLISH_WORD_BANK,
  ENGLISH_WORD_BANK_BY_CATEGORY,
  STATIC_CATEGORY_IDS,
  chooseRoundCategory,
  hasPlayableCelebrityAnswer,
  resolveRoundWordPlan,
  selectRandomCategoryIds,
  selectStaticWordEntry,
} from '../data/wordBank.ts';

const createSeededRng = (seed) => {
  let state = seed >>> 0;

  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;

    return state / 0x100000000;
  };
};

test('static word bank is populated from replacement categories', () => {
  assert.equal(ENGLISH_WORD_BANK.length, 4324);
  assert.deepEqual(STATIC_CATEGORY_IDS, [
    'activities',
    'food',
    'animals',
    'objects',
    'places',
    'sports',
  ]);

  assert.equal(ENGLISH_WORD_BANK_BY_CATEGORY.activities.length, 698);
  assert.equal(ENGLISH_WORD_BANK_BY_CATEGORY.food.length, 492);
  assert.equal(ENGLISH_WORD_BANK_BY_CATEGORY.animals.length, 380);
  assert.equal(ENGLISH_WORD_BANK_BY_CATEGORY.objects.length, 600);
  assert.equal(ENGLISH_WORD_BANK_BY_CATEGORY.places.length, 645);
  assert.equal(ENGLISH_WORD_BANK_BY_CATEGORY.sports.length, 1509);
});

test('static category selection respects difficulty', () => {
  const foodEntry = selectStaticWordEntry({
    categoryId: 'food',
    difficulty: 'medium',
    rng: () => 0,
  });
  const sportsEntry = selectStaticWordEntry({
    categoryId: 'sports',
    difficulty: 'hard',
    rng: () => 0,
  });

  assert.equal(foodEntry.word, 'cantaloupe');
  assert.equal(foodEntry.difficulty, 'medium');
  assert.equal(sportsEntry.word, 'soccer');
  assert.equal(sportsEntry.difficulty, 'hard');
});

test('english static rounds use selected difficulty data', () => {
  const plan = resolveRoundWordPlan({
    categoryIds: ['places'],
    difficulty: 'hard',
    languageId: 'english',
    languageName: 'English',
    rng: () => 0,
  });

  assert.equal(plan.mode, 'local-static');
  assert.equal(plan.source.type, 'static');
  assert.equal(plan.source.categoryId, 'places');
  assert.equal(plan.source.entry.difficulty, 'hard');
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

test('random category mode downweights movies and celebrities', () => {
  const categoryIds = [...STATIC_CATEGORY_IDS, ...DYNAMIC_CATEGORY_IDS];
  const categoryCounts = Object.fromEntries(categoryIds.map((categoryId) => [categoryId, 0]));
  const rng = createSeededRng(12345);
  const roundCount = 20000;

  for (let roundIndex = 0; roundIndex < roundCount; roundIndex += 1) {
    const randomCategoryIds = selectRandomCategoryIds({
      categoryIds,
      count: 3,
      rng,
    });
    const selectedCategoryId = chooseRoundCategory(randomCategoryIds, rng);

    categoryCounts[selectedCategoryId] += 1;
  }

  const averageStaticCount =
    STATIC_CATEGORY_IDS.reduce((sum, categoryId) => sum + categoryCounts[categoryId], 0) /
    STATIC_CATEGORY_IDS.length;

  assert.ok(categoryCounts.movies < averageStaticCount * 0.75);
  assert.ok(categoryCounts.celebrities < averageStaticCount * 0.75);
});

test('celebrity answer helper rejects incomplete output', () => {
  assert.equal(hasPlayableCelebrityAnswer('Single'), false);
  assert.equal(hasPlayableCelebrityAnswer('First Last'), true);
});
