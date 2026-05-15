import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildPrompt,
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
