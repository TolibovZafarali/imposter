export function remainingRoundSeconds(startedAt: number, durationSeconds: number, now: number) {
  return Math.max(0, Math.min(durationSeconds, Math.ceil((startedAt + durationSeconds * 1000 - now) / 1000)));
}
