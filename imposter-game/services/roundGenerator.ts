import { buildRound } from '@/game/round';
import type { ImposterCount, Player, Round, RoundTimerSetting } from '@/game/types';
import {
  CATEGORY_LABELS,
  hasPlayableCelebrityAnswer,
  resolveRoundWordPlan,
  selectStaticWordEntry,
  type EnglishWordEntry,
  type DynamicCategoryId,
  type RoundWordPlan,
  type StaticCategoryId,
  type WordDifficulty,
} from '@/data/wordBank';

type GeneratedWord = {
  word: string;
  clue: string;
};

type PlayedWordContext = {
  categoryIds: readonly string[];
  languageId: string;
  languageName: string;
};

export type RoundGeneratorInput = {
  players: Player[];
  categoryIds: string[];
  difficulty: WordDifficulty;
  languageId: string;
  languageName: string;
  imposterCount?: ImposterCount;
  isImposterHintEnabled?: boolean;
  roundTimerMinutes?: RoundTimerSetting;
  rng?: () => number;
};

const AI_CLIENT_GENERATION_ATTEMPTS = 4;
const AI_ROUND_REQUEST_TIMEOUT_MS = 6000;
const DEFAULT_AI_ROUND_API_URL = 'http://localhost:3000/api/generate-round';
const EMERGENCY_STATIC_CATEGORY_ID: StaticCategoryId = 'objects';
let playedRoundWordsByContext = new Map<string, string[]>();
let playedRoundEntryIdsByContext = new Map<string, string[]>();

const emergencyDynamicWords: Record<DynamicCategoryId, readonly GeneratedWord[]> = {
  movies: [
    { word: 'Titanic', clue: 'iceberg' },
    { word: 'Avatar', clue: 'blue' },
    { word: 'The Matrix', clue: 'simulation' },
    { word: 'Frozen', clue: 'ice' },
    { word: 'Jaws', clue: 'shark' },
    { word: 'Barbie', clue: 'pink' },
    { word: 'Interstellar', clue: 'gravity' },
    { word: 'Inception', clue: 'dream' },
    { word: 'Shrek', clue: 'swamp' },
    { word: 'Spider-Man', clue: 'web' },
  ],
  celebrities: [
    { word: 'Leo Tolstoy', clue: 'beard' },
    { word: 'Taylor Swift', clue: 'eras' },
    { word: 'Cristiano Ronaldo', clue: 'siu' },
    { word: 'Lionel Messi', clue: 'dribble' },
    { word: 'Albert Einstein', clue: 'relativity' },
    { word: 'Michael Jackson', clue: 'moonwalk' },
    { word: 'Beyonce Knowles', clue: 'queen' },
    { word: 'Elon Musk', clue: 'rocket' },
    { word: 'Dwayne Johnson', clue: 'rock' },
    { word: 'Leonardo DiCaprio', clue: 'oscar' },
  ],
};

const emergencyAssociationClues = new Map([
  ['globe', 'geography'],
  ['flag', 'wind'],
  ['dough', 'elasticity'],
  ['plate', 'moon'],
  ['nutella', 'spread'],
  ['knife', 'sharp'],
  ['chair', 'posture'],
  ['table', 'surface'],
  ['lamp', 'glow'],
  ['mirror', 'reflection'],
  ['clock', 'ticking'],
  ['phone', 'signal'],
  ['camera', 'lens'],
  ['book', 'pages'],
  ['key', 'security'],
  ['lock', 'security'],
  ['fan', 'breeze'],
  ['pillow', 'softness'],
  ['blanket', 'warmth'],
  ['window', 'view'],
  ['battery', 'charge'],
  ['magnet', 'attraction'],
  ['spoon', 'scoop'],
  ['fork', 'prongs'],
  ['cup', 'sip'],
  ['bottle', 'cap'],
  ['pizza', 'slice'],
  ['apple', 'crunch'],
  ['banana', 'peel'],
  ['coffee', 'caffeine'],
  ['tea', 'steam'],
  ['ice cream', 'melting'],
  ['soccer', 'goal'],
  ['basketball', 'dribble'],
  ['tennis', 'rally'],
  ['chess', 'strategy'],
  ['swimming', 'splash'],
  ['library', 'quiet'],
  ['mountain', 'altitude'],
  ['island', 'shore'],
  ['airport', 'runway'],
  ['museum', 'exhibit'],
  ['dog', 'loyalty'],
  ['cat', 'whiskers'],
  ['bird', 'wings'],
  ['shark', 'fins'],
  ['elephant', 'trunk'],
]);

