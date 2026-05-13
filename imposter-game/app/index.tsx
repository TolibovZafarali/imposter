import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import type { ComponentProps } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';

import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Screen } from '@/components/ui/screen';
import { Text } from '@/components/ui/text';
import { Colors, Radii, Spacing, Typography } from '@/constants/theme';
import { useLanguageSettings } from '@/contexts/language-settings';

type MaterialIconName = ComponentProps<typeof MaterialIcons>['name'];

type Player = {
  id: string;
  name: string;
};

type Category = {
  id: string;
  label: string;
  icon: MaterialIconName;
};

const INITIAL_PLAYERS: Player[] = [
  { id: 'player-1', name: 'Player 1' },
  { id: 'player-2', name: 'Player 2' },
  { id: 'player-3', name: 'Player 3' },
];

const CATEGORIES: Category[] = [
  { id: 'food', label: 'Food', icon: 'restaurant' },
  { id: 'animals', label: 'Animals', icon: 'pets' },
  { id: 'jobs', label: 'Jobs', icon: 'work' },
  { id: 'countries', label: 'Countries', icon: 'public' },
  { id: 'objects', label: 'Objects', icon: 'category' },
  { id: 'sports', label: 'Sports', icon: 'sports-soccer' },
  { id: 'school', label: 'School', icon: 'school' },
  { id: 'movies', label: 'Movies', icon: 'movie' },
  { id: 'celebrities', label: 'Celebrities', icon: 'star' },
  { id: 'fantasy', label: 'Fantasy', icon: 'auto-awesome' },
];

const CATEGORY_ROWS = [
  ['food', 'animals', 'jobs'],
  ['countries', 'objects'],
  ['sports', 'school', 'movies'],
  ['celebrities', 'fantasy'],
];

const CATEGORIES_BY_ID = new Map(CATEGORIES.map((category) => [category.id, category]));

const ADD_PLAYER_ICON: MaterialIconName = 'person-add-alt-1';
const REMOVE_PLAYER_ICON: MaterialIconName = 'close';
const EDIT_ICON: MaterialIconName = 'edit';
const PLAYER_ICON: MaterialIconName = 'person';
const PLAY_ICON: MaterialIconName = 'play-arrow';
const LANGUAGE_ICON: MaterialIconName = 'language';
const MIN_PLAYERS = 3;
const MAX_PLAYERS = 10;
const MAX_PLAYER_NAME_LENGTH = 10;
const MAX_SELECTED_CATEGORIES = 3;

const limitPlayerName = (name: string) => name.slice(0, MAX_PLAYER_NAME_LENGTH);

