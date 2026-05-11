import { StyleSheet, Text, type TextProps } from 'react-native';

import { Colors, Typography } from '@/constants/theme';

export type ThemedTextProps = TextProps & {
  lightColor?: string;
  darkColor?: string;
  type?: 'default' | 'title' | 'defaultSemiBold' | 'subtitle' | 'link';
};

export function ThemedText({
  style,
  lightColor,
  darkColor,
  type = 'default',
  ...rest
}: ThemedTextProps) {
  const colorOverride = lightColor ?? darkColor;
  return (
    <Text
      style={[
        variantMap[type],
        type === 'link' ? styles.link : null,
        colorOverride ? { color: colorOverride } : null,
        style,
      ]}
      {...rest}
    />
  );
}

const variantMap = {
  default: Typography.body,
  defaultSemiBold: Typography.bodyEmphasis,
  title: Typography.title,
  subtitle: Typography.heading,
  link: Typography.body,
};

const styles = StyleSheet.create({
  link: {
    color: Colors.primary,
  },
});
