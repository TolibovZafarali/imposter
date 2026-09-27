import { useEffect, useRef, type ReactNode } from 'react';
import { Animated, Easing, Platform, StyleSheet, View } from 'react-native';
import Svg, { Circle, Ellipse, G, Path, Rect, Text as SvgText } from 'react-native-svg';

const INK = '#352025';
const CREAM = '#FFF5D9';
const PEACH = '#FFA889';
const MINT = '#C8E5C6';
const YELLOW = '#F8CF63';

type SceneProps = {
  scene: 0 | 1 | 2;
  active: boolean;
  reduceMotion: boolean;
  size: number;
};

function useSceneMotion(active: boolean, reduceMotion: boolean) {
  const float = useRef(new Animated.Value(0)).current;
  const chatter = useRef(new Animated.Value(0)).current;
  const blink = useRef(new Animated.Value(1)).current;
  const celebration = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    float.setValue(0);
    chatter.setValue(0);
    blink.setValue(1);
    celebration.setValue(0);
    if (!active || reduceMotion) return;
    const native = Platform.OS !== 'web';
    const breathe = (value: Animated.Value, duration: number) => Animated.loop(
      Animated.sequence([
        Animated.timing(value, { toValue: 1, duration, easing: Easing.inOut(Easing.sin), useNativeDriver: native, isInteraction: false }),
        Animated.timing(value, { toValue: 0, duration, easing: Easing.inOut(Easing.sin), useNativeDriver: native, isInteraction: false }),
      ]),
    );
    const animations = [
      breathe(float, 1550),
      breathe(chatter, 1050),
      breathe(celebration, 2300),
      Animated.loop(Animated.sequence([
        Animated.delay(2850),
        Animated.timing(blink, { toValue: 0.08, duration: 90, useNativeDriver: native, isInteraction: false }),
        Animated.timing(blink, { toValue: 1, duration: 130, useNativeDriver: native, isInteraction: false }),
        Animated.delay(1100),
        Animated.timing(blink, { toValue: 0.08, duration: 80, useNativeDriver: native, isInteraction: false }),
        Animated.timing(blink, { toValue: 1, duration: 110, useNativeDriver: native, isInteraction: false }),
      ])),
    ];
    animations.forEach((animation) => animation.start());
    return () => animations.forEach((animation) => animation.stop());
  }, [active, blink, celebration, chatter, float, reduceMotion]);

  return { float, chatter, blink, celebration };
}

type FloatProps = {
  children: ReactNode;
  x: number;
  y: number;
  width: number;
  height: number;
  motion: Animated.Value;
  travel?: number;
  tilt?: number;
  rock?: number;
};

function Float({ children, x, y, width, height, motion, travel = -8, tilt = 0, rock = 3 }: FloatProps) {
  return (
    <Animated.View style={{
      position: 'absolute', left: x, top: y, width, height,
      transform: [
        { translateY: motion.interpolate({ inputRange: [0, 1], outputRange: [0, travel] }) },
        { rotate: motion.interpolate({ inputRange: [0, 1], outputRange: [`${tilt}deg`, `${tilt + rock}deg`] }) },
      ],
    }}>
      {children}
    </Animated.View>
  );
}

function Pizza({ x = 0, y = 0, scale = 1 }: { x?: number; y?: number; scale?: number }) {
  return (
    <G transform={`translate(${x} ${y}) scale(${scale})`} stroke={INK} strokeWidth={2.7} strokeLinejoin="round">
      <Path d="M7 10 Q29 -3 52 10 L29 62 Z" fill={YELLOW} />
      <Path d="M5 10 Q29 -5 54 10 L51 19 Q29 6 8 19 Z" fill={PEACH} />
      <Circle cx={23} cy={26} r={5} fill="#C63642" />
      <Circle cx={35} cy={37} r={4.3} fill="#C63642" />
      <Path d="M22 43 l4 -2 M38 23 l3 2" stroke="#537C48" strokeWidth={3} strokeLinecap="round" />
    </G>
  );
}

