import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { StyleSheet } from 'react-native';
import Animated, {
  Easing,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withSequence,
  withTiming,
} from 'react-native-reanimated';

import { AnimatedImposterLogo } from '@/components/splash/AnimatedImposterLogo';
import { Colors } from '@/constants/theme';

const LOGO_SIZE = 220;
const ENTER_MS = 260;
const GLANCE_DELAY_MS = 300;
const GLANCE_OUT_MS = 180;
const GLANCE_BACK_MS = 300;
const BLINK_DELAY_MS = 520;
const BLINK_CLOSE_MS = 88;
const BLINK_OPEN_MS = 150;
const EXIT_DELAY_MS = 1650;
const EXIT_MS = 220;

const premiumEase = Easing.bezier(0.2, 0.8, 0.2, 1);
const blinkEase = Easing.bezier(0.5, 0, 0.2, 1);

export function SplashGate() {
  const [isVisible, setIsVisible] = useState(true);
  const overlayOpacity = useSharedValue(1);
  const introProgress = useSharedValue(0);
  const blinkProgress = useSharedValue(0);
  const glanceProgress = useSharedValue(0);

  useEffect(() => {
    introProgress.value = withTiming(1, {
      duration: ENTER_MS,
      easing: premiumEase,
    });

    glanceProgress.value = withDelay(
      GLANCE_DELAY_MS,
      withSequence(
        withTiming(1, { duration: GLANCE_OUT_MS, easing: premiumEase }),
        withTiming(0, { duration: GLANCE_BACK_MS, easing: premiumEase })
      )
    );

    blinkProgress.value = withDelay(
      BLINK_DELAY_MS,
      withSequence(
        withTiming(1, { duration: BLINK_CLOSE_MS, easing: blinkEase }),
        withTiming(0, { duration: BLINK_OPEN_MS, easing: premiumEase })
      )
    );

    overlayOpacity.value = withDelay(
      EXIT_DELAY_MS,
      withTiming(0, { duration: EXIT_MS, easing: premiumEase }, (finished) => {
        if (finished) {
          runOnJS(setIsVisible)(false);
        }
      })
    );
  }, [blinkProgress, glanceProgress, introProgress, overlayOpacity]);

  const overlayStyle = useAnimatedStyle(() => ({
    opacity: overlayOpacity.value,
  }));

  if (!isVisible) {
    return null;
  }

  return (
    <Animated.View style={[styles.overlay, overlayStyle]}>
      <StatusBar style="dark" />
      <AnimatedImposterLogo
        size={LOGO_SIZE}
        introProgress={introProgress}
        blinkProgress={blinkProgress}
        glanceProgress={glanceProgress}
      />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.background,
    zIndex: 100,
  },
});
