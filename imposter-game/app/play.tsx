import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, BackHandler, ScrollView, StyleSheet, View } from 'react-native';
import * as Haptics from 'expo-haptics';

import { Button } from '@/components/ui/button';
import { PlayerAvatar } from '@/components/player-avatar';
import { RoundResults } from '@/components/round-results';
import { ConfirmationDialog } from '@/components/ui/confirmation-dialog';
import { Screen } from '@/components/ui/screen';
import { Text } from '@/components/ui/text';
import { Colors, Radii, Shadows, Spacing } from '@/constants/theme';
import { useGame } from '@/contexts/game-context';
import { useLanguageSettings } from '@/contexts/language-settings';
import { CATEGORY_LABELS, selectRandomCategoryIds } from '@/data/wordBank';
import { remainingRoundSeconds } from '@/game/timer';
import { createRound } from '@/services/roundGenerator';
import { engagementStore, requestMilestoneReview } from '@/services/engagement';
import { discardPreparedAd, prepareResultAd, showCompletedRoundAd } from '@/services/ads';

const formatTime = (seconds: number) => `${Math.floor(seconds / 60)}:${(seconds % 60).toString().padStart(2, '0')}`;

export default function PlayScreen() {
  const router = useRouter();
  const { state, setupPreferences, resetGame, completeRound, startRound } = useGame();
  const { selectedLanguage } = useLanguageSettings();
  const [now, setNow] = useState(Date.now());
  const [confirmFinish, setConfirmFinish] = useState(false);
  const [confirmLeave, setConfirmLeave] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [revealedRoundId, setRevealedRoundId] = useState<string | null>(null);
  const busyRef = useRef(false);
  const onResults = useRef(false);
  const mounted = useRef(true);
  const round = state.round;
  const completed = state.phase === 'completed';
  const resultsReady = completed && revealedRoundId === round?.id;
  const handleRevealComplete = useCallback(() => {
    if (round) setRevealedRoundId(round.id);
  }, [round]);
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
    onResults.current = resultsReady;
    if (!resultsReady || !round) return;
    const stillHere = () => onResults.current && mounted.current && !busyRef.current;
    let active = true;
    const reviewTimer = setTimeout(() => {
      if (active) void requestMilestoneReview(stillHere);
    }, 4000);
    void engagementStore.complete(round.id).then(() => {
      if (active) void prepareResultAd(stillHere);
    }).catch(() => {});
    return () => { active = false; onResults.current = false; clearTimeout(reviewTimer); discardPreparedAd(); };
  }, [resultsReady, round]);

  const leaveResults = async (replay: boolean) => {
    if (!round || busyRef.current || !resultsReady) return;
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

  const abandonRound = () => {
    setConfirmLeave(false);
    resetGame();
    router.replace('/');
  };

  if (!round || !firstSpeaker) return <Screen />;

  if (completed) {
    return (
      <RoundResults key={round.id} round={round} onRevealComplete={handleRevealComplete}>
        <View style={styles.actions}>
          {error ? <Text accessibilityRole="alert" variant="bodySmall" color="primary" align="center">{error}</Text> : null}
          <Button
            label={busy ? 'Getting ready…' : error ? 'Try next round again' : 'Play again'}
            size="lg"
            fullWidth
            disabled={busy}
            accessibilityState={{ busy, disabled: busy }}
            onPress={() => void leaveResults(true)}
            leadingIcon={<MaterialIcons name="replay" size={22} color={Colors.textOnPrimary} />}
          />
          <Button label="Change setup" variant="ghost" fullWidth disabled={busy} onPress={() => void leaveResults(false)} />
        </View>
      </RoundResults>
    );
  }

  return (
    <Screen style={styles.screen}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.content}
        accessibilityElementsHidden={confirmLeave || confirmFinish}
        importantForAccessibility={confirmLeave || confirmFinish ? 'no-hide-descendants' : 'auto'}>
        <View style={styles.results}>
          <Text variant="bodyEmphasis" color="primary" align="center">{timeUp ? 'Time to vote' : 'Let the guessing begin'}</Text>
          {duration !== null ? (
            <View style={[styles.timerRing, timeUp && styles.timerRingDone]} accessibilityLabel={`${formatTime(seconds)} remaining`}>
              <Text variant="display" align="center" style={styles.timerText}>{formatTime(seconds)}</Text>
            </View>
          ) : <MaterialIcons name="forum" size={64} color={Colors.primary} />}
          <View style={styles.statusBlock}>
            <Text variant="bodySmall" align="center" color="muted">{timeUp ? 'Make your call together' : 'First speaker'}</Text>
            {timeUp ? <Text variant="title" align="center">Who is bluffing?</Text> : (
              <View style={styles.speaker}>
                <PlayerAvatar player={firstSpeaker} size={44} />
                <Text variant="title" align="center" numberOfLines={1} adjustsFontSizeToFit style={styles.speakerName}>
                  {firstSpeaker.name}
                </Text>
              </View>
            )}
          </View>
        </View>
        <View style={styles.actions}>
          <Button label="Finish round"
            size="lg" fullWidth disabled={confirmFinish} accessibilityState={{ disabled: confirmFinish }}
            onPress={() => setConfirmFinish(true)}
            leadingIcon={<MaterialIcons name="visibility" size={22} color={Colors.textOnPrimary} />} />
          <Button label="Leave round" variant="ghost" fullWidth onPress={() => setConfirmLeave(true)} />
        </View>
      </ScrollView>
      <ConfirmationDialog
        visible={confirmFinish}
        title="Everyone voted?"
        description="Agree on your vote out loud before revealing the word and imposters."
        primaryAction={{ label: 'Reveal results', onPress: () => {
          setConfirmFinish(false);
          completeRound();
        } }}
        secondaryAction={{ label: 'Keep playing', onPress: () => setConfirmFinish(false) }}
        onDismiss={() => setConfirmFinish(false)}
      />
      <ConfirmationDialog
        visible={confirmLeave}
        title="Leave this round?"
        description="This round will end. Your players and settings will stay."
        primaryAction={{ label: 'Keep playing', onPress: () => setConfirmLeave(false), neutral: true }}
        secondaryAction={{ label: 'Leave round', onPress: abandonRound, destructive: true }}
        onDismiss={() => setConfirmLeave(false)}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  screen: { paddingVertical: Spacing.xl },
  content: { flexGrow: 1, justifyContent: 'space-between', alignItems: 'center', gap: Spacing.xxl },
  results: { flex: 1, width: '100%', maxWidth: 420, justifyContent: 'center', alignItems: 'center', gap: Spacing.xl },
  timerRing: { width: 220, height: 220, alignItems: 'center', justifyContent: 'center', borderRadius: Radii.pill,
    borderWidth: 2, borderColor: Colors.border, backgroundColor: Colors.surfaceRaised, ...Shadows.md },
  timerRingDone: { borderColor: Colors.redBorder, backgroundColor: Colors.redSurfaceStrong },
  timerText: { fontVariant: ['tabular-nums'], letterSpacing: 0 },
  statusBlock: { alignItems: 'center', gap: Spacing.md },
  speaker: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.sm },
  speakerName: { flexShrink: 1 },
  actions: { width: '100%', maxWidth: 420, gap: Spacing.md },
});
