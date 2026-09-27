import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  Animated,
  AppState,
  BackHandler,
  Easing,
  PanResponder,
  Platform,
  ScrollView,
  StyleSheet,
  View,
  useWindowDimensions,
} from 'react-native';

import { TransparentImposterIcon } from '@/components/imposter/TransparentImposterIcon';
import { TutorialScene } from '@/components/onboarding/TutorialScene';
import { Screen } from '@/components/ui/screen';
import { Text } from '@/components/ui/text';
import { Colors, Spacing } from '@/constants/theme';
import { getTutorialSwipeDirection } from '@/game/tutorialNavigation';
import { useAccessibilitySettings } from '@/hooks/use-accessibility-settings';

type TutorialProps = {
  onFinish: (outcome: 'completed' | 'skipped') => void;
  replay?: boolean;
};

const PAPER = '#FFF4DC';
const BACKGROUND = Platform.OS === 'web' ? Colors.accent : '#A62C39';
const STEPS = [
  {
    title: 'One secret.\nOne imposter.',
    description: 'Peek, hide, then pass the phone.\nThe imposter doesn’t get the word.',
  },
  {
    title: 'Give a clue.\nSell the bluff.',
    description: 'Take turns giving clues. Never say the word.\nImposters, act like you know it.',
  },
  {
    title: 'Who’s the\nimposter?',
    description: 'Vote out loud. Reveal who was bluffing.\nThen go again.',
  },
] as const;

