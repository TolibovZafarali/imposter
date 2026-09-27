export const ONBOARDING_STORAGE_KEY = 'imposter:onboarding:v1';

export type OnboardingOutcome = 'completed' | 'skipped';

type OnboardingStorage = {
  getItem: (key: string) => Promise<string | null>;
  setItem: (key: string, value: string) => Promise<void>;
};

function isFinished(raw: string | null): boolean {
  if (!raw) return false;

  try {
    const value = JSON.parse(raw);
    return value?.version === 1 &&
      (value.outcome === 'completed' || value.outcome === 'skipped');
  } catch {
    return false;
  }
}

export function createOnboardingStore(storage: OnboardingStorage) {
  let dismissedThisSession = false;

  return {
    async isDismissed(): Promise<boolean> {
      if (dismissedThisSession) return true;

      try {
        const stored = await storage.getItem(ONBOARDING_STORAGE_KEY);
        dismissedThisSession = dismissedThisSession || isFinished(stored);
      } catch {
        // The walkthrough remains available when device storage cannot be read.
      }

      return dismissedThisSession;
    },
    async finish(outcome: OnboardingOutcome): Promise<void> {
      dismissedThisSession = true;

      try {
        await storage.setItem(ONBOARDING_STORAGE_KEY, JSON.stringify({ version: 1, outcome }));
      } catch {
        // Keep this session usable even if the device cannot save the choice.
      }
    },
  };
}
