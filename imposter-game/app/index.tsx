import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import type { ComponentProps, ComponentRef } from 'react';
import {
  Animated as RNAnimated,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text as RNText,
  TextInput,
  View,
} from 'react-native';
import Animated, {
  Easing as ReanimatedEasing,
  LinearTransition,
  withTiming,
  type EntryExitAnimationFunction,
} from 'react-native-reanimated';

import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Screen } from '@/components/ui/screen';
import { Text } from '@/components/ui/text';
import { getLanguageFlagEmoji } from '@/constants/languages';
import { Colors, Radii, Spacing, Transitions, Typography } from '@/constants/theme';
import { useGame } from '@/contexts/game-context';
import { useLanguageSettings } from '@/contexts/language-settings';
import { selectRandomCategoryIds, type WordDifficulty } from '@/data/wordBank';
import type { Player } from '@/game/types';
import { createRound } from '@/services/roundGenerator';

type MaterialIconName = ComponentProps<typeof MaterialIcons>['name'];
type PlayerNameInputRef = ComponentRef<typeof TextInput>;

type PlayerNameSelection = {
  playerId: string;
  start: number;
  end: number;
};

type Category = {
  id: string;
  label: string;
  icon: MaterialIconName;
  isAiGenerated?: boolean;
};

const CATEGORIES: Category[] = [
  { id: 'activities', label: 'Activities', icon: 'directions-run' },
  { id: 'food', label: 'Food', icon: 'restaurant' },
  { id: 'animals', label: 'Animals', icon: 'pets' },
  { id: 'objects', label: 'Objects', icon: 'category' },
  { id: 'places', label: 'Places', icon: 'place' },
  { id: 'sports', label: 'Sports', icon: 'sports-soccer' },
  { id: 'movies', label: 'Movies', icon: 'movie', isAiGenerated: true },
  { id: 'celebrities', label: 'Celebrities', icon: 'star', isAiGenerated: true },
];

const CATEGORY_ROWS = [
  ['food', 'animals', 'objects'],
  ['places', 'activities', 'sports'],
  ['movies', 'celebrities'],
];

const DIFFICULTY_OPTIONS = [
  { id: 'easy', label: 'Easy' },
  { id: 'medium', label: 'Medium' },
  { id: 'hard', label: 'Hard' },
] as const satisfies readonly { id: WordDifficulty; label: string }[];

const CATEGORIES_BY_ID = new Map(CATEGORIES.map((category) => [category.id, category]));

const ADD_PLAYER_ICON: MaterialIconName = 'person-add-alt-1';
const REMOVE_PLAYER_ICON: MaterialIconName = 'close';
const EDIT_ICON: MaterialIconName = 'edit';
const PLAYER_ICON: MaterialIconName = 'person';
const PLAY_ICON: MaterialIconName = 'play-arrow';
const RANDOM_CATEGORY_ICON: MaterialIconName = 'casino';
const AI_GENERATED_CATEGORY_ICON: MaterialIconName = 'auto-awesome';
const SETTINGS_ICON: MaterialIconName = 'settings';
const MIN_PLAYERS = 3;
const MAX_PLAYERS = 10;
const MAX_PLAYER_NAME_LENGTH = 10;
const MAX_SELECTED_CATEGORIES = 3;
const RANDOM_CATEGORY_COUNT = MAX_SELECTED_CATEGORIES;
const PLAYER_LIST_GAP = Spacing.sm;
const PLAYERS_SECTION_PADDING = Spacing.xl;
const SETUP_SCROLL_BOTTOM_PADDING = Spacing.xxxl;
const SETUP_SCROLL_OVERFLOW_TOLERANCE = 2;
const DIFFICULTY_SWITCH_GAP = Spacing.xs;
const DIFFICULTY_SWITCH_PADDING = Spacing.xs;
const PLAYER_TILE_ENTER_DURATION = Transitions.slow;
const PLAYER_TILE_EXIT_DURATION = Transitions.base;
const PLAYER_TILE_MOTION_OFFSET = 8;
const PLAYER_TILE_ENTER_SCALE = 0.96;
const PLAYER_TILE_EXIT_SCALE = 0.97;
const PLAYER_ICON_SWATCHES = [
  {
    foreground: '#0B5CFF',
    background: 'rgba(11, 92, 255, 0.12)',
    border: 'rgba(11, 92, 255, 0.24)',
  },
  {
    foreground: '#00A88F',
    background: 'rgba(0, 168, 143, 0.13)',
    border: 'rgba(0, 168, 143, 0.24)',
  },
  {
    foreground: '#FF4F31',
    background: 'rgba(255, 79, 49, 0.13)',
    border: 'rgba(255, 79, 49, 0.25)',
  },
  {
    foreground: '#7B4DFF',
    background: 'rgba(123, 77, 255, 0.13)',
    border: 'rgba(123, 77, 255, 0.24)',
  },
  {
    foreground: '#D61F69',
    background: 'rgba(214, 31, 105, 0.12)',
    border: 'rgba(214, 31, 105, 0.23)',
  },
  {
    foreground: '#F97316',
    background: 'rgba(249, 115, 22, 0.13)',
    border: 'rgba(249, 115, 22, 0.24)',
  },
  {
    foreground: '#0086C9',
    background: 'rgba(0, 134, 201, 0.12)',
    border: 'rgba(0, 134, 201, 0.23)',
  },
  {
    foreground: '#10A34A',
    background: 'rgba(16, 163, 74, 0.12)',
    border: 'rgba(16, 163, 74, 0.23)',
  },
  {
    foreground: '#C026D3',
    background: 'rgba(192, 38, 211, 0.12)',
    border: 'rgba(192, 38, 211, 0.23)',
  },
  {
    foreground: '#E11D48',
    background: 'rgba(225, 29, 72, 0.12)',
    border: 'rgba(225, 29, 72, 0.23)',
  },
] as const;

