import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import type { ImageRef } from 'expo-image';
import { useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import {
  Animated,
  AppState,
  BackHandler,
  Easing,
  ScrollView,
  Pressable,
  StyleSheet,
  View,
  useWindowDimensions,
} from 'react-native';

import { TransparentImposterIcon } from '@/components/imposter/TransparentImposterIcon';
import { WordIllustration } from '@/components/word-illustration';
import { getWordIllustrationSize, selectRevealIllustration } from '@/components/word-illustration-state';
import { Button } from '@/components/ui/button';
import { Screen } from '@/components/ui/screen';
import { Text } from '@/components/ui/text';
import { Colors, Radii, Shadows, Spacing } from '@/constants/theme';
import { useGame } from '@/contexts/game-context';
import { useAccessibilitySettings } from '@/hooks/use-accessibility-settings';
import { useRoundIllustration } from '@/hooks/use-round-illustration';
import * as Haptics from 'expo-haptics';

const CARD_EXIT_DURATION = 220;
const CARD_ENTER_DURATION = 260;
const FLIP_DURATION = 320;

export default function RevealScreen() {
  const router = useRouter();
  const { reduceMotion, screenReader } = useAccessibilitySettings();
  const { width, height, fontScale } = useWindowDimensions();
  const { state, advanceReveal, startPlaying } = useGame();
  const [hasSeenCard, setHasSeenCard] = useState(false);
  const [isCardHeld, setIsCardHeld] = useState(false);
  const [showContent, setShowContent] = useState(false);
  const [isClosing, setIsClosing] = useState(false);
  const [revealedCardIdentity, setRevealedCardIdentity] = useState<{
    roundId: string;
    playerId: string;
  } | null>(null);
  const [revealedIllustration, setRevealedIllustration] = useState<{
    roundId: string;
    playerId: string;
    entryId: string;
    image: ImageRef;
    size: number;
  } | null>(null);
  const [failedIllustration, setFailedIllustration] = useState<{
    roundId: string;
    entryId: string;
  } | null>(null);
  const transitionLocked = useRef(false);
  const mounted = useRef(true);
  const [isSliding, setIsSliding] = useState(false);
  const isPressingCard = useRef(false);
  const flipValue = useRef(new Animated.Value(0)).current;
  const slideValue = useRef(new Animated.Value(0)).current;
  const opacityValue = useRef(new Animated.Value(1)).current;

  const round = state.round;
  const currentPlayer = round?.players[state.currentRevealIndex] ?? null;
  const currentCard =
    round?.cards.find((card) => card.playerId === currentPlayer?.id) ?? null;
  const isCurrentReveal = revealedCardIdentity?.roundId === round?.id
    && revealedCardIdentity?.playerId === currentPlayer?.id;
  const isCurrentCardHeld = isCardHeld && isCurrentReveal;
  const showCurrentContent = showContent && isCurrentReveal;
  const isLastPlayer = round ? state.currentRevealIndex === round.players.length - 1 : false;
  const canContinue = hasSeenCard && isCurrentReveal && !isCardHeld && !isSliding && !isClosing;
  const cardMinHeight = Math.min(480, Math.max(300, height - 310));
  const roundIllustrationEntryId = round?.cards.find(
    (card) => card.role === 'regular' && card.illustrationEntryId,
  )?.illustrationEntryId ?? null;
  const readyIllustration = useRoundIllustration(round?.id, roundIllustrationEntryId);
  const illustrationSize = getWordIllustrationSize({
    cardHeight: cardMinHeight,
    contentWidth: Math.min(420, width - Spacing.xl * 2) - Spacing.xl * 2,
    fontScale,
  });
  const currentIllustration = revealedIllustration?.roundId === round?.id
    && revealedIllustration?.playerId === currentPlayer?.id
    && revealedIllustration?.entryId === currentCard?.illustrationEntryId
    ? revealedIllustration : null;

  useEffect(() => {
    isPressingCard.current = false;
    transitionLocked.current = false;
    flipValue.stopAnimation();
    flipValue.setValue(0);
    slideValue.stopAnimation();
    slideValue.setValue(0);
    opacityValue.stopAnimation();
    opacityValue.setValue(1);
    setHasSeenCard(false);
    setIsCardHeld(false);
    setShowContent(false);
    setIsClosing(false);
    setIsSliding(false);
    setRevealedCardIdentity(null);
    setRevealedIllustration(null);
  }, [round?.id, flipValue, slideValue, opacityValue]);

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

  useEffect(() => {
    mounted.current = true;
    const background = AppState.addEventListener('change', (status) => {
      if (status !== 'active') {
        isPressingCard.current = false;
        flipValue.stopAnimation();
        flipValue.setValue(0);
        setIsCardHeld(false);
        setShowContent(false);
        setIsClosing(false);
        setRevealedIllustration(null);
      }
    });
    const back = BackHandler.addEventListener('hardwareBackPress', () => true);
    return () => {
      mounted.current = false;
      background.remove();
      back.remove();
      flipValue.stopAnimation();
      slideValue.stopAnimation();
      opacityValue.stopAnimation();
    };
  }, [flipValue, slideValue, opacityValue]);

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
    if (!round || !currentCard || transitionLocked.current) {
      return;
    }

    const image = selectRevealIllustration({
      ready: failedIllustration?.roundId === round.id
        && failedIllustration.entryId === currentCard.illustrationEntryId
        ? null : readyIllustration,
      roundId: round.id,
      role: currentCard.role,
      entryId: currentCard.illustrationEntryId,
      size: illustrationSize,
    });
    // Freeze artwork readiness for this reveal so late decoding cannot move the word.
    setRevealedCardIdentity({ roundId: round.id, playerId: currentCard.playerId });
    setRevealedIllustration(image && currentCard.illustrationEntryId ? {
      roundId: round.id,
      playerId: currentCard.playerId,
      entryId: currentCard.illustrationEntryId,
      image,
      size: illustrationSize,
    } : null);
    isPressingCard.current = true;
    setIsCardHeld(true);
    setShowContent(true);
    setIsClosing(false);
    flipValue.stopAnimation();
    Animated.timing(flipValue, {
      toValue: 1,
      duration: reduceMotion ? 0 : FLIP_DURATION,
      easing: Easing.bezier(0.2, 0.8, 0.2, 1),
      useNativeDriver: true,
    }).start(({ finished }) => {
      if (finished && mounted.current && isPressingCard.current) {
        setHasSeenCard(true);
        void Haptics.selectionAsync().catch(() => {});
      }
    });
  };

  const hideCard = () => {
    if (transitionLocked.current || !isPressingCard.current) {
      return;
    }

    isPressingCard.current = false;
    setIsCardHeld(false);
    setIsClosing(true);
    flipValue.stopAnimation();
    Animated.timing(flipValue, {
      toValue: 0,
      duration: reduceMotion ? 0 : FLIP_DURATION,
      easing: Easing.bezier(0.2, 0.8, 0.2, 1),
      useNativeDriver: true,
    }).start(({ finished }) => {
      if (finished && mounted.current && !isPressingCard.current) {
        setShowContent(false);
        setIsClosing(false);
        setRevealedIllustration(null);
      }
    });
  };

  const showNextPlayer = () => {
    if (!round || !canContinue || isLastPlayer || transitionLocked.current) {
      return;
    }

    transitionLocked.current = true;
    setIsSliding(true);
    Animated.parallel([
      Animated.timing(slideValue, {
        toValue: -width,
        duration: reduceMotion ? 0 : CARD_EXIT_DURATION,
        useNativeDriver: true,
      }),
      Animated.timing(opacityValue, {
        toValue: 0,
        duration: reduceMotion ? 0 : CARD_EXIT_DURATION,
        useNativeDriver: true,
      }),
    ]).start(({ finished }) => {
      if (!finished || !mounted.current) return;
      advanceReveal();
      setHasSeenCard(false);
      setShowContent(false);
      setRevealedIllustration(null);
      setIsCardHeld(false);
      isPressingCard.current = false;
      flipValue.setValue(0);
      slideValue.setValue(width);

      Animated.parallel([
        Animated.timing(slideValue, {
          toValue: 0,
          duration: reduceMotion ? 0 : CARD_ENTER_DURATION,
          useNativeDriver: true,
        }),
        Animated.timing(opacityValue, {
          toValue: 1,
          duration: reduceMotion ? 0 : CARD_ENTER_DURATION,
          useNativeDriver: true,
        }),
      ]).start(() => {
        if (!mounted.current) return;
        transitionLocked.current = false;
        setIsSliding(false);
      });
    });
  };

  const startTimer = () => {
    if (!canContinue || !isLastPlayer || transitionLocked.current) {
      return;
    }

    transitionLocked.current = true;
    startPlaying();
    router.replace('/play');
  };

  if (!round || !currentPlayer || !currentCard) {
    return <Screen style={styles.screen} />;
  }

  return (
    <Screen style={styles.screen}>
      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        <View style={styles.header}>
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
              accessibilityLabel={isCurrentCardHeld
                ? currentCard.role === 'imposter'
                  ? `Imposter. ${currentCard.hint ? `Hint: ${currentCard.hint}.` : 'No hint this round.'} Activate to hide.`
                  : `Secret word: ${currentCard.word}. Activate to hide.`
                : `Reveal ${currentPlayer.name}'s card`}
              accessibilityHint={screenReader ? 'Activate to reveal. Keep the phone private; your screen reader will read the card.' : 'Hold to reveal. Release to hide before passing the phone.'}
              accessibilityState={{ expanded: isCurrentCardHeld, disabled: isSliding }}
              disabled={isSliding}
              onPressIn={screenReader ? undefined : revealCard}
              onPressOut={screenReader ? undefined : hideCard}
              onPress={screenReader ? () => isPressingCard.current ? hideCard() : revealCard() : undefined}
              style={[styles.cardPressable, { minHeight: cardMinHeight }]}>
              <Animated.View aria-hidden accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={[styles.cardFace, styles.cardFront, frontFaceStyle]}>
                <View style={styles.frontIcon}>
                  <MaterialIcons name="touch-app" size={42} color={Colors.text} />
                </View>
                <Text variant="heading" align="center" style={styles.frontTitle}>
                  {screenReader ? 'Tap to reveal' : 'Hold to reveal'}
                </Text>
                <Text variant="bodySmall" align="center" color="muted">
                  {currentPlayer.name}
                </Text>
              </Animated.View>

              <Animated.View
                aria-hidden
                accessibilityElementsHidden
                importantForAccessibility="no-hide-descendants"
                style={[
                  styles.cardFace,
                  styles.cardBack,
                  backFaceStyle,
                ]}>
                {showCurrentContent && currentCard.role === 'imposter' ? (
                  <>
                    <TransparentImposterIcon size={92} />
                    <Text
                      variant="display"
                      align="center"
                      adjustsFontSizeToFit
                      minimumFontScale={0.6}
                      numberOfLines={1}
                      style={styles.imposterTitle}>
                      IMPOSTER
                    </Text>
                    <Text variant="bodyEmphasis" align="center" color="muted">
                      {currentCard.hint ? 'Hint' : 'No hint this round'}
                    </Text>
                    {currentCard.hint ? (
                      <Text
                        variant="title"
                        align="center"
                        adjustsFontSizeToFit
                        minimumFontScale={0.6}
                        numberOfLines={3}
                        style={styles.hintWord}>
                        {currentCard.hint}
                      </Text>
                    ) : null}
                  </>
                ) : null}

                {showCurrentContent && currentCard.role === 'regular' ? (
                  <>
                    {currentIllustration && illustrationSize > 0 ? (
                      <WordIllustration
                        image={currentIllustration.image}
                        size={Math.min(currentIllustration.size, illustrationSize)}
                        onError={() => setFailedIllustration({
                          roundId: currentIllustration.roundId,
                          entryId: currentIllustration.entryId,
                        })}
                      />
                    ) : null}
                    <Text variant="bodyEmphasis" align="center" color="muted">
                      Secret Word
                    </Text>
                    <Text
                      variant="display"
                      align="center"
                      adjustsFontSizeToFit
                      minimumFontScale={0.6}
                      numberOfLines={3}
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
              label={isLastPlayer ? 'Start talking' : `Pass to ${round.players[state.currentRevealIndex + 1]?.name}`}
              size="lg"
              fullWidth
              accessibilityLabel={isLastPlayer ? 'Start talking' : 'Next player'}
              onPress={isLastPlayer ? startTimer : showNextPlayer}
              leadingIcon={
                <MaterialIcons
                  name={isLastPlayer ? 'timer' : 'arrow-forward'}
                  size={22}
                  color={Colors.textOnPrimary}
                />
              }
            />
          ) : (
            <Text variant="bodySmall" align="center" color="muted">
              {isCardHeld ? screenReader ? 'Keep it secret. Tap again to hide.' : 'Keep it secret. Release to hide.' : 'Only look at your own card.'}
            </Text>
          )}
        </View>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    paddingTop: Spacing.lg,
    paddingBottom: Spacing.xl,
  },
  scrollContent: {
    flexGrow: 1,
    justifyContent: 'space-between',
    gap: Spacing.lg,
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
    minHeight: 0,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.lg,
    borderRadius: Radii.xxl,
    borderWidth: 1,
    borderColor: Colors.border,
    paddingHorizontal: Spacing.xl,
    paddingVertical: Spacing.xl,
    backfaceVisibility: 'hidden',
    ...Shadows.lg,
  },
  cardFront: {
    backgroundColor: Colors.surfaceRaised,
  },
  cardBack: {
    backgroundColor: Colors.surfaceRaised,
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
    width: '100%',
  },
  hintWord: {
    color: Colors.text,
    letterSpacing: 0,
    width: '100%',
  },
  secretWord: {
    color: Colors.text,
    letterSpacing: 0,
    width: '100%',
  },
  actionSlot: {
    minHeight: 68,
    width: '100%',
    maxWidth: 420,
    alignSelf: 'center',
    justifyContent: 'center',
  },
});
