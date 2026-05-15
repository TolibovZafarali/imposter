import { SafeAreaView, type Edge } from 'react-native-safe-area-context';
import { StyleSheet, View, type ViewProps } from 'react-native';

import { Colors, Spacing } from '@/constants/theme';

export type ScreenProps = ViewProps & {
  /** Pad horizontal edges. Defaults to `Spacing.xl`. */
  padded?: boolean;
  /** Apply safe-area insets. Defaults to true. */
  safe?: boolean;
  /** Safe-area edges to honor. Defaults to top and horizontal edges. */
  edges?: Edge[];
};

const DEFAULT_SAFE_EDGES: Edge[] = ['top', 'left', 'right'];

export function Screen({
  edges = DEFAULT_SAFE_EDGES,
  padded = true,
  safe = true,
  style,
  children,
  ...rest
}: ScreenProps) {
  if (safe) {
    return (
      <SafeAreaView
        edges={edges}
        style={[styles.root, padded && styles.padded, style]}
        {...rest}>
        {children}
      </SafeAreaView>
    );
  }

  return (
    <View
      style={[styles.root, padded && styles.padded, style]}
      {...rest}>
      {children}
    </View>
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