function WordCard({ mystery = false }: { mystery?: boolean }) {
  return (
    <Svg width="100%" height="100%" viewBox="0 0 96 122">
      <Rect x={8} y={8} width={82} height={108} rx={13} fill={INK} opacity={0.18} />
      <Rect x={3} y={3} width={84} height={108} rx={13} fill={mystery ? PEACH : CREAM} stroke={INK} strokeWidth={3.5} />
      {mystery ? (
        <>
          <Path d="M29 37 C30 17 65 18 64 39 C64 49 47 47 47 59" fill="none" stroke={INK} strokeWidth={8} strokeLinecap="round" />
          <Circle cx={47} cy={74} r={4.5} fill={INK} />
          <Path d="M28 92 H63" stroke={INK} strokeWidth={2} strokeLinecap="round" strokeDasharray="2 5" />
        </>
      ) : (
        <>
          <Pizza x={18} y={15} scale={0.88} />
          <SvgText x={45} y={93} textAnchor="middle" fontFamily="Arial" fontWeight="900" fontSize={15} letterSpacing={1} fill={INK}>PIZZA</SvgText>
        </>
      )}
      <Path d="M11 18 V12 H17 M73 97 H79 V91" fill="none" stroke={INK} strokeWidth={1.8} strokeLinecap="round" opacity={0.45} />
    </Svg>
  );
}

function Character({ color, blink, mood = 'happy', look = 0 }: {
  color: string;
  blink: Animated.Value;
  mood?: 'happy' | 'suspicious' | 'sheepish';
  look?: number;
}) {
  return (
    <View style={styles.character}>
      <Svg width="100%" height="100%" viewBox="0 0 120 148">
        <G stroke={INK} strokeWidth={3.5} strokeLinejoin="round" strokeLinecap="round">
          <Path d="M26 104 Q9 88 10 109 M94 105 Q111 86 113 105" fill="none" />
          <Path d="M42 121 L36 138 L22 137 M78 121 L84 138 L99 137" fill="none" />
          <Path d="M23 72 C15 35 33 17 58 16 C88 11 100 34 98 61 C111 88 98 119 73 122 L48 122 C19 121 12 99 23 72 Z" fill={color} />
          <Path d="M44 18 Q42 9 48 6 M53 16 Q57 5 64 8" fill="none" />
          {mood === 'happy' ? <Path d="M45 82 Q59 99 75 80 Q62 87 45 82 Z" fill={INK} /> : null}
          {mood === 'suspicious' ? <Path d="M49 86 Q61 80 71 86" fill="none" /> : null}
          {mood === 'sheepish' ? <Path d="M46 83 Q62 96 74 83 Z" fill={CREAM} strokeWidth={2.5} /> : null}
          {mood === 'sheepish' ? <Path d="M103 42 Q113 56 108 60 Q99 62 101 51 Z" fill="#BCDDEC" strokeWidth={2.5} /> : null}
        </G>
        <Ellipse cx={33} cy={78} rx={7} ry={4} fill="#D75B60" opacity={0.35} />
        <Ellipse cx={85} cy={77} rx={7} ry={4} fill="#D75B60" opacity={0.35} />
        <Path d="M35 103 Q44 111 53 110" fill="none" stroke={INK} strokeWidth={2} strokeLinecap="round" opacity={0.16} />
      </Svg>
      <Animated.View style={[styles.eyes, { transform: [{ scaleY: blink }] }]}>
        <Svg width="100%" height="100%" viewBox="0 0 68 31">
          <Ellipse cx={18} cy={17} rx={10} ry={13} fill={CREAM} stroke={INK} strokeWidth={2.5} />
          <Ellipse cx={48} cy={17} rx={10} ry={13} fill={CREAM} stroke={INK} strokeWidth={2.5} />
          <Ellipse cx={20 + look} cy={18} rx={4} ry={6} fill={INK} />
          <Ellipse cx={50 + look} cy={18} rx={4} ry={6} fill={INK} />
          {mood === 'suspicious' ? <Path d="M5 3 L28 10 M38 10 L60 2" stroke={INK} strokeWidth={4} strokeLinecap="round" /> : null}
          {mood === 'sheepish' ? <Path d="M6 4 Q13 -1 24 4 M40 3 Q47 -1 57 4" stroke={INK} strokeWidth={3} strokeLinecap="round" fill="none" /> : null}
        </Svg>
      </Animated.View>
    </View>
  );
}

