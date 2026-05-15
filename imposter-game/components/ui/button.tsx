import * as Haptics from 'expo-haptics';
import {
  Pressable,
  StyleSheet,
  View,
  type GestureResponderEvent,
  type PressableProps,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import { Colors, Radii, Shadows, Spacing, Typography } from '@/constants/theme';
import { Text } from '@/components/ui/text';

export type ButtonVariant = 'primary' | 'secondary' | 'accent' | 'ghost';
export type ButtonSize = 'sm' | 'md' | 'lg';

export type ButtonProps = Omit<PressableProps, 'children' | 'style'> & {
  label: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
  fullWidth?: boolean;
  leadingIcon?: React.ReactNode;
  trailingIcon?: React.ReactNode;
  style?: StyleProp<ViewStyle>;
};

export function Button({
  label,
  variant = 'primary',
  size = 'md',
  fullWidth = false,
  leadingIcon,
  trailingIcon,
  disabled,
  onPressIn,
  style,
  ...rest
}: ButtonProps) {
  const handlePressIn = (event: GestureResponderEvent) => {
    if (process.env.EXPO_OS === 'ios' && !disabled) {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    }
    onPressIn?.(event);
  };

  const labelColor =
    variant === 'primary'
      ? Colors.textOnPrimary
      : variant === 'secondary'
        ? Colors.textOnSecondary
        : variant === 'accent'
          ? Colors.textOnAccent
          : Colors.text;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: !!disabled }}
      onPressIn={handlePressIn}
      disabled={disabled}
      style={({ pressed }) => [
        styles.base,
        sizeStyles[size],
        variantStyles[variant],
        fullWidth && styles.fullWidth,
        pressed && !disabled && styles.pressed,
        disabled && styles.disabled,
        style,
      ]}
      {...rest}>
      {leadingIcon ? <View style={styles.iconSlot}>{leadingIcon}</View> : null}
      <Text
        style={[Typography.button, styles.label, sizeLabelStyles[size], { color: labelColor }]}>
        {label}
      </Text>
      {trailingIcon ? <View style={styles.iconSlot}>{trailingIcon}</View> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: Radii.pill,
    gap: Spacing.sm,
    ...Shadows.sm,
  },
  fullWidth: { alignSelf: 'stretch' },
  pressed: { opacity: 0.92, transform: [{ scale: 0.98 }] },
  disabled: { opacity: 0.45, shadowOpacity: 0 },
  iconSlot: { alignItems: 'center', justifyContent: 'center' },
  label: {
    includeFontPadding: false,
    textAlignVertical: 'center',
    transform: [{ translateY: -2 }],
  },
});

const sizeStyles = StyleSheet.create({
  sm: { paddingVertical: Spacing.sm + 2, paddingHorizontal: Spacing.lg },
  md: { paddingVertical: Spacing.md + 2, paddingHorizontal: Spacing.xl },
  lg: { paddingVertical: Spacing.lg, paddingHorizontal: Spacing.xxl },
});

const sizeLabelStyles = StyleSheet.create({
  sm: { fontSize: 14, lineHeight: 18 },
  md: { fontSize: 16, lineHeight: 20 },
  lg: { fontSize: 18, lineHeight: 22 },
});

const variantStyles = StyleSheet.create({
  primary: {
    backgroundColor: Colors.primary,
  },
  secondary: {
    backgroundColor: Colors.secondary,
  },
  accent: {
    backgroundColor: Colors.accent,
  },
  ghost: {
    backgroundColor: 'transparent',
    borderWidth: 1.5,
    borderColor: Colors.text,
    shadowOpacity: 0,
    elevation: 0,
  },
});
