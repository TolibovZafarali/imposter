import { Image, type ImageRef } from 'expo-image';
import { useEffect, useState } from 'react';

import { loadRoundIllustration } from '@/components/word-illustration-state';
import { resolveWordIllustration } from '@/data/wordIllustrations';

type ReadyIllustration = {
  roundId: string;
  entryId: string;
  image: ImageRef;
};

export function useRoundIllustration(roundId: string | undefined, entryId: string | null) {
  const [ready, setReady] = useState<ReadyIllustration | null>(null);
  const source = resolveWordIllustration(entryId);

  useEffect(() => {
    setReady(null);
    if (!roundId || !entryId) return;

    return loadRoundIllustration(
      source,
      (asset) => Image.loadAsync(asset),
      (image) => setReady({ roundId, entryId, image }),
    );
  }, [roundId, entryId, source]);

  // Effects run after rendering; old-round artwork must disappear immediately.
  return ready && ready.roundId === roundId && ready.entryId === entryId ? ready : null;
}
