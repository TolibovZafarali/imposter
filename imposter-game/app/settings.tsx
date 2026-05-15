import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import type { ComponentProps } from 'react';
import {
  Animated as RNAnimated,
  Pressable,
  ScrollView,
  StyleSheet,
  Text as RNText,
  View,
} from 'react-native';

import { Screen } from '@/components/ui/screen';
import { Text } from '@/components/ui/text';
import { getLanguageFlagEmoji } from '@/constants/languages';
import { Colors, Radii, Spacing } from '@/constants/theme';
import { useGame } from '@/contexts/game-context';
import { useLanguageSettings } from '@/contexts/language-settings';
import {
  formatRoundTimerSetting,
  getMaxImposterCount,
  MIN_PLAYERS_FOR_TWO_IMPOSTERS,
  ROUND_TIMER_MINUTE_OPTIONS,
} from '@/game/setupRules';
import type { ImposterCount, RoundTimerSetting } from '@/game/types';

type MaterialIconName = ComponentProps<typeof MaterialIcons>['name'];

const BACK_ICON: MaterialIconName = 'arrow-back-ios-new';
const LANGUAGE_ICON: MaterialIconName = 'language';
const CHEVRON_ICON: MaterialIconName = 'chevron-right';
const IMPOSTERS_ICON: MaterialIconName = 'groups';
const HINT_ICON: MaterialIconName = 'tips-and-updates';
const TIMER_ICON: MaterialIconName = 'timer';
const CHECK_ICON: MaterialIconName = 'check';
const DROPDOWN_OPEN_ICON: MaterialIconName = 'keyboard-arrow-up';
const DROPDOWN_CLOSED_ICON: MaterialIconName = 'keyboard-arrow-down';
const IMPOSTER_COUNT_OPTIONS: ImposterCount[] = [1, 2];
const IMPOSTER_COUNT_OPTION_WIDTH = 38;
const IMPOSTER_COUNT_SWITCH_GAP = Spacing.xs;
const IMPOSTER_COUNT_SWITCH_PADDING = Spacing.xs;
const HINT_TOGGLE_WIDTH = 54;
const HINT_TOGGLE_HEIGHT = 32;
const HINT_TOGGLE_PADDING = 3;
const HINT_TOGGLE_THUMB_SIZE = HINT_TOGGLE_HEIGHT - HINT_TOGGLE_PADDING * 2;
const HINT_TOGGLE_TRAVEL = HINT_TOGGLE_WIDTH - HINT_TOGGLE_THUMB_SIZE - HINT_TOGGLE_PADDING * 2;
const TIMER_DROPDOWN_OPTIONS: RoundTimerSetting[] = [null, ...ROUND_TIMER_MINUTE_OPTIONS];

