import assert from 'node:assert/strict';
import test from 'node:test';

import {
  AI_ROUND_REQUEST_TIMEOUT_MS,
  createRound,
} from '../services/roundGenerator.ts';
import {
  buildPrompt,
  buildStaticWordPrompt,
  CANDIDATE_COUNT,
  default as generateRoundHandler,
  getUniqueClueCandidates,
  hasPlayableCelebrityAnswer,
  MAX_DYNAMIC_GENERATION_ATTEMPTS,
  MAX_STATIC_PREPARE_ATTEMPTS,
  parseClueQualityJudgments,
  parseGeneratedWord,
  prepareStaticWordWithFallback,
  selectPopularityScope,
  selectBestGeneratedClue,
  setOpenAIClientFactoryForTesting,
} from '../api/generate-round.ts';
import { selectStaticWordEntry } from '../data/wordBank.ts';
import { getFallbackStaticWord } from '../services/staticFallback.ts';

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

const buildPlayers = () => [
  { id: 'player-1', name: 'A' },
  { id: 'player-2', name: 'B' },
  { id: 'player-3', name: 'C' },
];

const parseJsonResponse = async (response) => ({
  status: response.status,
  body: await response.json(),
});

const withEnv = async (updates, callback) => {
  const previousValues = new Map(Object.keys(updates).map((key) => [key, process.env[key]]));

  for (const [key, value] of Object.entries(updates)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }

  try {
    return await callback();
  } finally {
    for (const [key, value] of previousValues) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
};

const createFakeOpenAi = (parseImplementation) => ({
  responses: {
    parse: parseImplementation,
  },
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
  assert.match(prompt, /believable talking angle/);
  assert.match(prompt, /cause\/effect, use, setting, risk, sensation/);
  assert.match(prompt, /sunscreen -> beach/);
  assert.match(prompt, /pencil -> school is too generic/);
  assert.doesNotMatch(prompt, /Avoid weak common-place clues/);
  assert.doesNotMatch(prompt, /exactly one/i);
  assert.doesNotMatch(prompt, /obvious trait/i);
});

test('static word prompt keeps English words and avoids stored clues', () => {
  const prompt = buildStaticWordPrompt(buildStaticWordRequest(), 'static-word-seed');

  assert.match(prompt, /Keep the source word exactly as the returned word/);
  assert.match(prompt, /Weak stored clue to avoid copying: kitchen/);
  assert.match(prompt, /Generate 8 fresh imposter clue candidates/);
  assert.match(prompt, /Do not translate, reuse, or lightly rewrite the weak stored clue/);
  assert.match(prompt, /one or two words/);
  assert.match(prompt, /sunscreen -> beach is acceptable/);
  assert.doesNotMatch(prompt, /exactly one/i);
  assert.doesNotMatch(prompt, /Avoid weak common-place clues/);
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
  assert.match(prompt, /Generate 8 fresh imposter clue candidates/);
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
      /generic, unrelated, or an over-direct clue/
    );
  }
});

test('bad generated clues fail quality validation', () => {
  const badPairs = [
    ['sunscreen', 'edge'],
    ['baby goat', 'talisman'],
    ['desert kangaroo', 'talisman'],
    ['pizza', 'cheese'],
    ['passport', 'document'],
    ['hospital', 'doctor'],
    ['banana', 'fruit'],
    ['sushi', 'roll'],
  ];

  for (const [word, clue] of badPairs) {
    assert.throws(
      () => parseGeneratedWord({ word, clue }),
      /generic, unrelated, or an over-direct clue/
    );
  }
});

test('good generated clues pass quality validation', () => {
  const goodPairs = [
    ['sunscreen', 'burn'],
    ['sunscreen', 'UV'],
    ['sunscreen', 'beach'],
    ['sunscreen', 'protection'],
    ['passport', 'border'],
    ['hospital', 'recovery'],
    ['banana', 'peel'],
    ['pizza', 'oven'],
    ['flag', 'wind'],
    ['dough', 'elasticity'],
  ];

  for (const [word, clue] of goodPairs) {
    assert.deepEqual(parseGeneratedWord({ word, clue }), { word, clue });
  }
});

