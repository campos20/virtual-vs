import type { File } from 'expo-file-system';
import { isAvailableAsync, shareAsync } from 'expo-sharing';
import { shareBundle } from './share';

jest.mock('expo-sharing', () => ({
  isAvailableAsync: jest.fn(),
  shareAsync: jest.fn(),
}));

const bundle = { uri: 'file:///cache/sunday-set.vvs' } as File;

beforeEach(() => {
  jest.clearAllMocks();
  (isAvailableAsync as jest.Mock).mockResolvedValue(true);
});

describe('shareBundle', () => {
  it('hands the file to the OS share sheet', async () => {
    await shareBundle(bundle, 'Export…');

    expect(shareAsync).toHaveBeenCalledWith(bundle.uri, expect.objectContaining({ dialogTitle: 'Export…' }));
  });

  // A narrower type would hide the cloud apps this exists to reach, which is
  // the whole point: Drive is just another target in the sheet.
  it('declares a generic type, so every target stays in the sheet', async () => {
    await shareBundle(bundle, 'Export…');

    expect((shareAsync as jest.Mock).mock.calls[0][1]).toMatchObject({
      mimeType: 'application/octet-stream',
      UTI: 'public.data',
    });
  });

  it('says so when the device cannot share, rather than appearing to do nothing', async () => {
    (isAvailableAsync as jest.Mock).mockResolvedValue(false);

    await expect(shareBundle(bundle, 'Export…')).rejects.toThrow(/not available/);
    expect(shareAsync).not.toHaveBeenCalled();
  });
});
