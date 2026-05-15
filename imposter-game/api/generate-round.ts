import OpenAI from 'openai';
import { zodTextFormat } from 'openai/helpers/zod';
import { z } from 'zod';

const DEFAULT_MODEL = 'gpt-5.4-mini';
const GENERATION_ATTEMPTS = 8;
const difficultySchema = z.enum(['easy', 'medium', 'hard']);
const playedWordSchema = z.string().trim().min(1).max(42);

const roundWordRequestSchema = z.object({
  mode: z.literal('generate-round').optional(),
  categoryIds: z.array(z.string().trim().min(1).max(40)).min(1).max(3),
  difficulty: difficultySchema.default('easy'),
  languageId: z.string().trim().min(1).max(80),
  languageName: z.string().trim().min(1).max(80),
  playerCount: z.number().int().min(3).max(10),
  playedWords: z.array(playedWordSchema).default([]),
});

const translationRequestSchema = z.object({
  mode: z.literal('translate-word'),
  languageId: z.string().trim().min(1).max(80),
  languageName: z.string().trim().min(1).max(80),
  source: z.object({
    word: z.string().trim().min(1).max(42),
    clue: z.string().trim().min(1).max(42),
    categoryId: z.string().trim().min(1).max(40),
    categoryLabel: z.string().trim().min(1).max(80),
    difficulty: difficultySchema.optional(),
    sense: z.string().trim().min(1).max(160).optional(),
  }),
});

const requestSchema = z.union([translationRequestSchema, roundWordRequestSchema]);

const aiWordSchema = z.object({
  word: z.string(),
  clue: z.string(),
});

const normalizeForCloseness = (value: string) =>
  value
    .normalize('NFD')
    .replace(/\p{M}+/gu, '')
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .replace(/\s+/g, ' ');

const descriptiveClueTokens = new Set([
  'black',
  'blue',
  'brown',
  'cold',
  'dark',
  'fast',
  'fluffy',
  'furry',
  'giant',
  'gold',
  'golden',
  'gray',
  'green',
  'grey',
  'hot',
  'large',
  'light',
  'little',
  'long',
  'orange',
  'pink',
  'purple',
  'red',
  'round',
  'salty',
  'short',
  'silver',
  'slow',
  'small',
  'sour',
  'spicy',
  'spotted',
  'striped',
  'sweet',
  'tiny',
  'white',
  'yellow',
]);

const categoryClueTokens = new Set([
  'animal',
  'athlete',
  'bird',
  'building',
  'celebrity',
  'city',
  'country',
  'device',
  'drink',
  'film',
  'food',
  'game',
  'instrument',
  'job',
  'meal',
  'movie',
  'object',
  'person',
  'place',
  'plant',
  'school',
  'song',
  'sport',
  'story',
  'structure',
  'tool',
  'vehicle',
  'work',
]);

const closeClueTokens = new Set([
  ...descriptiveClueTokens,
  ...categoryClueTokens,
  'breakfast',
  'classroom',
  'creature',
  'dessert',
  'dinner',
  'forest',
  'habitat',
  'jungle',
  'kitchen',
  'land',
  'lunch',
  'mammal',
  'music',
  'ocean',
  'office',
  'pet',
  'restaurant',
  'safari',
  'sea',
  'space',
  'stage',
  'wild',
  'wildlife',
  'zoo',
]);

const hasExactlyOneWordClue = (clue: string) => {
  const clueTokens = normalizeForCloseness(clue).split(' ').filter(Boolean);

  return clueTokens.length === 1 && !/[-\u2010-\u2015/]/u.test(clue);
};

const hasOverSpecificClue = (clue: string) => {
  const clueTokens = normalizeForCloseness(clue).split(' ').filter(Boolean);

  if (!clueTokens.length) {
    return true;
  }

  if (!hasExactlyOneWordClue(clue)) {
    return true;
  }

  if (clueTokens.some((token) => closeClueTokens.has(token))) {
    return true;
  }

  return false;
};

