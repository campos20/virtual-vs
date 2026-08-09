import { render } from '@testing-library/react-native';
import type { ReactElement } from 'react';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { Provider } from 'react-redux';
import { createStore } from '@/store';

export type TestStore = ReturnType<typeof createStore>;

/** Renders `ui` under the same providers `_layout.tsx` wraps the real app in, against a fresh store. */
export function renderWithStore(ui: ReactElement, store: TestStore = createStore()) {
  return {
    store,
    ...render(
      <GestureHandlerRootView style={{ flex: 1 }}>
        <Provider store={store}>{ui}</Provider>
      </GestureHandlerRootView>
    ),
  };
}
