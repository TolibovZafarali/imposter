import type { EnglishWordEntry } from '../data/wordBank.ts';

type GeneratedWord = {
  word: string;
  clue: string;
};

type StaticFallbackOptions = {
  mode?: 'local-static' | 'translate-static';
  targetLanguage?: string;
};

const normalizeWordKey = (value: string) =>
  value
    .normalize('NFD')
    .replace(/\p{M}+/gu, '')
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .replace(/\s+/g, ' ');

const normalizeGeneratedText = (value: string) => value.trim().replace(/\s+/g, ' ');

const curatedStaticFallbackClues = new Map([
  ['sunscreen', 'beach'],
  ['baby goat', 'bleat'],
  ['desert kangaroo', 'hopping'],
  ['passport', 'border'],
  ['hospital', 'recovery'],
  ['banana', 'peel'],
  ['pizza', 'oven'],
  ['pencil', 'writing'],
  ['sushi', 'chopsticks'],
  ['knife', 'sharp'],
]);

const forbiddenFallbackClues = new Set([
  'animal',
  'common',
  'concept',
  'document',
  'edge',
  'essence',
  'familiar',
  'food',
  'fruit',
  'general',
  'item',
  'known',
  'object',
  'place',
  'related',
  'symbol',
  'talisman',
  'thing',
]);

const forbiddenFallbackPairs = new Set([
  'banana:fruit',
  'hospital:doctor',
  'knife:kitchen',
  'passport:document',
  'pencil:school',
  'pizza:cheese',
  'sushi:roll',
]);

const hasShortFallbackClue = (clue: string) => {
  const normalizedClue = normalizeWordKey(clue);
  const tokens = normalizedClue.split(' ').filter(Boolean);

  return (
    tokens.length >= 1 &&
    tokens.length <= 2 &&
    !/[-\u2010-\u2015/\\|_]/u.test(clue) &&
    !/[^\p{L}\p{M}\p{N}\s'’]/u.test(clue)
  );
};

export const isSafeStaticFallbackClue = (word: string, clue: string) => {
  const normalizedWord = normalizeWordKey(word);
  const normalizedClue = normalizeWordKey(clue);

  if (!normalizedWord || !normalizedClue || !hasShortFallbackClue(clue)) {
    return false;
  }

  if (normalizedWord === normalizedClue || forbiddenFallbackClues.has(normalizedClue)) {
    return false;
  }

  if (forbiddenFallbackPairs.has(`${normalizedWord}:${normalizedClue}`)) {
    return false;
  }

  const wordTokens = normalizedWord.split(' ');
  const clueTokens = normalizedClue.split(' ');

  return !clueTokens.some((clueToken) => clueToken.length >= 4 && wordTokens.includes(clueToken));
};

const isEnglishStaticFallback = ({ mode, targetLanguage }: StaticFallbackOptions) => {
  if (mode === 'local-static') {
    return true;
  }

  if (mode === 'translate-static') {
    return false;
  }

  return !targetLanguage || targetLanguage.trim().toLocaleLowerCase() === 'english';
};

export const getFallbackStaticWord = (
  entry: Pick<EnglishWordEntry, 'word' | 'hint'>,
  options: StaticFallbackOptions = {}
): GeneratedWord | null => {
  if (!isEnglishStaticFallback(options)) {
    return null;
  }

  const wordKey = normalizeWordKey(entry.word);
  const curatedClue = curatedStaticFallbackClues.get(wordKey);

  if (curatedClue) {
    return {
      word: entry.word,
      clue: curatedClue,
    };
  }

  const storedClue = normalizeGeneratedText(entry.hint);

  if (isSafeStaticFallbackClue(entry.word, storedClue)) {
    return {
      word: entry.word,
      clue: storedClue,
    };
  }

  return null;
};
