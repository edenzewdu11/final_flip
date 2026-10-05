import React, { useEffect, useState } from 'react';
import { Image, Platform, StyleSheet, View, AppState } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import './src/utils/errorMessage';
import AppNavigator from './src/navigation/AppNavigator';
import { runCryptoSelfTest } from './src/security/selfTest';

export default function App() {
  const [showStartupSplash, setShowStartupSplash] = useState(true);

  // TEMPORARY: offline crypto self-test (no network required).
  // Safe to remove once the E2E encryption layer is verified.
  useEffect(() => {
    runCryptoSelfTest().then(({ passed, results }) => {
      console.log(passed ? '✅ Crypto self-test PASSED' : '❌ Crypto self-test FAILED');
      results.forEach((r) => {
        console.log(`  ${r.passed ? '✅' : '❌'} ${r.name}`, r.detail ?? '');
      });
    });
  }, []);

  useEffect(() => {
    if (Platform.OS !== 'web' || typeof document === 'undefined') {
      return undefined;
    }

    const html = document.documentElement;
    const body = document.body;
    const root = document.getElementById('root');

    const previous = {
      htmlHeight: html.style.height,
      htmlOverflow: html.style.overflow,
      bodyHeight: body.style.height,
      bodyOverflow: body.style.overflow,
      bodyPosition: body.style.position,
      bodyTouchAction: body.style.touchAction,
      rootMinHeight: root?.style.minHeight || '',
      rootOverflow: root?.style.overflow || '',
      rootTouchAction: root?.style.touchAction || '',
    };

    html.style.height = '100%';
    html.style.overflow = 'auto';
    body.style.height = '100%';
    body.style.overflow = 'auto';
    body.style.position = 'static';
    body.style.touchAction = 'pan-y';

    if (root) {
      root.style.minHeight = '100%';
      root.style.overflow = 'auto';
      root.style.touchAction = 'pan-y';
    }

    return () => {
      html.style.height = previous.htmlHeight;
      html.style.overflow = previous.htmlOverflow;
      body.style.height = previous.bodyHeight;
      body.style.overflow = previous.bodyOverflow;
      body.style.position = previous.bodyPosition;
      body.style.touchAction = previous.bodyTouchAction;

      if (root) {
        root.style.minHeight = previous.rootMinHeight;
        root.style.overflow = previous.rootOverflow;
        root.style.touchAction = previous.rootTouchAction;
      }
    };
  }, []);

  useEffect(() => {
    const splashTimer = setTimeout(() => {
      setShowStartupSplash(false);
    }, 1400);

    return () => clearTimeout(splashTimer);
  }, []);

  // Memory cleanup when app enters background
  useEffect(() => {
    const handleAppStateChange = (nextAppState) => {
      if (nextAppState === 'background') {
        // Clear image caches to free memory
        if (Platform.OS !== 'web') {
          try {
            // Clear React Native image cache
            if (global.Image && global.Image.clearCache) {
              global.Image.clearCache();
            }
          } catch (e) {
            // Cache clearing might not be available
          }
        }
        
        // Clear any other heavy resources here
        // For example: clear video buffers, large data arrays, etc.
      }
    };

    const subscription = AppState.addEventListener('change', handleAppStateChange);
    return () => subscription?.remove();
  }, []);

  if (showStartupSplash) {
    return (
      <SafeAreaProvider>
        <View style={styles.startupSplash}>
          <Image
            source={require('./assets/splash.png')}
            style={styles.startupSplashImage}
            resizeMode="contain"
          />
        </View>
      </SafeAreaProvider>
    );
  }

  return (
    <SafeAreaProvider>
      <AppNavigator />
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  startupSplash: {
    flex: 1,
    backgroundColor: '#000000',
    alignItems: 'center',
    justifyContent: 'center',
  },
  startupSplashImage: {
    width: '88%',
    maxWidth: 420,
    aspectRatio: 1242 / 2436,
  },
});
