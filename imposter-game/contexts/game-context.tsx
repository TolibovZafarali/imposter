import { createContext, useContext, useMemo, useReducer, type ReactNode } from 'react';

import type { WordDifficulty } from '@/data/wordBank';
import type { GamePhase, Player, Round } from '@/game/types';

type GameSetupPreferences = {
  players: Player[];
  selectedCategoryIds: string[];
  isRandomCategoryMode: boolean;
  selectedDifficulty: WordDifficulty;
};

type GameState = {
  phase: GamePhase;
  round: Round | null;
  currentRevealIndex: number;
  setupPreferences: GameSetupPreferences;
};

type GameAction =
  | { type: 'startRound'; round: Round }
  | { type: 'advanceReveal' }
  | { type: 'startPlaying' }
  | { type: 'resetGame' }
  | { type: 'updateSetupPreferences'; preferences: Partial<GameSetupPreferences> };

type GameContextValue = {
  state: GameState;
  setupPreferences: GameSetupPreferences;
  startRound: (round: Round) => void;
  advanceReveal: () => void;
  startPlaying: () => void;
  resetGame: () => void;
  updateSetupPreferences: (preferences: Partial<GameSetupPreferences>) => void;
};

const initialSetupPlayers: Player[] = [
  { id: 'player-1', name: 'Player 1' },
  { id: 'player-2', name: 'Player 2' },
  { id: 'player-3', name: 'Player 3' },
];

const initialState: GameState = {
  phase: 'setup',
  round: null,
  currentRevealIndex: 0,
  setupPreferences: {
    players: initialSetupPlayers,
    selectedCategoryIds: [],
    isRandomCategoryMode: true,
    selectedDifficulty: 'easy',
  },
};

const GameContext = createContext<GameContextValue | null>(null);

function gameReducer(state: GameState, action: GameAction): GameState {
  switch (action.type) {
    case 'startRound':
      return {
        ...state,
        phase: 'reveal',
        round: action.round,
        currentRevealIndex: 0,
      };

    case 'advanceReveal': {
      if (!state.round) {
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
      return state.round
        ? {
            ...state,
            phase: 'playing',
          }
        : state;

    case 'resetGame':
      return {
        ...initialState,
        setupPreferences: state.setupPreferences,
      };

    case 'updateSetupPreferences':
      return {
        ...state,
        setupPreferences: {
          ...state.setupPreferences,
          ...action.preferences,
          selectedCategoryIds:
            action.preferences.selectedCategoryIds === undefined
              ? state.setupPreferences.selectedCategoryIds
              : [...action.preferences.selectedCategoryIds],
          players:
            action.preferences.players === undefined
              ? state.setupPreferences.players
              : action.preferences.players.map((player) => ({ ...player })),
        },
      };

    default:
      return state;
  }
}

export function GameProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(gameReducer, initialState);

  const value = useMemo(
    () => ({
      state,
      setupPreferences: state.setupPreferences,
      startRound: (round: Round) => dispatch({ type: 'startRound', round }),
      advanceReveal: () => dispatch({ type: 'advanceReveal' }),
      startPlaying: () => dispatch({ type: 'startPlaying' }),
      resetGame: () => dispatch({ type: 'resetGame' }),
      updateSetupPreferences: (preferences: Partial<GameSetupPreferences>) =>
        dispatch({ type: 'updateSetupPreferences', preferences }),
    }),
    [state]
  );

  return <GameContext.Provider value={value}>{children}</GameContext.Provider>;
}

export function useGame() {
  const value = useContext(GameContext);

  if (!value) {
    throw new Error('useGame must be used inside GameProvider');
  }

  return value;
}
