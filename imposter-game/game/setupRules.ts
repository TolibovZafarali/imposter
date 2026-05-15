import type { ImposterCount, RoundTimerMinutes, RoundTimerSetting } from './types';

export const DEFAULT_IMPOSTER_COUNT: ImposterCount = 1;
export const MAX_IMPOSTER_COUNT: ImposterCount = 2;
export const MIN_PLAYERS_FOR_TWO_IMPOSTERS = 5;
export const DEFAULT_IMPOSTER_HINT_ENABLED = true;
export const DEFAULT_ROUND_TIMER_MINUTES: RoundTimerSetting = 3;
export const ROUND_TIMER_MINUTE_OPTIONS = [1, 2, 3, 5, 10] as const satisfies readonly RoundTimerMinutes[];

export const getMaxImposterCount = (playerCount: number): ImposterCount =>
  playerCount >= MIN_PLAYERS_FOR_TWO_IMPOSTERS ? MAX_IMPOSTER_COUNT : 1;

export const clampImposterCount = (
  requestedImposterCount: number | undefined,
  playerCount: number
): ImposterCount => {
  const maxImposterCount = getMaxImposterCount(playerCount);

  return (requestedImposterCount ?? 1) >= 2 && maxImposterCount === 2 ? 2 : 1;
};

export const formatRoundTimerSetting = (roundTimerMinutes: RoundTimerSetting) =>
  roundTimerMinutes === null
    ? 'No timer'
    : `${roundTimerMinutes} ${roundTimerMinutes === 1 ? 'min' : 'mins'}`;
