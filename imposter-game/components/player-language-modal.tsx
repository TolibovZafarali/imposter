import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { useMemo, useRef, useState } from 'react';
import {
  AccessibilityInfo, findNodeHandle, FlatList, KeyboardAvoidingView, Modal,
  Platform, Pressable, StyleSheet, Text as RNText, TextInput, View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { LanguageFlag } from '@/components/language-flag';
import { Text } from '@/components/ui/text';
import { LANGUAGES, type LanguageOption } from '@/constants/languages';
import { Colors, Radii, Spacing, Typography } from '@/constants/theme';
import { useAccessibilitySettings } from '@/hooks/use-accessibility-settings';

type Props = {
  playerName: string;
  selectedLanguageId: string;
  onSelect: (language: LanguageOption) => void;
  onDismiss: () => void;
};

export function PlayerLanguageModal({ playerName, selectedLanguageId, onSelect, onDismiss }: Props) {
  const [query, setQuery] = useState('');
  const headingRef = useRef<RNText>(null);
  const { reduceMotion } = useAccessibilitySettings();
  const insets = useSafeAreaInsets();
  const languages = useMemo(() => {
    const search = query.trim().toLocaleLowerCase();
    return LANGUAGES.filter((language) =>
      `${language.name} ${language.nativeName}`.toLocaleLowerCase().includes(search));
  }, [query]);

  const focusHeading = () => {
    if (Platform.OS === 'web') {
      (headingRef.current as unknown as { focus?: () => void })?.focus?.();
      return;
    }
    const node = findNodeHandle(headingRef.current);
    if (node) AccessibilityInfo.setAccessibilityFocus(node);
  };

  return (
    <Modal transparent visible animationType={reduceMotion ? 'none' : 'slide'}
      onRequestClose={onDismiss} onShow={focusHeading} statusBarTranslucent>
      <KeyboardAvoidingView style={styles.overlay} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onDismiss}
          accessible={false} focusable={false} importantForAccessibility="no" />
        <View style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, Spacing.lg) }]}
          accessibilityViewIsModal onAccessibilityEscape={onDismiss}>
          <View style={styles.handle} accessible={false} />
          <View style={styles.header}>
            <RNText ref={headingRef} accessibilityRole="header" tabIndex={-1} style={styles.heading}>
              {playerName}’s language
            </RNText>
            <Pressable accessibilityRole="button" accessibilityLabel="Close language selection"
              onPress={onDismiss} style={styles.iconButton}>
              <MaterialIcons name="close" size={24} color={Colors.text} />
            </Pressable>
          </View>
          <View style={styles.search}>
            <MaterialIcons name="search" size={22} color={Colors.muted} />
            <TextInput accessibilityLabel="Search languages" placeholder="Search languages"
              placeholderTextColor={Colors.muted} value={query} onChangeText={setQuery}
              autoCapitalize="none" autoCorrect={false} returnKeyType="search" style={styles.input} />
            {query ? <Pressable accessibilityRole="button" accessibilityLabel="Clear language search"
              onPress={() => setQuery('')} style={styles.iconButton}>
              <MaterialIcons name="close" size={20} color={Colors.muted} />
            </Pressable> : null}
          </View>
          <FlatList data={languages} keyExtractor={(language) => language.id}
            accessibilityRole="radiogroup" accessibilityLabel="Player language"
            style={styles.list} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag"
            contentContainerStyle={styles.listContent}
            renderItem={({ item }) => {
              const selected = item.id === selectedLanguageId;
              return (
                <Pressable accessibilityRole="radio"
                  accessibilityLabel={`Choose ${item.name}, ${item.nativeName}`}
                  aria-checked={selected} onPress={() => onSelect(item)}
                  style={({ pressed }) => [styles.row, selected && styles.selectedRow, pressed && styles.pressed]}>
                  <LanguageFlag language={item} />
                  <View style={styles.names}>
                    <Text variant="bodyEmphasis">{item.name}</Text>
                    <Text variant="bodySmall" color="muted">{item.nativeName}</Text>
                  </View>
                  {selected ? <MaterialIcons name="check" size={24} color={Colors.primary} /> : null}
                </Pressable>
              );
            }}
            ListEmptyComponent={<Text align="center" color="muted" style={styles.empty}>No languages found</Text>} />
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, justifyContent: 'flex-end', alignItems: 'center', backgroundColor: Colors.overlay },
  sheet: { width: '100%', maxWidth: 520, height: '78%', maxHeight: 720, backgroundColor: Colors.card,
    borderTopLeftRadius: Radii.xl, borderTopRightRadius: Radii.xl, paddingHorizontal: Spacing.lg },
  handle: { width: 36, height: 4, borderRadius: 2, backgroundColor: Colors.border, alignSelf: 'center', marginVertical: Spacing.sm },
  header: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, paddingBottom: Spacing.sm },
  heading: { ...Typography.heading, flex: 1, minWidth: 0 },
  iconButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  search: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, borderWidth: 1,
    borderColor: Colors.border, borderRadius: Radii.lg, paddingLeft: Spacing.md, marginBottom: Spacing.md },
  input: { ...Typography.body, flex: 1, minWidth: 0, height: 48, paddingVertical: 0 },
  list: { flex: 1 },
  listContent: { gap: Spacing.sm, paddingBottom: Spacing.sm },
  row: { minHeight: 66, flexDirection: 'row', alignItems: 'center', gap: Spacing.md,
    padding: Spacing.md, borderWidth: 1, borderColor: Colors.border, borderRadius: Radii.lg },
  selectedRow: { borderColor: Colors.primary, backgroundColor: Colors.redSurface },
  pressed: { opacity: 0.7 },
  names: { flex: 1, minWidth: 0, gap: 2 },
  empty: { paddingVertical: Spacing.xl },
});