export function Tutorial({ onFinish, replay = false }: TutorialProps) {
  const window = useWindowDimensions();
  const { reduceMotion } = useAccessibilitySettings();
  const [step, setStep] = useState(0);
  const [frame, setFrame] = useState({ width: window.width, height: window.height - 180 });
  const [foreground, setForeground] = useState(AppState.currentState !== 'background');
  const offset = useRef(new Animated.Value(0)).current;
  const nudge = useRef(new Animated.Value(0)).current;
  const pageRef = useRef(0);
  const widthRef = useRef(frame.width);
  const transition = useRef(false);
  const finished = useRef(false);
  const mounted = useRef(true);
  const gestureStart = useRef(0);
  const finishRef = useRef(onFinish);
  finishRef.current = onFinish;
  const compact = frame.width < 350 || frame.height < 490;
  const sceneSize = Math.max(120, Math.min(390, frame.width - 32, frame.height - (compact ? 172 : 200) * window.fontScale));
  const nativeDriver = Platform.OS !== 'web';

  const resetPosition = useCallback(() => {
    offset.stopAnimation();
    offset.setValue(-pageRef.current * widthRef.current);
    transition.current = false;
  }, [offset]);

  const navigate = useCallback((direction: -1 | 0 | 1) => {
    if (transition.current || finished.current) return;
    const current = pageRef.current;
    const next = Math.max(0, Math.min(STEPS.length, current + direction));
    const completing = next === STEPS.length;
    transition.current = true;
    if (!completing) {
      pageRef.current = next;
      setStep(next);
    }
    Animated.timing(offset, {
      toValue: -next * widthRef.current,
      duration: reduceMotion ? 0 : completing ? 240 : 360,
      easing: Easing.bezier(0.2, 0.8, 0.2, 1),
      useNativeDriver: nativeDriver,
    }).start(({ finished: animationFinished }) => {
      if (!mounted.current) return;
      transition.current = false;
      if (!animationFinished) return;
      if (completing) {
        if (finished.current) return;
        finished.current = true;
        finishRef.current('completed');
      } else if (next !== current && Platform.OS !== 'web') {
        AccessibilityInfo.announceForAccessibility(`Page ${next + 1} of 3. ${STEPS[next].title.replace('\n', ' ')} ${STEPS[next].description.replace('\n', ' ')}`);
      }
    });
  }, [nativeDriver, offset, reduceMotion]);

  const panResponder = useMemo(() => PanResponder.create({
    onMoveShouldSetPanResponder: (_, gesture) => !transition.current && !finished.current &&
      Math.abs(gesture.dx) > 10 && Math.abs(gesture.dx) > Math.abs(gesture.dy) * 1.3,
    onPanResponderGrant: () => {
      gestureStart.current = -pageRef.current * widthRef.current;
      offset.stopAnimation();
    },
    onPanResponderMove: (_, gesture) => {
      if (transition.current || finished.current) return;
      const drag = pageRef.current === 0 && gesture.dx > 0 ? gesture.dx * 0.18 : gesture.dx;
      offset.setValue(gestureStart.current + Math.max(-widthRef.current, Math.min(widthRef.current, drag)));
    },
    onPanResponderRelease: (_, gesture) => {
      navigate(getTutorialSwipeDirection({ dx: gesture.dx, dy: gesture.dy, vx: gesture.vx, width: widthRef.current }));
    },
    onPanResponderTerminate: resetPosition,
    onPanResponderTerminationRequest: () => true,
  }), [navigate, offset, resetPosition]);

  useEffect(() => {
    widthRef.current = frame.width;
    resetPosition();
  }, [frame.width, resetPosition]);

  useEffect(() => {
    mounted.current = true;
    const subscription = AppState.addEventListener('change', (state) => {
      setForeground(state === 'active');
      if (state !== 'active') resetPosition();
    });
    return () => {
      mounted.current = false;
      subscription.remove();
      offset.stopAnimation();
    };
  }, [offset, resetPosition]);

  useEffect(() => {
    nudge.setValue(0);
    if (reduceMotion || !foreground) return;
    const animation = Animated.loop(Animated.sequence([
      Animated.timing(nudge, { toValue: 1, duration: 900, easing: Easing.inOut(Easing.sin), useNativeDriver: nativeDriver, isInteraction: false }),
      Animated.timing(nudge, { toValue: 0, duration: 900, easing: Easing.inOut(Easing.sin), useNativeDriver: nativeDriver, isInteraction: false }),
    ]));
    animation.start();
    return () => animation.stop();
  }, [foreground, nativeDriver, nudge, reduceMotion]);

  useEffect(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      if (transition.current) return true;
      if (pageRef.current > 0) navigate(-1);
      else if (replay && !finished.current) {
        finished.current = true;
        finishRef.current('skipped');
      } else return false;
      return true;
    });
    return () => subscription.remove();
  }, [navigate, replay]);

  const webKeyboard = Platform.OS === 'web' ? {
    onKeyDown: (event: { key: string; repeat: boolean; preventDefault: () => void }) => {
      if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return;
      event.preventDefault();
      if (!event.repeat) navigate(event.key === 'ArrowRight' ? 1 : -1);
    },
  } : {};

  return (
    <Screen padded={false} style={styles.screen} {...panResponder.panHandlers}>
      <StatusBar style="light" />
      <View style={styles.header} accessible={false} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" aria-hidden>
        <View style={styles.brand}>
          <TransparentImposterIcon size={37} color={PAPER} />
          <Text style={styles.wordmark}>IMPOSTER</Text>
        </View>
        <Text style={styles.playerCount}>3–10 FRIENDS · 1 PHONE</Text>
      </View>

      <View
        style={styles.viewport}
        onLayout={({ nativeEvent: { layout } }) => {
          if (layout.width > 0 && layout.height > 0) setFrame({ width: layout.width, height: layout.height });
        }}
        {...webKeyboard}
        accessible
        focusable
        tabIndex={0}
        accessibilityRole="adjustable"
        accessibilityLabel={`How to play. ${step === 0 ? '3 to 10 friends, one phone. ' : ''}${STEPS[step].title.replace('\n', ' ')} ${STEPS[step].description.replace('\n', ' ')}`}
        accessibilityHint={Platform.OS === 'web' ? 'Swipe left or use the right arrow key to continue. Use the left arrow key to go back.' : 'Swipe up for the next page, down for the previous page. Continue past the last page to play.'}
        accessibilityValue={{ text: `Page ${step + 1} of 3` }}
        accessibilityActions={[{ name: 'increment', label: step === 2 ? 'Start playing' : 'Next page' }, { name: 'decrement', label: 'Previous page' }]}
        onAccessibilityAction={({ nativeEvent }) => {
          if (nativeEvent.actionName === 'increment') navigate(1);
          if (nativeEvent.actionName === 'decrement') navigate(-1);
        }}>
        <Animated.View style={[styles.strip, { width: frame.width * STEPS.length, transform: [{ translateX: offset }] }]}>
          {STEPS.map((item, index) => {
            const inputRange = [-(index + 1) * frame.width, -index * frame.width, -(index - 1) * frame.width];
            const center = {
              opacity: offset.interpolate({ inputRange, outputRange: [0.2, 1, 0.2], extrapolate: 'clamp' }),
              transform: [
                { scale: offset.interpolate({ inputRange, outputRange: [0.82, 1, 0.82], extrapolate: 'clamp' }) },
                { rotate: offset.interpolate({ inputRange, outputRange: ['-7deg', '0deg', '7deg'], extrapolate: 'clamp' }) },
              ],
            };
            return (
              <View
                key={item.title}
                style={[styles.page, { width: frame.width }]}
                accessibilityElementsHidden
                importantForAccessibility="no-hide-descendants"
                aria-hidden>
                <ScrollView
                  scrollEnabled={window.fontScale > 1.3}
                  showsVerticalScrollIndicator={false}
                  contentContainerStyle={styles.pageContent}>
                  <Animated.View pointerEvents="none" style={[styles.art, center]}>
                    <TutorialScene scene={index as 0 | 1 | 2} active={index === step && foreground} reduceMotion={reduceMotion} size={sceneSize} />
                  </Animated.View>
                  <Animated.View style={[styles.copy, {
                    opacity: offset.interpolate({ inputRange, outputRange: [0, 1, 0], extrapolate: 'clamp' }),
                    transform: [{ translateY: offset.interpolate({ inputRange, outputRange: [20, 0, 20], extrapolate: 'clamp' }) }],
                  }]}>
                    <Text variant="display" align="center" style={[styles.title, compact && styles.titleCompact]}>{item.title}</Text>
                    <Text align="center" style={[styles.description, compact && styles.descriptionCompact]}>{item.description}</Text>
                  </Animated.View>
                </ScrollView>
              </View>
            );
          })}
        </Animated.View>
      </View>

      <View style={styles.footer} accessible={false} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" aria-hidden>
        <View style={styles.dots}>
          {STEPS.map((item, index) => (
            <View key={item.title} style={styles.dotSlot}>
              <Animated.View style={[styles.dot, {
                opacity: offset.interpolate({ inputRange: [-(index + 1) * frame.width, -index * frame.width, -(index - 1) * frame.width], outputRange: [0.3, 1, 0.3], extrapolate: 'clamp' }),
                transform: [{ scaleX: offset.interpolate({ inputRange: [-(index + 1) * frame.width, -index * frame.width, -(index - 1) * frame.width], outputRange: [1, 2.8, 1], extrapolate: 'clamp' }) }],
              }]} />
            </View>
          ))}
        </View>
        <View style={styles.swipeCue}>
          <Text style={styles.swipeText}>{step === 2 ? replay ? 'Swipe left to return' : 'Swipe left to play' : 'Swipe left'}</Text>
          <Animated.View style={{ transform: [{ translateX: nudge.interpolate({ inputRange: [0, 1], outputRange: [0, -8] }) }] }}>
            <MaterialIcons name="west" color={PAPER} size={23} />
          </Animated.View>
        </View>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  screen: { backgroundColor: BACKGROUND },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.sm, paddingHorizontal: Spacing.xl, paddingTop: Spacing.md, paddingBottom: Spacing.sm },
  brand: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  wordmark: { color: PAPER, fontSize: 13, fontWeight: '800', letterSpacing: 1.5 },
  playerCount: { color: PAPER, opacity: 0.7, fontSize: 9, letterSpacing: 0.8, lineHeight: 14, flexShrink: 1, textAlign: 'right' },
  viewport: { flex: 1, overflow: 'hidden' },
  strip: { height: '100%', flexDirection: 'row' },
  page: { height: '100%' },
  pageContent: { flexGrow: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: Spacing.md, gap: Spacing.lg },
  art: { alignItems: 'center', justifyContent: 'center' },
  copy: { width: '100%', maxWidth: 510, paddingHorizontal: Spacing.xl, gap: Spacing.lg, paddingBottom: Spacing.md },
  title: { color: PAPER, fontSize: 42, lineHeight: 46, letterSpacing: -1.5 },
  titleCompact: { fontSize: 34, lineHeight: 38 },
  description: { color: PAPER, opacity: 0.86, fontSize: 15, lineHeight: 23 },
  descriptionCompact: { fontSize: 13, lineHeight: 20 },
  footer: { alignItems: 'center', gap: Spacing.lg, paddingTop: Spacing.lg, paddingBottom: Spacing.xl },
  dots: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  dotSlot: { width: 29, height: 8, alignItems: 'center' },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: PAPER },
  swipeCue: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  swipeText: { fontSize: 12, color: PAPER, lineHeight: 20, letterSpacing: 0.4 },
});