test('batch judge dedupes candidates and selects highest scoring passing clue', async () => {
  const judgeCalls = [];
  const fakeOpenAi = createFakeOpenAi(async (options) => {
    judgeCalls.push(options);

    return {
      output_parsed: {
        judgments: [
          {
            clue: 'burn',
            relatedness: 5,
            naturalness: 5,
            revealRisk: 2,
            genericness: 1,
            stretchiness: 1,
            verdict: 'pass',
            reason: 'Strong natural risk association.',
          },
          {
            clue: 'beach',
            relatedness: 5,
            naturalness: 5,
            revealRisk: 1,
            genericness: 1,
            stretchiness: 1,
            verdict: 'pass',
            reason: 'Natural setting association.',
          },
          {
            clue: 'protection',
            relatedness: 4,
            naturalness: 4,
            revealRisk: 3,
            genericness: 2,
            stretchiness: 1,
            verdict: 'pass',
            reason: 'Related but less conversational.',
          },
        ],
      },
    };
  });

  const selected = await selectBestGeneratedClue({
    openai: fakeOpenAi,
    model: 'test-model',
    candidateWord: {
      word: 'sunscreen',
      clues: ['burn', 'Burn', 'edge', 'beach', 'protection', 'sunscreen', 'sharp/edge', 'too many words here'],
    },
    categoryIds: ['objects'],
    languageName: 'English',
    categoryLabel: 'Objects',
  });

  assert.deepEqual(selected, {
    word: 'sunscreen',
    clue: 'beach',
  });
  assert.equal(judgeCalls.length, 1);
  assert.match(judgeCalls[0].input[1].content, /Candidate clues: \["burn","beach","protection"\]/);
});

test('batch judge validation fails closed for malformed, missing, or unmapped judgments', async () => {
  assert.throws(
    () =>
      parseClueQualityJudgments(
        {
          judgments: [
            {
              clue: 'burn',
              relatedness: 5,
              revealRisk: 2,
              genericness: 1,
              stretchiness: 1,
              verdict: 'pass',
              reason: 'Missing naturalness.',
            },
          ],
        },
        ['burn']
      ),
    /malformed/
  );

  assert.throws(
    () =>
      parseClueQualityJudgments(
        {
          judgments: [
            {
              clue: 'talisman',
              relatedness: 5,
              naturalness: 5,
              revealRisk: 1,
              genericness: 1,
              stretchiness: 1,
              verdict: 'pass',
              reason: 'Not submitted.',
            },
          ],
        },
        ['burn']
      ),
    /not submitted/
  );

  await assert.rejects(
    () =>
      selectBestGeneratedClue({
        openai: createFakeOpenAi(async () => ({
          output_parsed: {
            judgments: 'not an array',
          },
        })),
        model: 'test-model',
        candidateWord: {
          word: 'sunscreen',
          clues: ['burn', 'beach', 'UV', 'protection', 'shade', 'lotion', 'summer', 'outside'],
        },
        categoryIds: ['objects'],
        languageName: 'English',
        categoryLabel: 'Objects',
      }),
    /malformed/
  );
});

test('batch judge does not trust verdict alone and fails when all candidates fail', async () => {
  await assert.rejects(
    () =>
      selectBestGeneratedClue({
        openai: createFakeOpenAi(async () => ({
          output_parsed: {
            judgments: [
              {
                clue: 'burn',
                relatedness: 3,
                naturalness: 5,
                revealRisk: 1,
                genericness: 1,
                stretchiness: 1,
                verdict: 'pass',
                reason: 'Verdict says pass but relatedness is too low.',
              },
              {
                clue: 'beach',
                relatedness: 5,
                naturalness: 3,
                revealRisk: 1,
                genericness: 1,
                stretchiness: 1,
                verdict: 'pass',
                reason: 'Verdict says pass but naturalness is too low.',
              },
            ],
          },
        })),
        model: 'test-model',
        candidateWord: {
          word: 'sunscreen',
          clues: ['burn', 'beach', 'edge', 'sunscreen', 'sharp/edge', 'too many words here', 'object', 'thing'],
        },
        categoryIds: ['objects'],
        languageName: 'English',
        categoryLabel: 'Objects',
      }),
    /Generated clue failed quality judgment/
  );
});

