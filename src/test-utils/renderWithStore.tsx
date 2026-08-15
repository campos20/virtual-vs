import { render } from '@testing-library/react-native';
import type { ReactElement } from 'react';
import { Provider } from 'react-redux';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { createStore } from '@/store';

export type TestStore = ReturnType<typeof createStore>;

// react-native-safe-area-context measures its frame via a native onLayout,
// which never fires under react-test-renderer - without explicit initial
// metrics, SafeAreaProvider renders nothing at all while it waits. There's
// no real device to measure, so these are just a plausible phone frame.
const TEST_SAFE_AREA_METRICS = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, left: 0, right: 0, bottom: 34 },
};

/** Renders `ui` under the same providers `_layout.tsx` wraps the real app in, against a fresh store. */
export function renderWithStore(ui: ReactElement, store: TestStore = createStore()) {
  return {
    store,
    ...render(
      <SafeAreaProvider initialMetrics={TEST_SAFE_AREA_METRICS}>
        <Provider store={store}>{ui}</Provider>
      </SafeAreaProvider>,
    ),
  };
}
