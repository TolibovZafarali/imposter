import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildPrompt,
  buildStaticWordPrompt,
  hasPlayableCelebrityAnswer,
  parseGeneratedWord,
  selectPopularityScope,
} from '../api/generate-round.ts';

const buildRoundRequest = (overrides = {}) => ({
  categoryIds: ['celebrities'],
  difficulty: 'easy',
  languageId: 'english',
  languageName: 'English',
  playerCount: 5,
  playedWords: [],
  ...overrides,
});

const buildStaticWordRequest = (overrides = {}) => ({
  mode: 'prepare-static-word',
  languageId: 'english',
  languageName: 'English',
  source: {
    word: 'knife',
    categoryId: 'objects',
    categoryLabel: 'Objects',
    difficulty: 'easy',
    storedClue: 'kitchen',
  },
  ...overrides,
});

test('celebrity answers require a complete public name', () => {
  assert.equal(hasPlayableCelebrityAnswer('Single'), false);
  assert.equal(hasPlayableCelebrityAnswer('First Last'), true);
});

test('celebrity prompt applies complete public name rules to every language', () => {
  const prompt = buildPrompt(
    buildRoundRequest({
      languageId: 'spanish',
      languageName: 'Spanish',
    }),
    'celebrity-scope-seed',
    [],
    'local'
  );

  assert.match(prompt, /For Celebrities, return only widely recognizable public figures/);
  assert.match(prompt, /complete public name with at least two words/);
  assert.match(prompt, /never return a first name, nickname, or partial name by itself/);
  assert.match(prompt, /These rules apply to every language/);
});

test('celebrity prompt prefers iconic traits over famous works for clues', () => {
  const prompt = buildPrompt(buildRoundRequest(), 'celebrity-trait-seed', [], 'local');

  assert.match(prompt, /recognizable traits, visual trademarks, symbols, or public persona clues/);
  assert.match(prompt, /Leo Tolstoy -> beard/);
  assert.match(prompt, /avoid using the person's most famous work/);
});

test('celebrity prompt does not include Uzbek-specific instructions', () => {
  const prompt = buildPrompt(
    buildRoundRequest({
      languageId: 'uzbek',
      languageName: 'Uzbek',
    }),
    'uzbek-celebrity-seed',
    [],
    'local'
  );

  assert.doesNotMatch(prompt, /For Uzbek/i);
  assert.doesNotMatch(prompt, /ordinary Uzbek first names/i);
});

test('movie prompt includes international and local popularity rules', () => {
  const prompt = buildPrompt(
    buildRoundRequest({
      categoryIds: ['movies'],
    }),
    'movie-scope-seed',
    [],
    'international'
  );

  assert.match(prompt, /Popularity scope: International/);
  assert.match(prompt, /If Popularity scope is International, choose something extremely famous worldwide/);
  assert.match(prompt, /If Popularity scope is Local, choose something extremely famous among speakers/);
  assert.match(prompt, /For Movies, return a well-known movie title/);
});

test('prompt injects already played words instead of recent words', () => {
  const playedWords = Array.from({ length: 45 }, (_, index) => `Movie ${index}`);
  const prompt = buildPrompt(
    buildRoundRequest({
      categoryIds: ['movies'],
    }),
    'played-word-seed',
    playedWords,
    'local'
  );

  assert.match(prompt, /Popularity scope: Local to the selected language\/culture/);
  assert.match(prompt, /Already played secret words to avoid: Movie 0, Movie 1/);
  assert.match(prompt, /Movie 44/);
  assert.doesNotMatch(prompt, /Recent secret words/i);
});

test('prompt asks for distinctive one- or two-word association clues', () => {
  const prompt = buildPrompt(
    buildRoundRequest({
      categoryIds: ['movies'],
    }),
    'association-clue-seed',
    [],
    'international'
  );

  assert.match(prompt, /one or two words/);
  assert.match(prompt, /physical properties, uses, behavior, shape or visual links/);
  assert.match(prompt, /Avoid weak common-place clues/);
  assert.doesNotMatch(prompt, /exactly one/i);
  assert.doesNotMatch(prompt, /obvious trait/i);
});

test('static word prompt keeps English words and avoids stored clues', () => {
  const prompt = buildStaticWordPrompt(buildStaticWordRequest(), 'static-word-seed');

  assert.match(prompt, /Keep the source word exactly as the returned word/);
  assert.match(prompt, /Weak stored clue to avoid copying: kitchen/);
  assert.match(prompt, /Generate a fresh imposter clue/);
  assert.match(prompt, /Do not translate, reuse, or lightly rewrite the weak stored clue/);
  assert.match(prompt, /one or two words/);
  assert.doesNotMatch(prompt, /exactly one/i);
});

test('static word prompt translates non-English words and generates fresh clues', () => {
  const prompt = buildStaticWordPrompt(
    buildStaticWordRequest({
      languageId: 'russian',
      languageName: 'Russian',
    }),
    'translated-static-seed'
  );

  assert.match(prompt, /Translate the source word naturally/);
  assert.match(prompt, /Generate a fresh imposter clue/);
  assert.match(prompt, /Both fields must be in the target language/);
});

test('generated clue validation accepts one- or two-word association clues', () => {
  assert.deepEqual(parseGeneratedWord({ word: 'knife', clue: 'sharp edge' }), {
    word: 'knife',
    clue: 'sharp edge',
  });
  assert.deepEqual(parseGeneratedWord({ word: 'dough', clue: 'elasticity' }), {
    word: 'dough',
    clue: 'elasticity',
  });
});

test('generated clue validation rejects long, punctuated, and generic clues', () => {
  assert.throws(
    () => parseGeneratedWord({ word: 'knife', clue: 'very sharp edge' }),
    /one or two clean words/
  );
  assert.throws(
    () => parseGeneratedWord({ word: 'knife', clue: 'sharp/edge' }),
    /one or two clean words/
  );

  for (const clue of ['school', 'kitchen', 'food', 'animal', 'object', 'store', 'restaurant']) {
    assert.throws(
      () => parseGeneratedWord({ word: 'knife', clue }),
      /generic category or common place/
    );
  }
});

test('generated words are rejected when they match played words after normalization', () => {
  assert.throws(
    () => parseGeneratedWord({ word: '  AMELIE!!! ', clue: 'party' }, ['Amelie'], ['movies']),
    /already played/
  );
  assert.throws(
    () => parseGeneratedWord({ word: 'Amélie', clue: 'party' }, ['amelie'], ['movies']),
    /already played/
  );
});

test('popularity scope is injected into prompts but stripped from parsed output', () => {
  const prompt = buildPrompt(buildRoundRequest(), 'scope-output-seed', [], 'local');
  const parsed = parseGeneratedWord(
    {
      word: 'Tom Hanks',
      clue: 'party',
      popularityScope: 'Local to the selected language/culture',
    },
    [],
    ['celebrities']
  );

  assert.match(prompt, /Popularity scope: Local to the selected language\/culture/);
  assert.equal('popularityScope' in parsed, false);
  assert.deepEqual(parsed, {
    word: 'Tom Hanks',
    clue: 'party',
  });
});

test('popularity scope selection is roughly balanced across generated variety keys', () => {
  const counts = {
    international: 0,
    local: 0,
  };
  const total = 10000;

  for (let index = 0; index < total; index += 1) {
    counts[selectPopularityScope(`round-${index}`)] += 1;
  }

  const internationalRatio = counts.international / total;

  assert.ok(internationalRatio > 0.45);
  assert.ok(internationalRatio < 0.55);
});
