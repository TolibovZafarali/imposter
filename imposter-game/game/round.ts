import {
  clampImposterCount,
  DEFAULT_IMPOSTER_HINT_ENABLED,
  DEFAULT_ROUND_TIMER_MINUTES,
} from './setupRules.ts';
import type { ImposterCount, Player, Round, RoundTimerSetting } from './types.ts';
import type { WordDifficulty } from '../data/wordBank.ts';

type BuildRoundInput = {
  players: Player[];
  categoryIds: string[];
  difficulty: WordDifficulty;
  languageId: string;
  languageName: string;
  secretWord: string;
  imposterHint: string;
  imposterCount?: ImposterCount;
  isImposterHintEnabled?: boolean;
  roundTimerMinutes?: RoundTimerSetting;
  rng?: () => number;
};

const getRandomIndex = (itemCount: number, rng: () => number) =>
  Math.min(Math.floor(rng() * itemCount), itemCount - 1);

const selectRandomIndices = (itemCount: number, count: number, rng: () => number) => {
  const availableIndices = Array.from({ length: itemCount }, (_, index) => index);
  const selectedIndices: number[] = [];

  for (let index = 0; index < count; index += 1) {
    const availableIndex = getRandomIndex(availableIndices.length, rng);
    const [selectedIndex] = availableIndices.splice(availableIndex, 1);

    selectedIndices.push(selectedIndex);
  }

  return selectedIndices;
};

export function buildRound({
  players,
  categoryIds,
  difficulty,
  languageId,
  languageName,
  secretWord,
  imposterHint,
  imposterCount,
  isImposterHintEnabled = DEFAULT_IMPOSTER_HINT_ENABLED,
  roundTimerMinutes = DEFAULT_ROUND_TIMER_MINUTES,
  rng = Math.random,
}: BuildRoundInput): Round {
  const selectedImposterCount = clampImposterCount(imposterCount, players.length);
  const imposterIndices = selectRandomIndices(players.length, selectedImposterCount, rng);
  const imposterIndexSet = new Set(imposterIndices);
  const firstSpeakerIndex = getRandomIndex(players.length, rng);
  const imposterPlayers = imposterIndices.map((index) => players[index]);
  const firstSpeaker = players[firstSpeakerIndex];
  const imposterPlayerIds = imposterPlayers.map((player) => player.id);

  return {
    id: `${Date.now()}-${imposterPlayerIds.join('-')}`,
    players,
    cards: players.map((player, index) => {
      const isImposter = imposterIndexSet.has(index);

      return {
        playerId: player.id,
        role: isImposter ? 'imposter' : 'regular',
        word: isImposter ? null : secretWord,
        hint: isImposter && isImposterHintEnabled ? imposterHint : null,
      };
    }),
    secretWord,
    imposterHint,
    imposterPlayerIds,
    imposterPlayerId: imposterPlayerIds[0],
    firstSpeakerId: firstSpeaker.id,
    config: {
      categoryIds,
      difficulty,
      languageId,
      languageName,
      imposterCount: selectedImposterCount,
      isImposterHintEnabled,
      roundTimerMinutes,
    },
  };
}
