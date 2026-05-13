import { DefaultTheme, ThemeProvider, type Theme } from '@react-navigation/native';
import {
  PlusJakartaSans_500Medium,
  PlusJakartaSans_700Bold,
  PlusJakartaSans_800ExtraBold,
} from '@expo-google-fonts/plus-jakarta-sans';
import { useFonts } from 'expo-font';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import 'react-native-reanimated';

import { SplashGate } from '@/components/splash/SplashGate';
import { Colors, FontFamily } from '@/constants/theme';
import { LanguageSettingsProvider } from '@/contexts/language-settings';

export const unstable_settings = {
  anchor: 'index',
};

SplashScreen.preventAutoHideAsync().catch(() => {});

const NavigationTheme: Theme = {
  ...DefaultTheme,
  dark: true,
  colors: {
    ...DefaultTheme.colors,
    background: Colors.background,
    card: Colors.card,
    text: Colors.text,
    border: Colors.border,
    primary: Colors.primary,
    notification: Colors.primary,
  },
  fonts: {
    regular: { fontFamily: FontFamily.body, fontWeight: '500' },
    medium: { fontFamily: FontFamily.body, fontWeight: '500' },
    bold: { fontFamily: FontFamily.bodyBold, fontWeight: '700' },
    heavy: { fontFamily: FontFamily.display, fontWeight: '800' },
  },
};

export default function RootLayout() {
  const [fontsLoaded] = useFonts({
    PlusJakartaSans_500Medium,
    PlusJakartaSans_700Bold,
    PlusJakartaSans_800ExtraBold,
  });
  const [nativeSplashHidden, setNativeSplashHidden] = useState(false);

  useEffect(() => {
    let isMounted = true;

    if (fontsLoaded) {
      SplashScreen.hideAsync()
        .catch(() => {})
        .finally(() => {
          if (isMounted) {
            setNativeSplashHidden(true);
          }
        });
    }

    return () => {
      isMounted = false;
    };
  }, [fontsLoaded]);

  if (!fontsLoaded || !nativeSplashHidden) {
    return null;
  }

  return (
    <ThemeProvider value={NavigationTheme}>
      <LanguageSettingsProvider>
        <View style={styles.root}>
          <Stack screenOptions={{ headerShown: false }}>
            <Stack.Screen name="index" />
            <Stack.Screen name="choose-language" options={{ animation: 'slide_from_right' }} />
          </Stack>
          <StatusBar style="light" />
          <SplashGate />
        </View>
      </LanguageSettingsProvider>
    </ThemeProvider>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
});
