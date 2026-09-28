const MAX_ILLUSTRATION_SIZE = 200;
const MIN_ILLUSTRATION_SIZE = 96;

export function getWordIllustrationSize({
  cardHeight,
  contentWidth,
  fontScale,
}: {
  cardHeight: number;
  contentWidth: number;
  fontScale: number;
}): number {
  // Reserve the label, all three word lines, two gaps, and card padding.
  const textHeight = (24 + 44 * 3) * Math.max(1, fontScale);
  const availableHeight = cardHeight - 48 - 32 - textHeight;
  const size = Math.floor(Math.min(MAX_ILLUSTRATION_SIZE, contentWidth, availableHeight));
  return size >= MIN_ILLUSTRATION_SIZE ? size : 0;
}

type ReleasableImage = { release(): void };

export function loadRoundIllustration<Image extends ReleasableImage>(
  source: number | undefined,
  load: (source: number) => Promise<Image>,
  onReady: (image: Image) => void,
): () => void {
  let disposed = false;
  let loadedImage: Image | null = null;

  if (source !== undefined) {
    void (async () => {
      try {
        const image = await load(source);
        if (disposed) {
          image.release();
          return;
        }
        loadedImage = image;
        onReady(image);
      } catch {
        // Artwork is optional; keep the text-only card without retrying.
      }
    })();
  }

  return () => {
    if (disposed) return;
    disposed = true;
    loadedImage?.release();
    loadedImage = null;
  };
}

export function selectRevealIllustration<Image>({
  ready,
  roundId,
  role,
  entryId,
  size,
}: {
  ready: { roundId: string; entryId: string; image: Image } | null;
  roundId: string;
  role: 'regular' | 'imposter';
  entryId: string | null | undefined;
  size: number;
}): Image | null {
  if (role !== 'regular' || size === 0 || !entryId) return null;
  return ready?.roundId === roundId && ready.entryId === entryId ? ready.image : null;
}
