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
  },
  library: {
    title: 'Biblioteca',
    newProject: '+ Novo',
    emptyTitle: 'Nenhum projeto ainda',
    emptyMeta: 'Toque em "+ Novo" para importar faixas e criar um.',
    stemsCount: (count: number) => `${count} ${count === 1 ? 'faixa' : 'faixas'}`,
  },
  project: {
    backToLibrary: '‹ Biblioteca',
    edit: 'Editar',
    bundledNotice: 'O projeto de demonstração não pode ser editado.',
    notFound: 'Projeto não encontrado.',
    loadFailed: 'Falha ao carregar o projeto.',
    deleteConfirmTitle: 'Excluir projeto?',
    deleteConfirmBody: (title: string, stemCount: number) =>
      `"${title}" e ${stemCount} ${stemCount === 1 ? 'faixa' : 'faixas'} serão excluídos permanentemente deste aparelho.`,
    deleteConfirmConfirm: 'Excluir',
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
  monitorSplit: {
    heading: 'SAÍDA',
    split: 'Split',
    sum: 'Soma',
  },
  click: {
    heading: 'CLICK',
  },
};
