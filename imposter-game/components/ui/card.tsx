import { View, type ViewProps } from 'react-native';

import { Cards } from '@/constants/theme';

export type CardProps = ViewProps & {
  variant?: keyof typeof Cards;
};

export function Card({ variant = 'base', style, ...rest }: CardProps) {
  return <View style={[Cards[variant], style]} {...rest} />;
}
