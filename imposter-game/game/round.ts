import type { Player, Round } from '@/game/types';
import type { RoundDifficulty } from '@/data/wordBank';

type BuildRoundInput = {
  players: Player[];
  categoryIds: string[];
  languageId: string;
  languageName: string;
  difficulty: RoundDifficulty;
  secretWord: string;
  imposterHint: string;
  rng?: () => number;
};

const getRandomIndex = (itemCount: number, rng: () => number) =>
  Math.min(Math.floor(rng() * itemCount), itemCount - 1);

export function buildRound({
  players,
  categoryIds,
  languageId,
  languageName,
  difficulty,
  secretWord,
  imposterHint,
  rng = Math.random,
}: BuildRoundInput): Round {
  const imposterIndex = getRandomIndex(players.length, rng);
  const firstSpeakerIndex = getRandomIndex(players.length, rng);
  const imposterPlayer = players[imposterIndex];
  const firstSpeaker = players[firstSpeakerIndex];

  return {
    id: `${Date.now()}-${imposterPlayer.id}`,
    players,
    cards: players.map((player, index) => {
      const isImposter = index === imposterIndex;

      return {
        playerId: player.id,
        role: isImposter ? 'imposter' : 'regular',
        word: isImposter ? null : secretWord,
        hint: isImposter ? imposterHint : null,
      };
    }),
    secretWord,
    imposterHint,
    imposterPlayerId: imposterPlayer.id,
    firstSpeakerId: firstSpeaker.id,
    config: {
      categoryIds,
      languageId,
      languageName,
      difficulty,
    },
  };
}
