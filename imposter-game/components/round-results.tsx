import * as Haptics from 'expo-haptics';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Animated, AppState, Easing, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import Reanimated, { FadeIn } from 'react-native-reanimated';

import { TransparentImposterIcon } from '@/components/imposter/TransparentImposterIcon';
import { Screen } from '@/components/ui/screen';
import { Text } from '@/components/ui/text';
import { Colors, Radii, Shadows, Spacing } from '@/constants/theme';
import { RESULT_FLIP_DURATION, startResultReveal } from '@/game/resultReveal';
import type { Round } from '@/game/types';
import { useAccessibilitySettings } from '@/hooks/use-accessibility-settings';

const RESULT_ACCENT = '#FF6378';

type RoundResultsProps = {
  round: Round;
  onRevealComplete: () => void;
  children: ReactNode;
};

export function RoundResults({ round, onRevealComplete, children }: RoundResultsProps) {
  const { reduceMotion, screenReader } = useAccessibilitySettings();
  const imposters = round.players.filter((player) => round.imposterPlayerIds.includes(player.id));
  const imposterHint = round.cards.find((card) => card.role === 'imposter')?.hint;
  const [visibleNames, setVisibleNames] = useState(0);
  const [wordVisible, setWordVisible] = useState(false);
  const [ready, setReady] = useState(false);
  const finished = useRef(false);
  const skip = useRef<() => void>(() => {});
  const scale = useRef(new Animated.Value(1)).current;
  const flip = useRef(new Animated.Value(0)).current;
  const dim = useRef(new Animated.Value(0)).current;
  const wordOpacity = useRef(new Animated.Value(0)).current;
  const eyeOpenness = useRef(new Animated.Value(1)).current;
  const imposterCount = imposters.length;

  useEffect(() => {
    if (finished.current) {
      dim.setValue(0);
      wordOpacity.setValue(1);
      return;
    }
    let active = true;
    let instant = reduceMotion || screenReader;
    const stopAnimations = () => {
      scale.stopAnimation();
      flip.stopAnimation();
      dim.stopAnimation();
      wordOpacity.stopAnimation();
    };
    const sequence = startResultReveal({
      imposterCount,
      onEvent: (event) => {
        if (!active) return;
        switch (event.type) {
          case 'beat':
            if (AppState.currentState !== 'active' && AppState.currentState !== null) return;
            void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
            Animated.sequence([
              Animated.timing(scale, { toValue: 1.035, duration: event.index === 2 ? 80 : 120, useNativeDriver: true }),
              Animated.timing(scale, { toValue: 1, duration: event.index === 2 ? 130 : 220, useNativeDriver: true }),
            ]).start();
            break;
          case 'flip':
            Animated.timing(flip, {
              toValue: 1,
              duration: RESULT_FLIP_DURATION,
              easing: Easing.inOut(Easing.cubic),
              useNativeDriver: true,
            }).start();
            break;
          case 'names':
            setVisibleNames(event.count);
            break;
          case 'word':
            setWordVisible(true);
            if (instant) wordOpacity.setValue(1);
            else Animated.timing(wordOpacity, { toValue: 1, duration: 280, useNativeDriver: true }).start();
            break;
          case 'complete':
            finished.current = true;
            scale.setValue(1);
            flip.setValue(1);
            if (instant) dim.setValue(0);
            else Animated.timing(dim, { toValue: 0, duration: 260, useNativeDriver: true }).start();
            setReady(true);
            onRevealComplete();
            break;
        }
      },
    });
    const revealImmediately = () => {
      if (finished.current) return;
      instant = true;
      stopAnimations();
      sequence.skip();
    };
    skip.current = revealImmediately;
    if (instant || (AppState.currentState !== 'active' && AppState.currentState !== null)) {
      revealImmediately();
    } else {
      Animated.timing(dim, { toValue: 1, duration: 300, useNativeDriver: true }).start();
    }
    const appState = AppState.addEventListener('change', (status) => {
      if (status !== 'active' && !finished.current) revealImmediately();
    });
    return () => {
      active = false;
      sequence.cancel();
      appState.remove();
      stopAnimations();
      skip.current = () => {};
    };
  }, [dim, flip, imposterCount, onRevealComplete, reduceMotion, scale, screenReader, wordOpacity]);

  useEffect(() => {
    eyeOpenness.setValue(1);
    if (!ready || reduceMotion || screenReader) return;

    let disposed = false;
    let foreground = AppState.currentState === 'active' || AppState.currentState === null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let animation: Animated.CompositeAnimation | undefined;

    const scheduleBlink = () => {
      if (disposed || !foreground) return;
      timer = setTimeout(() => {
        timer = undefined;
        if (disposed || !foreground) return;
        animation = Animated.sequence([
          Animated.timing(eyeOpenness, {
            toValue: 0.08,
            duration: 95,
            easing: Easing.in(Easing.quad),
            useNativeDriver: true,
            isInteraction: false,
          }),
          Animated.delay(45),
          Animated.timing(eyeOpenness, {
            toValue: 1,
            duration: 150,
            easing: Easing.out(Easing.quad),
            useNativeDriver: true,
            isInteraction: false,
          }),
        ]);
        animation.start(({ finished: blinkFinished }) => {
          if (blinkFinished) scheduleBlink();
        });
      }, 4200 + Math.random() * 2800);
    };
    const stopBlinking = () => {
      if (timer !== undefined) clearTimeout(timer);
      timer = undefined;
      animation?.stop();
      eyeOpenness.setValue(1);
    };

    scheduleBlink();
    const appState = AppState.addEventListener('change', (status) => {
      foreground = status === 'active';
      stopBlinking();
      if (foreground) scheduleBlink();
    });
    return () => {
      disposed = true;
      appState.remove();
      stopBlinking();
    };
  }, [eyeOpenness, ready, reduceMotion, screenReader]);

  return (
    <Screen padded={false}>
      <Animated.View pointerEvents="none" style={[styles.backdrop, { opacity: dim }]} />
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
        <View style={styles.stage}>
          <View style={styles.heading}>
            {ready ? <Text variant="bodyEmphasis" color="primary" align="center">Round complete</Text> : null}
          </View>
          <Animated.View style={[styles.card, { transform: [{ scale }] }]}>
            <Animated.View
              accessibilityElementsHidden={visibleNames === 0}
              importantForAccessibility={visibleNames === 0 ? 'no-hide-descendants' : 'auto'}
              style={[styles.face, styles.resultFace, {
                transform: [{ perspective: 1200 }, { rotateY: flip.interpolate({ inputRange: [0, 1], outputRange: ['-180deg', '0deg'] }) }],
              }]}>
              <View pointerEvents="none" style={styles.cardInset} />
              <Animated.View
                accessible={false}
                accessibilityElementsHidden
                importantForAccessibility="no-hide-descendants"
                style={{ transform: [{ scaleY: eyeOpenness }] }}>
                <TransparentImposterIcon size={88} color={RESULT_ACCENT} />
              </Animated.View>
              {visibleNames > 0 ? <Text variant="body" style={styles.secondaryText} align="center">
                {imposterCount === 1 ? 'The imposter was' : 'The imposters were'}
              </Text> : <View style={styles.labelSpace} />}
              <View style={[styles.names, { minHeight: imposterCount * 44 }]}>
                {imposters.slice(0, visibleNames).map((player) => (
                  <Reanimated.View key={player.id} entering={reduceMotion || screenReader ? undefined : FadeIn.duration(220)}>
                    <Text variant="title" align="center" style={styles.resultValue}>{player.name}</Text>
                  </Reanimated.View>
                ))}
              </View>
              <Animated.View style={[styles.word, imposterHint && styles.wordWithHint, { opacity: wordOpacity }]}>
                {wordVisible ? <>
                  <View style={styles.divider} />
                  <Text variant="body" style={styles.secondaryText} align="center">The secret word</Text>
                  <Text variant="title" align="center" style={[styles.resultValue, styles.secretWord]}>{round.secretWord}</Text>
                  {imposterHint ? <View style={styles.hint}>
                    <Text variant="body" style={styles.secondaryText} align="center">Imposter hint</Text>
                    <Text variant="subheading" align="center" style={styles.hintValue}>{imposterHint}</Text>
                  </View> : null}
                </> : null}
              </Animated.View>
            </Animated.View>
            <Animated.View
              pointerEvents="none"
              accessibilityElementsHidden
              importantForAccessibility="no-hide-descendants"
              style={[styles.face, styles.sealedFace, {
                transform: [{ perspective: 1200 }, { rotateY: flip.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '180deg'] }) }],
              }]}>
              <View style={styles.cardInset} />
              <View style={styles.cornerMark} />
              <TransparentImposterIcon size={192} color={RESULT_ACCENT} />
              <View style={[styles.cornerMark, styles.bottomMark]} />
            </Animated.View>
            {!ready ? <Pressable
              style={StyleSheet.absoluteFill}
              accessibilityRole="button"
              accessibilityLabel="Skip suspense and reveal results"
              onPress={() => skip.current()}
            /> : null}
          </Animated.View>
        </View>
        <View style={styles.actions}>
          {ready ? <Reanimated.View entering={reduceMotion || screenReader ? undefined : FadeIn.duration(260)}>{children}</Reanimated.View> : null}
        </View>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: Colors.overlay },
  content: { flexGrow: 1, alignItems: 'center', justifyContent: 'space-between', padding: Spacing.xl, gap: Spacing.lg },
  stage: { flexGrow: 1, width: '100%', maxWidth: 360, gap: Spacing.xl },
  heading: { minHeight: 24 },
  card: { flexGrow: 1, width: '100%', ...Shadows.lg },
  face: { borderRadius: Radii.xxl, backfaceVisibility: 'hidden', borderWidth: 1, overflow: 'hidden' },
  resultFace: {
    flexGrow: 1,
    minHeight: 340,
    padding: Spacing.xl,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.md,
    backgroundColor: Colors.text,
    borderColor: 'rgba(255, 255, 255, 0.14)',
  },
  sealedFace: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.text,
    borderColor: Colors.text,
  },
  cardInset: { ...StyleSheet.absoluteFillObject, margin: Spacing.md, borderWidth: 1, borderColor: Colors.redBorder, borderRadius: Radii.xl },
  cornerMark: { position: 'absolute', width: 8, height: 8, top: Spacing.xl, left: Spacing.xl, backgroundColor: RESULT_ACCENT, transform: [{ rotate: '45deg' }] },
  bottomMark: { top: 'auto', left: 'auto', bottom: Spacing.xl, right: Spacing.xl },
  labelSpace: { height: 24 },
  names: { width: '100%', justifyContent: 'center', gap: Spacing.xs },
  resultValue: { fontSize: 36, lineHeight: 44, color: Colors.textInverse },
  secondaryText: { color: '#B9B8BE' },
  secretWord: { color: RESULT_ACCENT },
  word: { width: '100%', minHeight: 112, alignItems: 'center', gap: Spacing.sm },
  wordWithHint: { minHeight: 196 },
  hint: { width: '100%', alignItems: 'center', gap: Spacing.xs, marginTop: Spacing.md },
  hintValue: { fontSize: 22, lineHeight: 28, color: Colors.textInverse },
  divider: { width: '100%', height: 1, backgroundColor: 'rgba(255, 255, 255, 0.14)', marginVertical: Spacing.sm },
  actions: { width: '100%', maxWidth: 420, minHeight: 120 },
});
