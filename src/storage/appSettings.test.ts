import { File, Paths } from 'expo-file-system';
import { readAppSettings, writeAppSettings } from './appSettings';

const settingsFile = new File(Paths.document, 'settings.json');

beforeEach(() => {
  if (settingsFile.exists) settingsFile.delete();
});

describe('appSettings', () => {
  it('returns an empty object when no settings file exists yet', () => {
    expect(readAppSettings()).toEqual({});
  });

  it('round-trips a written language override', () => {
    writeAppSettings({ languageOverride: 'pt-BR' });

    expect(readAppSettings()).toEqual({ languageOverride: 'pt-BR' });
  });

  it('merges into existing settings rather than overwriting them', () => {
    writeAppSettings({ languageOverride: 'pt-BR' });
    writeAppSettings({ languageOverride: 'en' });

    expect(readAppSettings()).toEqual({ languageOverride: 'en' });
  });

  // Selecting "System" on the About screen clears the override this way.
  it('clears the override when written as undefined', () => {
    writeAppSettings({ languageOverride: 'pt-BR' });
    writeAppSettings({ languageOverride: undefined });

    expect(readAppSettings()).toEqual({});
  });

  it('falls back to an empty object for unreadable/corrupt settings', () => {
    settingsFile.write('not valid json');

    expect(readAppSettings()).toEqual({});
  });
});
