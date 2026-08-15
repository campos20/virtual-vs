import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import { audioEngine } from '@/engine';
import { projectAdded } from '@/store/projectsSlice';
import { trackEntityId } from '@/store/tracksSlice';
import { getDemoLibraryEntry } from '@/storage';
import { createStore } from '@/store';
import { renderWithStore } from '@/test-utils/renderWithStore';
import { PlayerScreen } from './PlayerScreen';

const mockBack = jest.fn();

jest.mock('expo-router', () => ({
  useLocalSearchParams: () => ({ projectId: 'demo-sync-test' }),
  useRouter: () => ({ back: mockBack }),
}));

beforeEach(() => {
  mockBack.mockClear();
});

// usePlayhead's requestAnimationFrame loop ticks independently of React's act()
// batching (real timers, not test-controlled), which trips act() warnings once
// it outlives the test that started it. None of these tests assert on the
// live-ticking playhead readout, so keep the loop from ever scheduling.
beforeEach(() => {
  jest.spyOn(globalThis, 'requestAnimationFrame').mockReturnValue(0);
  jest.spyOn(globalThis, 'cancelAnimationFrame').mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

function renderPlayerScreen() {
  const store = createStore();
  store.dispatch(projectAdded(getDemoLibraryEntry()));
  return renderWithStore(<PlayerScreen />, store);
}

async function waitForMixerToLoad() {
  await waitFor(() => expect(screen.getByText('Bass')).toBeTruthy());
}

describe('PlayerScreen', () => {
  it('loads the demo project and renders a channel strip per track', async () => {
    renderPlayerScreen();

    await waitForMixerToLoad();

    expect(screen.getByText('Demo: Sync Test')).toBeTruthy();
    expect(screen.getByText('120 BPM')).toBeTruthy();
    expect(screen.getByText('A minor')).toBeTruthy();
    expect(screen.getByText('Bass')).toBeTruthy();
    expect(screen.getByText('Keys')).toBeTruthy();
    expect(screen.getByText('Guide Vocal')).toBeTruthy();
  });

  it('starts stopped, showing the play icon and a zeroed transport', async () => {
    renderPlayerScreen();
    await waitForMixerToLoad();

    expect(screen.getByTestId('play-icon')).toBeTruthy();
    expect(screen.getByText(/^0:00\.0/)).toBeTruthy();
  });

  it('play/pause drives the real audio engine transport', async () => {
    renderPlayerScreen();
    await waitForMixerToLoad();

    fireEvent.press(screen.getByTestId('play-pause-button'));
    expect(audioEngine.getTransportState()).toBe('playing');
    expect(screen.getByTestId('pause-icon')).toBeTruthy();

    fireEvent.press(screen.getByTestId('play-pause-button'));
    expect(audioEngine.getTransportState()).toBe('paused');
    expect(screen.getByTestId('play-icon')).toBeTruthy();
  });

  it('stop resets the transport back to the start', async () => {
    renderPlayerScreen();
    await waitForMixerToLoad();

    fireEvent.press(screen.getByTestId('play-pause-button'));
    fireEvent.press(screen.getByTestId('stop-button'));

    expect(audioEngine.getTransportState()).toBe('stopped');
    expect(screen.getByText(/^0:00\.0/)).toBeTruthy();
    expect(screen.getByTestId('play-icon')).toBeTruthy();
  });

  it('toggling mute on a channel strip mutes it in the engine and commits it to the store', async () => {
    const { store } = renderPlayerScreen();
    await waitForMixerToLoad();

    // Channel strips render left-to-right in manifest order: Bass, Keys, Guide Vocal.
    const [bassMute] = screen.getAllByText('M');
    fireEvent.press(bassMute);

    expect(audioEngine.getTrackState('bass')?.muted).toBe(true);
    const committed = store.getState().tracks.entities[trackEntityId('demo-sync-test', 'bass')];
    expect(committed?.muted).toBe(true);

    fireEvent.press(bassMute);
    expect(audioEngine.getTrackState('bass')?.muted).toBe(false);
  });

  it('toggling solo on a channel strip solos it in the engine and commits it to the store', async () => {
    const { store } = renderPlayerScreen();
    await waitForMixerToLoad();

    const [, keysSolo] = screen.getAllByText('S');
    fireEvent.press(keysSolo);

    expect(audioEngine.getTrackState('keys')?.soloed).toBe(true);
    const committed = store.getState().tracks.entities[trackEntityId('demo-sync-test', 'keys')];
    expect(committed?.soloed).toBe(true);
  });

  it('routing a track to a different bus updates the engine and the store', async () => {
    const { store } = renderPlayerScreen();
    await waitForMixerToLoad();

    // Bass starts on "main" (manifest default) - route it to "cue" (the "L" pill) instead.
    const [bassL] = screen.getAllByText('L');
    fireEvent.press(bassL);

    expect(audioEngine.getTrackState('bass')?.bus).toBe('cue');
    const committed = store.getState().tracks.entities[trackEntityId('demo-sync-test', 'bass')];
    expect(committed?.bus).toBe('cue');
  });

  it('navigates back when the back button is pressed', async () => {
    renderPlayerScreen();
    await waitForMixerToLoad();

    fireEvent.press(screen.getByTestId('back-button'));

    expect(mockBack).toHaveBeenCalledTimes(1);
  });

  // Regression guard for the Android Fabric "already has a parent" crash on
  // the Player -> Library transition (see AGENTS.md). Anything that can push
  // engine state into setState has to be detached *before* the transport is
  // stopped and before we navigate, or a re-render commits into the frame
  // where Fabric is removing this screen's views.
  it('stops playback and navigates only after detaching the engine listener', async () => {
    const detach = jest.fn();
    jest.spyOn(audioEngine, 'onTransportStateChange').mockReturnValue(detach);
    const stopSpy = jest.spyOn(audioEngine, 'stop');

    renderPlayerScreen();
    await waitForMixerToLoad();
    stopSpy.mockClear();

    fireEvent.press(screen.getByTestId('back-button'));

    expect(detach).toHaveBeenCalled();
    expect(stopSpy).toHaveBeenCalled();
    expect(mockBack).toHaveBeenCalledTimes(1);
    expect(detach.mock.invocationCallOrder[0]).toBeLessThan(
      stopSpy.mock.invocationCallOrder[0]
    );
    expect(stopSpy.mock.invocationCallOrder[0]).toBeLessThan(
      mockBack.mock.invocationCallOrder[0]
    );
  });

  // Covers the Android hardware back button and back gesture, which never run
  // handleBack - only the unmount cleanups. React runs those in declaration
  // order, so the transport listener effect must be declared before the
  // loader effect whose cleanup calls stop().
  it('detaches the engine listener before stopping it on unmount', async () => {
    const detach = jest.fn();
    jest.spyOn(audioEngine, 'onTransportStateChange').mockReturnValue(detach);
    const stopSpy = jest.spyOn(audioEngine, 'stop');

    const { unmount } = renderPlayerScreen();
    await waitForMixerToLoad();
    stopSpy.mockClear();

    unmount();

    expect(detach).toHaveBeenCalled();
    expect(stopSpy).toHaveBeenCalled();
    expect(detach.mock.invocationCallOrder[0]).toBeLessThan(
      stopSpy.mock.invocationCallOrder[0]
    );
  });

  it('flipping the monitor switch updates the engine and the settings store', async () => {
    const { store } = renderPlayerScreen();
    await waitForMixerToLoad();

    expect(audioEngine.getMonitorMode()).toBe('split');

    // Console row order: monitor switch, then click switch.
    const [monitorSwitch] = screen.getAllByRole('switch');
    fireEvent(monitorSwitch, 'valueChange', true);

    expect(audioEngine.getMonitorMode()).toBe('monitor');
    expect(store.getState().settings.monitorMode).toBe('monitor');
  });

  it('flipping the click switch mutes/unmutes the engine click and updates the settings store', async () => {
    const { store } = renderPlayerScreen();
    await waitForMixerToLoad();

    expect(audioEngine.getClickEnabled()).toBe(true);

    const [, clickSwitch] = screen.getAllByRole('switch');
    fireEvent(clickSwitch, 'valueChange', false);

    expect(audioEngine.getClickEnabled()).toBe(false);
    expect(store.getState().settings.clickEnabled).toBe(false);
  });
});
