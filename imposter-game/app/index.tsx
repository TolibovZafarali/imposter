import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { Image } from 'expo-image';
import type { ComponentProps } from 'react';
import { Platform, StyleSheet, View, type ViewStyle } from 'react-native';

import { Screen } from '@/components/ui/screen';
import { Text } from '@/components/ui/text';
import { Colors, Radii, Shadows, Spacing } from '@/constants/theme';

type MaterialIconName = ComponentProps<typeof MaterialIcons>['name'];

type HomeAction = {
  label: string;
  icon: MaterialIconName;
  variant: 'primary' | 'secondary';
};

const HOME_ACTIONS: HomeAction[] = [
  { label: 'Play', icon: 'play-arrow', variant: 'primary' },
  { label: 'How to Play', icon: 'menu-book', variant: 'secondary' },
  { label: 'Settings', icon: 'tune', variant: 'secondary' },
];

const primaryActionShadow: ViewStyle =
  Platform.OS === 'web'
    ? ({ boxShadow: '0px 10px 24px rgba(0, 0, 0, 0.32)' } as unknown as ViewStyle)
    : Shadows.md;

const secondaryActionShadow: ViewStyle =
  Platform.OS === 'web'
    ? ({ boxShadow: '0px 6px 18px rgba(0, 0, 0, 0.2)' } as unknown as ViewStyle)
    : Shadows.sm;

export default function HomeScreen() {
  return (
    <Screen style={styles.screen}>
      <View style={styles.brand}>
        <Image
          source={require('@/assets/images/imposter-logo.png')}
          style={styles.logo}
          contentFit="contain"
          accessibilityLabel="Imposter"
        />
        <Text variant="display" align="center">
          Imposter
        </Text>
      </View>

      <View style={styles.actions}>
        {HOME_ACTIONS.map((action) => {
          const isPrimary = action.variant === 'primary';

          return (
            <View
              key={action.label}
              style={[styles.actionRow, isPrimary ? styles.primaryAction : styles.secondaryAction]}>
              <View style={[styles.iconBadge, isPrimary ? styles.primaryIcon : styles.secondaryIcon]}>
                <MaterialIcons
                  name={action.icon}
                  size={24}
                  color={isPrimary ? Colors.textOnPrimary : Colors.primary}
                />
              </View>
              <Text
                variant="subheading"
                color={isPrimary ? 'textOnPrimary' : 'text'}
                style={styles.actionLabel}>
                {action.label}
              </Text>
            </View>
          );
        })}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  screen: {
    justifyContent: 'space-between',
    paddingTop: Spacing.xxxxl,
    paddingBottom: Spacing.xxxl,
  },
  brand: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  logo: {
    width: 132,
    height: 132,
    marginBottom: Spacing.xl,
  },
  actions: {
    width: '100%',
    maxWidth: 420,
    alignSelf: 'center',
    gap: Spacing.md,
  },
  actionRow: {
    minHeight: 68,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    borderRadius: Radii.xl,
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.lg,
    borderWidth: 1,
  },
  primaryAction: {
    backgroundColor: Colors.primary,
    borderColor: Colors.primary,
    ...primaryActionShadow,
  },
  secondaryAction: {
    backgroundColor: Colors.card,
    borderColor: Colors.border,
    ...secondaryActionShadow,
  },
  iconBadge: {
    width: 42,
    height: 42,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: Radii.pill,
  },
  primaryIcon: {
    backgroundColor: 'rgba(250, 247, 242, 0.16)',
  },
  secondaryIcon: {
    backgroundColor: 'rgba(182, 25, 46, 0.16)',
  },
  actionLabel: {
    flex: 1,
  },
});