export default function SettingsScreen() {
  const router = useRouter();
  const { selectedLanguage } = useLanguageSettings();
  const { setupPreferences, updateSetupPreferences } = useGame();
  const [isTimerDropdownOpen, setIsTimerDropdownOpen] = useState(false);
  const imposterCountSlideValue = useRef(new RNAnimated.Value(0)).current;
  const { players, imposterCount, isImposterHintEnabled, roundTimerMinutes } = setupPreferences;
  const hintToggleSlideValue = useRef(
    new RNAnimated.Value(isImposterHintEnabled ? HINT_TOGGLE_TRAVEL : 0)
  ).current;
  const maxImposterCount = getMaxImposterCount(players.length);
  const isTwoImpostersAvailable = maxImposterCount === 2;

  useEffect(() => {
    const selectedImposterCountIndex = Math.max(
      IMPOSTER_COUNT_OPTIONS.indexOf(imposterCount),
      0
    );

    RNAnimated.spring(imposterCountSlideValue, {
      toValue:
        selectedImposterCountIndex * (IMPOSTER_COUNT_OPTION_WIDTH + IMPOSTER_COUNT_SWITCH_GAP),
      damping: 18,
      mass: 0.8,
      stiffness: 180,
      useNativeDriver: true,
    }).start();
  }, [imposterCount, imposterCountSlideValue]);

  useEffect(() => {
    RNAnimated.spring(hintToggleSlideValue, {
      toValue: isImposterHintEnabled ? HINT_TOGGLE_TRAVEL : 0,
      damping: 18,
      mass: 0.8,
      stiffness: 180,
      useNativeDriver: true,
    }).start();
  }, [hintToggleSlideValue, isImposterHintEnabled]);

  const updateImposterCount = (nextImposterCount: ImposterCount) => {
    updateSetupPreferences({ imposterCount: nextImposterCount });
  };

  const toggleImposterHint = () => {
    updateSetupPreferences({ isImposterHintEnabled: !isImposterHintEnabled });
  };

  const updateRoundTimer = (nextRoundTimerMinutes: RoundTimerSetting) => {
    updateSetupPreferences({ roundTimerMinutes: nextRoundTimerMinutes });
    setIsTimerDropdownOpen(false);
  };

  return (
    <Screen style={styles.screen}>
      <ScrollView
        alwaysBounceVertical={false}
        showsVerticalScrollIndicator={false}
        style={styles.scroll}
        contentContainerStyle={styles.content}>
        <View style={styles.header}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Back"
            hitSlop={8}
            onPress={() => router.back()}
            style={({ pressed }) => [styles.headerIconButton, pressed && styles.iconButtonPressed]}>
            <MaterialIcons name={BACK_ICON} size={21} color={Colors.text} />
          </Pressable>
          <Text variant="heading" color="primary" style={styles.title}>
            Settings
          </Text>
        </View>

        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Change language, current language ${selectedLanguage.name}`}
          onPress={() => router.push('/choose-language')}
          style={({ pressed }) => [styles.settingRow, pressed && styles.settingRowPressed]}>
          <View style={styles.settingIconBadge}>
            <MaterialIcons name={LANGUAGE_ICON} size={22} color={Colors.primary} />
          </View>
          <View style={styles.settingTextGroup}>
            <Text variant="bodyEmphasis" numberOfLines={1} style={styles.settingLabel}>
              Language
            </Text>
            <Text
              variant="bodySmall"
              numberOfLines={1}
              adjustsFontSizeToFit
              minimumFontScale={0.82}
              style={styles.settingValue}>
              {selectedLanguage.name}
            </Text>
          </View>
          <RNText allowFontScaling={false} style={styles.languageFlagIcon}>
            {getLanguageFlagEmoji(selectedLanguage)}
          </RNText>
          <MaterialIcons name={CHEVRON_ICON} size={24} color={Colors.muted} />
        </Pressable>

        <View style={styles.settingRow}>
          <View style={styles.settingIconBadge}>
            <MaterialIcons name={IMPOSTERS_ICON} size={22} color={Colors.primary} />
          </View>
          <View style={styles.settingTextGroup}>
            <Text variant="bodyEmphasis" numberOfLines={1} style={styles.settingLabel}>
              Imposters
            </Text>
            <Text
              variant="bodySmall"
              numberOfLines={1}
              adjustsFontSizeToFit
              minimumFontScale={0.82}
              style={styles.settingValue}>
              {isTwoImpostersAvailable
                ? `${imposterCount} selected`
                : `${MIN_PLAYERS_FOR_TWO_IMPOSTERS}+ players for 2`}
            </Text>
          </View>
          <View style={styles.countControl}>
            <RNAnimated.View
              pointerEvents="none"
              style={[
                styles.countIndicator,
                {
                  transform: [{ translateX: imposterCountSlideValue }],
                },
              ]}
            />
            {IMPOSTER_COUNT_OPTIONS.map((countOption) => {
              const isSelected = imposterCount === countOption;
              const isDisabled = countOption > maxImposterCount;

              return (
                <Pressable
                  key={countOption}
                  accessibilityRole="button"
                  accessibilityLabel={
                    isDisabled
                      ? `${countOption} imposters requires at least ${MIN_PLAYERS_FOR_TWO_IMPOSTERS} players`
                      : `Use ${countOption} ${countOption === 1 ? 'imposter' : 'imposters'}`
                  }
                  accessibilityState={{ selected: isSelected, disabled: isDisabled }}
                  disabled={isDisabled}
                  onPress={() => updateImposterCount(countOption)}
                  style={({ pressed }) => [
                    styles.countOption,
                    isDisabled && styles.countOptionDisabled,
                    pressed && !isDisabled && styles.countOptionPressed,
                  ]}>
                  <Text
                    variant="bodyEmphasis"
                    align="center"
                    style={[styles.countOptionText, isSelected && styles.countOptionTextSelected]}>
                    {countOption}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>

        <Pressable
          accessibilityRole="switch"
          accessibilityLabel={`Imposter hint, currently ${isImposterHintEnabled ? 'on' : 'off'}`}
          accessibilityState={{ checked: isImposterHintEnabled }}
          onPress={toggleImposterHint}
          style={({ pressed }) => [styles.settingRow, pressed && styles.settingRowPressed]}>
          <View style={styles.settingIconBadge}>
            <MaterialIcons name={HINT_ICON} size={22} color={Colors.primary} />
          </View>
          <View style={styles.settingTextGroup}>
            <Text variant="bodyEmphasis" numberOfLines={1} style={styles.settingLabel}>
              Imposter hint
            </Text>
            <Text
              variant="bodySmall"
              numberOfLines={1}
              adjustsFontSizeToFit
              minimumFontScale={0.82}
              style={styles.settingValue}>
              {isImposterHintEnabled ? 'Shown to imposters' : 'Hidden from imposters'}
            </Text>
          </View>
          <View
            style={[
              styles.hintToggle,
              isImposterHintEnabled && styles.hintToggleEnabled,
            ]}>
            <RNAnimated.View
              style={[
                styles.hintToggleThumb,
                {
                  transform: [{ translateX: hintToggleSlideValue }],
                },
              ]}
            />
          </View>
        </Pressable>

        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Round timer, current setting ${formatRoundTimerSetting(roundTimerMinutes)}`}
          accessibilityState={{ expanded: isTimerDropdownOpen }}
          onPress={() => setIsTimerDropdownOpen((isOpen) => !isOpen)}
          style={({ pressed }) => [
            styles.settingRow,
            isTimerDropdownOpen && styles.settingRowOpen,
            pressed && styles.settingRowPressed,
          ]}>
          <View style={styles.settingIconBadge}>
            <MaterialIcons name={TIMER_ICON} size={22} color={Colors.primary} />
          </View>
          <View style={styles.settingTextGroup}>
            <Text variant="bodyEmphasis" numberOfLines={1} style={styles.settingLabel}>
              Round timer
            </Text>
            <Text
              variant="bodySmall"
              numberOfLines={1}
              adjustsFontSizeToFit
              minimumFontScale={0.82}
              style={styles.settingValue}>
              {formatRoundTimerSetting(roundTimerMinutes)}
            </Text>
          </View>
          <MaterialIcons
            name={isTimerDropdownOpen ? DROPDOWN_OPEN_ICON : DROPDOWN_CLOSED_ICON}
            size={26}
            color={Colors.muted}
          />
        </Pressable>

        {isTimerDropdownOpen ? (
          <View style={styles.timerDropdown}>
            {TIMER_DROPDOWN_OPTIONS.map((timerOption) => {
              const isSelected = timerOption === roundTimerMinutes;
              const optionLabel = formatRoundTimerSetting(timerOption);

              return (
                <Pressable
                  key={timerOption ?? 'none'}
                  accessibilityRole="button"
                  accessibilityLabel={`Set round timer to ${optionLabel}`}
                  accessibilityState={{ selected: isSelected }}
                  onPress={() => updateRoundTimer(timerOption)}
                  style={({ pressed }) => [
                    styles.timerOption,
                    isSelected && styles.timerOptionSelected,
                    pressed && styles.timerOptionPressed,
                  ]}>
                  <Text
                    variant="bodyEmphasis"
                    numberOfLines={1}
                    style={[styles.timerOptionText, isSelected && styles.timerOptionTextSelected]}>
                    {optionLabel}
                  </Text>
                  {isSelected ? (
                    <MaterialIcons name={CHECK_ICON} size={20} color={Colors.primary} />
                  ) : null}
                </Pressable>
              );
            })}
          </View>
        ) : null}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
  scroll: {
    flex: 1,
  },
  content: {
    paddingTop: Spacing.lg,
    paddingBottom: Spacing.xxxl,
  },
  header: {
    width: '100%',
    maxWidth: 520,
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    paddingBottom: Spacing.lg,
  },
  headerIconButton: {
    width: 42,
    height: 42,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: Radii.pill,
    backgroundColor: Colors.surface,
  },
  iconButtonPressed: {
    opacity: 0.72,
    transform: [{ scale: 0.96 }],
  },
  title: {
    flex: 1,
  },
  settingRow: {
    width: '100%',
    maxWidth: 520,
    minHeight: 72,
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: Radii.lg,
    backgroundColor: Colors.surfaceRaised,
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.lg,
    marginBottom: Spacing.sm,
  },
  settingRowPressed: {
    opacity: 0.82,
    transform: [{ scale: 0.99 }],
  },
  settingRowOpen: {
    borderColor: Colors.redBorder,
  },
  settingIconBadge: {
    width: 42,
    height: 42,
    flexShrink: 0,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: Radii.pill,
    backgroundColor: Colors.redSurface,
  },
  settingTextGroup: {
    flex: 1,
    minWidth: 0,
    gap: Spacing.xs,
  },
  settingLabel: {
    includeFontPadding: false,
    textAlignVertical: 'center',
    transform: [{ translateY: -2 }],
  },
  settingValue: {
    color: Colors.muted,
    includeFontPadding: false,
    textAlignVertical: 'center',
    transform: [{ translateY: -2 }],
  },
  languageFlagIcon: {
    width: 34,
    fontSize: 26,
    lineHeight: 30,
    includeFontPadding: false,
    textAlign: 'right',
    textAlignVertical: 'center',
  },
  countControl: {
    flexShrink: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: IMPOSTER_COUNT_SWITCH_GAP,
    overflow: 'hidden',
    position: 'relative',
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: Radii.pill,
    backgroundColor: Colors.surface,
    padding: IMPOSTER_COUNT_SWITCH_PADDING,
  },
  countIndicator: {
    position: 'absolute',
    top: IMPOSTER_COUNT_SWITCH_PADDING,
    bottom: IMPOSTER_COUNT_SWITCH_PADDING,
    left: IMPOSTER_COUNT_SWITCH_PADDING,
    width: IMPOSTER_COUNT_OPTION_WIDTH,
    borderRadius: Radii.pill,
    backgroundColor: Colors.primary,
  },
  countOption: {
    width: IMPOSTER_COUNT_OPTION_WIDTH,
    height: 34,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: Radii.pill,
    zIndex: 1,
  },
  countOptionDisabled: {
    opacity: 0.38,
  },
  countOptionPressed: {
    opacity: 0.82,
    transform: [{ scale: 0.96 }],
  },
  countOptionText: {
    lineHeight: 20,
    color: Colors.muted,
    includeFontPadding: false,
    textAlignVertical: 'center',
    transform: [{ translateY: -2 }],
  },
  countOptionTextSelected: {
    color: Colors.textOnPrimary,
  },
  hintToggle: {
    width: HINT_TOGGLE_WIDTH,
    height: HINT_TOGGLE_HEIGHT,
    flexShrink: 0,
    justifyContent: 'center',
    borderRadius: Radii.pill,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.surface,
    padding: HINT_TOGGLE_PADDING,
  },
  hintToggleEnabled: {
    borderColor: Colors.primary,
    backgroundColor: Colors.primary,
  },
  hintToggleThumb: {
    width: HINT_TOGGLE_THUMB_SIZE,
    height: HINT_TOGGLE_THUMB_SIZE,
    borderRadius: Radii.pill,
    backgroundColor: Colors.textOnPrimary,
  },
  timerDropdown: {
    width: '100%',
    maxWidth: 520,
    alignSelf: 'center',
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: Radii.lg,
    backgroundColor: Colors.surfaceRaised,
    marginTop: -Spacing.xs,
    marginBottom: Spacing.sm,
  },
  timerOption: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.md,
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.lg,
  },
  timerOptionSelected: {
    backgroundColor: Colors.redSurface,
  },
  timerOptionPressed: {
    opacity: 0.84,
  },
  timerOptionText: {
    flex: 1,
    minWidth: 0,
    lineHeight: 20,
    includeFontPadding: false,
    textAlignVertical: 'center',
    transform: [{ translateY: -2 }],
  },
  timerOptionTextSelected: {
    color: Colors.primary,
  },
});
