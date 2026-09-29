import { Image } from 'expo-image';
import { StyleSheet, View } from 'react-native';

import { FLAG_ASSETS } from '@/constants/flag-assets';
import type { LanguageOption } from '@/constants/languages';

type Props = {
  language: Pick<LanguageOption, 'flagCountryCode'>;
  width?: number;
};

export function LanguageFlag({ language, width = 32 }: Props) {
  return (
    <View
      accessible={false}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      pointerEvents="none"
      style={[styles.frame, { width, height: width * 0.75 }]}>
      <Image
        source={FLAG_ASSETS[language.flagCountryCode]}
        recyclingKey={language.flagCountryCode}
        contentFit="contain"
        accessible={false}
        style={StyleSheet.absoluteFill}
      />
      <View style={[StyleSheet.absoluteFill, styles.outline]} />
    </View>
  );
}

const styles = StyleSheet.create({
  frame: {
    flexShrink: 0,
    borderRadius: 3,
    overflow: 'hidden',
  },
  outline: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(0, 0, 0, 0.12)',
    borderRadius: 3,
  },
});
