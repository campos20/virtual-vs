import { fireEvent, screen } from '@testing-library/react-native';
import { Provider } from 'react-redux';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { createStore } from '@/store';
import { renderWithStore } from '@/test-utils/renderWithStore';
import { LyricsDrawer } from './LyricsDrawer';

// Matches the frame renderWithStore.tsx uses - SafeAreaProvider renders
// nothing under react-test-renderer without explicit initial metrics.
const TEST_SAFE_AREA_METRICS = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, left: 0, right: 0, bottom: 34 },
};

describe('LyricsDrawer', () => {
  it('pre-fills the draft from the lyrics prop', () => {
    renderWithStore(
      <LyricsDrawer visible lyrics="Existing lyrics" onClose={jest.fn()} onSave={jest.fn()} />
    );

    expect(screen.getByTestId('lyrics-input').props.value).toBe('Existing lyrics');
  });

  it('saves the edited draft and closes', () => {
    const onSave = jest.fn();
    const onClose = jest.fn();
    renderWithStore(<LyricsDrawer visible lyrics="Old" onClose={onClose} onSave={onSave} />);

    fireEvent.changeText(screen.getByTestId('lyrics-input'), 'New lyrics');
    fireEvent.press(screen.getByTestId('save-lyrics-button'));

    expect(onSave).toHaveBeenCalledWith('New lyrics');
    expect(onClose).toHaveBeenCalled();
  });

  it('re-seeds the draft from a changed lyrics prop when reopened', () => {
    // RTL's `rerender` replaces the whole tree it was given, so the
    // Provider/SafeAreaProvider wrapping has to be included in both calls
    // here rather than going through renderWithStore (which only returns
    // the wrapped result, not a way to rerender within that same wrapping).
    const store = createStore();
    const wrap = (ui: React.ReactElement) => (
      <SafeAreaProvider initialMetrics={TEST_SAFE_AREA_METRICS}>
        <Provider store={store}>{ui}</Provider>
      </SafeAreaProvider>
    );
    const { rerender } = renderWithStore(
      <LyricsDrawer visible={false} lyrics="First" onClose={jest.fn()} onSave={jest.fn()} />,
      store
    );

    rerender(wrap(<LyricsDrawer visible lyrics="Second" onClose={jest.fn()} onSave={jest.fn()} />));

    expect(screen.getByTestId('lyrics-input').props.value).toBe('Second');
  });

  it('the Close button dismisses without saving', () => {
    const onSave = jest.fn();
    const onClose = jest.fn();
    renderWithStore(<LyricsDrawer visible lyrics="Old" onClose={onClose} onSave={onSave} />);

    fireEvent.press(screen.getByTestId('close-lyrics-button'));

    expect(onSave).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });
});
