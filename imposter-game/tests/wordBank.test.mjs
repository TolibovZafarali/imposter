import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DYNAMIC_CATEGORY_IDS,
  ENGLISH_WORD_BANK,
  ENGLISH_WORD_BANK_BY_CATEGORY,
  RANDOM_CATEGORY_WEIGHTS,
  STATIC_CATEGORY_IDS,
  chooseRoundCategory,
  hasPlayableCelebrityAnswer,
  resolveRoundWordPlan,
  selectRandomCategoryIds,
  selectStaticWordEntry,
} from '../data/wordBank.ts';

test('static word bank is populated from replacement categories', () => {
  assert.equal(ENGLISH_WORD_BANK.length, 2985);
  assert.deepEqual(STATIC_CATEGORY_IDS, [
    'activities',
    'food',
    'animals',
    'objects',
    'places',
    'sports',
  ]);

  assert.equal(ENGLISH_WORD_BANK_BY_CATEGORY.activities.length, 613);
  assert.equal(ENGLISH_WORD_BANK_BY_CATEGORY.food.length, 391);
  assert.equal(ENGLISH_WORD_BANK_BY_CATEGORY.animals.length, 380);
  assert.equal(ENGLISH_WORD_BANK_BY_CATEGORY.objects.length, 562);
  assert.equal(ENGLISH_WORD_BANK_BY_CATEGORY.places.length, 564);
  assert.equal(ENGLISH_WORD_BANK_BY_CATEGORY.sports.length, 475);
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
  assert.equal(sportsEntry.word, 'netball');
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

test('random category weights are based on playability', () => {
  assert.deepEqual(RANDOM_CATEGORY_WEIGHTS, {
    objects: 25,
    animals: 22,
    activities: 19,
    places: 11,
    sports: 10,
    food: 7,
    movies: 3,
    celebrities: 3,
  });
  assert.equal(
    Object.values(RANDOM_CATEGORY_WEIGHTS).reduce((sum, weight) => sum + weight, 0),
    100
  );
  assert.ok(RANDOM_CATEGORY_WEIGHTS.food > RANDOM_CATEGORY_WEIGHTS.movies);
  assert.ok(RANDOM_CATEGORY_WEIGHTS.food > RANDOM_CATEGORY_WEIGHTS.celebrities);
  assert.ok(
    ENGLISH_WORD_BANK_BY_CATEGORY.animals.length < ENGLISH_WORD_BANK_BY_CATEGORY.places.length
  );
  assert.ok(RANDOM_CATEGORY_WEIGHTS.animals > RANDOM_CATEGORY_WEIGHTS.places);
});

test('random category selection uses weights instead of equal odds', () => {
  const categoryIds = ['food', 'movies', 'celebrities'];

  assert.equal(chooseRoundCategory(categoryIds, () => 0.75), 'movies');
  assert.deepEqual(
    selectRandomCategoryIds({
      categoryIds,
      count: 1,
      rng: () => 0.75,
    }),
    ['movies']
  );
});

test('celebrity answer helper rejects incomplete output', () => {
  assert.equal(hasPlayableCelebrityAnswer('Single'), false);
  assert.equal(hasPlayableCelebrityAnswer('First Last'), true);
});
