// The app is locked to a single light-warm palette for MVP. Components that
// branch on color scheme always get 'light' so the locked tokens render
// consistently regardless of the device setting.
export function useColorScheme(): 'light' {
  return 'light';
}
