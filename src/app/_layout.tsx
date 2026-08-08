import { Stack } from 'expo-router';
import { useEffect } from 'react';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { Provider } from 'react-redux';
import { audioEngine } from '@/engine';
import { store } from '@/store';

export default function RootLayout() {
  useEffect(() => {
    // Activates the iOS/Android audio session once for the app's lifetime,
    // so playback keeps going in the background / with the screen locked.
    audioEngine.prepare().catch((error) => {
      console.warn('Failed to prepare audio session', error);
    });
  }, []);

  return (
    // Required by react-native-gesture-handler (used by the Fader/TransportBar scrub gestures).
    <GestureHandlerRootView style={{ flex: 1 }}>
      <Provider store={store}>
        <Stack screenOptions={{ headerShown: false }} />
      </Provider>
    </GestureHandlerRootView>
  );
}