const playerTileEasing = ReanimatedEasing.bezier(...Transitions.easing);
const playerTileLayoutTransition = LinearTransition.duration(PLAYER_TILE_ENTER_DURATION).easing(
  playerTileEasing
);

const playerTileEntering: EntryExitAnimationFunction = () => {
  'worklet';

  return {
    initialValues: {
      opacity: 0,
      transform: [{ translateY: PLAYER_TILE_MOTION_OFFSET }, { scale: PLAYER_TILE_ENTER_SCALE }],
    },
    animations: {
      opacity: withTiming(1, {
        duration: PLAYER_TILE_ENTER_DURATION,
        easing: playerTileEasing,
      }),
      transform: [
        {
          translateY: withTiming(0, {
            duration: PLAYER_TILE_ENTER_DURATION,
            easing: playerTileEasing,
          }),
        },
        {
          scale: withTiming(1, {
            duration: PLAYER_TILE_ENTER_DURATION,
            easing: playerTileEasing,
          }),
        },
      ],
    },
  };
};

const playerTileExiting: EntryExitAnimationFunction = () => {
  'worklet';

  return {
    initialValues: {
      opacity: 1,
      transform: [{ translateY: 0 }, { scale: 1 }],
    },
    animations: {
      opacity: withTiming(0, {
        duration: PLAYER_TILE_EXIT_DURATION,
        easing: playerTileEasing,
      }),
      transform: [
        {
          translateY: withTiming(-PLAYER_TILE_MOTION_OFFSET, {
            duration: PLAYER_TILE_EXIT_DURATION,
            easing: playerTileEasing,
          }),
        },
        {
          scale: withTiming(PLAYER_TILE_EXIT_SCALE, {
            duration: PLAYER_TILE_EXIT_DURATION,
            easing: playerTileEasing,
          }),
        },
      ],
    },
  };
};

const limitPlayerName = (name: string) => name.slice(0, MAX_PLAYER_NAME_LENGTH);

const pickRandomCategoryIds = (rng = Math.random) => {
  return selectRandomCategoryIds({
    categoryIds: CATEGORIES.map((category) => category.id),
    count: RANDOM_CATEGORY_COUNT,
    rng,
  });
};