test('retry limits and client timeout are bounded', () => {
  assert.equal(CANDIDATE_COUNT, 8);
  assert.equal(MAX_STATIC_PREPARE_ATTEMPTS, 3);
  assert.equal(MAX_DYNAMIC_GENERATION_ATTEMPTS, 3);
  assert.equal(AI_ROUND_REQUEST_TIMEOUT_MS, 12000);
  assert.deepEqual(getUniqueClueCandidates(['burn', 'Burn', ' beach ', 'beach']), ['burn', 'beach']);
});

test('static fallback preserves selected word and stored safe clue', () => {
  assert.deepEqual(
    getFallbackStaticWord({
      id: 'objects-medium-sunscreen',
      word: 'sunscreen',
      hint: 'beach',
      categoryId: 'objects',
      difficulty: 'medium',
    }),
    {
      word: 'sunscreen',
      clue: 'beach',
    }
  );
});

test('static fallback no longer returns unrelated hashed or generic clues', () => {
  const fallbacks = [
    getFallbackStaticWord({
      id: 'objects-medium-sunscreen',
      word: 'sunscreen',
      hint: 'beach',
      categoryId: 'objects',
      difficulty: 'medium',
    }),
    getFallbackStaticWord({
      id: 'animals-medium-baby-goat',
      word: 'baby goat',
      hint: 'talisman',
      categoryId: 'animals',
      difficulty: 'medium',
    }),
    getFallbackStaticWord({
      id: 'animals-hard-desert-kangaroo',
      word: 'desert kangaroo',
      hint: 'talisman',
      categoryId: 'animals',
      difficulty: 'hard',
    }),
    getFallbackStaticWord({
      id: 'objects-hard-unknown',
      word: 'unknown object',
      hint: 'edge',
      categoryId: 'objects',
      difficulty: 'hard',
    }),
  ];

  assert.deepEqual(fallbacks, [
    { word: 'sunscreen', clue: 'beach' },
    { word: 'baby goat', clue: 'bleat' },
    { word: 'desert kangaroo', clue: 'hopping' },
    null,
  ]);

  const forbiddenFinalFallbackClues = [
    'familiar',
    'common',
    'known',
    'thing',
    'object',
    'place',
    'item',
    'concept',
    'symbol',
    'edge',
    'talisman',
    'essence',
    'general',
    'related',
  ];

  for (const fallback of fallbacks) {
    if (!fallback) {
      continue;
    }

    assert.ok(!forbiddenFinalFallbackClues.includes(fallback.clue));
  }
});

test('static fallback refuses non-English translation mode instead of returning English', () => {
  assert.equal(
    getFallbackStaticWord(
      {
        id: 'objects-medium-sunscreen',
        word: 'sunscreen',
        hint: 'beach',
        categoryId: 'objects',
        difficulty: 'medium',
      },
      {
        mode: 'translate-static',
        targetLanguage: 'Spanish',
      }
    ),
    null
  );
});

test('server static fallback returns selected English static word without 502', async () => {
  setOpenAIClientFactoryForTesting();

  await withEnv({ OPENAI_API_KEY: undefined }, async () => {
    const response = await generateRoundHandler.fetch(
      new Request('http://localhost/api/generate-round', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(
          buildStaticWordRequest({
            source: {
              word: 'sunscreen',
              categoryId: 'objects',
              categoryLabel: 'Objects',
              difficulty: 'medium',
              storedClue: 'edge',
            },
          })
        ),
      })
    );
    const { status, body } = await parseJsonResponse(response);

    assert.equal(status, 200);
    assert.equal(body.word, 'sunscreen');
    assert.equal(body.clue, 'beach');
    assert.equal(body.categoryId, 'objects');
    assert.equal(body.difficulty, 'medium');
    assert.equal(body.fallback, true);
  });
});

