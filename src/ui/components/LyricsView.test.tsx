import { fireEvent, screen } from '@testing-library/react-native';
import { renderWithStore } from '@/test-utils/renderWithStore';
import { LyricsView } from './LyricsView';

function renderLyrics(overrides: Partial<React.ComponentProps<typeof LyricsView>> = {}) {
  const onEdit = jest.fn();
  const onTapLine = jest.fn();
  const onFontSizeChange = jest.fn();
  const onAllCapsChange = jest.fn();
  renderWithStore(
    <LyricsView
      lyrics=""
      syncPoints={[]}
      durationSec={60}
      playheadSec={0}
      fontSizePt={18}
      allCaps={false}
      onEdit={onEdit}
      onTapLine={onTapLine}
      onFontSizeChange={onFontSizeChange}
      onAllCapsChange={onAllCapsChange}
      {...overrides}
    />
  );
  return { onEdit, onTapLine, onFontSizeChange, onAllCapsChange };
}

describe('LyricsView', () => {
  it('shows the empty state and lets the user open the editor from it', () => {
    const { onEdit } = renderLyrics();

    expect(screen.getByText('No lyrics yet.')).toBeTruthy();
    fireEvent.press(screen.getByTestId('add-lyrics-button'));

    expect(onEdit).toHaveBeenCalled();
  });

  it('renders each non-blank line and hides the empty state', () => {
    renderLyrics({ lyrics: 'Line one\n\nLine two' });

    expect(screen.queryByText('No lyrics yet.')).toBeNull();
    expect(screen.getByText('Line one')).toBeTruthy();
    expect(screen.getByText('Line two')).toBeTruthy();
  });

  it('calls onTapLine with the tapped line index', () => {
    const { onTapLine } = renderLyrics({ lyrics: 'Line one\nLine two' });

    fireEvent.press(screen.getByTestId('lyrics-line-1'));

    expect(onTapLine).toHaveBeenCalledWith(1);
  });

  it('does not render a blank line as tappable', () => {
    renderLyrics({ lyrics: 'Line one\n\nLine two' });

    expect(screen.queryByTestId('lyrics-line-1')).toBeNull();
  });

  it('the corner Edit button calls onEdit', () => {
    const { onEdit } = renderLyrics({ lyrics: 'Line one' });

    fireEvent.press(screen.getByTestId('edit-lyrics-button'));

    expect(onEdit).toHaveBeenCalled();
  });

  it('shows the tap hint before any line has been tapped', () => {
    renderLyrics({ lyrics: 'Line one', syncPoints: [] });

    expect(screen.getByText('Tap a line to fine-tune sync')).toBeTruthy();
  });

  it('hides the tap hint once a sync point exists', () => {
    renderLyrics({ lyrics: 'Line one', syncPoints: [{ lineIndex: 0, timeSec: 1 }] });

    expect(screen.queryByText('Tap a line to fine-tune sync')).toBeNull();
  });

  it('steps the font size up and down, clamped at the configured bounds', () => {
    const { onFontSizeChange } = renderLyrics({ lyrics: 'Line one', fontSizePt: 14 });

    fireEvent.press(screen.getByTestId('lyrics-font-decrease'));
    expect(onFontSizeChange).toHaveBeenCalledWith(14); // clamped at the minimum

    fireEvent.press(screen.getByTestId('lyrics-font-increase'));
    expect(onFontSizeChange).toHaveBeenCalledWith(16);
  });

  it('clamps the font size at the maximum', () => {
    const { onFontSizeChange } = renderLyrics({ lyrics: 'Line one', fontSizePt: 30 });

    fireEvent.press(screen.getByTestId('lyrics-font-increase'));

    expect(onFontSizeChange).toHaveBeenCalledWith(30);
  });

  it('toggles all caps on and off', () => {
    const { onAllCapsChange } = renderLyrics({ lyrics: 'Line one', allCaps: false });

    fireEvent.press(screen.getByTestId('lyrics-allcaps-toggle'));
    expect(onAllCapsChange).toHaveBeenCalledWith(true);
  });

  it('renders line text with an uppercase transform when all caps is on', () => {
    renderLyrics({ lyrics: 'Line one', allCaps: true });

    const style = screen.getByText('Line one').props.style;
    const flattened = Array.isArray(style) ? Object.assign({}, ...style.flat(Infinity)) : style;
    expect(flattened.textTransform).toBe('uppercase');
  });
});