export default function HomeScreen() {
  const router = useRouter();
  const { setupPreferences, startRound, updateSetupPreferences } = useGame();
  const { selectedLanguage } = useLanguageSettings();
  const [editingPlayerId, setEditingPlayerId] = useState<string | null>(null);
  const [playerNameSelection, setPlayerNameSelection] = useState<PlayerNameSelection | null>(null);
  const [difficultyToggleWidth, setDifficultyToggleWidth] = useState(0);
  const [setupViewportHeight, setSetupViewportHeight] = useState(0);
  const [setupContentHeight, setSetupContentHeight] = useState(0);
  const [isStartingGame, setIsStartingGame] = useState(false);
  const [roundGenerationError, setRoundGenerationError] = useState<string | null>(null);
  const isStartingGameRef = useRef(false);
  const playerInputRefs = useRef(new Map<string, PlayerNameInputRef>());
  const playerFocusTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const playerBlurUnlockTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const playerBlurLockRef = useRef<string | null>(null);
  const difficultySlideValue = useRef(new RNAnimated.Value(0)).current;
  const {
    players,
    selectedCategoryIds,
    isRandomCategoryMode,
    selectedDifficulty,
    imposterCount,
    isImposterHintEnabled,
    roundTimerMinutes,
  } = setupPreferences;

  const canStartGame =
    (isRandomCategoryMode || selectedCategoryIds.length > 0) && !isStartingGame;
  const isSetupScrollEnabled =
    setupViewportHeight > 0 &&
    Math.max(0, setupContentHeight - SETUP_SCROLL_BOTTOM_PADDING) >
      setupViewportHeight + SETUP_SCROLL_OVERFLOW_TOLERANCE;
  const difficultyOptionWidth = Math.max(
    0,
    (difficultyToggleWidth -
      DIFFICULTY_SWITCH_PADDING * 2 -
      DIFFICULTY_SWITCH_GAP * (DIFFICULTY_OPTIONS.length - 1)) /
      DIFFICULTY_OPTIONS.length
  );
  useEffect(() => {
    const selectedDifficultyIndex = Math.max(
      DIFFICULTY_OPTIONS.findIndex((difficultyOption) => difficultyOption.id === selectedDifficulty),
      0
    );

    RNAnimated.spring(difficultySlideValue, {
      toValue: selectedDifficultyIndex * (difficultyOptionWidth + DIFFICULTY_SWITCH_GAP),
      damping: 18,
      mass: 0.8,
      stiffness: 180,
      useNativeDriver: true,
    }).start();
  }, [difficultyOptionWidth, difficultySlideValue, selectedDifficulty]);

  useEffect(() => {
    return () => {
      if (playerFocusTimeoutRef.current) {
        clearTimeout(playerFocusTimeoutRef.current);
      }

      if (playerBlurUnlockTimeoutRef.current) {
        clearTimeout(playerBlurUnlockTimeoutRef.current);
      }
    };
  }, []);

  const clearPlayerNameSelection = () => {
    setPlayerNameSelection(null);
  };

  const beginEditingPlayer = (player: Player) => {
    const selection = { playerId: player.id, start: 0, end: player.name.length };

    if (playerFocusTimeoutRef.current) {
      clearTimeout(playerFocusTimeoutRef.current);
    }

    if (playerBlurUnlockTimeoutRef.current) {
      clearTimeout(playerBlurUnlockTimeoutRef.current);
    }

    playerBlurLockRef.current = player.id;
    setEditingPlayerId(player.id);
    setPlayerNameSelection(selection);

    playerFocusTimeoutRef.current = setTimeout(() => {
      const input = playerInputRefs.current.get(player.id);
      input?.focus();
      input?.setNativeProps?.({ selection: { start: selection.start, end: selection.end } });
      playerFocusTimeoutRef.current = null;
    }, 50);

    playerBlurUnlockTimeoutRef.current = setTimeout(() => {
      if (playerBlurLockRef.current === player.id) {
        playerBlurLockRef.current = null;
      }

      playerBlurUnlockTimeoutRef.current = null;
    }, 250);
  };

  const updatePlayers = (getNextPlayers: (currentPlayers: Player[]) => Player[]) => {
    updateSetupPreferences({ players: getNextPlayers(players) });
  };

  const updatePlayerName = (playerId: string, name: string) => {
    const limitedName = limitPlayerName(name);

    updatePlayers((currentPlayers) =>
      currentPlayers.map((player) =>
        player.id === playerId ? { ...player, name: limitedName } : player
      )
    );
  };

  const addPlayer = () => {
    updatePlayers((currentPlayers) => {
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
    updatePlayers((currentPlayers) => {
      if (currentPlayers.length <= MIN_PLAYERS) {
        return currentPlayers;
      }

      return currentPlayers.filter((player) => player.id !== playerId);
    });

    if (editingPlayerId === playerId) {
      setEditingPlayerId(null);
      playerBlurLockRef.current = null;
      clearPlayerNameSelection();
    }
  };

  const finishEditing = (playerId: string) => {
    updatePlayers((currentPlayers) =>
      currentPlayers.map((player, index) => {
        if (player.id !== playerId) {
          return player;
        }

        const trimmedName = player.name.trim();
        return { ...player, name: limitPlayerName(trimmedName || `Player ${index + 1}`) };
      })
    );
    setEditingPlayerId(null);
    playerBlurLockRef.current = null;
    clearPlayerNameSelection();
  };

  const toggleCategory = (categoryId: string) => {
    let nextCategoryIds: string[];

    if (selectedCategoryIds.includes(categoryId)) {
      nextCategoryIds = selectedCategoryIds.filter(
        (currentCategoryId) => currentCategoryId !== categoryId
      );
    } else {
      if (selectedCategoryIds.length >= MAX_SELECTED_CATEGORIES) {
        return;
      }

      nextCategoryIds = [...selectedCategoryIds, categoryId];
    }

    updateSetupPreferences({
      selectedCategoryIds: nextCategoryIds,
      isRandomCategoryMode: nextCategoryIds.length === 0,
    });
  };

  const selectRandomCategories = () => {
    updateSetupPreferences({
      selectedCategoryIds: [],
      isRandomCategoryMode: true,
    });
  };

  const handleStartGame = async () => {
    if (!canStartGame || isStartingGameRef.current) {
      return;
    }

    isStartingGameRef.current = true;
    setIsStartingGame(true);
    setRoundGenerationError(null);

    const roundPlayers = players.map((player, index) => {
      const trimmedName = player.name.trim();

      return {
        ...player,
        name: limitPlayerName(trimmedName || `Player ${index + 1}`),
      };
    });
    const roundCategoryIds = isRandomCategoryMode
      ? pickRandomCategoryIds()
      : selectedCategoryIds;

    try {
      const round = await createRound({
        players: roundPlayers,
        categoryIds: roundCategoryIds,
        difficulty: selectedDifficulty,
        languageId: selectedLanguage.id,
        languageName: selectedLanguage.name,
        imposterCount,
        isImposterHintEnabled,
        roundTimerMinutes,
      });

      updateSetupPreferences({ players: roundPlayers });
      setEditingPlayerId(null);
      playerBlurLockRef.current = null;
      clearPlayerNameSelection();
      startRound(round);
      router.push('/reveal');
    } catch {
      setRoundGenerationError('Could not create a round. Check the server for translated or AI categories and try again.');
    } finally {
      isStartingGameRef.current = false;
      setIsStartingGame(false);
    }
  };

  return (
    <Screen padded={false} style={styles.screen}>
      <ScrollView
        alwaysBounceVertical={false}
        bounces={isSetupScrollEnabled}
        keyboardShouldPersistTaps="handled"
        onContentSizeChange={(_, contentHeight) => setSetupContentHeight(contentHeight)}
        onLayout={(event) => setSetupViewportHeight(event.nativeEvent.layout.height)}
        overScrollMode={isSetupScrollEnabled ? 'auto' : 'never'}
        scrollEnabled={isSetupScrollEnabled}
        showsVerticalScrollIndicator={false}
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}>
        <View style={styles.topBar}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Open settings"
            hitSlop={8}
            onPress={() => router.push('/settings')}
            style={({ pressed }) => [
              styles.topIconButton,
              pressed && styles.iconButtonPressed,
            ]}>
            <MaterialIcons name={SETTINGS_ICON} size={23} color={Colors.text} />
          </Pressable>
          <View style={styles.brand}>
            <Text variant="display" align="center" style={styles.title}>
              IMPOSTER
            </Text>
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Change language, current language ${selectedLanguage.name}`}
            hitSlop={8}
            onPress={() => router.push('/choose-language')}
            style={({ pressed }) => [
              styles.topIconButton,
              pressed && styles.iconButtonPressed,
            ]}>
            <RNText allowFontScaling={false} style={styles.languageFlagIcon}>
              {getLanguageFlagEmoji(selectedLanguage)}
            </RNText>
          </Pressable>
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
              const playerIconSwatch = PLAYER_ICON_SWATCHES[index % PLAYER_ICON_SWATCHES.length];

              return (
                <Animated.View
                  key={player.id}
                  entering={playerTileEntering}
                  exiting={playerTileExiting}
                  layout={playerTileLayoutTransition}
                  style={styles.playerTile}>
                  <View
                    style={[
                      styles.personBadge,
                      {
                        backgroundColor: playerIconSwatch.background,
                        borderColor: playerIconSwatch.border,
                      },
                    ]}>
                    <MaterialIcons
                      name={PLAYER_ICON}
                      size={24}
                      color={playerIconSwatch.foreground}
                    />
                  </View>

                  <View style={styles.playerNameRow}>
                    {isEditing ? (
                      <TextInput
                        ref={(input) => {
                          if (input) {
                            playerInputRefs.current.set(player.id, input);
                          } else {
                            playerInputRefs.current.delete(player.id);
                          }
                        }}
                        selectTextOnFocus
                        value={player.name}
                        onChangeText={(name) => {
                          clearPlayerNameSelection();
                          updatePlayerName(player.id, name);
                        }}
                        onPressIn={clearPlayerNameSelection}
                        onBlur={() => {
                          if (playerBlurLockRef.current === player.id) {
                            return;
                          }

                          finishEditing(player.id);
                        }}
                        onSubmitEditing={() => finishEditing(player.id)}
                        returnKeyType="done"
                        maxLength={MAX_PLAYER_NAME_LENGTH}
                        placeholder={player.name}
                        placeholderTextColor={Colors.muted}
                        selection={
                          playerNameSelection?.playerId === player.id
                            ? {
                                start: playerNameSelection.start,
                                end: playerNameSelection.end,
                              }
                            : undefined
                        }
                        textAlign="left"
                        style={[
                          styles.playerInput,
                          Platform.OS === 'ios' && styles.playerInputEditingIos,
                        ]}
                      />
                    ) : (
                      <Text
                        variant="bodyEmphasis"
                        adjustsFontSizeToFit
                        minimumFontScale={0.72}
                        numberOfLines={1}
                        style={styles.playerNameText}>
                        {player.name}
                      </Text>
                    )}
                  </View>

                  <View style={styles.playerActions}>
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
                      onPress={() => beginEditingPlayer(player)}
                      style={({ pressed }) => [
                        styles.editButton,
                        pressed && styles.iconButtonPressed,
                      ]}>
                      <MaterialIcons name={EDIT_ICON} size={20} color={Colors.primary} />
                    </Pressable>
                  </View>
                </Animated.View>
              );
            })}
          </View>
        </Card>

        <Card variant="flat" style={styles.setupBox}>
          <View style={styles.categoriesHeader}>
            <Text
              variant="heading"
              color="primary"
              numberOfLines={1}
              style={styles.categoriesTitle}>
              Categories
            </Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Choose three random categories each round"
              accessibilityState={{ selected: isRandomCategoryMode }}
              hitSlop={8}
              onPress={selectRandomCategories}
              style={({ pressed }) => [
                styles.randomCategoryButton,
                isRandomCategoryMode && styles.randomCategoryButtonSelected,
                pressed && styles.randomCategoryButtonPressed,
              ]}>
              <MaterialIcons
                name={RANDOM_CATEGORY_ICON}
                size={17}
                color={isRandomCategoryMode ? Colors.primary : Colors.muted}
              />
              <Text
                variant="bodyEmphasis"
                adjustsFontSizeToFit
                minimumFontScale={0.82}
                numberOfLines={1}
                style={[
                  styles.randomCategoryLabel,
                  isRandomCategoryMode && styles.randomCategoryLabelSelected,
                ]}>
                Random
              </Text>
            </Pressable>
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
                  const categoryStatusLabel = category.isAiGenerated ? ', AI generated' : '';

                  return (
                    <Pressable
                      key={category.id}
                      accessibilityRole="button"
                      accessibilityLabel={`${isSelected ? 'Deselect' : 'Select'} ${
                        category.label
                      } category${categoryStatusLabel}`}
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
                      {category.isAiGenerated ? (
                        <MaterialIcons
                          name={AI_GENERATED_CATEGORY_ICON}
                          size={14}
                          color={isSelected ? Colors.textOnPrimary : Colors.primary}
                        />
                      ) : null}
                    </Pressable>
                  );
                })}
              </View>
            ))}
          </View>

          <View style={styles.categoriesFooter}>
            <View
              onLayout={(event) => setDifficultyToggleWidth(event.nativeEvent.layout.width)}
              style={styles.difficultyToggle}>
              <RNAnimated.View
                pointerEvents="none"
                style={[
                  styles.difficultyIndicator,
                  {
                    opacity: difficultyOptionWidth > 0 ? 1 : 0,
                    transform: [{ translateX: difficultySlideValue }],
                    width: difficultyOptionWidth,
                  },
                ]}
              />
              {DIFFICULTY_OPTIONS.map((difficultyOption) => {
                const isSelected = selectedDifficulty === difficultyOption.id;

                return (
                  <Pressable
                    key={difficultyOption.id}
                    accessibilityRole="button"
                    accessibilityLabel={`Set difficulty to ${difficultyOption.label}`}
                    accessibilityState={{ selected: isSelected }}
                    onPress={() =>
                      updateSetupPreferences({ selectedDifficulty: difficultyOption.id })
                    }
                    style={({ pressed }) => [
                      styles.difficultyOption,
                      pressed && styles.difficultyOptionPressed,
                    ]}>
                    <Text
                      variant="bodyEmphasis"
                      adjustsFontSizeToFit
                      minimumFontScale={0.84}
                      numberOfLines={1}
                      style={[
                        styles.difficultyOptionText,
                        isSelected && styles.difficultyOptionTextSelected,
                      ]}>
                      {difficultyOption.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </View>
        </Card>

        <View style={styles.startActions}>
          {roundGenerationError ? (
            <Text
              accessibilityRole="alert"
              align="center"
              color="primary"
              variant="bodySmall"
              style={styles.startError}>
              {roundGenerationError}
            </Text>
          ) : null}
          <Button
            label={isStartingGame ? 'Starting...' : 'Start Game'}
            size="lg"
            fullWidth
            disabled={!canStartGame}
            onPress={handleStartGame}
            accessibilityLabel={
              isStartingGame
                ? 'Starting game'
                : canStartGame
                  ? 'Start game'
                  : 'Select at least one category to start game'
            }
            leadingIcon={
              <MaterialIcons
                name={isStartingGame ? 'hourglass-top' : PLAY_ICON}
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
    paddingHorizontal: Spacing.xl,
    paddingTop: Spacing.lg,
    paddingBottom: SETUP_SCROLL_BOTTOM_PADDING,
    gap: Spacing.lg,
  },
  topBar: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.md,
  },
  brand: {
    flex: 1,
    minWidth: 0,
    alignItems: 'center',
    justifyContent: 'center',
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
    padding: PLAYERS_SECTION_PADDING,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.md,
  },
  categoriesHeader: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.md,
  },
  categoriesTitle: {
    flex: 1,
    minWidth: 0,
  },
  playersGrid: {
    gap: PLAYER_LIST_GAP,
  },
  playerTile: {
    minHeight: 64,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.md,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: Radii.lg,
    backgroundColor: Colors.surface,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
  },
  personBadge: {
    width: 42,
    height: 42,
    flexShrink: 0,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderRadius: Radii.pill,
    backgroundColor: Colors.surfacePressed,
  },
  playerNameRow: {
    flex: 1,
    height: 44,
    minWidth: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  playerNameText: {
    alignSelf: 'stretch',
    height: 44,
    lineHeight: 44,
    minWidth: 0,
    color: Colors.text,
    includeFontPadding: false,
  },
  playerInput: {
    ...Typography.bodyEmphasis,
    alignSelf: 'stretch',
    height: 44,
    lineHeight: 24,
    minWidth: 0,
    padding: 0,
    paddingVertical: 0,
    paddingTop: 0,
    paddingBottom: 0,
    margin: 0,
    color: Colors.text,
    includeFontPadding: false,
    textAlign: 'left',
    textAlignVertical: 'center',
  },
  playerInputEditingIos: {
    height: 44,
    lineHeight: 24,
    paddingVertical: 0,
    paddingTop: 0,
    paddingBottom: 0,
    borderWidth: 1,
    borderColor: Colors.primary,
    borderRadius: Radii.sm,
    backgroundColor: Colors.surfaceRaised,
    paddingHorizontal: Spacing.sm,
  },
  playerActions: {
    minWidth: 40,
    flexShrink: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: Spacing.xs,
  },
  addPlayerButton: {
    width: 38,
    height: 38,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: Radii.pill,
    backgroundColor: Colors.redSurface,
  },
  addPlayerButtonDisabled: {
    backgroundColor: Colors.surface,
    opacity: 0.64,
  },
  editButton: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: Radii.pill,
    backgroundColor: Colors.redSurface,
  },
  removeButton: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: Radii.pill,
    backgroundColor: Colors.surface,
  },
  iconButtonPressed: {
    opacity: 0.72,
    transform: [{ scale: 0.96 }],
  },
  categoriesRows: {
    gap: Spacing.md,
  },
  categoriesFooter: {
    width: '100%',
    alignSelf: 'stretch',
    justifyContent: 'flex-end',
  },
  randomCategoryButton: {
    minHeight: 36,
    maxWidth: 140,
    flexShrink: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.xs + 2,
    borderWidth: 1,
    borderColor: Colors.border,
    borderStyle: 'dashed',
    borderRadius: Radii.pill,
    backgroundColor: 'transparent',
    paddingVertical: Spacing.xs + 2,
    paddingHorizontal: Spacing.sm + 2,
  },
  randomCategoryButtonSelected: {
    borderColor: Colors.primary,
    borderStyle: 'solid',
    backgroundColor: Colors.redSurfaceStrong,
  },
  randomCategoryButtonPressed: {
    opacity: 0.86,
    transform: [{ scale: 0.97 }],
  },
  randomCategoryLabel: {
    minWidth: 0,
    lineHeight: 20,
    color: Colors.muted,
    includeFontPadding: false,
    textAlignVertical: 'center',
    transform: [{ translateY: -2 }],
  },
  randomCategoryLabelSelected: {
    color: Colors.primary,
  },
  difficultyToggle: {
    minHeight: 46,
    flexDirection: 'row',
    flexWrap: 'nowrap',
    gap: DIFFICULTY_SWITCH_GAP,
    overflow: 'hidden',
    position: 'relative',
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: Radii.pill,
    backgroundColor: Colors.surface,
    padding: DIFFICULTY_SWITCH_PADDING,
  },
  difficultyIndicator: {
    position: 'absolute',
    top: DIFFICULTY_SWITCH_PADDING,
    bottom: DIFFICULTY_SWITCH_PADDING,
    left: DIFFICULTY_SWITCH_PADDING,
    borderRadius: Radii.pill,
    backgroundColor: Colors.primary,
  },
  difficultyOption: {
    height: 36,
    flex: 1,
    minWidth: 0,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: Radii.pill,
    paddingHorizontal: Spacing.sm,
    zIndex: 1,
  },
  difficultyOptionPressed: {
    opacity: 0.82,
    transform: [{ scale: 0.98 }],
  },
  difficultyOptionText: {
    minWidth: 0,
    lineHeight: 20,
    color: Colors.muted,
    includeFontPadding: false,
    textAlignVertical: 'center',
    transform: [{ translateY: -2 }],
  },
  difficultyOptionTextSelected: {
    color: Colors.textOnPrimary,
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
    backgroundColor: Colors.surface,
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
    lineHeight: 20,
    includeFontPadding: false,
    textAlignVertical: 'center',
    transform: [{ translateY: -2 }],
  },
  categoryLabelSelected: {
    color: Colors.textOnPrimary,
  },
  topIconButton: {
    width: 44,
    height: 44,
    flexShrink: 0,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: Radii.pill,
    backgroundColor: Colors.surface,
  },
  languageFlagIcon: {
    fontSize: 26,
    lineHeight: 30,
    includeFontPadding: false,
    textAlign: 'center',
    textAlignVertical: 'center',
  },
  startActions: {
    width: '100%',
    maxWidth: 420,
    alignSelf: 'center',
    gap: Spacing.md,
    paddingBottom: Spacing.md,
  },
  startError: {
    paddingHorizontal: Spacing.md,
  },
});