const hasLexicallyCloseClue = (word: string, clue: string) => {
  const normalizedWord = normalizeForCloseness(word);
  const normalizedClue = normalizeForCloseness(clue);

  if (!normalizedWord || !normalizedClue) {
    return true;
  }

  if (normalizedWord === normalizedClue) {
    return true;
  }

  const wordTokens = normalizedWord.split(' ');
  const clueTokens = normalizedClue.split(' ');
  const sharesMeaningfulToken = clueTokens.some(
    (clueToken) => clueToken.length >= 4 && wordTokens.includes(clueToken)
  );

  if (sharesMeaningfulToken) {
    return true;
  }

  return (
    Math.min(normalizedWord.length, normalizedClue.length) >= 4 &&
    (normalizedWord.includes(normalizedClue) || normalizedClue.includes(normalizedWord))
  );
};

export const hasPlayableCelebrityAnswer = (word: string) =>
  normalizeForCloseness(word).split(' ').filter(Boolean).length >= 2;

const isCelebrityRequest = (categoryIds: readonly string[]) => categoryIds.includes('celebrities');
const isMovieRequest = (categoryIds: readonly string[]) => categoryIds.includes('movies');

const responseSchema = z
  .object({
    word: z.string().trim().min(1).max(42),
    clue: z.string().trim().min(1).max(42),
  })
  .refine((value) => hasExactlyOneWordClue(value.clue), {
    message: 'The clue must be exactly one word',
    path: ['clue'],
  })
  .refine((value) => !hasOverSpecificClue(value.clue), {
    message: 'The clue must be indirect, not a category or descriptor',
    path: ['clue'],
  })
  .refine(
    (value) => !hasLexicallyCloseClue(value.word, value.clue),
    'The clue must be broader than and lexically separate from the word'
  );

type RoundWordRequest = z.infer<typeof roundWordRequestSchema>;
type TranslationWordRequest = z.infer<typeof translationRequestSchema>;
type RoundWordResponse = z.infer<typeof responseSchema>;
export type PopularityScope = 'international' | 'local';
let serverPlayedWordsByContext = new Map<string, string[]>();

const corsHeaders = {
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Origin': '*',
  'Content-Type': 'application/json',
};

const categoryLabel = (categoryId: string) =>
  categoryId
    .split('-')
    .map((part) => part.charAt(0).toLocaleUpperCase() + part.slice(1))
    .join(' ');

const normalizeGeneratedText = (value: string) => value.trim().replace(/\s+/g, ' ');

const jsonResponse = (body: unknown, status = 200) =>
  Response.json(body, {
    status,
    headers: corsHeaders,
  });

const isAlreadyPlayedWord = (word: string, playedWords: readonly string[]) => {
  const wordKey = normalizeForCloseness(word);
  const playedWordKeys = new Set(playedWords.map(normalizeForCloseness).filter(Boolean));

  return playedWordKeys.has(wordKey);
};

const mergeUniquePlayedWords = (words: readonly string[]) => {
  const seenWordKeys = new Set<string>();

  return words.filter((word) => {
    const wordKey = normalizeForCloseness(word);

    if (!wordKey || seenWordKeys.has(wordKey)) {
      return false;
    }

    seenWordKeys.add(wordKey);
    return true;
  });
};

const getPlayedWordContextKey = ({
  categoryIds,
  languageId,
  languageName,
}: Pick<RoundWordRequest, 'categoryIds' | 'languageId' | 'languageName'>) => {
  const languageKey = normalizeForCloseness(languageId) || normalizeForCloseness(languageName) || 'unknown-language';
  const categoryKey = categoryIds.map(normalizeForCloseness).filter(Boolean).sort().join('|') || 'unknown-category';

  return `${languageKey}:${categoryKey}`;
};

const getServerPlayedWords = (input: RoundWordRequest) =>
  serverPlayedWordsByContext.get(getPlayedWordContextKey(input)) ?? [];

const getAlreadyPlayedWords = (input: RoundWordRequest, extraWords: readonly string[] = []) =>
  mergeUniquePlayedWords([
    ...extraWords,
    ...input.playedWords,
    ...getServerPlayedWords(input),
  ]);

