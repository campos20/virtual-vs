import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { View } from 'react-native';
import { Provider } from 'react-redux';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { audioEngine } from '@/engine';
import { store } from '@/store';
import { ProjectLibraryGate } from '@/ui/ProjectLibraryGate';
import { NowPlayingBar } from '@/ui/components/NowPlayingBar';
import { useThemeColors, useThemeMode } from '@/ui/theme';

export default function RootLayout() {
  useEffect(() => {
    // Activates the iOS/Android audio session once for the app's lifetime,
    // so playback keeps going in the background / with the screen locked.
    audioEngine.prepare().catch((error) => {
      console.warn('Failed to prepare audio session', error);
    });
  }, []);

  return (
    <SafeAreaProvider>
      <Provider store={store}>
        <ProjectLibraryGate>
          <ThemedApp />
        </ProjectLibraryGate>
      </Provider>
    </SafeAreaProvider>
  );
}

// Split out from RootLayout because useThemeColors()/useThemeMode() need the
// Redux Provider above them in the tree - a hook call in the component that
// renders the Provider itself would run before that context exists.
function ThemedApp() {
  const colors = useThemeColors();
  const mode = useThemeMode();

  return (
    <>
      {/* expo-status-bar's `style` names the icon color, not the theme:
          "light" means light icons, which is what a *dark* background
          needs - the inverse of our own dark/light theme mode. */}
      <StatusBar style={mode === 'dark' ? 'light' : 'dark'} />
      <View style={{ flex: 1 }}>
        {/* No transition animation: simpler and more predictable than an
            animated push/pop, and removes the window where two screens'
            native view trees are both present/rendering at once during a
            transition - see AGENTS.md "Stability over appearance". */}
        <Stack
          screenOptions={{
            headerShown: false,
            animation: 'none',
            contentStyle: { backgroundColor: colors.background },
          }}
        />
        {/* Rendered above the navigator, not inside any one screen, so
            playback (and this bar) survives every screen transition - see
            the "now playing" plan. */}
        <NowPlayingBar />
      </View>
    </>
  );
}
