export const DAY_MS = 86_400_000;
export type Engagement = {
  firstSeenAt: number;
  completedRounds: number;
  recentRoundIds: string[];
  lastAdAt: number;
  lastAdRound: number;
  adTimes: number[];
  reviewTimes: number[];
  lastReviewVersion: string;
};

export const newEngagement = (now: number): Engagement => ({
  firstSeenAt: now, completedRounds: 0, recentRoundIds: [], lastAdAt: 0,
  lastAdRound: 0, adTimes: [], reviewTimes: [], lastReviewVersion: '',
});

export function parseEngagement(raw: string | null, now: number): Engagement {
  if (!raw) return newEngagement(now);
  try {
    const value: Engagement = JSON.parse(raw);
    const count = (n: number) => Number.isSafeInteger(n) && n >= 0;
    const times = (items: number[]) => Array.isArray(items) && items.every(count);
    if (!value || !count(value.firstSeenAt) || !count(value.completedRounds) ||
      !count(value.lastAdAt) || !count(value.lastAdRound) ||
      !times(value.adTimes) || !times(value.reviewTimes) ||
      !Array.isArray(value.recentRoundIds) || !value.recentRoundIds.every((id) => typeof id === 'string') ||
      typeof value.lastReviewVersion !== 'string') return newEngagement(now);
    return { ...value, recentRoundIds: value.recentRoundIds.slice(-64),
      adTimes: value.adTimes.filter((time) => now - time < DAY_MS),
      reviewTimes: value.reviewTimes.filter((time) => now - time < 365 * DAY_MS) };
  } catch {
    return newEngagement(now);
  }
}

export function recordCompletion(value: Engagement, roundId: string): Engagement {
  if (value.recentRoundIds.includes(roundId)) return value;
  return { ...value, completedRounds: value.completedRounds + 1,
    recentRoundIds: [...value.recentRoundIds, roundId].slice(-64) };
}

export function canOfferAds(value: Engagement, now: number) {
  return value.completedRounds >= 3 && now - value.firstSeenAt >= DAY_MS;
}

export function canShowAd(value: Engagement, now: number, adsRemoved: boolean) {
  return !adsRemoved && canOfferAds(value, now) &&
    value.completedRounds - value.lastAdRound >= 3 &&
    now - value.lastAdAt >= 10 * 60_000 &&
    value.adTimes.filter((time) => now - time < DAY_MS).length < 2 &&
    !value.reviewTimes.some((time) => now - time < 10 * 60_000);
}

export function canRequestReview(value: Engagement, now: number, version: string) {
  return value.completedRounds >= 4 && now - value.firstSeenAt >= 3 * DAY_MS &&
    value.lastReviewVersion !== version && value.reviewTimes.length < 3 &&
    !value.reviewTimes.some((time) => now - time < 120 * DAY_MS) &&
    (!value.lastAdAt || now - value.lastAdAt >= 10 * 60_000);
}

export function createEngagementStore(storage: {
  getItem: (key: string) => Promise<string | null>;
  setItem: (key: string, value: string) => Promise<void>;
}, now = Date.now) {
  const key = 'imposter:engagement:v1';
  let queue: Promise<unknown> = Promise.resolve();
  const update = (change: (value: Engagement) => Engagement = (value) => value) => {
    const operation = queue.then(async () => {
      const value = change(parseEngagement(await storage.getItem(key), now()));
      await storage.setItem(key, JSON.stringify(value));
      return value;
    });
    queue = operation.catch(() => {});
    return operation;
  };
  return { update, complete: (id: string) => update((value) => recordCompletion(value, id)) };
}
