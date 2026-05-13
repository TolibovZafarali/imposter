import OpenAI from 'openai';
import { zodTextFormat } from 'openai/helpers/zod';
import { z } from 'zod';

const DEFAULT_MODEL = 'gpt-5.4-mini';

const requestSchema = z.object({
  categoryIds: z.array(z.string().trim().min(1).max(40)).min(1).max(3),
  languageId: z.string().trim().min(1).max(80),
  languageName: z.string().trim().min(1).max(80),
  playerCount: z.number().int().min(3).max(10),
});

const aiWordSchema = z.object({
  word: z.string(),
  clue: z.string(),
});

const responseSchema = z
  .object({
    word: z.string().trim().min(1).max(42),
    clue: z.string().trim().min(1).max(42),
  })
  .refine(
    (value) => value.word.toLocaleLowerCase() !== value.clue.toLocaleLowerCase(),
    'The clue must be different from the word'
  );

type RoundWordRequest = z.infer<typeof requestSchema>;
type RoundWordResponse = z.infer<typeof responseSchema>;

const fallbackWords: Record<string, RoundWordResponse[]> = {
  food: [
    { word: 'Pizza', clue: 'Food' },
    { word: 'Sushi', clue: 'Meal' },
  ],
  animals: [
    { word: 'Elephant', clue: 'Animal' },
    { word: 'Penguin', clue: 'Bird' },
  ],
  jobs: [
    { word: 'Doctor', clue: 'Work' },
    { word: 'Pilot', clue: 'Travel' },
  ],
  countries: [
    { word: 'Japan', clue: 'Place' },
    { word: 'Brazil', clue: 'Country' },
  ],
  objects: [
    { word: 'Umbrella', clue: 'Object' },
    { word: 'Camera', clue: 'Device' },
  ],
  sports: [
    { word: 'Soccer', clue: 'Sport' },
    { word: 'Tennis', clue: 'Game' },
  ],
  school: [
    { word: 'Notebook', clue: 'School' },
    { word: 'Teacher', clue: 'Class' },
  ],
  movies: [
    { word: 'Titanic', clue: 'Movie' },
    { word: 'Avatar', clue: 'Film' },
  ],
  celebrities: [
    { word: 'Beyonce', clue: 'Famous' },
    { word: 'Messi', clue: 'Athlete' },
  ],
  fantasy: [
    { word: 'Dragon', clue: 'Fantasy' },
    { word: 'Wizard', clue: 'Magic' },
  ],
};

const defaultFallbackWords: RoundWordResponse[] = [
  { word: 'Moon', clue: 'Night' },
  { word: 'Bridge', clue: 'Crossing' },
];

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

const getFallbackWord = (categoryIds: string[]) => {
  const selectedCategoryId = categoryIds[0];
  const words = fallbackWords[selectedCategoryId] ?? defaultFallbackWords;

  return words[Math.floor(Math.random() * words.length)];
};

const buildPrompt = ({ categoryIds, languageName, playerCount }: RoundWordRequest) => {
  const categories = categoryIds.map(categoryLabel).join(', ');

  return [
    `Language: ${languageName}`,
    `Categories: ${categories}`,
    `Player count: ${playerCount}`,
    '',
    'Generate one secret word and one broad imposter clue for this round.',
    'Both fields must be in the requested language, using the natural script for that language.',
  ].join('\n');
};

const parseGeneratedWord = (value: RoundWordResponse): RoundWordResponse =>
  responseSchema.parse({
    word: normalizeGeneratedText(value.word),
    clue: normalizeGeneratedText(value.clue),
  });

async function generateRoundWord(input: RoundWordRequest): Promise<RoundWordResponse> {
  if (!process.env.OPENAI_API_KEY) {
    return getFallbackWord(input.categoryIds);
  }

  const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
  });

  const response = await openai.responses.parse({
    model: process.env.OPENAI_MODEL || DEFAULT_MODEL,
    reasoning: {
      effort: 'none',
    },
    max_output_tokens: 160,
    input: [
      {
        role: 'system',
        content: [
          'You generate safe, family-friendly words for a pass-and-play Imposter party game.',
          'Regular players see the secret word. The imposter sees only the clue.',
          'The clue must be broad and related, but it must not reveal the exact answer.',
          'Avoid adult content, slurs, gore, politics, religion, tragedies, and obscure niche references.',
          'Avoid multi-sentence output, punctuation-heavy answers, translations, romanization, and explanations.',
          'Use proper nouns only when the chosen category naturally asks for them.',
        ].join(' '),
      },
      {
        role: 'user',
        content: buildPrompt(input),
      },
    ],
    text: {
      format: zodTextFormat(aiWordSchema, 'imposter_round_word'),
    },
  });

  if (!response.output_parsed) {
    throw new Error('OpenAI returned no parsed round word');
  }

  return parseGeneratedWord(response.output_parsed);
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
      return jsonResponse(await generateRoundWord(parsedRequest.data));
    } catch {
      return jsonResponse(getFallbackWord(parsedRequest.data.categoryIds));
    }
  },
};
