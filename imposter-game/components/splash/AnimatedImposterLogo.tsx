import { StyleSheet } from 'react-native';
import Animated, {
  interpolate,
  type SharedValue,
  useAnimatedProps,
  useAnimatedStyle,
} from 'react-native-reanimated';
import Svg, { ClipPath, Defs, G, Path, Rect } from 'react-native-svg';

const AnimatedG = Animated.createAnimatedComponent(G);
const AnimatedRect = Animated.createAnimatedComponent(Rect);

const VIEWBOX_SIZE = 1500;
const BLINK_SLIT_HEIGHT = 92;
const PUPIL_GLANCE_X = 30;
const PUPIL_GLANCE_Y = -18;
const LOGO_RED = '#B6192E';

const EYE_PATH =
  'M 210.5625 847.09375 C 239.933594 804.121094 266.320312 762.027344 296.183594 722.558594 C 355.507812 644.152344 424.765625 575.71875 508.921875 523.6875 C 628.71875 449.625 757.753906 426.132812 895.945312 454.339844 C 1005.15625 476.632812 1102.742188 525.339844 1194.519531 586.835938 C 1226.441406 608.21875 1257.449219 631.011719 1289.761719 653.78125 C 1260.535156 695.769531 1234.050781 736.667969 1204.726562 775.386719 C 1145.378906 853.765625 1076.503906 922.480469 992.601562 974.929688 C 870.363281 1051.339844 738.59375 1074.359375 597.761719 1044.300781 C 489.808594 1021.261719 393.109375 972.621094 302.25 911.441406 C 271.121094 890.492188 240.804688 868.359375 210.5625 847.09375 Z M 944.652344 715.828125 C 925.761719 609.128906 823.039062 536.421875 716.742188 554.539062 C 608.882812 572.917969 535.507812 676.636719 554.324219 784.101562 C 573.15625 891.625 677.347656 964.261719 785.035156 944.894531 C 891.066406 925.835938 963.429688 821.976562 944.652344 715.828125 Z M 1203.261719 669.691406 C 1100.855469 597.167969 996.488281 537.277344 874.050781 516.507812 C 1014.542969 598.269531 1060.78125 784.507812 942.222656 930.914062 C 1054.652344 864.550781 1132.460938 772.828125 1203.261719 669.691406 Z M 551.773438 574.042969 C 444.210938 636.804688 365.835938 727.765625 297.160156 828.5625 C 384.996094 902.082031 557.9375 983.804688 624.800781 981.175781 C 478.175781 896.492188 442.355469 708.625 551.773438 574.042969 Z M 551.773438 574.042969';

const PUPIL_PATH =
  'M 775.015625 618.75 C 749.207031 644.164062 743.757812 661.527344 754.695312 683.429688 C 762.875 699.824219 782.25 709.433594 800.957031 706.398438 C 823.644531 702.707031 833.675781 688.777344 840.730469 651.152344 C 900.507812 700.417969 893.277344 781.535156 863.210938 825.105469 C 822.558594 884.046875 746.792969 903.835938 685.445312 870.503906 C 623.265625 836.722656 596.789062 763.382812 623.410156 697.714844 C 650.945312 629.828125 730.949219 599.703125 775.015625 618.75 Z M 775.015625 618.75';

export type AnimatedImposterLogoProps = {
  size: number;
  introProgress: SharedValue<number>;
  blinkProgress: SharedValue<number>;
  glanceProgress: SharedValue<number>;
};

export function AnimatedImposterLogo({
  size,
  introProgress,
  blinkProgress,
  glanceProgress,
}: AnimatedImposterLogoProps) {
  const logoStyle = useAnimatedStyle(() => ({
    opacity: introProgress.value,
    transform: [{ scale: interpolate(introProgress.value, [0, 1], [0.985, 1]) }],
  }));

  const blinkClipProps = useAnimatedProps(() => {
    const height = interpolate(blinkProgress.value, [0, 1], [VIEWBOX_SIZE, BLINK_SLIT_HEIGHT]);

    return {
      height,
      y: (VIEWBOX_SIZE - height) / 2,
    };
  });

  const pupilProps = useAnimatedProps(() => {
    const translateX = interpolate(glanceProgress.value, [0, 1], [0, PUPIL_GLANCE_X]);
    const translateY = interpolate(glanceProgress.value, [0, 1], [0, PUPIL_GLANCE_Y]);

    return {
      transform: `translate(${translateX} ${translateY})`,
    };
  });

  return (
    <Animated.View style={[styles.logo, { width: size, height: size }, logoStyle]}>
      <Svg
        width={size}
        height={size}
        viewBox={`0 0 ${VIEWBOX_SIZE} ${VIEWBOX_SIZE}`}
        preserveAspectRatio="xMidYMid meet">
        <Defs>
          <ClipPath id="imposter-logo-blink">
            <AnimatedRect
              animatedProps={blinkClipProps}
              x={0}
              width={VIEWBOX_SIZE}
            />
          </ClipPath>
        </Defs>
        <G clipPath="url(#imposter-logo-blink)">
          <Path d={EYE_PATH} fill={LOGO_RED} fillRule="nonzero" />
          <AnimatedG animatedProps={pupilProps}>
            <Path d={PUPIL_PATH} fill={LOGO_RED} fillRule="nonzero" />
          </AnimatedG>
        </G>
      </Svg>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  logo: {
    alignItems: 'center',
    justifyContent: 'center',
  },
});
