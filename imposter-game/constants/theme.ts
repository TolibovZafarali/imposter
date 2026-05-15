import { Platform, StyleSheet } from 'react-native';

// ---------------------------------------------------------------------------
// Colors — locked bright palette.
// ---------------------------------------------------------------------------

export const Colors = {
  background: '#F7F8FB',
  text: '#1C1B1F',
  primary: '#B6192E',
  secondary: '#FFFFFF',
  accent: '#B6192E',
  card: '#FFFFFF',
  surface: '#F0F3F8',
  surfaceRaised: '#FFFFFF',
  surfacePressed: '#E4E9F1',
  redSurface: 'rgba(182, 25, 46, 0.10)',
  redSurfaceStrong: 'rgba(182, 25, 46, 0.16)',
  redBorder: 'rgba(182, 25, 46, 0.36)',
  muted: 'rgba(28, 27, 31, 0.62)',
  border: 'rgba(28, 27, 31, 0.12)',

  textInverse: '#FFFFFF',
  textOnPrimary: '#FFFFFF',
  textOnSecondary: '#1C1B1F',
  textOnAccent: '#FFFFFF',
  shadow: '#111827',
  overlay: 'rgba(17, 24, 39, 0.44)',
} as const;

// Templated screens read `Colors.light` / `Colors.dark`; route both to the
// same locked palette so older call sites keep working without a rewrite.
const legacyPalette = {
  text: Colors.text,
  background: Colors.background,
  tint: Colors.primary,
  icon: Colors.muted,
  tabIconDefault: Colors.muted,
  tabIconSelected: Colors.primary,
};

export const LegacyColors = {
  light: legacyPalette,
  dark: legacyPalette,
};

// ---------------------------------------------------------------------------
// Typography
//
// Plus Jakarta Sans is the brand font; load via `expo-font` in the root
// layout. Each weight is a separate registered family on native. When a
// glyph is missing (non-Latin scripts), React Native falls back to the
// platform's system font automatically — on web we add an explicit Noto
// chain so Arabic/CJK/Devanagari render cleanly without extra bundles.
// ---------------------------------------------------------------------------

const webFallback =
  "'Plus Jakarta Sans', 'Noto Sans', 'Noto Sans Arabic', 'Noto Sans JP', 'Noto Sans SC', 'Noto Sans KR', 'Noto Sans Devanagari', system-ui, -apple-system, BlinkMacSystemFont, sans-serif";

// Plus Jakarta Sans tops out at 800 ExtraBold (no 900 Black in the package),
// so display/title share the 800 family and rely on size + tracking for
// hierarchy against heading.
export const FontFamily = {
  body: Platform.select({ web: webFallback, default: 'PlusJakartaSans_500Medium' })!,
  bodyBold: Platform.select({ web: webFallback, default: 'PlusJakartaSans_700Bold' })!,
  heading: Platform.select({ web: webFallback, default: 'PlusJakartaSans_800ExtraBold' })!,
  display: Platform.select({ web: webFallback, default: 'PlusJakartaSans_800ExtraBold' })!,
};

export const FontWeight = {
  body: '500',
  button: '700',
  heading: '800',
  display: '800',
} as const;

export const Typography = StyleSheet.create({
  display: {
    fontFamily: FontFamily.display,
    fontWeight: FontWeight.display,
    fontSize: 40,
    lineHeight: 44,
    letterSpacing: -1,
    color: Colors.text,
  },
  title: {
    fontFamily: FontFamily.display,
    fontWeight: FontWeight.display,
    fontSize: 30,
    lineHeight: 34,
    letterSpacing: -0.6,
    color: Colors.text,
  },
  heading: {
    fontFamily: FontFamily.heading,
    fontWeight: FontWeight.heading,
    fontSize: 22,
    lineHeight: 28,
    letterSpacing: -0.3,
    color: Colors.text,
  },
  subheading: {
    fontFamily: FontFamily.bodyBold,
    fontWeight: FontWeight.button,
    fontSize: 18,
    lineHeight: 24,
    color: Colors.text,
  },
  body: {
    fontFamily: FontFamily.body,
    fontWeight: FontWeight.body,
    fontSize: 16,
    lineHeight: 24,
    color: Colors.text,
  },
  bodyEmphasis: {
    fontFamily: FontFamily.bodyBold,
    fontWeight: FontWeight.button,
    fontSize: 16,
    lineHeight: 24,
    color: Colors.text,
  },
  bodySmall: {
    fontFamily: FontFamily.body,
    fontWeight: FontWeight.body,
    fontSize: 14,
    lineHeight: 20,
    color: Colors.text,
  },
  button: {
    fontFamily: FontFamily.bodyBold,
    fontWeight: FontWeight.button,
    fontSize: 16,
    lineHeight: 20,
    letterSpacing: 0.2,
    color: Colors.text,
  },
  caption: {
    fontFamily: FontFamily.body,
    fontWeight: FontWeight.body,
    fontSize: 12,
    lineHeight: 16,
    color: Colors.muted,
  },
});

