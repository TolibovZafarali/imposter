import { Image } from 'expo-image';
import { StyleSheet, View } from 'react-native';

import { PLAYER_AVATAR_ASSETS } from '@/constants/player-avatar-assets';
import type { Player } from '@/game/types';

type Props = {
  player: Pick<Player, 'avatarId'>;
  size?: number;
};

export function PlayerAvatar({ player, size = 44 }: Props) {
  const avatarId = player.avatarId ?? 'duck';

  return (
    <View
      accessible={false}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      pointerEvents="none"
      style={{ width: size, height: size, flexShrink: 0 }}>
      <Image
        source={PLAYER_AVATAR_ASSETS[avatarId]}
        recyclingKey={avatarId}
        contentFit="contain"
        accessible={false}
        style={StyleSheet.absoluteFill}
      />
    </View>
  );
}