const rememberGeneratedWord = (input: RoundWordRequest, word: string) => {
  const contextKey = getPlayedWordContextKey(input);
  const playedWords = getServerPlayedWords(input);

  serverPlayedWordsByContext.set(
    contextKey,
    mergeUniquePlayedWords([word, ...playedWords.filter((playedWord) => !isAlreadyPlayedWord(word, [playedWord]))])
  );
};

const createVarietyKey = (attempt: number) =>
  `${Date.now().toString(36)}-${attempt}-${Math.random().toString(36).slice(2, 10)}`;

const hashVarietyKey = (varietyKey: string) => {
  let hash = 2166136261;

  for (const character of varietyKey) {
    hash ^= character.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 16777619);
  }

  return hash >>> 0;
};

export const selectPopularityScope = (varietyKey: string): PopularityScope =>
  hashVarietyKey(varietyKey) % 2 === 0 ? 'international' : 'local';

const formatPopularityScope = (popularityScope: PopularityScope) =>
  popularityScope === 'international' ? 'International' : 'Local to the selected language/culture';

const difficultyInstructions = {
  easy: 'Difficulty target: easy. Choose a highly familiar, everyday answer most casual players recognize immediately.',
  medium: 'Difficulty target: medium. Choose a familiar but less obvious answer that still works for casual players.',
  hard: 'Difficulty target: hard. Choose a more specific or less common answer, but avoid obscure trivia.',
} as const;

export const buildPrompt = (
  { categoryIds, difficulty, languageName, playerCount }: RoundWordRequest,
  varietyKey: string,
  alreadyPlayedWords: readonly string[],
  popularityScope: PopularityScope = selectPopularityScope(varietyKey)
) => {
  const categories = categoryIds.map(categoryLabel).join(', ');
  const playedWordList = alreadyPlayedWords.length ? alreadyPlayedWords.join(', ') : 'None';
  const hasCelebrityCategory = isCelebrityRequest(categoryIds);
  const hasMovieCategory = isMovieRequest(categoryIds);

  return [
    `Language: ${languageName}`,
    `Categories: ${categories}`,
    `Difficulty: ${difficulty}`,
    `Player count: ${playerCount}`,
    `Popularity scope: ${formatPopularityScope(popularityScope)}`,
    `Variety key: ${varietyKey}`,
    `Already played secret words to avoid: ${playedWordList}`,
    '',
    'Generate one secret word and one imposter clue for this round.',
    'Choose a fair, broadly playable answer that casual players can discuss.',
    difficultyInstructions[difficulty],
    '',
    'Popularity rules:',
    '- If Popularity scope is International, choose something extremely famous worldwide. Most casual players should recognize it, even if they are not experts.',
    '- If Popularity scope is Local, choose something extremely famous among speakers of the requested language or people from the main culture/country associated with that language.',
    '- Do not choose obscure, niche, old, regional-only, or expert-level answers.',
    '- The answer should feel obvious and playable for a casual party game.',
    '',
    'Repeat-prevention rules:',
    '- Never choose any word from the already played secret words list.',
    '- Choose a different valid word each request.',
    '- Treat minor spelling, punctuation, spacing, casing, diacritic, or transliteration differences as the same word when avoiding repeats.',
    '',
    'Category rules:',
    hasMovieCategory
      ? '- For Movies, return a well-known movie title in the requested language when there is a natural/common localized title. Otherwise use the title most commonly recognized by speakers of that language.'
      : null,
    hasCelebrityCategory
      ? '- For Celebrities, return only widely recognizable public figures.'
      : null,
    hasCelebrityCategory
      ? '- For Celebrities, the secret word must be a complete public name with at least two words: first and last name, or a complete multi-word stage/public name.'
      : null,
    hasCelebrityCategory
      ? '- For Celebrities, never return a first name, nickname, or partial name by itself.'
      : null,
    '- These rules apply to every language. Do not add special exceptions for any specific language.',
    '',
    'Clue rules:',
    '- The imposter clue must be exactly one word.',
    '- The clue should be simple, common, and easy for an imposter to use in conversation.',
    '- The clue should be indirectly related in vibe, mood, situation, or broad context, but not too obscure.',
    '- Avoid clues that are so distant, poetic, or abstract that the imposter cannot participate.',
    '- Do not use the secret word category, class, synonym, usual location, habitat, obvious trait, or direct association as the clue.',
    '- Do not use synonyms, translations, rhymes, famous associations, ingredients, materials, colors, shapes, sizes, parts, actions, usual locations, habitats, or any text contained in the answer.',
    '- The clue must have no spaces, hyphens, slashes, punctuation, or short phrases.',
    '',
    'Output rules:',
    '- Return short answers only.',
    '- Return one secret word or short phrase.',
    '- Return exactly one clue word.',
    '- Both fields must be in the requested language, using the natural script for that language.',
    '- Treat the variety key as a random seed; do not output it.',
    '- Do not output the popularity scope.',
    '- Do not copy wording from these instructions as the answer.',
  ]
    .filter((line): line is string => line !== null)
    .join('\n');
};