function Bubble({ word, color = CREAM, right = false }: { word: string; color?: string; right?: boolean }) {
  return (
    <Svg width="100%" height="100%" viewBox="0 0 142 85">
      <Path d={right
        ? 'M20 4 H121 Q137 4 137 23 V47 Q137 64 119 64 H101 L110 80 L82 64 H20 Q5 64 5 47 V22 Q5 4 20 4 Z'
        : 'M20 4 H121 Q137 4 137 23 V47 Q137 64 119 64 H57 L33 80 L38 64 H20 Q5 64 5 47 V22 Q5 4 20 4 Z'}
      fill={color} stroke={INK} strokeWidth={3.3} strokeLinejoin="round" />
      <SvgText x={71} y={42} textAnchor="middle" fontFamily="Arial" fontWeight="800" fontSize={word === 'hmm…' ? 23 : 21} fill={INK}>{word}</SvgText>
    </Svg>
  );
}

function Spark({ color = YELLOW }: { color?: string }) {
  return <Svg width="100%" height="100%" viewBox="0 0 36 36"><Path d="M18 2 L22 13 L34 17 L23 22 L19 34 L14 23 L2 19 L13 14 Z" fill={color} stroke={INK} strokeWidth={2.4} strokeLinejoin="round" /></Svg>;
}

function PointingHand({ reverse = false }: { reverse?: boolean }) {
  return (
    <Svg width="100%" height="100%" viewBox="0 0 104 62">
      <G transform={reverse ? 'translate(104 0) scale(-1 1)' : undefined} stroke={INK} strokeWidth={3.5} strokeLinejoin="round" strokeLinecap="round">
        <Path d="M3 21 L34 19 Q43 11 60 14 L89 8 Q99 7 98 15 Q98 20 67 28 Q85 30 80 38 Q82 47 73 49 Q75 58 64 58 L44 56 Q34 56 30 45 L3 48" fill={CREAM} />
        <Path d="M62 31 L76 33 M61 43 L74 45" fill="none" strokeWidth={2} />
        <Path d="M3 20 L22 19 L21 49 L3 50" fill={MINT} />
      </G>
    </Svg>
  );
}

function SecretScene({ motion }: { motion: ReturnType<typeof useSceneMotion> }) {
  return (
    <>
      <Svg width={360} height={360} style={StyleSheet.absoluteFill} viewBox="0 0 360 360">
        <Ellipse cx={179} cy={310} rx={146} ry={20} fill={INK} opacity={0.13} />
        <Path d="M39 149 Q5 122 28 99 M326 145 Q352 119 333 97" stroke={CREAM} strokeWidth={2.4} fill="none" strokeLinecap="round" strokeDasharray="5 8" opacity={0.65} />
        <Path d="M151 43 Q177 27 204 46 M192 36 L205 46 L192 50" stroke={CREAM} strokeWidth={2.3} fill="none" strokeLinecap="round" strokeLinejoin="round" opacity={0.7} />
      </Svg>
      <Float x={29} y={46} width={92} height={117} motion={motion.float} tilt={-14} travel={-6} rock={5}><WordCard /></Float>
      <Float x={243} y={45} width={92} height={117} motion={motion.float} tilt={12} travel={8} rock={-5}><WordCard /></Float>
      <Float x={24} y={175} width={114} height={141} motion={motion.float} tilt={-7} rock={3}><Character color={CREAM} blink={motion.blink} look={3} /></Float>
      <Float x={225} y={175} width={114} height={141} motion={motion.float} tilt={8} rock={-3} travel={6}><Character color={MINT} blink={motion.blink} look={-4} /></Float>
      <Float x={132} y={99} width={92} height={117} motion={motion.chatter} tilt={4} rock={-5} travel={-6}><WordCard mystery /></Float>
      <Float x={123} y={222} width={116} height={143} motion={motion.float} travel={-5} rock={-2}><Character color={PEACH} blink={motion.blink} mood="sheepish" look={-3} /></Float>
      <Float x={5} y={35} width={24} height={24} motion={motion.chatter} rock={18} travel={4}><Spark /></Float>
      <Float x={331} y={193} width={23} height={23} motion={motion.chatter} rock={-17} travel={-5}><Spark color={CREAM} /></Float>
    </>
  );
}

