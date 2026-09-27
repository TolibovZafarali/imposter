import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect, useState, type ReactNode } from 'react';

import { Tutorial } from '@/components/onboarding/Tutorial';
import { Screen } from '@/components/ui/screen';
import { createOnboardingStore, type OnboardingOutcome } from '@/game/onboarding';

const onboardingStore = createOnboardingStore(AsyncStorage);

export function FirstLaunchGate({ children }: { children: ReactNode }) {
  const [isDismissed, setIsDismissed] = useState<boolean | null>(null);

  useEffect(() => {
    let isMounted = true;

    void onboardingStore.isDismissed().then((dismissed) => {
      if (isMounted) setIsDismissed(dismissed);
    });

    return () => {
      isMounted = false;
    };
  }, []);

  const finish = (outcome: OnboardingOutcome) => {
    void onboardingStore.finish(outcome);
    setIsDismissed(true);
  };

  if (isDismissed === null) {
    return <Screen accessibilityLabel="Loading IMPOSTER" accessibilityState={{ busy: true }} />;
  }

  return isDismissed ? children : <Tutorial onFinish={finish} />;
}
