import OpenAI from 'openai';
import { zodTextFormat } from 'openai/helpers/zod';
import { z } from 'zod';

const DEFAULT_MODEL = 'gpt-5.4-mini';
const CLIENT_RECENT_WORD_LIMIT = 40;
const SERVER_RECENT_WORD_LIMIT = 80;
const GENERATION_ATTEMPTS = 8;

const roundWordRequestSchema = z.object({
  mode: z.literal('generate-round').optional(),
  categoryIds: z.array(z.string().trim().min(1).max(40)).min(1).max(3),
  languageId: z.string().trim().min(1).max(80),
  languageName: z.string().trim().min(1).max(80),
  playerCount: z.number().int().min(3).max(10),
  recentWords: z.array(z.string().trim().min(1).max(42)).max(CLIENT_RECENT_WORD_LIMIT).default([]),
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
    message: 'The clue must be distant, not a category or descriptor',
    path: ['clue'],
  })
  .refine(
    (value) => !hasLexicallyCloseClue(value.word, value.clue),
    'The clue must be broader than and lexically separate from the word'
  );

type RoundWordRequest = z.infer<typeof roundWordRequestSchema>;
type TranslationWordRequest = z.infer<typeof translationRequestSchema>;
type RoundWordResponse = z.infer<typeof responseSchema>;
let serverRecentWords: string[] = [];

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

const isRecentlyUsedWord = (word: string, recentWords: string[]) => {
  const wordKey = normalizeForCloseness(word);
  const recentWordKeys = new Set(recentWords.map(normalizeForCloseness).filter(Boolean));

  return recentWordKeys.has(wordKey);
};

const getBlockedRecentWords = (clientRecentWords: string[]) => {
  const seenWordKeys = new Set<string>();

  return [...clientRecentWords, ...serverRecentWords].filter((word) => {
    const wordKey = normalizeForCloseness(word);

    if (!wordKey || seenWordKeys.has(wordKey)) {
      return false;
    }

    seenWordKeys.add(wordKey);
    return true;
  });
};

const rememberGeneratedWord = (word: string) => {
  serverRecentWords = [
    word,
    ...serverRecentWords.filter((recentWord) => !isRecentlyUsedWord(word, [recentWord])),
  ].slice(0, SERVER_RECENT_WORD_LIMIT);
};

const createVarietyKey = (attempt: number) =>
  `${Date.now().toString(36)}-${attempt}-${Math.random().toString(36).slice(2, 10)}`;

const isUzbekLanguageRequest = ({ languageId, languageName }: Pick<TranslationWordRequest, 'languageId' | 'languageName'>) =>
  languageId === 'uzbek' || languageName.toLocaleLowerCase().includes('uzbek');

const buildPrompt = (
  { categoryIds, languageName, playerCount }: RoundWordRequest,
  varietyKey: string,
  blockedRecentWords: string[]
) => {
  const categories = categoryIds.map(categoryLabel).join(', ');
  const recentWordList = blockedRecentWords.length ? blockedRecentWords.join(', ') : 'None';
  const hasCelebrityCategory = isCelebrityRequest(categoryIds);
  const isUzbekLanguage = languageName.toLocaleLowerCase().includes('uzbek');

  return [
    `Language: ${languageName}`,
    `Categories: ${categories}`,
    `Player count: ${playerCount}`,
    `Variety key: ${varietyKey}`,
    `Recent secret words to avoid: ${recentWordList}`,
    '',
    'Generate one secret word and one imposter clue for this round.',
    'Treat the variety key as a random seed; do not output it.',
    'Never choose any word from the recent secret words list. Choose a different valid word each request.',
    'Do not reuse example words from this prompt unless there is no reasonable alternative.',
    'Both fields must be in the requested language, using the natural script for that language.',
    'The imposter clue must be exactly one word. No spaces, hyphens, slashes, punctuation, or short phrases.',
    'The clue must be far from the answer: use a distant vibe, mood, situation, or abstract context.',
    hasCelebrityCategory
      ? 'For Celebrities, return only widely recognizable public figures in the selected language/culture.'
      : null,
    hasCelebrityCategory
      ? 'For Celebrities, the secret word must be a complete public name with at least two words: first and last name, or a complete multi-word stage/public name.'
      : null,
    hasCelebrityCategory
      ? 'For Celebrities, never return a first name, nickname, or partial name by itself, such as Dilbar, Sherzod, Messi, Beyonce, or Ronaldo.'
      : null,
    hasCelebrityCategory && isUzbekLanguage
      ? 'For Uzbek Celebrities, do not output ordinary Uzbek first names by themselves. Use full recognizable public names such as Yulduz Usmonova, Ozodbek Nazarbekov, Sevara Nazarkhan, Oksana Chusovitina, or another similarly recognizable full name.'
      : null,
    'Do not use the secret word category or class. For Elephant, never use Animal, Mammal, Creature, Large, Land, Safari, Zoo, or Jungle.',
    'Do not use synonyms, translations, rhymes, famous associations, ingredients, materials, colors, shapes, sizes, parts, actions, usual locations, habitats, or any text contained in the answer.',
    'Bad clues: Elephant -> Large land animal, Elephant -> Animal, Panda -> Black-and-white, Panda -> Bamboo, Pizza -> Food, Doctor -> Hospital, Lionel Messi -> Football.',
    'Good clues: Elephant -> Nature, Panda -> Nature, Pizza -> Party, Doctor -> Routine, Umbrella -> Prepared, Lionel Messi -> Legend.',
    'Return short answers only: one secret word or short phrase, and exactly one distant clue word.',
  ]
    .filter((line): line is string => line !== null)
    .join('\n');
};

