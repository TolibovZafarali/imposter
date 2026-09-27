export const RESULT_FLIP_DURATION = 420;

type RevealEvent =
  | { type: 'beat'; index: number }
  | { type: 'flip' }
  | { type: 'names'; count: number }
  | { type: 'word' }
  | { type: 'complete' };

type Schedule = (callback: () => void, delay: number) => () => void;

const scheduleTimeout: Schedule = (callback, delay) => {
  const timer = setTimeout(callback, delay);
  return () => clearTimeout(timer);
};

export function startResultReveal({
  imposterCount,
  onEvent,
  schedule = scheduleTimeout,
}: {
  imposterCount: number;
  onEvent: (event: RevealEvent) => void;
  schedule?: Schedule;
}) {
  let active = true;
  const cancellations: (() => void)[] = [];
  const cancel = () => {
    active = false;
    cancellations.forEach((stop) => stop());
  };
  const at = (delay: number, event: RevealEvent) => {
    cancellations.push(schedule(() => {
      if (!active) return;
      if (event.type === 'complete') cancel();
      onEvent(event);
    }, delay));
  };

  [220, 920, 1450].forEach((delay, index) => at(delay, { type: 'beat', index }));
  at(1900, { type: 'flip' });
  for (let index = 0; index < imposterCount; index += 1) {
    at(2110 + index * 280, { type: 'names', count: index + 1 });
  }
  const wordAt = 2590 + Math.max(0, imposterCount - 1) * 280;
  at(wordAt, { type: 'word' });
  at(wordAt + 360, { type: 'complete' });

  return {
    cancel,
    skip: () => {
      if (!active) return;
      cancel();
      onEvent({ type: 'names', count: imposterCount });
      onEvent({ type: 'word' });
      onEvent({ type: 'complete' });
    },
  };
}
