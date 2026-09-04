import { fireEvent, screen } from '@testing-library/react-native';
import { renderWithStore } from '@/test-utils/renderWithStore';
import { LyricsSyncDrawer } from './LyricsSyncDrawer';

function renderDrawer(overrides: Partial<React.ComponentProps<typeof LyricsSyncDrawer>> = {}) {
  const onClose = jest.fn();
  const onRemoveOne = jest.fn();
  const onClearAll = jest.fn();
  renderWithStore(
    <LyricsSyncDrawer
      visible
      onClose={onClose}
      lyrics={'Line one\nLine two\nLine three'}
      syncPoints={[]}
      onRemoveOne={onRemoveOne}
      onClearAll={onClearAll}
      {...overrides}
    />
  );
  return { onClose, onRemoveOne, onClearAll };
}

describe('LyricsSyncDrawer', () => {
  it('shows an empty state and no Clear All button when nothing is synced', () => {
    renderDrawer({ syncPoints: [] });

    expect(screen.getByText('Tap a line to fine-tune sync')).toBeTruthy();
    expect(screen.queryByTestId('clear-all-sync-button')).toBeNull();
  });

  it('lists every sync point, sorted by time, with its line text and timestamp', () => {
    renderDrawer({
      lyrics: 'Intro line\nVerse line\nChorus line',
      syncPoints: [
        { lineIndex: 2, timeSec: 42 },
        { lineIndex: 0, timeSec: 5 },
      ],
    });

    expect(screen.getByText('Intro line')).toBeTruthy();
    expect(screen.getByText('0:05')).toBeTruthy();
    expect(screen.getByText('Chorus line')).toBeTruthy();
    expect(screen.getByText('0:42')).toBeTruthy();
  });

  it('shows the sync count', () => {
    renderDrawer({
      lyrics: 'A\nB',
      syncPoints: [
        { lineIndex: 0, timeSec: 1 },
        { lineIndex: 1, timeSec: 2 },
      ],
    });

    expect(screen.getByText('2 lines synced')).toBeTruthy();
  });

  it('removes a single sync point', () => {
    const { onRemoveOne } = renderDrawer({
      lyrics: 'A\nB',
      syncPoints: [{ lineIndex: 1, timeSec: 2 }],
    });

    fireEvent.press(screen.getByTestId('remove-sync-1'));

    expect(onRemoveOne).toHaveBeenCalledWith(1);
  });

  it('clears every sync point at once', () => {
    const { onClearAll } = renderDrawer({
      lyrics: 'A\nB',
      syncPoints: [
        { lineIndex: 0, timeSec: 1 },
        { lineIndex: 1, timeSec: 2 },
      ],
    });

    fireEvent.press(screen.getByTestId('clear-all-sync-button'));

    expect(onClearAll).toHaveBeenCalled();
  });

  it('closes without side effects from the Close button', () => {
    const { onClose, onClearAll, onRemoveOne } = renderDrawer();

    fireEvent.press(screen.getByTestId('close-lyrics-sync-button'));

    expect(onClose).toHaveBeenCalled();
    expect(onClearAll).not.toHaveBeenCalled();
    expect(onRemoveOne).not.toHaveBeenCalled();
  });
});
