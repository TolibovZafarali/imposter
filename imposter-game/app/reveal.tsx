import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import {
  Animated,
  Pressable,
  StyleSheet,
  View,
  useWindowDimensions,
} from 'react-native';

import { TransparentImposterIcon } from '@/components/imposter/TransparentImposterIcon';
import { Button } from '@/components/ui/button';
import { Screen } from '@/components/ui/screen';
import { Text } from '@/components/ui/text';
import { Colors, Radii, Shadows, Spacing } from '@/constants/theme';
import { useGame } from '@/contexts/game-context';

const CARD_EXIT_DURATION = 220;
const CARD_ENTER_DURATION = 260;
const FLIP_DURATION = 170;

export default function RevealScreen() {
  const router = useRouter();
  const { width, height } = useWindowDimensions();
  const { state, advanceReveal, startPlaying } = useGame();
  const [hasSeenCard, setHasSeenCard] = useState(false);
  const [isCardHeld, setIsCardHeld] = useState(false);
  const [isSliding, setIsSliding] = useState(false);
  const isPressingCard = useRef(false);
  const flipValue = useRef(new Animated.Value(0)).current;
  const slideValue = useRef(new Animated.Value(0)).current;
  const opacityValue = useRef(new Animated.Value(1)).current;

  const round = state.round;
  const currentPlayer = round?.players[state.currentRevealIndex] ?? null;
  const currentCard =
    round?.cards.find((card) => card.playerId === currentPlayer?.id) ?? null;
  const isLastPlayer = round ? state.currentRevealIndex === round.players.length - 1 : false;
  const canContinue = hasSeenCard && !isCardHeld && !isSliding;
  const cardMinHeight = Math.min(520, Math.max(360, height * 0.58));

  useEffect(() => {
    if (!round) {
      router.replace('/');
      return;
    }

    if (state.phase === 'playing') {
      router.replace('/play');
      return;
    }

    if (state.phase !== 'reveal') {
      router.replace('/');
    }
  }, [round, router, state.phase]);

  const frontFaceStyle = {
    transform: [
      { perspective: 900 },
      {
        rotateY: flipValue.interpolate({
          inputRange: [0, 1],
          outputRange: ['0deg', '180deg'],
        }),
      },
    ],
  };

  const backFaceStyle = {
    transform: [
      { perspective: 900 },
      {
        rotateY: flipValue.interpolate({
          inputRange: [0, 1],
          outputRange: ['180deg', '360deg'],
        }),
      },
    ],
  };

  const slideStyle = {
    opacity: opacityValue,
    transform: [{ translateX: slideValue }],
  };

  const revealCard = () => {
    if (!currentCard || isSliding) {
      return;
    }

    isPressingCard.current = true;
    setIsCardHeld(true);
    Animated.timing(flipValue, {
      toValue: 1,
      duration: FLIP_DURATION,
      useNativeDriver: true,
    }).start();
  };

  const hideCard = () => {
    if (isSliding) {
      return;
    }

    isPressingCard.current = false;
    setIsCardHeld(false);
    setHasSeenCard(true);
    Animated.timing(flipValue, {
      toValue: 0,
      duration: FLIP_DURATION,
      useNativeDriver: true,
    }).start();
  };

  const showNextPlayer = () => {
    if (!round || !canContinue || isLastPlayer) {
      return;
    }

    setIsSliding(true);
    Animated.parallel([
      Animated.timing(slideValue, {
        toValue: -width,
        duration: CARD_EXIT_DURATION,
        useNativeDriver: true,
      }),
      Animated.timing(opacityValue, {
        toValue: 0,
        duration: CARD_EXIT_DURATION,
        useNativeDriver: true,
      }),
    ]).start(() => {
      advanceReveal();
      setHasSeenCard(false);
      setIsCardHeld(false);
      isPressingCard.current = false;
      flipValue.setValue(0);
      slideValue.setValue(width);

      Animated.parallel([
        Animated.timing(slideValue, {
          toValue: 0,
          duration: CARD_ENTER_DURATION,
          useNativeDriver: true,
        }),
        Animated.timing(opacityValue, {
          toValue: 1,
          duration: CARD_ENTER_DURATION,
          useNativeDriver: true,
        }),
      ]).start(() => setIsSliding(false));
    });
  };

  const startTimer = () => {
    if (!canContinue || !isLastPlayer) {
      return;
    }

    startPlaying();
    router.replace('/play');
  };

  if (!round || !currentPlayer || !currentCard) {
    return <Screen style={styles.screen} />;
  }

  return (
    <Screen style={styles.screen}>
      <View style={styles.header}>
        <Text variant="bodyEmphasis" color="muted" align="center">
          {state.currentRevealIndex + 1} / {round.players.length}
        </Text>
        <Text
          variant="title"
          align="center"
          adjustsFontSizeToFit
          minimumFontScale={0.8}
          numberOfLines={1}
          style={styles.playerName}>
          {currentPlayer.name}
        </Text>
      </View>

      <View style={styles.cardStage}>
        <Animated.View style={[styles.cardMotion, slideStyle]}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Reveal ${currentPlayer.name}'s card`}
            onPressIn={revealCard}
            onPressOut={hideCard}
            onPress={hideCard}
            style={[styles.cardPressable, { minHeight: cardMinHeight }]}>
            <Animated.View style={[styles.cardFace, styles.cardFront, frontFaceStyle]}>
              <View style={styles.frontIcon}>
                <MaterialIcons name="touch-app" size={42} color={Colors.text} />
              </View>
              <Text variant="heading" align="center" style={styles.frontTitle}>
                Hold to reveal
              </Text>
              <Text variant="bodySmall" align="center" color="muted">
                {currentPlayer.name}
              </Text>
            </Animated.View>

            <Animated.View
              style={[
                styles.cardFace,
                styles.cardBack,
                currentCard.role === 'imposter' && styles.imposterBack,
                backFaceStyle,
              ]}>
              {isCardHeld && currentCard.role === 'imposter' ? (
                <>
                  <TransparentImposterIcon size={92} />
                  <Text
                    variant="display"
                    align="center"
                    adjustsFontSizeToFit
                    minimumFontScale={0.72}
                    numberOfLines={1}
                    style={styles.imposterTitle}>
                    IMPOSTER
                  </Text>
                  <Text variant="bodyEmphasis" align="center" color="muted">
                    Hint
                  </Text>
                  <Text
                    variant="title"
                    align="center"
                    adjustsFontSizeToFit
                    minimumFontScale={0.76}
                    numberOfLines={1}
                    style={styles.hintWord}>
                    {currentCard.hint}
                  </Text>
                </>
              ) : null}

              {isCardHeld && currentCard.role === 'regular' ? (
                <>
                  <Text variant="bodyEmphasis" align="center" color="muted">
                    Secret Word
                  </Text>
                  <Text
                    variant="display"
                    align="center"
                    adjustsFontSizeToFit
                    minimumFontScale={0.64}
                    numberOfLines={1}
                    style={styles.secretWord}>
                    {currentCard.word}
                  </Text>
                </>
              ) : null}
            </Animated.View>
          </Pressable>
        </Animated.View>
      </View>

      <View style={styles.actionSlot}>
        {canContinue ? (
          <Button
            label={isLastPlayer ? 'Start Game' : 'Next Player'}
            size="lg"
            fullWidth
            accessibilityLabel={isLastPlayer ? 'Start Game' : 'Next Player'}
            onPress={isLastPlayer ? startTimer : showNextPlayer}
            leadingIcon={
              <MaterialIcons
                name={isLastPlayer ? 'timer' : 'arrow-forward'}
                size={22}
                color={Colors.textOnPrimary}
              />
            }
          />
        ) : null}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    justifyContent: 'space-between',
    paddingTop: Spacing.lg,
    paddingBottom: Spacing.xl,
  },
  header: {
    minHeight: 78,
    justifyContent: 'center',
    gap: Spacing.xs,
  },
  playerName: {
    letterSpacing: 0,
  },
  cardStage: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    width: '100%',
  },
  cardMotion: {
    width: '100%',
    maxWidth: 420,
  },
  cardPressable: {
    width: '100%',
  },
  cardFace: {
    ...StyleSheet.absoluteFillObject,
    minHeight: 360,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.lg,
    borderRadius: Radii.xxl,
    borderWidth: 1,
    borderColor: Colors.border,
    paddingHorizontal: Spacing.xl,
    paddingVertical: Spacing.xxxl,
    backfaceVisibility: 'hidden',
    ...Shadows.lg,
  },
  cardFront: {
    backgroundColor: Colors.surfaceRaised,
  },
  cardBack: {
    backgroundColor: Colors.surfaceRaised,
  },
  imposterBack: {
    backgroundColor: Colors.redSurfaceStrong,
    borderColor: Colors.redBorder,
  },
  frontIcon: {
    width: 92,
    height: 92,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: Radii.pill,
    backgroundColor: Colors.surface,
  },
  frontTitle: {
    letterSpacing: 0,
  },
  imposterTitle: {
    color: Colors.primary,
    letterSpacing: 0,
  },
  hintWord: {
    color: Colors.text,
    letterSpacing: 0,
  },
  secretWord: {
    color: Colors.text,
    letterSpacing: 0,
  },
  actionSlot: {
    minHeight: 68,
    width: '100%',
    maxWidth: 420,
    alignSelf: 'center',
    justifyContent: 'center',
  },
});
