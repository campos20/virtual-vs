import type { TranslationDictionary } from './en';

/**
 * Brazilian Portuguese. Typed against `TranslationDictionary` so a missing
 * key is a compile error, not a silent English fallback at runtime.
 *
 * A few terms are kept as their English form on purpose, because that's the
 * word Brazilian musicians and engineers actually use for it, not because
 * they weren't translated: "click" (click track - "clique" would read as a
 * mouse click) and "cue"/"split" (foldback/signal-split jargon, both common
 * loanwords in Brazilian live-sound). "Key" becomes "TOM", and its example
 * uses solfège note names ("Lá" not "A") since that's how Brazilian
 * musicians read a key, not letter names.
 */
export const ptBR: TranslationDictionary = {
  common: {
    cancel: 'Cancelar',
    save: 'Salvar',
    close: 'Fechar',
  },
  library: {
    title: 'Biblioteca',
    newProject: '+ Novo',
    emptyTitle: 'Nenhum projeto ainda',
    emptyMeta: 'Toque em "+ Novo" para importar faixas e criar um.',
    stemsCount: (count: number) => `${count} ${count === 1 ? 'faixa' : 'faixas'}`,
    moveUp: 'Mover para cima',
    moveDown: 'Mover para baixo',
    newFolder: '+ Pasta',
    importBundle: 'Importar um backup…',
    lockedWhilePlaying: 'Pare a reprodução antes de mover arquivos.',
    exportEmptyFolder: 'Esta pasta ainda não tem músicas para exportar.',
    importAlreadyHere: (count: number) =>
      count === 1
        ? 'Essa música já está na sua biblioteca, então nada foi alterado.'
        : `Essas ${count} músicas já estão na sua biblioteca, então nada foi alterado.`,
  },
  folder: {
    defaultName: 'Nova pasta',
    createFailed: 'Não foi possível criar a pasta. Verifique se há espaço livre no dispositivo.',
    songsCount: (count: number) => `${count} ${count === 1 ? 'música' : 'músicas'}`,
    empty: 'Vazia — adicione músicas pelo menu da música',
    expand: 'Mostrar músicas',
    collapse: 'Ocultar músicas',
    rename: 'Renomear',
    renamePlaceholder: 'Nome da pasta',
    delete: 'Excluir pasta',
    deleteConfirmTitle: 'Excluir pasta?',
    deleteConfirmBody: (name: string, songCount: number) =>
      `"${name}" será excluída. ${songCount === 1 ? 'A música dela continua' : `As ${songCount} músicas dela continuam`} neste dispositivo e ${songCount === 1 ? 'volta' : 'voltam'} para a biblioteca.`,
    deleteConfirmConfirm: 'Excluir',
    addTo: (name: string) => `Adicionar a ${name}`,
    removeFrom: 'Remover da pasta',
    export: 'Exportar…',
    songOptions: 'Opções da música',
    folderOptions: 'Opções da pasta',
  },
  project: {
    backToLibrary: 'Biblioteca',
    edit: 'Editar',
    notFound: 'Projeto não encontrado.',
    loadFailed: 'Falha ao carregar o projeto.',
    deleteConfirmTitle: 'Excluir projeto?',
    deleteConfirmBody: (title: string, stemCount: number) =>
      `"${title}" e ${stemCount} ${stemCount === 1 ? 'faixa' : 'faixas'} serão excluídos permanentemente deste aparelho.`,
    deleteConfirmConfirm: 'Excluir',
    mixer: 'Mixer',
    lockedWhilePlaying: 'Pare a reprodução para editar',
    lockedWhilePlayingBody:
      'Editar reconstrói o motor de áudio, o que cortaria a música. Pare a reprodução primeiro.',
  },
  projectForm: {
    titleLabel: 'TÍTULO',
    titlePlaceholder: 'Título do projeto',
    tempoLabel: 'TEMPO (BPM)',
    tempoPlaceholder: 'Opcional — deixe em branco para não ter click',
    tempoHintNone: 'Nenhum tempo definido, então este projeto toca sem o click do metrônomo.',
    tempoHintSet: 'O click é gerado a partir deste tempo e enviado ao bus de cue (L).',
    keyLabel: 'TOM',
    keyPlaceholder: 'ex.: Lá menor',
    stemsLabel: 'FAIXAS',
    addAudioFiles: 'Adicionar Arquivos de Áudio…',
    noStemsYet: 'Nenhuma faixa ainda.',
    remove: 'Remover',
    deleteProject: 'Excluir Projeto',
  },
  progress: {
    copying: (name: string) => `Copiando ${name}…`,
    copyingOf: (name: string, current: number, total: number) =>
      `Copiando ${name} (${current} de ${total})…`,
    converting: (name: string) => `Convertendo ${name} para estéreo…`,
    convertingGeneric: 'Convertendo para estéreo…',
    decoding: 'Decodificando faixas…',
    decodingOf: (current: number, total: number) =>
      `Decodificando faixas (${current} de ${total})…`,
    building: 'Montando o mixer…',
    waveforms: 'Desenhando as ondas…',
    exporting: (name: string, current: number, total: number) =>
      `Empacotando ${name} (${current} de ${total})…`,
    importing: (name: string, current: number, total: number) =>
      `Desempacotando ${name} (${current} de ${total})…`,
  },
  markers: {
    heading: 'Marcadores',
    emptyText: 'Nenhum marcador ainda. Toque em um predefinido ou digite um nome e adicione na posição atual.',
    namePlaceholder: 'Nome do marcador',
    addAt: (time: string) => `Adicionar em ${time}`,
    remove: 'Remover',
    jumpTo: (name: string) => `Ir para ${name}`,
    presetIntro: 'Introdução',
    presetVerse: 'Estrofe',
    presetChorus: 'Refrão',
    presetBridge: 'Ponte',
    presetOutro: 'Final',
    presetA: 'A',
    presetB: 'B',
  },
  nowPlaying: {
    heading: 'Tocando Agora',
    goToSong: (title: string) => `Tocando agora: ${title}. Ir para a música.`,
  },
  monitorSplit: {
    heading: 'SAÍDA',
    split: 'Split',
    sum: 'Soma',
  },
  click: {
    heading: 'CLICK',
  },
  menu: {
    moreOptions: 'Mais opções',
    about: 'Sobre',
  },
  about: {
    title: 'Sobre',
    developedBy: (name: string) => `Desenvolvido por ${name}`,
    version: (version: string) => `Versão ${version}`,
    viewOnGithub: 'Ver no GitHub',
    license: 'Licença',
    language: 'Idioma',
    languageSystem: 'Sistema',
  },
};