const emergencyCategoryCluePools = {
  activities: ['motion', 'practice', 'rhythm', 'focus', 'skill', 'routine'],
  food: ['flavor', 'texture', 'craving', 'bite', 'steam', 'crunch'],
  animals: ['instinct', 'tracks', 'claws', 'wings', 'camouflage', 'speed'],
  objects: ['surface', 'edge', 'weight', 'handle', 'utility', 'reflection'],
  places: ['map', 'landmark', 'route', 'horizon', 'altitude', 'border'],
  sports: ['score', 'balance', 'reflexes', 'strategy', 'rivalry', 'sprint'],
} as const satisfies Record<StaticCategoryId, readonly string[]>;

const normalizeWordKey = (value: string) =>
  value
    .normalize('NFD')
    .replace(/\p{M}+/gu, '')
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .replace(/\s+/g, ' ');

const isPlayedWord = (word: string, playedWords: readonly string[]) => {
  const wordKey = normalizeWordKey(word);
  const playedWordKeys = new Set(playedWords.map(normalizeWordKey).filter(Boolean));

  return playedWordKeys.has(wordKey);
};

const mergeUniquePlayedWords = (words: readonly string[]) => {
  const seenWordKeys = new Set<string>();

  return words.filter((word) => {
    const wordKey = normalizeWordKey(word);

    if (!wordKey || seenWordKeys.has(wordKey)) {
      return false;
    }

    seenWordKeys.add(wordKey);
    return true;
  });
};

const hashText = (value: string) => {
  let hash = 2166136261;

  for (const character of value) {
    hash ^= character.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 16777619);
  }

  return hash >>> 0;
};

const selectByTextHash = <T,>(items: readonly T[], seed: string) =>
  items[hashText(seed) % items.length];

const getEmergencyAssociationClue = (entry: EnglishWordEntry) => {
  const wordKey = normalizeWordKey(entry.word);
  const exactClue = emergencyAssociationClues.get(wordKey);

  if (exactClue) {
    return exactClue;
  }

  const tokenRules: readonly [RegExp, string][] = [
    [/\b(ball|soccer|football|basketball|volleyball|tennis)\b/u, 'bounce'],
    [/\b(coffee|espresso|latte|tea)\b/u, 'caffeine'],
    [/\b(ice|freezer|snow|frozen)\b/u, 'cold'],
    [/\b(fire|flame|heater|stove|oven)\b/u, 'heat'],
    [/\b(water|pool|river|lake|ocean|swimming)\b/u, 'splash'],
    [/\b(photo|picture|camera|mirror|glass|window)\b/u, 'reflection'],
    [/\b(book|paper|notebook|letter|newspaper)\b/u, 'pages'],
    [/\b(clock|timer|alarm|calendar)\b/u, 'time'],
    [/\b(key|lock|safe|password)\b/u, 'security'],
    [/\b(shoe|sock|boot|sneaker|walking|running)\b/u, 'steps'],
    [/\b(guitar|piano|drum|music|song)\b/u, 'rhythm'],
    [/\b(knife|razor|blade|scissors|needle)\b/u, 'sharp'],
    [/\b(pillow|blanket|towel|sweater|cotton)\b/u, 'softness'],
    [/\b(map|globe|country|city|island|mountain)\b/u, 'geography'],
    [/\b(cake|cookie|candy|chocolate|honey)\b/u, 'sweetness'],
  ];
  const matchedRule = tokenRules.find(([pattern]) => pattern.test(wordKey));

  if (matchedRule) {
    return matchedRule[1];
  }

  return selectByTextHash(emergencyCategoryCluePools[entry.categoryId], `${entry.categoryId}:${wordKey}`);
};

const getEmergencyStaticWord = (entry: EnglishWordEntry): GeneratedWord => ({
  word: entry.word,
  clue: getEmergencyAssociationClue(entry),
});

const getEmergencyDynamicWord = (categoryId: DynamicCategoryId, seed: string) =>
  selectByTextHash(emergencyDynamicWords[categoryId], seed);

const getPlayedWordContextKeys = ({ categoryIds, languageId, languageName }: PlayedWordContext) => {
  const languageKey = normalizeWordKey(languageId) || normalizeWordKey(languageName) || 'unknown-language';

  return categoryIds.map((categoryId) => {
    const categoryKey = normalizeWordKey(categoryId) || 'unknown-category';

    return `${languageKey}:${categoryKey}`;
  });
};