export default function HomeScreen() {
  const router = useRouter();
  const { selectedLanguage } = useLanguageSettings();
  const [players, setPlayers] = useState(INITIAL_PLAYERS);
  const [editingPlayerId, setEditingPlayerId] = useState<string | null>(null);
  const [selectedCategoryIds, setSelectedCategoryIds] = useState<string[]>([]);

  const canStartGame = selectedCategoryIds.length > 0;

  const updatePlayerName = (playerId: string, name: string) => {
    const limitedName = limitPlayerName(name);

    setPlayers((currentPlayers) =>
      currentPlayers.map((player) =>
        player.id === playerId ? { ...player, name: limitedName } : player
      )
    );
  };

  const addPlayer = () => {
    setPlayers((currentPlayers) => {
      if (currentPlayers.length >= MAX_PLAYERS) {
        return currentPlayers;
      }

      const nextPlayerNumber =
        currentPlayers.reduce((highestNumber, player) => {
          const playerNumber = Number(player.id.replace('player-', ''));

          return Number.isFinite(playerNumber)
            ? Math.max(highestNumber, playerNumber)
            : highestNumber;
        }, 0) + 1;

      return [
        ...currentPlayers,
        {
          id: `player-${nextPlayerNumber}`,
          name: limitPlayerName(`Player ${nextPlayerNumber}`),
        },
      ];
    });
  };

  const removePlayer = (playerId: string) => {
    setPlayers((currentPlayers) => {
      if (currentPlayers.length <= MIN_PLAYERS) {
        return currentPlayers;
      }

      return currentPlayers.filter((player) => player.id !== playerId);
    });

    if (editingPlayerId === playerId) {
      setEditingPlayerId(null);
    }
  };

  const finishEditing = (playerId: string) => {
    setPlayers((currentPlayers) =>
      currentPlayers.map((player, index) => {
        if (player.id !== playerId) {
          return player;
        }

        const trimmedName = player.name.trim();
        return { ...player, name: limitPlayerName(trimmedName || `Player ${index + 1}`) };
      })
    );
    setEditingPlayerId(null);
  };

  const toggleCategory = (categoryId: string) => {
    setSelectedCategoryIds((currentCategoryIds) => {
      if (currentCategoryIds.includes(categoryId)) {
        return currentCategoryIds.filter((currentCategoryId) => currentCategoryId !== categoryId);
      }

      if (currentCategoryIds.length >= MAX_SELECTED_CATEGORIES) {
        return currentCategoryIds;
      }

      return [...currentCategoryIds, categoryId];
    });
  };

  return (
    <Screen style={styles.screen}>
      <ScrollView
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}>
        <View style={styles.brand}>
          <Text variant="display" align="center" style={styles.title}>
            IMPOSTER
          </Text>
        </View>

        <Card variant="flat" style={[styles.setupBox, styles.playersBox]}>
          <View style={styles.sectionHeader}>
            <Text variant="heading" color="primary">
              Players
            </Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={
                players.length >= MAX_PLAYERS
                  ? `Maximum ${MAX_PLAYERS} players reached`
                  : 'Add player'
              }
              accessibilityState={{ disabled: players.length >= MAX_PLAYERS }}
              disabled={players.length >= MAX_PLAYERS}
              hitSlop={8}
              onPress={addPlayer}
              style={({ pressed }) => [
                styles.addPlayerButton,
                players.length >= MAX_PLAYERS && styles.addPlayerButtonDisabled,
                pressed && styles.iconButtonPressed,
              ]}>
              <MaterialIcons
                name={ADD_PLAYER_ICON}
                size={22}
                color={players.length >= MAX_PLAYERS ? Colors.muted : Colors.primary}
              />
            </Pressable>
          </View>

          <View style={styles.playersGrid}>
            {players.map((player, index) => {
              const isEditing = editingPlayerId === player.id;
              const canRemovePlayer = index >= 3;

              return (
                <View key={player.id} style={styles.playerTile}>
                  {canRemovePlayer ? (
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={`Remove ${player.name}`}
                      hitSlop={8}
                      onPress={() => removePlayer(player.id)}
                      style={({ pressed }) => [
                        styles.removeButton,
                        pressed && styles.iconButtonPressed,
                      ]}>
                      <MaterialIcons name={REMOVE_PLAYER_ICON} size={20} color={Colors.muted} />
                    </Pressable>
                  ) : null}

                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`Edit ${player.name}`}
                    hitSlop={8}
                    onPress={() => setEditingPlayerId(player.id)}
                    style={({ pressed }) => [
                      styles.editButton,
                      pressed && styles.iconButtonPressed,
                    ]}>
                    <MaterialIcons name={EDIT_ICON} size={18} color={Colors.primary} />
                  </Pressable>

                  <View style={styles.personBadge}>
                    <MaterialIcons name={PLAYER_ICON} size={34} color={Colors.text} />
                  </View>

                  <View style={styles.playerNameRow}>
                    {isEditing ? (
                      <TextInput
                        autoFocus
                        selectTextOnFocus
                        value={player.name}
                        onChangeText={(name) => updatePlayerName(player.id, name)}
                        onBlur={() => finishEditing(player.id)}
                        onSubmitEditing={() => finishEditing(player.id)}
                        returnKeyType="done"
                        maxLength={MAX_PLAYER_NAME_LENGTH}
                        placeholder={player.name}
                        placeholderTextColor={Colors.muted}
                        textAlign="center"
                        style={styles.playerInput}
                      />
                    ) : (
                      <Text
                        variant="bodyEmphasis"
                        align="center"
                        adjustsFontSizeToFit
                        minimumFontScale={0.9}
                        numberOfLines={1}
                        style={styles.playerName}>
                        {player.name}
                      </Text>
                    )}
                  </View>
                </View>
              );
            })}
          </View>
        </Card>

        <Card variant="flat" style={styles.setupBox}>
          <View style={styles.sectionHeader}>
            <Text variant="heading" color="primary">
              Categories
            </Text>
          </View>

          <View style={styles.categoriesRows}>
            {CATEGORY_ROWS.map((categoryRow) => (
              <View key={categoryRow.join('-')} style={styles.categoryRow}>
                {categoryRow.map((categoryId) => {
                  const category = CATEGORIES_BY_ID.get(categoryId);

                  if (!category) {
                    return null;
                  }

                  const isSelected = selectedCategoryIds.includes(category.id);
                  const isDisabled =
                    !isSelected && selectedCategoryIds.length >= MAX_SELECTED_CATEGORIES;

                  return (
                    <Pressable
                      key={category.id}
                      accessibilityRole="button"
                      accessibilityLabel={`${isSelected ? 'Deselect' : 'Select'} ${
                        category.label
                      } category`}
                      accessibilityState={{ selected: isSelected, disabled: isDisabled }}
                      disabled={isDisabled}
                      onPress={() => toggleCategory(category.id)}
                      style={({ pressed }) => [
                        styles.categoryTile,
                        isSelected && styles.categoryTileSelected,
                        isDisabled && styles.categoryTileDisabled,
                        pressed && styles.categoryTilePressed,
                      ]}>
                      <MaterialIcons
                        name={category.icon}
                        size={18}
                        color={isSelected ? Colors.textOnPrimary : Colors.muted}
                      />
                      <Text
                        variant="bodyEmphasis"
                        adjustsFontSizeToFit
                        minimumFontScale={0.78}
                        numberOfLines={1}
                        style={[styles.categoryLabel, isSelected && styles.categoryLabelSelected]}>
                        {category.label}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            ))}
          </View>
        </Card>

        <Card variant="flat" style={[styles.setupBox, styles.languageSummaryBox]}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Change language, current language ${selectedLanguage.name}`}
            onPress={() => router.push('/choose-language')}
            style={({ pressed }) => [
              styles.languageSummaryRow,
              pressed && styles.languageSummaryPressed,
            ]}>
            <View style={styles.languageInlineText}>
              <Text
                variant="heading"
                color="primary"
                numberOfLines={1}
              style={styles.languageTitle}>
              Language
            </Text>
            </View>
            <View style={styles.languageActionGroup}>
              <Text
                variant="bodyEmphasis"
                adjustsFontSizeToFit
                minimumFontScale={0.82}
                numberOfLines={1}
                style={styles.selectedLanguageText}>
                {selectedLanguage.name}
              </Text>
              <View style={styles.languageIconButton}>
                <MaterialIcons name={LANGUAGE_ICON} size={22} color={Colors.text} />
              </View>
            </View>
          </Pressable>
        </Card>

        <View style={styles.startActions}>
          <Button
            label="Start Game"
            size="lg"
            fullWidth
            disabled={!canStartGame}
            accessibilityLabel={
              canStartGame ? 'Start game' : 'Select at least one category to start game'
            }
            leadingIcon={
              <MaterialIcons
                name={PLAY_ICON}
                size={22}
                color={Colors.textOnPrimary}
              />
            }
          />
        </View>
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
  scrollContent: {
    flexGrow: 1,
    paddingTop: Spacing.lg,
    paddingBottom: Spacing.xxxl,
    gap: Spacing.xl,
  },
  brand: {
    alignItems: 'center',
    justifyContent: 'flex-start',
  },
  title: {
    letterSpacing: 0,
  },
  setupBox: {
    width: '100%',
    maxWidth: 420,
    alignSelf: 'center',
    gap: Spacing.lg,
  },
  playersBox: {
    gap: Spacing.md,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.md,
  },
  playersGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.sm,
  },
  playerTile: {
    width: '47.9%',
    minHeight: 128,
    minWidth: 132,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.sm,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: Radii.lg,
    backgroundColor: 'rgba(250, 247, 242, 0.05)',
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
  },
  personBadge: {
    width: 58,
    height: 58,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: Radii.pill,
    backgroundColor: 'rgba(250, 247, 242, 0.08)',
  },
  playerNameRow: {
    alignSelf: 'stretch',
    height: 30,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.sm,
  },
  playerName: {
    alignSelf: 'stretch',
    minWidth: 0,
    includeFontPadding: false,
  },
  playerInput: {
    ...Typography.bodyEmphasis,
    alignSelf: 'stretch',
    height: 24,
    lineHeight: 24,
    minWidth: 72,
    padding: 0,
    margin: 0,
    color: Colors.text,
    includeFontPadding: false,
    textAlignVertical: 'center',
    transform: [{ translateY: Platform.OS === 'ios' ? -1 : 0 }],
  },
  addPlayerButton: {
    width: 38,
    height: 38,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: Radii.pill,
    backgroundColor: 'rgba(182, 25, 46, 0.14)',
  },
  addPlayerButtonDisabled: {
    backgroundColor: 'rgba(250, 247, 242, 0.08)',
    opacity: 0.64,
  },
  editButton: {
    width: 24,
    height: 24,
    position: 'absolute',
    top: Spacing.sm,
    right: Spacing.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  removeButton: {
    width: 30,
    height: 30,
    position: 'absolute',
    top: Spacing.sm,
    left: Spacing.sm,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: Radii.pill,
    backgroundColor: 'rgba(250, 247, 242, 0.08)',
  },
  iconButtonPressed: {
    opacity: 0.72,
    transform: [{ scale: 0.96 }],
  },
  categoriesRows: {
    gap: Spacing.md,
  },
  categoryRow: {
    width: '100%',
    flexDirection: 'row',
    flexWrap: 'nowrap',
    gap: Spacing.sm,
  },
  categoryTile: {
    minHeight: 42,
    flexShrink: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.xs + 2,
    borderRadius: Radii.pill,
    backgroundColor: 'rgba(250, 247, 242, 0.05)',
    paddingVertical: Spacing.sm + 1,
    paddingHorizontal: Spacing.sm + 2,
  },
  categoryTileSelected: {
    backgroundColor: Colors.primary,
  },
  categoryTileDisabled: {
    opacity: 0.42,
  },
  categoryTilePressed: {
    opacity: 0.82,
    transform: [{ scale: 0.98 }],
  },
  categoryLabel: {
    minWidth: 0,
    includeFontPadding: false,
  },
  categoryLabelSelected: {
    color: Colors.textOnPrimary,
  },
  languageSummaryBox: {
    paddingVertical: Spacing.lg,
  },
  languageSummaryRow: {
    width: '100%',
    minHeight: 44,
    flexDirection: 'row',
    flexWrap: 'nowrap',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.lg,
  },
  languageSummaryPressed: {
    opacity: 0.82,
    transform: [{ scale: 0.99 }],
  },
  languageInlineText: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    flexWrap: 'nowrap',
    alignItems: 'center',
  },
  languageTitle: {
    flexShrink: 0,
    includeFontPadding: false,
  },
  languageActionGroup: {
    flexShrink: 0,
    maxWidth: '62%',
    flexDirection: 'row',
    flexWrap: 'nowrap',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  selectedLanguageText: {
    flexShrink: 1,
    minWidth: 0,
    color: Colors.text,
    includeFontPadding: false,
  },
  languageIconButton: {
    width: 42,
    height: 42,
    flexShrink: 0,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: Radii.pill,
    backgroundColor: 'rgba(250, 247, 242, 0.08)',
  },
  startActions: {
    width: '100%',
    maxWidth: 420,
    alignSelf: 'center',
    paddingBottom: Spacing.md,
  },
});
