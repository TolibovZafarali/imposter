import { createContext, useContext, useMemo, useReducer, type ReactNode } from 'react';

import type { GamePhase, Round } from '@/game/types';

type GameState = {
  phase: GamePhase;
  round: Round | null;
  currentRevealIndex: number;
};

type GameAction =
  | { type: 'startRound'; round: Round }
  | { type: 'advanceReveal' }
  | { type: 'startPlaying' }
  | { type: 'resetGame' };

type GameContextValue = {
  state: GameState;
  startRound: (round: Round) => void;
  advanceReveal: () => void;
  startPlaying: () => void;
  resetGame: () => void;
};

const initialState: GameState = {
  phase: 'setup',
  round: null,
  currentRevealIndex: 0,
};

const GameContext = createContext<GameContextValue | null>(null);

function gameReducer(state: GameState, action: GameAction): GameState {
  switch (action.type) {
    case 'startRound':
      return {
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
      return initialState;

    default:
      return state;
  }
}

export function GameProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(gameReducer, initialState);

  const value = useMemo(
    () => ({
      state,
      startRound: (round: Round) => dispatch({ type: 'startRound', round }),
      advanceReveal: () => dispatch({ type: 'advanceReveal' }),
      startPlaying: () => dispatch({ type: 'startPlaying' }),
      resetGame: () => dispatch({ type: 'resetGame' }),
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
