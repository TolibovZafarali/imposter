import type { RoundDifficulty } from '@/data/wordBank';

export type Player = {
  id: string;
  name: string;
};

export type Role = 'regular' | 'imposter';

export type GamePhase = 'setup' | 'reveal' | 'playing';

export type RoundCard = {
  playerId: string;
  role: Role;
  word: string | null;
  hint: string | null;
};

export type RoundConfig = {
  categoryIds: string[];
  languageId: string;
  languageName: string;
  difficulty: RoundDifficulty;
};

export type Round = {
  id: string;
  players: Player[];
  cards: RoundCard[];
  secretWord: string;
  imposterHint: string;
  imposterPlayerId: string;
  firstSpeakerId: string;
  config: RoundConfig;
};
