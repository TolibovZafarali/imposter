import { Image, type ImageRef } from 'expo-image';
import { useState } from 'react';

export function WordIllustration({
  image,
  size,
  onError,
}: {
  image: ImageRef;
  size: number;
  onError: () => void;
}) {
  const [failed, setFailed] = useState(false);

  return (
    <Image
      source={image}
      contentFit="contain"
      transition={0}
      accessible={false}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      accessibilityLabel=""
      onError={() => {
        setFailed(true);
        onError();
      }}
      style={{ width: size, height: size, opacity: failed ? 0 : 1 }}
    />
  );
}
