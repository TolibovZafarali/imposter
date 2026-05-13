import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Button } from '@/components/ui/button';
import { Screen } from '@/components/ui/screen';
import { Text } from '@/components/ui/text';
import { Colors, Radii, Shadows, Spacing } from '@/constants/theme';
import { useGame } from '@/contexts/game-context';

const GAME_DURATION_SECONDS = 180;

const formatTime = (seconds: number) => {
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;

  return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
};

export default function PlayScreen() {
  const router = useRouter();
  const { state, resetGame } = useGame();
  const [remainingSeconds, setRemainingSeconds] = useState(GAME_DURATION_SECONDS);
  const round = state.round;

  const firstSpeaker = useMemo(
    () => round?.players.find((player) => player.id === round.firstSpeakerId) ?? null,
    [round]
  );
  const isTimeUp = remainingSeconds === 0;

  useEffect(() => {
    if (!round || state.phase !== 'playing') {
      router.replace('/');
    }
  }, [round, router, state.phase]);

  useEffect(() => {
    if (!round || state.phase !== 'playing') {
      return;
    }

    setRemainingSeconds(GAME_DURATION_SECONDS);

    const timerId = setInterval(() => {
      setRemainingSeconds((currentSeconds) => {
        if (currentSeconds <= 1) {
          clearInterval(timerId);
          return 0;
        }

        return currentSeconds - 1;
      });
    }, 1000);

    return () => clearInterval(timerId);
  }, [round, state.phase]);

  const returnToSetup = () => {
    resetGame();
    router.replace('/');
  };

  if (!round || !firstSpeaker) {
    return <Screen style={styles.screen} />;
  }

  return (
    <Screen style={styles.screen}>
      <View style={styles.content}>
        <View style={[styles.timerRing, isTimeUp && styles.timerRingDone]}>
          <Text
            variant="display"
            align="center"
            adjustsFontSizeToFit
            minimumFontScale={0.78}
            numberOfLines={1}
            style={styles.timerText}>
            {formatTime(remainingSeconds)}
          </Text>
        </View>

        <View style={styles.statusBlock}>
          <Text variant="bodyEmphasis" align="center" color={isTimeUp ? 'primary' : 'muted'}>
            {isTimeUp ? "Time's up" : 'First Speaker'}
          </Text>
          <Text
            variant="title"
            align="center"
            adjustsFontSizeToFit
            minimumFontScale={0.78}
            numberOfLines={1}
            style={styles.speakerName}>
            {firstSpeaker.name}
          </Text>
          <Text variant="body" align="center" color="muted" style={styles.statusText}>
            {isTimeUp
              ? 'Move to voting when the next phase is ready.'
              : 'starts with a similar word.'}
          </Text>
        </View>
      </View>

      <View style={styles.actions}>
        <Button
          label="Back to Setup"
          variant="ghost"
          fullWidth
          accessibilityLabel="Back to Setup"
          onPress={returnToSetup}
          leadingIcon={<MaterialIcons name="home" size={20} color={Colors.text} />}
        />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    justifyContent: 'space-between',
    paddingTop: Spacing.xxxl,
    paddingBottom: Spacing.xl,
  },
  content: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.xxxl,
  },
  timerRing: {
    width: 220,
    height: 220,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: Radii.pill,
    borderWidth: 2,
    borderColor: Colors.border,
    backgroundColor: 'rgba(250, 247, 242, 0.08)',
    ...Shadows.lg,
  },
  timerRingDone: {
    borderColor: 'rgba(255, 116, 132, 0.62)',
    backgroundColor: 'rgba(182, 25, 46, 0.22)',
  },
  timerText: {
    letterSpacing: 0,
  },
  statusBlock: {
    width: '100%',
    maxWidth: 420,
    alignItems: 'center',
    gap: Spacing.md,
  },
  speakerName: {
    letterSpacing: 0,
  },
  statusText: {
    maxWidth: 280,
  },
  actions: {
    width: '100%',
    maxWidth: 420,
    alignSelf: 'center',
  },
});