export type TypographyVariant = keyof typeof Typography;

// ---------------------------------------------------------------------------
// Spacing — multiples of 4
// ---------------------------------------------------------------------------

export const Spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
  xxxl: 48,
  xxxxl: 64,
} as const;

// ---------------------------------------------------------------------------
// Rounded corners
// ---------------------------------------------------------------------------

export const Radii = {
  none: 0,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
  pill: 999,
} as const;

// ---------------------------------------------------------------------------
// Shadows — soft, playful, never harsh
// ---------------------------------------------------------------------------

const shadowColorRgb = '17, 24, 39';

const createShadow = ({
  width,
  height,
  opacity,
  radius,
  elevation,
}: {
  width: number;
  height: number;
  opacity: number;
  radius: number;
  elevation: number;
}) =>
  Platform.select({
    web: {
      boxShadow: `${width}px ${height}px ${radius}px rgba(${shadowColorRgb}, ${opacity})`,
    },
    default: {
      shadowColor: Colors.shadow,
      shadowOffset: { width, height },
      shadowOpacity: opacity,
      shadowRadius: radius,
      elevation,
    },
  });

export const Shadows = StyleSheet.create({
  sm: createShadow({ width: 0, height: 2, opacity: 0.06, radius: 6, elevation: 2 }),
  md: createShadow({ width: 0, height: 6, opacity: 0.08, radius: 14, elevation: 4 }),
  lg: createShadow({ width: 0, height: 12, opacity: 0.12, radius: 24, elevation: 8 }),
  float: Platform.select({
    web: {
      boxShadow: `0px 0px 22px rgba(${shadowColorRgb}, 0.12)`,
    },
    ios: {
      shadowColor: Colors.shadow,
      shadowOffset: { width: 0, height: 0 },
      shadowOpacity: 0.18,
      shadowRadius: 24,
    },
    default: {
      shadowColor: Colors.shadow,
      shadowOffset: { width: 0, height: 0 },
      shadowOpacity: 0.14,
      shadowRadius: 22,
      elevation: 7,
    },
  }),
});

// ---------------------------------------------------------------------------
// Cards — preset block styles
// ---------------------------------------------------------------------------

export const Cards = StyleSheet.create({
  base: {
    backgroundColor: Colors.card,
    borderRadius: Radii.xl,
    padding: Spacing.xl,
    borderWidth: 1,
    borderColor: Colors.border,
    ...Shadows.sm,
  },
  flat: {
    backgroundColor: Colors.card,
    borderRadius: Radii.xl,
    padding: Spacing.xl,
    ...Shadows.float,
  },
  elevated: {
    backgroundColor: Colors.card,
    borderRadius: Radii.xl,
    padding: Spacing.xl,
    borderWidth: 1,
    borderColor: Colors.border,
    ...Shadows.md,
  },
});

// ---------------------------------------------------------------------------
// Transitions — durations + easing for Reanimated / web
// ---------------------------------------------------------------------------

export const Transitions = {
  fast: 120,
  base: 200,
  slow: 320,
  // Reanimated bezier args: matches a snappy, playful out-curve.
  easing: [0.2, 0.8, 0.2, 1] as const,
  // CSS equivalent for web targets.
  cssEasing: 'cubic-bezier(0.2, 0.8, 0.2, 1)',
} as const;

// ---------------------------------------------------------------------------
// Legacy `Fonts` export — used by the starter Explore screen until Phase 2.
// ---------------------------------------------------------------------------

export const Fonts = {
  sans: FontFamily.body,
  serif: Platform.select({ ios: 'ui-serif', default: 'serif' })!,
  rounded: FontFamily.display,
  mono: Platform.select({
    ios: 'ui-monospace',
    web: "SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace",
    default: 'monospace',
  })!,
};
