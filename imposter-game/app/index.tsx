import { Image } from 'expo-image';
import { StyleSheet, View } from 'react-native';

const SPLASH_BACKGROUND = '#171717';

export default function SplashScreen() {
  return (
    <View style={styles.container}>
      <Image
        source={require('@/assets/images/imposter-logo.png')}
        style={styles.logo}
        contentFit="contain"
        accessibilityLabel="Imposter"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: SPLASH_BACKGROUND,
  },
  logo: {
    width: '46%',
    maxWidth: 260,
    minWidth: 164,
    aspectRatio: 1,
  },
});
