/**
 * Canonical English strings - the shape every other locale is checked
 * against (see pt-BR.ts). Mixer jargon that's standard regardless of
 * language (L/R, M/S, BPM) lives inline in its component, not here.
 */
export const en = {
  common: {
    cancel: 'Cancel',
    save: 'Save',
  },
  library: {
    title: 'Library',
    newProject: '+ New',
    emptyTitle: 'No projects yet',
    emptyMeta: 'Tap "+ New" to import stems and build one.',
    stemsCount: (count: number) => `${count} stem${count === 1 ? '' : 's'}`,
  },
  project: {
    backToLibrary: '‹ Library',
    edit: 'Edit',
    bundledNotice: "The bundled demo project can't be edited.",
    notFound: 'Project not found.',
    loadFailed: 'Failed to load project.',
    deleteConfirmTitle: 'Delete project?',
    deleteConfirmBody: (title: string, stemCount: number) =>
      `"${title}" and its ${stemCount} stem${stemCount === 1 ? '' : 's'} will be permanently deleted from this device.`,
    deleteConfirmConfirm: 'Delete',
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
  monitorSplit: {
    heading: 'OUTPUT',
    split: 'Split',
    sum: 'Sum',
  },
  click: {
    heading: 'CLICK',
  },
};

export type TranslationDictionary = typeof en;