const buildTranslationPrompt = (input: TranslationWordRequest) => {
  const { languageName, source } = input;
  const isAnimalTranslation = source.categoryId === 'animals';

  return [
    `Target language: ${languageName}`,
    `English source word: ${source.word}`,
    `English source category: ${source.categoryLabel}`,
    source.difficulty ? `English source difficulty: ${source.difficulty}` : null,
    source.sense ? `English source sense: ${source.sense}` : null,
    `English imposter clue: ${source.clue}`,
    '',
    'Translate the source word naturally for native speakers in the target language.',
    'Do not replace the source word with a different example.',
    'Use the common everyday word a native speaker would naturally say in a casual party game.',
    'Translate meaning, not spelling, and use the natural script for the target language.',
    'Prefer common native/common-use words over English spellings, loanword-looking forms, scientific names, or raw transliterations.',
    'Never transliterate the English spelling unless that transliteration is truly the normal everyday word in the target language.',
    'If the exact species/object term is uncommon or sounds borrowed, use the closest common everyday term that native speakers recognize, even if it is slightly broader.',
    isAnimalTranslation
      ? 'For animals, prefer natural everyday animal names over scientific or taxonomy-level precision.'
      : null,
    'Return one translated secret word or short phrase, and one translated imposter clue.',
    'The imposter clue must be exactly one word. No spaces, hyphens, slashes, punctuation, or short phrases.',
    'The clue must stay indirect, simple, common, and playable like the English source clue.',
    'If the literal clue translation would be multiple words or too obvious, choose a natural one-word equivalent that keeps the same indirect relationship.',
  ]
    .filter((line): line is string => line !== null)
    .join('\n');
};

export const parseGeneratedWord = (
  value: RoundWordResponse,
  alreadyPlayedWords: readonly string[] = [],
  categoryIds: readonly string[] = []
): RoundWordResponse => {
  const parsedWord = responseSchema.parse({
    word: normalizeGeneratedText(value.word),
    clue: normalizeGeneratedText(value.clue),
  });

  if (isCelebrityRequest(categoryIds) && !hasPlayableCelebrityAnswer(parsedWord.word)) {
    throw new Error('OpenAI returned an incomplete celebrity name');
  }

  if (isAlreadyPlayedWord(parsedWord.word, alreadyPlayedWords)) {
    throw new Error('OpenAI returned an already played round word');
  }

  return parsedWord;
};