const getPlayedWordsForContext = (context: PlayedWordContext) =>
  mergeUniquePlayedWords(
    getPlayedWordContextKeys(context).flatMap((contextKey) => playedRoundWordsByContext.get(contextKey) ?? [])
  );

const getPlayedEntryIdsForContext = (context: PlayedWordContext) =>
  getPlayedWordContextKeys(context).flatMap((contextKey) => playedRoundEntryIdsByContext.get(contextKey) ?? []);

const rememberRoundWord = (word: string, context: PlayedWordContext, entryId?: string) => {
  for (const contextKey of getPlayedWordContextKeys(context)) {
    const playedWords = playedRoundWordsByContext.get(contextKey) ?? [];

    playedRoundWordsByContext.set(
      contextKey,
      mergeUniquePlayedWords([word, ...playedWords.filter((playedWord) => !isPlayedWord(word, [playedWord]))])
    );

    if (entryId) {
      const playedEntryIds = playedRoundEntryIdsByContext.get(contextKey) ?? [];

      playedRoundEntryIdsByContext.set(contextKey, [
        entryId,
        ...playedEntryIds.filter((playedEntryId) => playedEntryId !== entryId),
      ]);
    }
  }
};

const getAiRoundApiUrl = () =>
  process.env.EXPO_PUBLIC_AI_ROUND_API_URL?.trim() || DEFAULT_AI_ROUND_API_URL;

const isGeneratedWord = (value: unknown): value is GeneratedWord => {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const candidate = value as Record<string, unknown>;

  return (
    typeof candidate.word === 'string' &&
    candidate.word.trim().length > 0 &&
    typeof candidate.clue === 'string' &&
    candidate.clue.trim().length > 0
  );
};

const isCelebrityCategory = (categoryIds: readonly string[]) => categoryIds.includes('celebrities');

const isGeneratedWordValidForCategories = (generatedWord: GeneratedWord, categoryIds: readonly string[]) =>
  !isCelebrityCategory(categoryIds) || hasPlayableCelebrityAnswer(generatedWord.word);

const getAiGenerationAttemptLimit = (categoryIds: readonly string[]) =>
  isCelebrityCategory(categoryIds) ? AI_CLIENT_GENERATION_ATTEMPTS : 1;

async function fetchAiGeneratedWord({
  players,
  categoryIds,
  difficulty,
  languageId,
  languageName,
}: RoundGeneratorInput): Promise<GeneratedWord> {
  const rejectedWords: string[] = [];
  let lastError: unknown;
  const playedWordContext = {
    categoryIds,
    languageId,
    languageName,
  };

  for (let attempt = 0; attempt < getAiGenerationAttemptLimit(categoryIds); attempt += 1) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), AI_ROUND_REQUEST_TIMEOUT_MS);

    try {
      const playedWords = mergeUniquePlayedWords([
        ...rejectedWords,
        ...getPlayedWordsForContext(playedWordContext),
      ]);
      const response = await fetch(getAiRoundApiUrl(), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          categoryIds,
          difficulty,
          languageId,
          languageName,
          playerCount: players.length,
          playedWords,
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error('AI round generation failed');
      }

      const payload: unknown = await response.json();

      if (!isGeneratedWord(payload)) {
        throw new Error('AI round generation returned an invalid payload');
      }

      const generatedWord = {
        word: payload.word.trim(),
        clue: payload.clue.trim(),
      };

      if (isPlayedWord(generatedWord.word, playedWords)) {
        rejectedWords.unshift(generatedWord.word);
        lastError = new Error('AI round generation returned an already played word');
        continue;
      }

      if (!isGeneratedWordValidForCategories(generatedWord, categoryIds)) {
        rejectedWords.unshift(generatedWord.word);
        lastError = new Error('AI round generation returned an incomplete celebrity name');
        continue;
      }

      return generatedWord;
    } catch (error) {
      throw error instanceof Error ? error : new Error('AI round generation failed');
    } finally {
      clearTimeout(timeoutId);
    }
  }

  throw lastError instanceof Error ? lastError : new Error('AI round generation failed');
}

