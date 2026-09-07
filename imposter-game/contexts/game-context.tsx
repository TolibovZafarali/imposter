import { createContext, useContext, useMemo, useReducer, type ReactNode } from 'react';

import type { Round } from '@/game/types';
import { gameReducer, initialState, type GameState, type GameSetupPreferences } from '@/game/state';

type GameContextValue = {
  state: GameState;
  setupPreferences: GameSetupPreferences;
  startRound: (round: Round) => void;
  advanceReveal: () => void;
  startPlaying: () => void;
  completeRound: () => void;
  resetGame: () => void;
  updateSetupPreferences: (preferences: Partial<GameSetupPreferences>) => void;
};

const GameContext = createContext<GameContextValue | null>(null);

export function GameProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(gameReducer, initialState);

  const value = useMemo(
    () => ({
      state,
      setupPreferences: state.setupPreferences,
      startRound: (round: Round) => dispatch({ type: 'startRound', round }),
      advanceReveal: () => dispatch({ type: 'advanceReveal' }),
      startPlaying: () => dispatch({ type: 'startPlaying', now: Date.now() }),
      completeRound: () => dispatch({ type: 'completeRound' }),
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