async function generateRoundWord(input: RoundWordRequest): Promise<RoundWordResponse> {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error('OpenAI API key is not configured');
  }

  const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
  });

  let lastError: unknown;

  for (let attempt = 0; attempt < GENERATION_ATTEMPTS; attempt += 1) {
    try {
      const varietyKey = createVarietyKey(attempt);
      const popularityScope = selectPopularityScope(varietyKey);
      const alreadyPlayedWords = getAlreadyPlayedWords(input);
      const response = await openai.responses.parse({
        model: process.env.OPENAI_MODEL || DEFAULT_MODEL,
        reasoning: {
          effort: 'none',
        },
        temperature: 1,
        max_output_tokens: 160,
        input: [
          {
            role: 'system',
            content: [
              'You generate safe, family-friendly words for a pass-and-play Imposter party game.',
              'Regular players see the secret word. The imposter sees only the clue.',
              'The imposter clue must be exactly one simple, common word and indirectly related to the secret word.',
              'Use broad vibe, mood, situation, or context clues that are playable in conversation.',
              'Never use categories, classes, defining attributes, ingredients, parts, usual locations, habitats, actions, famous associations, or adjacent examples.',
              'Never make the clue descriptive, category-level, or multi-word, such as "large land animal", "black-and-white", "animal", or "food".',
              'If a typical player could guess the word immediately from the clue, make the clue less direct.',
              'If an imposter could not use the clue in conversation, make the clue simpler and more common.',
              'Avoid adult content, slurs, gore, politics, religion, tragedies, and obscure niche references.',
              'Avoid multi-sentence output, punctuation-heavy answers, translations, romanization, and explanations.',
              'Use proper nouns only when the chosen category naturally asks for them.',
            ].join(' '),
          },
          {
            role: 'user',
            content: buildPrompt(input, varietyKey, alreadyPlayedWords, popularityScope),
          },
        ],
        text: {
          format: zodTextFormat(aiWordSchema, 'imposter_round_word'),
        },
      });

      if (!response.output_parsed) {
        throw new Error('OpenAI returned no parsed round word');
      }

      const generatedWord = parseGeneratedWord(
        response.output_parsed,
        getAlreadyPlayedWords(input),
        input.categoryIds
      );

      rememberGeneratedWord(input, generatedWord.word);

      return generatedWord;
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError instanceof Error ? lastError : new Error('OpenAI round generation failed');
}

async function translateStaticWord(input: TranslationWordRequest): Promise<RoundWordResponse> {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error('OpenAI API key is not configured');
  }

  const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
  });

  let lastError: unknown;

  for (let attempt = 0; attempt < GENERATION_ATTEMPTS; attempt += 1) {
    try {
      const response = await openai.responses.parse({
        model: process.env.OPENAI_MODEL || DEFAULT_MODEL,
        reasoning: {
          effort: 'none',
        },
        temperature: 0.2,
        max_output_tokens: 160,
        input: [
          {
            role: 'system',
            content: [
              'You translate words for a pass-and-play Imposter party game.',
              'Regular players see the secret word. The imposter sees only the clue.',
              'The output must be in the requested target language and natural script.',
              'The imposter clue must be exactly one simple, common word and stay indirectly related to the secret word.',
              'Never return explanations, romanization, punctuation-heavy answers, or multi-sentence output.',
            ].join(' '),
          },
          {
            role: 'user',
            content: buildTranslationPrompt(input),
          },
        ],
        text: {
          format: zodTextFormat(aiWordSchema, 'imposter_translated_word'),
        },
      });

      if (!response.output_parsed) {
        throw new Error('OpenAI returned no parsed translation');
      }

      return parseGeneratedWord(response.output_parsed);
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError instanceof Error ? lastError : new Error('OpenAI translation failed');
}

export default {
  async fetch(request: Request) {
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: corsHeaders,
      });
    }

    if (request.method !== 'POST') {
      return jsonResponse({ error: 'Method not allowed' }, 405);
    }

    let payload: unknown;

    try {
      payload = await request.json();
    } catch {
      return jsonResponse({ error: 'Invalid JSON body' }, 400);
    }

    const parsedRequest = requestSchema.safeParse(payload);

    if (!parsedRequest.success) {
      return jsonResponse({ error: 'Invalid round generation request' }, 400);
    }

    try {
      if (parsedRequest.data.mode === 'translate-word') {
        return jsonResponse(await translateStaticWord(parsedRequest.data));
      }

      return jsonResponse(await generateRoundWord(parsedRequest.data));
    } catch {
      return jsonResponse({ error: 'Round generation failed' }, 502);
    }
  },
};