async function fetchPreparedStaticWord({
  sourceEntry,
  languageId,
  languageName,
}: {
  sourceEntry: EnglishWordEntry;
  languageId: string;
  languageName: string;
}): Promise<GeneratedWord> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), AI_ROUND_REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(getAiRoundApiUrl(), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        mode: 'prepare-static-word',
        languageId,
        languageName,
        source: {
          word: sourceEntry.word,
          categoryId: sourceEntry.categoryId,
          categoryLabel: CATEGORY_LABELS[sourceEntry.categoryId],
          difficulty: sourceEntry.difficulty,
          sense: sourceEntry.sense,
          storedClue: sourceEntry.hint,
        },
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error('Static word preparation failed');
    }

    const payload: unknown = await response.json();

    if (!isGeneratedWord(payload)) {
      throw new Error('Static word preparation returned an invalid payload');
    }

    return {
      word: payload.word.trim(),
      clue: payload.clue.trim(),
    };
  } finally {
    clearTimeout(timeoutId);
  }
}

export async function createAiRound(input: RoundGeneratorInput): Promise<Round> {
  const generatedWord = await fetchAiGeneratedWord(input);
  const round = buildRound({
    players: input.players,
    categoryIds: input.categoryIds,
    difficulty: input.difficulty,
    languageId: input.languageId,
    languageName: input.languageName,
    secretWord: generatedWord.word,
    imposterHint: generatedWord.clue,
    imposterCount: input.imposterCount,
    isImposterHintEnabled: input.isImposterHintEnabled,
    roundTimerMinutes: input.roundTimerMinutes,
  });

  rememberRoundWord(generatedWord.word, {
    categoryIds: input.categoryIds,
    languageId: input.languageId,
    languageName: input.languageName,
  });

  return round;
}

export async function createRound(input: RoundGeneratorInput): Promise<Round> {
  const playedWordContext = {
    categoryIds: input.categoryIds,
    languageId: input.languageId,
    languageName: input.languageName,
  };
  const playedWords = getPlayedWordsForContext(playedWordContext);
  const playedEntryIds = getPlayedEntryIdsForContext(playedWordContext);
  let wordPlan: RoundWordPlan;

  try {
    wordPlan = resolveRoundWordPlan({
      categoryIds: input.categoryIds,
      difficulty: input.difficulty,
      languageId: input.languageId,
      languageName: input.languageName,
      playedWords,
      playedEntryIds,
      rng: input.rng,
    });
  } catch {
    wordPlan = {
      mode: 'local-static',
      source: {
        type: 'static',
        categoryId: EMERGENCY_STATIC_CATEGORY_ID,
        entry: selectStaticWordEntry({
          categoryId: EMERGENCY_STATIC_CATEGORY_ID,
          difficulty: input.difficulty,
          playedWords,
          playedEntryIds,
          rng: input.rng,
        }),
      },
    };
  }

  let generatedWord: GeneratedWord;
  let shouldRememberStaticEntry = false;

  if (wordPlan.mode === 'ai') {
    try {
      generatedWord = await fetchAiGeneratedWord({
        ...input,
        categoryIds: [wordPlan.source.categoryId],
      });
    } catch {
      generatedWord = getEmergencyDynamicWord(
        wordPlan.source.categoryId,
        `${wordPlan.source.categoryId}:${input.languageId}:${playedWords.length}:${Date.now()}`
      );
    }
  } else {
    try {
      generatedWord = await fetchPreparedStaticWord({
        sourceEntry: wordPlan.source.entry,
        languageId: input.languageId,
        languageName: input.languageName,
      });
      shouldRememberStaticEntry = true;
    } catch {
      try {
        generatedWord = await fetchAiGeneratedWord({
          ...input,
          categoryIds: [wordPlan.source.categoryId],
        });
      } catch {
        generatedWord = getEmergencyStaticWord(wordPlan.source.entry);
        shouldRememberStaticEntry = true;
      }
    }
  }

  const round = buildRound({
    players: input.players,
    categoryIds: [wordPlan.source.categoryId],
    difficulty: input.difficulty,
    languageId: input.languageId,
    languageName: input.languageName,
    secretWord: generatedWord.word,
    imposterHint: generatedWord.clue,
    imposterCount: input.imposterCount,
    isImposterHintEnabled: input.isImposterHintEnabled,
    roundTimerMinutes: input.roundTimerMinutes,
    rng: input.rng,
  });

  rememberRoundWord(
    generatedWord.word,
    {
      categoryIds: [wordPlan.source.categoryId],
      languageId: input.languageId,
      languageName: input.languageName,
    },
    wordPlan.source.type === 'static' && shouldRememberStaticEntry ? wordPlan.source.entry.id : undefined
  );

  return round;
}
