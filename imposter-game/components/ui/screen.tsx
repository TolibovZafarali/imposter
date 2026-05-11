import { SafeAreaView } from 'react-native-safe-area-context';
import { StyleSheet, View, type ViewProps } from 'react-native';

import { Colors, Spacing } from '@/constants/theme';

export type ScreenProps = ViewProps & {
  /** Pad horizontal edges. Defaults to `Spacing.xl`. */
  padded?: boolean;
  /** Apply safe-area insets. Defaults to true. */
  safe?: boolean;
};

export function Screen({
  padded = true,
  safe = true,
  style,
  children,
  ...rest
}: ScreenProps) {
  const Container = safe ? SafeAreaView : View;
  return (
    <Container
      style={[styles.root, padded && styles.padded, style]}
      {...rest}>
      {children}
    </Container>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  padded: {
    paddingHorizontal: Spacing.xl,
  },
});