function ClueScene({ motion }: { motion: ReturnType<typeof useSceneMotion> }) {
  return (
    <>
      <Svg width={360} height={360} style={StyleSheet.absoluteFill} viewBox="0 0 360 360">
        <Ellipse cx={180} cy={316} rx={157} ry={20} fill={INK} opacity={0.13} />
        <Path d="M39 154 L26 150 M43 143 L35 132 M324 156 L336 149 M319 146 L324 134" stroke={CREAM} strokeWidth={3} strokeLinecap="round" opacity={0.8} />
        <Path d="M127 166 Q178 189 230 166" stroke={CREAM} strokeWidth={2} fill="none" strokeDasharray="4 8" opacity={0.5} />
      </Svg>
      <Float x={15} y={68} width={137} height={82} motion={motion.chatter} tilt={-9} travel={-8} rock={4}><Bubble word="cheesy" /></Float>
      <Float x={212} y={81} width={134} height={80} motion={motion.chatter} tilt={8} travel={5} rock={-4}><Bubble word="slice!" color={MINT} right /></Float>
      <Float x={10} y={180} width={122} height={150} motion={motion.float} tilt={-5} rock={3}><Character color={CREAM} blink={motion.blink} look={4} /></Float>
      <Float x={230} y={181} width={122} height={150} motion={motion.float} tilt={6} travel={6} rock={-4}><Character color={MINT} blink={motion.blink} mood="suspicious" look={-4} /></Float>
      <Float x={118} y={208} width={125} height={154} motion={motion.float} travel={-5} rock={-2}><Character color={PEACH} blink={motion.blink} mood="sheepish" look={3} /></Float>
      <Float x={120} y={136} width={121} height={73} motion={motion.chatter} tilt={-3} travel={-4} rock={6}><Bubble word="hmm…" color={YELLOW} /></Float>
      <Float x={164} y={30} width={31} height={31} motion={motion.float} rock={18} travel={6}><Spark /></Float>
      <Float x={20} y={313} width={22} height={22} motion={motion.chatter} rock={-10} travel={-4}><Spark color={PEACH} /></Float>
    </>
  );
}

