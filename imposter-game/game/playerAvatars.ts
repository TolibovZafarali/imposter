import type { Player } from './types.ts';

export const PLAYER_AVATARS = [
  { id: 'duck', name: 'Duck with sunglasses' },
  { id: 'frog', name: 'Frog with a crown' },
  { id: 'cat', name: 'Cat in a party hat' },
  { id: 'penguin', name: 'Penguin with a bow tie' },
  { id: 'bear', name: 'Bear with headphones' },
  { id: 'rabbit', name: 'Rabbit with glasses' },
  { id: 'fox', name: 'Fox in a baseball cap' },
  { id: 'dog', name: 'Dog with a bandana' },
  { id: 'owl', name: 'Owl in a graduation cap' },
  { id: 'raccoon', name: 'Raccoon in a beanie' },
] as const;

export type PlayerAvatarId = (typeof PLAYER_AVATARS)[number]['id'];
export const MAX_PLAYERS = PLAYER_AVATARS.length;

export function isPlayerAvatarId(value: unknown): value is PlayerAvatarId {
  return PLAYER_AVATARS.some((avatar) => avatar.id === value);
}

export function assignPlayerAvatars(
  players: readonly Player[],
  previousPlayers: readonly Player[] = []
): (Player & { avatarId: PlayerAvatarId })[] {
  if (players.length > MAX_PLAYERS) {
    throw new Error(`A game supports up to ${MAX_PLAYERS} players`);
  }

  const previousAvatars = new Map(previousPlayers.map((player) => [player.id, player.avatarId]));
  const used = new Set<PlayerAvatarId>();
  const reserved = players.map((player) => {
    const avatarId = player.avatarId ?? previousAvatars.get(player.id);
    if (!isPlayerAvatarId(avatarId) || used.has(avatarId)) return undefined;
    used.add(avatarId);
    return avatarId;
  });

  return players.map((player, index) => {
    const avatarId = reserved[index] ?? PLAYER_AVATARS.find((avatar) => !used.has(avatar.id))!.id;
    used.add(avatarId);
    return { ...player, avatarId };
  });
}

export function shufflePlayerAvatars(players: readonly Player[], rng = Math.random) {
  const avatars = PLAYER_AVATARS.map((avatar) => avatar.id);
  for (let index = avatars.length - 1; index > 0; index--) {
    const otherIndex = Math.floor(rng() * (index + 1));
    [avatars[index], avatars[otherIndex]] = [avatars[otherIndex], avatars[index]];
  }
  return assignPlayerAvatars(players.map((player, index) => ({ ...player, avatarId: avatars[index] })));
}

export function cyclePlayerAvatar(players: Player[], playerId: string): Player[] {
  const playerIndex = players.findIndex((player) => player.id === playerId);
  if (playerIndex === -1) return players;

  const assigned = assignPlayerAvatars(players);
  const currentAvatarId = assigned[playerIndex].avatarId;
  const currentIndex = PLAYER_AVATARS.findIndex((avatar) => avatar.id === currentAvatarId);
  const alternatives = Array.from({ length: MAX_PLAYERS - 1 }, (_, offset) =>
    PLAYER_AVATARS[(currentIndex + offset + 1) % MAX_PLAYERS].id);
  const used = new Set(assigned.map((player) => player.avatarId));
  const nextAvatarId = alternatives.find((avatarId) => !used.has(avatarId)) ?? alternatives[0];

  return assigned.map((player) => {
    if (player.id === playerId) return { ...player, avatarId: nextAvatarId };
    if (player.avatarId === nextAvatarId) return { ...player, avatarId: currentAvatarId };
    return player;
  });
}
