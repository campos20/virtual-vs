import { Stack } from 'expo-router';
import { useEffect } from 'react';
import { Provider } from 'react-redux';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { audioEngine } from '@/engine';
import { store } from '@/store';
import { ProjectLibraryGate } from '@/ui/ProjectLibraryGate';

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
        {/* No transition animation: simpler and more predictable than an
            animated push/pop, and removes the window where two screens'
            native view trees are both present/rendering at once during a
            transition - see AGENTS.md "Stability over appearance". */}
        <Stack screenOptions={{ headerShown: false, animation: 'none' }} />
        </ProjectLibraryGate>
      </Provider>
    </SafeAreaProvider>
  );
}
