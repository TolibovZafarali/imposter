import { Text as RNText, type TextProps as RNTextProps, type TextStyle } from 'react-native';

import { Colors, Typography, type TypographyVariant } from '@/constants/theme';

export type AppTextProps = RNTextProps & {
  variant?: TypographyVariant;
  color?: keyof typeof Colors;
  align?: TextStyle['textAlign'];
};

export function Text({
  variant = 'body',
  color,
  align,
  style,
  ...rest
}: AppTextProps) {
  return (
    <RNText
      style={[
        Typography[variant],
        color ? { color: Colors[color] } : null,
        align ? { textAlign: align } : null,
        style,
      ]}
      {...rest}
    />
  );
}
