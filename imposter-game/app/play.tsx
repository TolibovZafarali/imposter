import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Alert, AppState, BackHandler, ScrollView, StyleSheet, View } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';

import { Button } from '@/components/ui/button';
import { Screen } from '@/components/ui/screen';
import { Text } from '@/components/ui/text';
import { Colors, Radii, Shadows, Spacing } from '@/constants/theme';
import { useGame } from '@/contexts/game-context';
import { useLanguageSettings } from '@/contexts/language-settings';
import { CATEGORY_LABELS, selectRandomCategoryIds } from '@/data/wordBank';
import { remainingRoundSeconds } from '@/game/timer';
import { useAccessibilitySettings } from '@/hooks/use-accessibility-settings';
import { createRound } from '@/services/roundGenerator';
import { engagementStore, requestMilestoneReview } from '@/services/engagement';
import { discardPreparedAd, prepareResultAd, showCompletedRoundAd } from '@/services/ads';

const formatTime = (seconds: number) => `${Math.floor(seconds / 60)}:${(seconds % 60).toString().padStart(2, '0')}`;

export default function PlayScreen() {
  const router = useRouter();
  const { state, setupPreferences, resetGame, completeRound, startRound } = useGame();
  const { selectedLanguage } = useLanguageSettings();
  const { reduceMotion } = useAccessibilitySettings();
  const [now, setNow] = useState(Date.now());
  const [confirmFinish, setConfirmFinish] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const busyRef = useRef(false);
  const onResults = useRef(false);
  const mounted = useRef(true);
  const round = state.round;
  const completed = state.phase === 'completed';
  const duration = round?.config.roundTimerMinutes ? round.config.roundTimerMinutes * 60 : null;
  const seconds = duration !== null && state.playStartedAt !== null
    ? remainingRoundSeconds(state.playStartedAt, duration, now) : 0;
  const timeUp = duration !== null && seconds === 0;
  const firstSpeaker = round?.players.find((player) => player.id === round.firstSpeakerId);

  useEffect(() => {
    if (!round) router.replace('/');
    else if (state.phase === 'reveal') router.replace('/reveal');
    else if (state.phase === 'setup') router.replace('/');
  }, [round, router, state.phase]);

  useEffect(() => {
    mounted.current = true;
    const back = BackHandler.addEventListener('hardwareBackPress', () => true);
    return () => { mounted.current = false; onResults.current = false; back.remove(); discardPreparedAd(); };
  }, []);

  useEffect(() => {
    if (completed || duration === null) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 500);
    const appState = AppState.addEventListener('change', (status) => {
      if (status === 'active') setNow(Date.now());
    });
    return () => { clearInterval(timer); appState.remove(); };
  }, [completed, duration]);

  useEffect(() => {
    if (timeUp && !completed) void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
  }, [timeUp, completed]);

  useEffect(() => {
    onResults.current = completed;
    if (!completed || !round) return;
    const stillHere = () => onResults.current && mounted.current && !busyRef.current;
    let active = true;
    const reviewTimer = setTimeout(() => {
      if (active) void requestMilestoneReview(stillHere);
    }, 4000);
    void engagementStore.complete(round.id).then(() => {
      if (active) void prepareResultAd(stillHere);
    }).catch(() => {});
    return () => { active = false; onResults.current = false; clearTimeout(reviewTimer); discardPreparedAd(); };
  }, [completed, round]);

  const leaveResults = async (replay: boolean) => {
    if (!round || busyRef.current || !completed) return;
    busyRef.current = true;
    setBusy(true);
    setError(null);
    try {
      await engagementStore.complete(round.id).catch(() => {});
      await showCompletedRoundAd(() => onResults.current && mounted.current);
      if (!mounted.current) return;
      if (!replay) {
        onResults.current = false;
        resetGame();
        router.replace('/');
        return;
      }
      const next = await createRound({
        players: setupPreferences.players,
        categoryIds: setupPreferences.isRandomCategoryMode
          ? selectRandomCategoryIds({ categoryIds: Object.keys(CATEGORY_LABELS), count: 1 })
          : setupPreferences.selectedCategoryIds,
        difficulty: setupPreferences.selectedDifficulty,
        languageId: selectedLanguage.id,
        languageName: selectedLanguage.name,
        imposterCount: setupPreferences.imposterCount,
        isImposterHintEnabled: setupPreferences.isImposterHintEnabled,
        roundTimerMinutes: setupPreferences.roundTimerMinutes,
      });
      if (!mounted.current) return;
      onResults.current = false;
      startRound(next);
      router.replace('/reveal');
    } catch {
      if (mounted.current) setError('The next round could not load. Check your connection and try again, or change categories in setup.');
    } finally {
      busyRef.current = false;
      if (mounted.current) setBusy(false);
    }
  };

  const abandonRound = () => Alert.alert('Leave this round?', 'Your group and settings will stay ready for another game.', [
    { text: 'Keep playing', style: 'cancel' },
    { text: 'Leave round', style: 'destructive', onPress: () => { resetGame(); router.replace('/'); } },
  ]);

  if (!round || !firstSpeaker) return <Screen />;
  const imposterNames = round.players.filter((player) => round.imposterPlayerIds.includes(player.id)).map((player) => player.name);

  return (
    <Screen style={styles.screen}>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
        {completed ? (
          <Animated.View entering={reduceMotion ? undefined : FadeIn.duration(260)} style={styles.results}>
            <Text variant="bodyEmphasis" color="primary" align="center">Round complete</Text>
            <View style={styles.resultCard}>
              <MaterialIcons name="visibility" size={36} color={Colors.primary} />
              <Text variant="bodySmall" color="muted" align="center">{imposterNames.length === 1 ? 'The imposter was' : 'The imposters were'}</Text>
              <Text variant="title" align="center">{imposterNames.join(' & ')}</Text>
              <View style={styles.divider} />
              <Text variant="bodySmall" color="muted" align="center">The secret word</Text>
              <Text variant="title" align="center" color="primary">{round.secretWord}</Text>
            </View>
            <Text variant="body" color="muted" align="center">New word. New roles. Same suspicious friends.</Text>
          </Animated.View>
        ) : (
          <View style={styles.results}>
            <Text variant="bodyEmphasis" color="primary" align="center">{timeUp ? 'Time to vote' : 'Let the guessing begin'}</Text>
            {duration !== null ? (
              <View style={[styles.timerRing, timeUp && styles.timerRingDone]} accessibilityLabel={`${formatTime(seconds)} remaining`}>
                <Text variant="display" align="center" style={styles.timerText}>{formatTime(seconds)}</Text>
              </View>
            ) : <MaterialIcons name="forum" size={64} color={Colors.primary} />}
            <View style={styles.statusBlock}>
              <Text variant="bodySmall" align="center" color="muted">{timeUp ? 'Make your call together' : 'First speaker'}</Text>
              <Text variant="title" align="center">{timeUp ? 'Who is bluffing?' : firstSpeaker.name}</Text>
              <Text variant="body" align="center" color="muted">
                {timeUp ? 'Discuss, count down from three, and point to your suspect. Reveal when everyone has voted.' : 'Give one clue without saying the word. Go around the group, then discuss and vote out loud.'}
              </Text>
            </View>
          </View>
        )}
        <View style={styles.actions}>
          {!completed && confirmFinish ? <View style={styles.resultCard}>
            <Text variant="heading" align="center">Everyone voted?</Text>
            <Text variant="bodySmall" color="muted" align="center">Agree on your vote out loud before revealing the word and imposters.</Text>
            <Button label="Reveal results" fullWidth onPress={completeRound} />
            <Button label="Keep playing" variant="secondary" fullWidth onPress={() => setConfirmFinish(false)} />
          </View> : null}
          {error ? <Text accessibilityRole="alert" variant="bodySmall" color="primary" align="center">{error}</Text> : null}
          <Button label={completed ? busy ? 'Getting ready…' : error ? 'Try next round again' : 'Play again' : 'Finish round'}
            size="lg" fullWidth disabled={busy || (!completed && confirmFinish)} accessibilityState={{ busy, disabled: busy || (!completed && confirmFinish) }}
            onPress={completed ? () => void leaveResults(true) : () => setConfirmFinish(true)}
            leadingIcon={<MaterialIcons name={completed ? 'replay' : 'visibility'} size={22} color={Colors.textOnPrimary} />} />
          <Button label={completed ? 'Change setup' : 'Leave round'} variant="ghost" fullWidth disabled={busy}
            onPress={completed ? () => void leaveResults(false) : abandonRound} />
        </View>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  screen: { paddingVertical: Spacing.xl },
  content: { flexGrow: 1, justifyContent: 'space-between', alignItems: 'center', gap: Spacing.xxl },
  results: { flex: 1, width: '100%', maxWidth: 420, justifyContent: 'center', alignItems: 'center', gap: Spacing.xl },
  resultCard: { width: '100%', alignItems: 'center', gap: Spacing.md, padding: Spacing.xl, borderRadius: Radii.xxl,
    backgroundColor: Colors.surfaceRaised, borderWidth: 1, borderColor: Colors.border, ...Shadows.md },
  divider: { width: '100%', height: 1, backgroundColor: Colors.border, marginVertical: Spacing.sm },
  timerRing: { width: 220, height: 220, alignItems: 'center', justifyContent: 'center', borderRadius: Radii.pill,
    borderWidth: 2, borderColor: Colors.border, backgroundColor: Colors.surfaceRaised, ...Shadows.md },
  timerRingDone: { borderColor: Colors.redBorder, backgroundColor: Colors.redSurfaceStrong },
  timerText: { fontVariant: ['tabular-nums'], letterSpacing: 0 },
  statusBlock: { alignItems: 'center', gap: Spacing.md },
  actions: { width: '100%', maxWidth: 420, gap: Spacing.md },
});
