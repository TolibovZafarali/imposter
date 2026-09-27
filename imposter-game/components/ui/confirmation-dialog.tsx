import { Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button } from '@/components/ui/button';
import { Text } from '@/components/ui/text';
import { Colors, Radii, Shadows, Spacing } from '@/constants/theme';
import { useAccessibilitySettings } from '@/hooks/use-accessibility-settings';

type DialogAction = {
  label: string;
  onPress: () => void;
};

type ConfirmationDialogProps = {
  visible: boolean;
  title: string;
  description: string;
  primaryAction: DialogAction & { neutral?: boolean };
  secondaryAction: DialogAction & { destructive?: boolean };
  onDismiss: () => void;
};

export function ConfirmationDialog({
  visible,
  title,
  description,
  primaryAction,
  secondaryAction,
  onDismiss,
}: ConfirmationDialogProps) {
  const { reduceMotion } = useAccessibilitySettings();

  return (
    <Modal
      visible={visible}
      transparent
      animationType={reduceMotion ? 'none' : 'fade'}
      statusBarTranslucent
      navigationBarTranslucent
      onRequestClose={onDismiss}>
      <SafeAreaView style={styles.overlay}>
        <ScrollView bounces={false} contentContainerStyle={styles.viewport}>
          <View
            style={styles.dialog}
            accessibilityViewIsModal
            onAccessibilityEscape={onDismiss}>
            <View style={styles.copy}>
              <Text variant="title" accessibilityRole="header" style={styles.title}>
                {title}
              </Text>
              <Text variant="body" color="muted">
                {description}
              </Text>
            </View>
            <View style={styles.actions}>
              <Button
                label={primaryAction.label}
                fullWidth
                style={[styles.primaryButton, primaryAction.neutral && styles.neutralButton]}
                onPress={primaryAction.onPress}
              />
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={secondaryAction.label}
                onPress={secondaryAction.onPress}
                style={({ pressed }) => [
                  styles.secondaryButton,
                  pressed && (secondaryAction.destructive ? styles.destructiveButtonPressed : styles.secondaryButtonPressed),
                ]}>
                <Text variant="bodyEmphasis" color={secondaryAction.destructive ? 'primary' : 'text'} align="center">
                  {secondaryAction.label}
                </Text>
              </Pressable>
            </View>
          </View>
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: Colors.overlay },
  viewport: { flexGrow: 1, justifyContent: 'center', alignItems: 'center', padding: Spacing.xl },
  dialog: {
    width: '100%',
    maxWidth: 360,
    padding: Spacing.xl,
    gap: Spacing.xl,
    borderRadius: Radii.xl,
    backgroundColor: Colors.card,
    ...Shadows.lg,
  },
  copy: { gap: Spacing.sm },
  title: { fontSize: 24, lineHeight: 30, letterSpacing: -0.5 },
  actions: { gap: Spacing.md },
  primaryButton: { minHeight: 52, borderRadius: Radii.lg },
  neutralButton: { backgroundColor: Colors.text },
  secondaryButton: {
    minHeight: 52,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
    borderRadius: Radii.lg,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  secondaryButtonPressed: { backgroundColor: Colors.surface },
  destructiveButtonPressed: { backgroundColor: Colors.redSurface, borderColor: Colors.redBorder },
});
