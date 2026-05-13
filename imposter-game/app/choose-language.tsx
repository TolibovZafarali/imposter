import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import type { ComponentProps } from 'react';
import { FlatList, Pressable, StyleSheet, TextInput, View } from 'react-native';

import { Screen } from '@/components/ui/screen';
import { Text } from '@/components/ui/text';
import { LANGUAGES, type LanguageOption } from '@/constants/languages';
import { Colors, Radii, Spacing, Typography } from '@/constants/theme';
import { useLanguageSettings } from '@/contexts/language-settings';

type MaterialIconName = ComponentProps<typeof MaterialIcons>['name'];

const BACK_ICON: MaterialIconName = 'arrow-back-ios-new';
const SEARCH_ICON: MaterialIconName = 'search';
const CLEAR_ICON: MaterialIconName = 'close';
const CHECK_ICON: MaterialIconName = 'check';

const normalizeSearchText = (text: string) => text.trim().toLocaleLowerCase();

export default function ChooseLanguageScreen() {
  const router = useRouter();
  const { selectedLanguageId, setSelectedLanguageId } = useLanguageSettings();
  const [searchQuery, setSearchQuery] = useState('');

  const filteredLanguages = useMemo(() => {
    const query = normalizeSearchText(searchQuery);

    if (!query) {
      return LANGUAGES;
    }

    return LANGUAGES.filter((language) => {
      const name = language.name.toLocaleLowerCase();
      const nativeName = language.nativeName.toLocaleLowerCase();

      return name.includes(query) || nativeName.includes(query);
    });
  }, [searchQuery]);

  const chooseLanguage = (language: LanguageOption) => {
    setSelectedLanguageId(language.id);
    router.back();
  };

  const renderLanguage = ({ item }: { item: LanguageOption }) => {
    const isSelected = item.id === selectedLanguageId;

    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Choose ${item.name}, ${item.nativeName}`}
        accessibilityState={{ selected: isSelected }}
        onPress={() => chooseLanguage(item)}
        style={({ pressed }) => [
          styles.languageRow,
          isSelected && styles.languageRowSelected,
          pressed && styles.languageRowPressed,
        ]}>
        <View style={styles.languageTextGroup}>
          <Text variant="bodyEmphasis" numberOfLines={1} style={styles.languageName}>
            {item.name}
          </Text>
          <Text
            variant="bodySmall"
            numberOfLines={1}
            adjustsFontSizeToFit
            minimumFontScale={0.82}
            style={styles.languageNativeName}>
            {item.nativeName}
          </Text>
        </View>
        {isSelected ? (
          <View style={styles.checkBadge}>
            <MaterialIcons name={CHECK_ICON} size={18} color={Colors.textOnPrimary} />
          </View>
        ) : null}
      </Pressable>
    );
  };

  return (
    <Screen style={styles.screen}>
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
          Choose language
        </Text>
      </View>

      <View style={styles.searchBox}>
        <MaterialIcons name={SEARCH_ICON} size={21} color={Colors.muted} />
        <TextInput
          autoCapitalize="none"
          autoCorrect={false}
          clearButtonMode="never"
          placeholder="Search languages"
          placeholderTextColor={Colors.muted}
          returnKeyType="search"
          value={searchQuery}
          onChangeText={setSearchQuery}
          style={styles.searchInput}
        />
        {searchQuery ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Clear search"
            hitSlop={8}
            onPress={() => setSearchQuery('')}
            style={({ pressed }) => [styles.clearButton, pressed && styles.iconButtonPressed]}>
            <MaterialIcons name={CLEAR_ICON} size={20} color={Colors.text} />
          </Pressable>
        ) : null}
      </View>

      <FlatList
        data={filteredLanguages}
        keyExtractor={(language) => language.id}
        renderItem={renderLanguage}
        keyboardDismissMode="on-drag"
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.listContent}
        ListEmptyComponent={
          <View style={styles.emptyState}>
            <Text variant="bodyEmphasis" align="center">
              No languages found
            </Text>
          </View>
        }
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    paddingTop: Spacing.lg,
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
    backgroundColor: 'rgba(250, 247, 242, 0.08)',
  },
  iconButtonPressed: {
    opacity: 0.72,
    transform: [{ scale: 0.96 }],
  },
  title: {
    flex: 1,
  },
  searchBox: {
    width: '100%',
    maxWidth: 520,
    minHeight: 50,
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: Radii.pill,
    backgroundColor: 'rgba(250, 247, 242, 0.06)',
    paddingLeft: Spacing.lg,
    paddingRight: Spacing.sm,
    marginBottom: Spacing.lg,
  },
  searchInput: {
    ...Typography.body,
    flex: 1,
    minWidth: 0,
    height: 48,
    padding: 0,
    color: Colors.text,
  },
  clearButton: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: Radii.pill,
    backgroundColor: 'rgba(250, 247, 242, 0.08)',
  },
  listContent: {
    width: '100%',
    maxWidth: 520,
    alignSelf: 'center',
    paddingBottom: Spacing.xxxl,
    gap: Spacing.sm,
  },
  languageRow: {
    minHeight: 68,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: Radii.lg,
    backgroundColor: 'rgba(250, 247, 242, 0.05)',
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.lg,
  },
  languageRowSelected: {
    borderColor: Colors.primary,
    backgroundColor: 'rgba(182, 25, 46, 0.16)',
  },
  languageRowPressed: {
    opacity: 0.82,
    transform: [{ scale: 0.99 }],
  },
  languageTextGroup: {
    flex: 1,
    minWidth: 0,
    gap: Spacing.xs,
  },
  languageName: {
    includeFontPadding: false,
  },
  languageNativeName: {
    color: Colors.muted,
    includeFontPadding: false,
  },
  checkBadge: {
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: Radii.pill,
    backgroundColor: Colors.primary,
  },
  emptyState: {
    minHeight: 180,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
