/**
 * Canonical English strings - the shape every other locale is checked
 * against (see pt-BR.ts). Mixer jargon that's standard regardless of
 * language (L/R, M/S, BPM) lives inline in its component, not here.
 */
export const en = {
  common: {
    cancel: 'Cancel',
    save: 'Save',
    close: 'Close',
  },
  library: {
    title: 'Library',
    newProject: '+ New',
    emptyTitle: 'No projects yet',
    emptyMeta: 'Tap "+ New" to import stems and build one.',
    stemsCount: (count: number) => `${count} stem${count === 1 ? '' : 's'}`,
    moveUp: 'Move up',
    moveDown: 'Move down',
    newFolder: '+ Folder',
    importBundle: 'Import a backup…',
    lockedWhilePlaying: 'Stop playback before moving files around.',
    exportEmptyFolder: 'This folder has no songs to export yet.',
    importAlreadyHere: (count: number) =>
      count === 1
        ? 'That song is already in your library, so nothing was changed.'
        : `Those ${count} songs are already in your library, so nothing was changed.`,
  },
  folder: {
    /** Name a new folder carries until it's renamed. User data, so it's written in the user's language. */
    defaultName: 'New folder',
    createFailed: "Couldn't create the folder. Check that this device has free space.",
    songsCount: (count: number) => `${count} song${count === 1 ? '' : 's'}`,
    empty: 'Empty — add songs from a song\u2019s menu',
    expand: 'Show songs',
    collapse: 'Hide songs',
    rename: 'Rename',
    renamePlaceholder: 'Folder name',
    delete: 'Delete folder',
    deleteConfirmTitle: 'Delete folder?',
    deleteConfirmBody: (name: string, songCount: number) =>
      `"${name}" will be deleted. Its ${songCount} song${songCount === 1 ? '' : 's'} stay on this device and return to the library.`,
    deleteConfirmConfirm: 'Delete',
    addTo: (name: string) => `Add to ${name}`,
    removeFrom: 'Remove from folder',
    export: 'Export…',
    songOptions: 'Song options',
    folderOptions: 'Folder options',
  },
  project: {
    backToLibrary: 'Library',
    edit: 'Edit',
    notFound: 'Project not found.',
    loadFailed: 'Failed to load project.',
    deleteConfirmTitle: 'Delete project?',
    deleteConfirmBody: (title: string, stemCount: number) =>
      `"${title}" and its ${stemCount} stem${stemCount === 1 ? '' : 's'} will be permanently deleted from this device.`,
    deleteConfirmConfirm: 'Delete',
    mixer: 'Mixer',
    lockedWhilePlaying: 'Stop playback to edit',
    lockedWhilePlayingBody:
      'Editing rebuilds the audio engine, which would cut the song off. Stop playback first.',
  },
  projectForm: {
    titleLabel: 'TITLE',
    titlePlaceholder: 'Project title',
    tempoLabel: 'TEMPO (BPM)',
    tempoPlaceholder: 'Optional — leave empty for no click',
    tempoHintNone: 'No tempo set, so this project plays without a metronome click.',
    tempoHintSet: 'The click is generated from this tempo and sent to the cue (L) bus.',
    keyLabel: 'KEY',
    keyPlaceholder: 'e.g. A minor',
    stemsLabel: 'STEMS',
    addAudioFiles: 'Add Audio Files…',
    noStemsYet: 'No stems yet.',
    remove: 'Remove',
    deleteProject: 'Delete Project',
  },
  progress: {
    copying: (name: string) => `Copying ${name}…`,
    copyingOf: (name: string, current: number, total: number) =>
      `Copying ${name} (${current} of ${total})…`,
    converting: (name: string) => `Converting ${name} to stereo…`,
    convertingGeneric: 'Converting to stereo…',
    decoding: 'Decoding stems…',
    decodingOf: (current: number, total: number) => `Decoding stems (${current} of ${total})…`,
    building: 'Building the mixer…',
    waveforms: 'Drawing waveforms…',
    exporting: (name: string, current: number, total: number) =>
      `Packing ${name} (${current} of ${total})…`,
    importing: (name: string, current: number, total: number) =>
      `Unpacking ${name} (${current} of ${total})…`,
  },
  markers: {
    heading: 'Markers',
    emptyText: 'No markers yet. Tap a preset or type a name, then add one at the current position.',
    namePlaceholder: 'Marker name',
    addAt: (time: string) => `Add at ${time}`,
    remove: 'Remove',
    jumpTo: (name: string) => `Jump to ${name}`,
    presetIntro: 'Intro',
    presetVerse: 'Verse',
    presetChorus: 'Chorus',
    presetBridge: 'Bridge',
    presetOutro: 'Outro',
    presetA: 'A',
    presetB: 'B',
  },
  lyrics: {
    heading: 'Lyrics',
    toggleLabel: 'Lyrics',
    emptyText: 'No lyrics yet.',
    addLyrics: 'Add lyrics',
    edit: 'Edit',
    editPlaceholder: 'Type or paste the lyrics…',
    editHint: 'Saving clears any existing tap-to-sync timing, since the lines may no longer match up.',
    tapHint: 'Tap a line to fine-tune sync',
    allCaps: 'ALL CAPS',
    syncCount: (count: number) => `${count} line${count === 1 ? '' : 's'} synced`,
    clearSync: 'Clear sync',
    sync: 'Sync',
    syncHeading: 'Tap to Sync',
    remove: 'Remove',
  },
  nowPlaying: {
    heading: 'Now Playing',
    goToSong: (title: string) => `Now playing: ${title}. Go to song.`,
  },
  monitorSplit: {
    heading: 'OUTPUT',
    split: 'Split',
    sum: 'Sum',
  },
  click: {
    heading: 'CLICK',
  },
  menu: {
    moreOptions: 'More options',
    settings: 'Settings',
    about: 'About',
  },
  about: {
    title: 'About',
    developedBy: (name: string) => `Developed by ${name}`,
    version: (version: string) => `Version ${version}`,
    viewOnGithub: 'View on GitHub',
    license: 'License',
  },
  settings: {
    title: 'Settings',
    language: 'Language',
    languageSystem: 'System',
    theme: 'Appearance',
    themeSystem: 'System',
    themeLight: 'Light',
    themeDark: 'Dark',
  },
};

export type TranslationDictionary = typeof en;