const buildTranslationPrompt = (input: TranslationWordRequest) => {
  const { languageName, source } = input;
  const isAnimalTranslation = source.categoryId === 'animals';
  const isUzbekTranslation = isUzbekLanguageRequest(input);

  return [
    `Target language: ${languageName}`,
    `English source word: ${source.word}`,
    `English source category: ${source.categoryLabel}`,
    source.sense ? `English source sense: ${source.sense}` : null,
    `English hard imposter clue: ${source.clue}`,
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
    isAnimalTranslation && isUzbekTranslation
      ? 'For Uzbek animal translations, use natural Uzbek words. Example: Gecko should be Kaltakesak, not Geko or Gekkon.'
      : null,
    'Return one translated secret word or short phrase, and one translated imposter clue.',
    'The imposter clue must be exactly one word. No spaces, hyphens, slashes, punctuation, or short phrases.',
    'The clue must stay hard and indirect, like the English source clue.',
    'If the literal clue translation would be multiple words or too obvious, choose a natural one-word equivalent that keeps the same distant relationship.',
  ]
    .filter((line): line is string => line !== null)
    .join('\n');
};

const parseGeneratedWord = (
  value: RoundWordResponse,
  blockedRecentWords: string[] = [],
  categoryIds: readonly string[] = []
): RoundWordResponse => {
  const parsedWord = responseSchema.parse({
    word: normalizeGeneratedText(value.word),
    clue: normalizeGeneratedText(value.clue),
  });

  if (isCelebrityRequest(categoryIds) && !hasPlayableCelebrityAnswer(parsedWord.word)) {
    throw new Error('OpenAI returned an incomplete celebrity name');
  }

  if (isRecentlyUsedWord(parsedWord.word, blockedRecentWords)) {
    throw new Error('OpenAI returned a recently used round word');
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
      const blockedRecentWords = getBlockedRecentWords(input.recentWords);
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
              'The imposter clue must be exactly one word and far from the secret word.',
              'Use distant vibe words, moods, situations, or abstract context only.',
              'Never use categories, classes, defining attributes, ingredients, parts, usual locations, habitats, actions, famous associations, or adjacent examples.',
              'Never make the clue descriptive, category-level, or multi-word, such as "large land animal", "black-and-white", "animal", or "food".',
              'If a typical player could guess the word from the clue, make the clue more distant.',
              'Avoid adult content, slurs, gore, politics, religion, tragedies, and obscure niche references.',
              'Avoid multi-sentence output, punctuation-heavy answers, translations, romanization, and explanations.',
              'Use proper nouns only when the chosen category naturally asks for them.',
            ].join(' '),
          },
          {
            role: 'user',
            content: buildPrompt(input, createVarietyKey(attempt), blockedRecentWords),
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
        getBlockedRecentWords(input.recentWords),
        input.categoryIds
      );

      rememberGeneratedWord(generatedWord.word);

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
              'The imposter clue must be exactly one word and stay far from the secret word.',
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
