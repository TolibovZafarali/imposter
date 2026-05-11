import { Platform, StyleSheet } from 'react-native';

// ---------------------------------------------------------------------------
// Colors — locked palette. Light-themed; see CLAUDE.md note in commit message.
// ---------------------------------------------------------------------------

export const Colors = {
  background: '#FAF7F2',
  text: '#171717',
  primary: '#FF6B4A',
  secondary: '#5B7CFA',
  accent: '#FFD166',
  card: '#FFFFFF',
  muted: '#8A8A8A',
  border: '#E9E2D8',

  textInverse: '#FFFFFF',
  textOnPrimary: '#FFFFFF',
  textOnSecondary: '#FFFFFF',
  textOnAccent: '#171717',
  shadow: '#171717',
  overlay: 'rgba(23, 23, 23, 0.45)',
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

export const Shadows = StyleSheet.create({
  sm: {
    shadowColor: Colors.shadow,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 6,
    elevation: 2,
  },
  md: {
    shadowColor: Colors.shadow,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.08,
    shadowRadius: 14,
    elevation: 4,
  },
  lg: {
    shadowColor: Colors.shadow,
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.12,
    shadowRadius: 24,
    elevation: 8,
  },
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
    borderWidth: 1,
    borderColor: Colors.border,
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