function RevealScene({ motion }: { motion: ReturnType<typeof useSceneMotion> }) {
  return (
    <>
      <Animated.View style={[styles.burst, { transform: [
        { scale: motion.celebration.interpolate({ inputRange: [0, 1], outputRange: [0.96, 1.035] }) },
        { rotate: motion.celebration.interpolate({ inputRange: [0, 1], outputRange: ['-3deg', '3deg'] }) },
      ] }]}>
        <Svg width={302} height={302} viewBox="0 0 302 302">
          <Path d="M152 7 L177 45 L217 23 L222 68 L269 67 L251 110 L291 139 L250 163 L272 208 L226 213 L220 263 L177 247 L151 294 L125 250 L80 270 L76 222 L28 221 L47 175 L8 150 L49 124 L28 82 L77 78 L80 30 L126 49 Z" fill={YELLOW} stroke={INK} strokeWidth={3.4} strokeLinejoin="round" />
          <Circle cx={150} cy={151} r={101} fill={CREAM} opacity={0.24} />
        </Svg>
      </Animated.View>
      <Float x={111} y={113} width={140} height={173} motion={motion.float} travel={-8} rock={-3} tilt={3}><Character color={PEACH} blink={motion.blink} mood="sheepish" look={-3} /></Float>
      <Float x={145} y={52} width={65} height={69} motion={motion.chatter} travel={-8} rock={7} tilt={-4}>
        <Svg width={65} height={69} viewBox="0 0 65 69">
          <Path d="M29 9 L39 8 L36 39 L28 39 Z" fill={INK} stroke={INK} strokeWidth={3} strokeLinejoin="round" />
          <Circle cx={31} cy={53} r={6} fill={INK} />
          <Path d="M11 14 L16 22 M53 12 L48 22" stroke={INK} strokeWidth={3} strokeLinecap="round" />
        </Svg>
      </Float>
      <Float x={0} y={193} width={108} height={66} motion={motion.chatter} travel={-3} rock={-5} tilt={-9}><PointingHand /></Float>
      <Float x={252} y={192} width={108} height={66} motion={motion.chatter} travel={5} rock={4} tilt={9}><PointingHand reverse /></Float>
      <Float x={18} y={55} width={29} height={29} motion={motion.celebration} travel={16} rock={45}><Spark color={MINT} /></Float>
      <Float x={310} y={93} width={32} height={32} motion={motion.celebration} travel={-13} rock={-30}><Spark color={CREAM} /></Float>
      <Float x={63} y={298} width={24} height={24} motion={motion.chatter} travel={-6} rock={20}><Spark color={CREAM} /></Float>
      <Float x={278} y={289} width={25} height={25} motion={motion.chatter} travel={6} rock={-20}><Spark color={MINT} /></Float>
      <Float x={18} y={30} width={324} height={289} motion={motion.celebration} travel={9} rock={-2}>
        <Svg width={324} height={289} viewBox="0 0 324 289">
          <G stroke={INK} strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
            <Path d="M72 8 L82 12 L77 24 L68 19 Z" fill={PEACH} />
            <Path d="M250 17 L261 13 L265 26 L255 30 Z" fill={MINT} />
            <Path d="M301 233 L311 228 L315 239 L305 244 Z" fill={CREAM} />
            <Path d="M11 221 L21 224 L18 236 L7 232 Z" fill={YELLOW} />
            <Path d="M142 278 Q151 264 161 276 Q169 289 179 276" fill="none" stroke={CREAM} strokeWidth={4} />
            <Path d="M6 97 Q20 91 16 82" fill="none" stroke={MINT} strokeWidth={4} />
            <Path d="M300 30 Q291 38 300 44" fill="none" stroke={PEACH} strokeWidth={4} />
          </G>
        </Svg>
      </Float>
    </>
  );
}

export function TutorialScene({ scene, active, reduceMotion, size }: SceneProps) {
  const motion = useSceneMotion(active, reduceMotion);
  return (
    <View
      pointerEvents="none"
      accessible={false}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      aria-hidden
      style={{ width: size, height: size }}>
      <View style={[styles.board, { transform: [{ scale: size / 360 }] }]}>
        {scene === 0 ? <SecretScene motion={motion} /> : scene === 1 ? <ClueScene motion={motion} /> : <RevealScene motion={motion} />}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  board: { width: 360, height: 360, position: 'absolute', left: '50%', top: '50%', marginLeft: -180, marginTop: -180 },
  character: { flex: 1 },
  eyes: { position: 'absolute', top: '30.5%', left: '21%', width: '57%', height: '21%' },
  burst: { position: 'absolute', left: 29, top: 18, width: 302, height: 302 },
});
