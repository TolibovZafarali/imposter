import type { WordDifficulty } from '../data/wordBank.ts';
import { assignPlayerAvatars, cyclePlayerAvatar, shufflePlayerAvatars } from './playerAvatars.ts';
import {
  clampImposterCount,
  DEFAULT_IMPOSTER_HINT_ENABLED,
  DEFAULT_IMPOSTER_COUNT,
  DEFAULT_ROUND_TIMER_MINUTES,
} from './setupRules.ts';
import type { GamePhase, ImposterCount, Player, Round, RoundTimerSetting } from './types.ts';

export type GameSetupPreferences = {
  players: Player[];
  selectedCategoryIds: string[];
  isRandomCategoryMode: boolean;
  selectedDifficulty: WordDifficulty;
  imposterCount: ImposterCount;
  isImposterHintEnabled: boolean;
  roundTimerMinutes: RoundTimerSetting;
};

export type GameState = {
  phase: GamePhase;
  round: Round | null;
  currentRevealIndex: number;
  playStartedAt: number | null;
  setupPreferences: GameSetupPreferences;
};

export type GameAction =
  | { type: 'startRound'; round: Round }
  | { type: 'advanceReveal' }
  | { type: 'startPlaying'; now: number }
  | { type: 'completeRound' }
  | { type: 'resetGame' }
  | { type: 'changePlayerAvatar'; playerId: string }
  | { type: 'updateSetupPreferences'; preferences: Partial<GameSetupPreferences> };

const initialSetupPlayers: Player[] = assignPlayerAvatars([
  { id: 'player-1', name: 'Player 1' },
  { id: 'player-2', name: 'Player 2' },
  { id: 'player-3', name: 'Player 3' },
]);

export const initialState: GameState = {
  phase: 'setup',
  round: null,
  currentRevealIndex: 0,
  playStartedAt: null,
  setupPreferences: {
    players: initialSetupPlayers,
    selectedCategoryIds: [],
    isRandomCategoryMode: true,
    selectedDifficulty: 'easy',
    imposterCount: DEFAULT_IMPOSTER_COUNT,
    isImposterHintEnabled: DEFAULT_IMPOSTER_HINT_ENABLED,
    roundTimerMinutes: DEFAULT_ROUND_TIMER_MINUTES,
  },
};

export function createInitialState(rng = Math.random): GameState {
  return {
    ...initialState,
    setupPreferences: {
      ...initialState.setupPreferences,
      players: shufflePlayerAvatars(initialState.setupPreferences.players, rng),
      selectedCategoryIds: [...initialState.setupPreferences.selectedCategoryIds],
    },
  };
}

export function gameReducer(state: GameState, action: GameAction): GameState {
  switch (action.type) {
    case 'startRound':
      return {
        ...state,
        phase: 'reveal',
        round: {
          ...action.round,
          players: assignPlayerAvatars(action.round.players, state.setupPreferences.players),
        },
        currentRevealIndex: 0,
        playStartedAt: null,
      };

    case 'advanceReveal': {
      if (!state.round || state.phase !== 'reveal') {
        return state;
      }

      return {
        ...state,
        currentRevealIndex: Math.min(
          state.currentRevealIndex + 1,
          state.round.players.length - 1
        ),
      };
    }

    case 'startPlaying':
      return state.round && state.phase === 'reveal' &&
        state.currentRevealIndex === state.round.players.length - 1
        ? {
            ...state,
            phase: 'playing',
            playStartedAt: action.now,
          }
        : state;

    case 'completeRound':
      return state.round && state.phase === 'playing'
        ? { ...state, phase: 'completed' }
        : state;

    case 'resetGame':
      return {
        ...initialState,
        setupPreferences: state.setupPreferences,
      };

    case 'changePlayerAvatar': {
      if (state.phase !== 'setup') return state;
      const players = cyclePlayerAvatar(state.setupPreferences.players, action.playerId);
      if (players === state.setupPreferences.players) return state;
      return {
        ...state,
        setupPreferences: { ...state.setupPreferences, players },
      };
    }

    case 'updateSetupPreferences': {
      const nextPlayers =
        action.preferences.players === undefined
          ? state.setupPreferences.players
          : assignPlayerAvatars(action.preferences.players, state.setupPreferences.players);
      const nextImposterCount = clampImposterCount(
        action.preferences.imposterCount ?? state.setupPreferences.imposterCount,
        nextPlayers.length
      );

      return {
        ...state,
        setupPreferences: {
          ...state.setupPreferences,
          ...action.preferences,
          selectedCategoryIds:
            action.preferences.selectedCategoryIds === undefined
              ? state.setupPreferences.selectedCategoryIds
              : [...action.preferences.selectedCategoryIds],
          players: nextPlayers,
          imposterCount: nextImposterCount,
        },
      };
    }

    default:
      return state;
  }
}