test('client static fallback preserves selected word, category, and difficulty', async () => {
  const previousFetch = globalThis.fetch;
  const expectedEntry = selectStaticWordEntry({
    categoryId: 'objects',
    difficulty: 'medium',
    rng: () => 0,
  });

  globalThis.fetch = async () =>
    new Response(JSON.stringify({ error: 'Static word preparation failed' }), {
      status: 502,
      headers: {
        'Content-Type': 'application/json',
      },
    });

  try {
    const round = await createRound({
      players: buildPlayers(),
      categoryIds: ['objects'],
      difficulty: 'medium',
      languageId: 'english-client-static-fallback',
      languageName: 'English',
      rng: () => 0,
    });

    assert.equal(round.secretWord, expectedEntry.word);
    assert.equal(round.imposterHint, expectedEntry.hint);
    assert.deepEqual(round.config.categoryIds, ['objects']);
    assert.equal(round.config.difficulty, 'medium');
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test('client non-English static failure fails closed instead of showing English fallback', async () => {
  const previousFetch = globalThis.fetch;

  globalThis.fetch = async () =>
    new Response(JSON.stringify({ error: 'Static fallback translation failed' }), {
      status: 502,
      headers: {
        'Content-Type': 'application/json',
      },
    });

  try {
    await assert.rejects(
      () =>
        createRound({
          players: buildPlayers(),
          categoryIds: ['objects'],
          difficulty: 'medium',
          languageId: 'spanish-client-static-fallback-failure',
          languageName: 'Spanish',
          rng: () => 0,
        }),
      /Static word fallback is unavailable/
    );
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test('client uses translated server fallback without switching to dynamic content', async () => {
  const previousFetch = globalThis.fetch;

  globalThis.fetch = async () =>
    new Response(JSON.stringify({ word: 'protector solar', clue: 'playa' }), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
      },
    });

  try {
    const round = await createRound({
      players: buildPlayers(),
      categoryIds: ['objects'],
      difficulty: 'medium',
      languageId: 'spanish-client-static-fallback-success',
      languageName: 'Spanish',
      rng: () => 0,
    });

    assert.equal(round.secretWord, 'protector solar');
    assert.equal(round.imposterHint, 'playa');
    assert.deepEqual(round.config.categoryIds, ['objects']);
    assert.equal(round.config.difficulty, 'medium');
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test('server non-English fallback translates safe English fallback or fails closed', async () => {
  await withEnv({ OPENAI_API_KEY: 'test-key' }, async () => {
    let callCount = 0;

    setOpenAIClientFactoryForTesting(() =>
      createFakeOpenAi(async () => {
        callCount += 1;

        if (callCount <= MAX_STATIC_PREPARE_ATTEMPTS) {
          return { output_parsed: null };
        }

        return {
          output_parsed: {
            word: 'protector solar',
            clue: 'playa',
          },
        };
      })
    );

    try {
      const translatedFallback = await prepareStaticWordWithFallback(
        buildStaticWordRequest({
          languageId: 'spanish',
          languageName: 'Spanish',
          source: {
            word: 'sunscreen',
            categoryId: 'objects',
            categoryLabel: 'Objects',
            difficulty: 'medium',
            storedClue: 'edge',
          },
        })
      );

      assert.equal(translatedFallback.word, 'protector solar');
      assert.equal(translatedFallback.clue, 'playa');
      assert.equal(translatedFallback.categoryId, 'objects');
      assert.equal(translatedFallback.difficulty, 'medium');
      assert.equal(translatedFallback.fallback, true);
      assert.notEqual(translatedFallback.word, 'sunscreen');
      assert.notEqual(translatedFallback.clue, 'beach');
      assert.equal(callCount, MAX_STATIC_PREPARE_ATTEMPTS + 1);
    } finally {
      setOpenAIClientFactoryForTesting();
    }
  });

  await withEnv({ OPENAI_API_KEY: undefined }, async () => {
    const response = await generateRoundHandler.fetch(
      new Request('http://localhost/api/generate-round', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(
          buildStaticWordRequest({
            languageId: 'spanish',
            languageName: 'Spanish',
            source: {
              word: 'sunscreen',
              categoryId: 'objects',
              categoryLabel: 'Objects',
              difficulty: 'medium',
              storedClue: 'edge',
            },
          })
        ),
      })
    );
    const { status, body } = await parseJsonResponse(response);

    assert.equal(status, 502);
    assert.equal(body.error, 'Static fallback translation failed');
    assert.equal(body.word, undefined);
    assert.equal(body.clue, undefined);
  });
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
