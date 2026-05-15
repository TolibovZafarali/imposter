import type { WordDifficulty } from '@/data/wordBank';

export type Player = {
  id: string;
  name: string;
};

export type Role = 'regular' | 'imposter';
export type ImposterCount = 1 | 2;
export type RoundTimerMinutes = 1 | 2 | 3 | 5 | 10;
export type RoundTimerSetting = RoundTimerMinutes | null;

export type GamePhase = 'setup' | 'reveal' | 'playing';

export type RoundCard = {
  playerId: string;
  role: Role;
  word: string | null;
  hint: string | null;
};

export type RoundConfig = {
  categoryIds: string[];
  difficulty: WordDifficulty;
  languageId: string;
  languageName: string;
  imposterCount: ImposterCount;
  isImposterHintEnabled: boolean;
  roundTimerMinutes: RoundTimerSetting;
};

export type Round = {
  id: string;
  players: Player[];
  cards: RoundCard[];
  secretWord: string;
  imposterHint: string;
  imposterPlayerIds: string[];
  imposterPlayerId: string;
  firstSpeakerId: string;
  config: RoundConfig;
};
