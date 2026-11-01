/**
 * Strings for the desktop-only UI, in the same locales as src/i18n. Kept
 * here rather than in the mobile dictionaries so the phone builds don't
 * carry text for screens they never show.
 */
import { useTranslation, type Locale } from "@/i18n";

const en = {
  audioInterface: "AUDIO INTERFACE",
  outputDevice: "Output device",
  systemDefault: "System default",
  outputs: (n: number) => `${n} output${n === 1 ? "" : "s"}`,
  notConnected: "not connected",
  bufferSize: "Buffer size",
  driverDefault: "Driver default",
  frames: (n: number) => `${n} frames`,
  openRouting: "Routing",
  openRoutingHint: "Send each track to any output of the interface",
  outputNames: "OUTPUT NAMES",
  outputNamesHint:
    "Name this interface's outputs the way the stage knows them (IEM drummer, FOH bass…). Saved per device.",
  unnamed: "Unnamed",
  noOutput: "No audio output is open",
  open: (name: string, channels: number, rate: number) =>
    `${name} · ${channels} outputs · ${rate} Hz`,
  switchWhilePlaying: "Switching the audio device stops playback. Continue?",
  routing: "Routing",
  close: "Close",
  track: "Track",
  click: "Click",
  mono: "Mono",
  stereo: "Stereo",
  allSongs: "All songs",
  thisSong: "This song only",
  reset: "Reset",
  defaultRoute: "default",
  loadSongFirst: "Open a song to route its tracks.",
  monitorNote:
    "Monitor mode is on: everything plays on outputs 1–2 until you switch back to split.",
  routingHelp:
    "Tap a cell to send a track to that output; a track can go to several outputs. In stereo, a tap picks the pair (1–2, 3–4…). Routes apply to every song with a track of the same name unless pinned to this song. Unrouted tracks follow the phone layout: cue on output 1, main on output 2.",
  missingOutputs: (name: string, n: number) =>
    `${name}: routed to an output this device doesn't have (it has ${n}); that part is silent.`,
  routedNowhere: (name: string) => `${name} is routed nowhere (silent).`,
  deviceProblem: (message: string) =>
    `Audio problem: ${message}. It reconnects on its own when the device is back, or pick one in Settings.`,
  engineUnresponsive:
    "The audio engine is not answering. Audio may have stopped.",
  orphanPlayback:
    "The engine is still playing a song this window isn't showing.",
  stop: "Stop",
  commandFailed: (message: string) => `Audio command failed: ${message}`,
  dismiss: "Dismiss",
  silentTracks: (names: string) =>
    `Silent on this device (routed to outputs it doesn't have): ${names}`,
  newInterface: (name: string, channels: number) =>
    `Audio interface connected: ${name} (${channels} outputs)`,
  useIt: "Use it",
  shortcutsHeading: "KEYBOARD SHORTCUTS",
  shortcutsHint: "Press ? anywhere in the app to show this list.",
  shortcutsTitle: "Keyboard shortcuts",
  or: "or",
  shortcutGroups: {
    transport: "Transport",
    markers: "Markers",
    song: "Song screen",
    help: "Help",
  },
  shortcuts: {
    playPause: "Play / pause",
    stop: "Stop and return to the start",
    toStart: "Go to the start (keeps playing)",
    barBack: "Back one bar (5 s without a tempo)",
    barForward: "Forward one bar (5 s without a tempo)",
    fourBarsBack: "Back four bars",
    fourBarsForward: "Forward four bars",
    previousMarker: "Previous marker",
    nextMarker: "Next marker",
    marker: "Jump to marker 1–9",
    previousSong: "Previous song (while not playing)",
    nextSong: "Next song (while not playing)",
    toggleMixer: "Show / hide the mixer",
    toggleLyrics: "Switch between tracks and lyrics",
    toggleClick: "Click on / off",
    help: "Show this list",
  },
};

type DesktopStrings = typeof en;

const ptBR: DesktopStrings = {
  audioInterface: "INTERFACE DE ÁUDIO",
  outputDevice: "Saída de áudio",
  systemDefault: "Padrão do sistema",
  outputs: (n) => `${n} saída${n === 1 ? "" : "s"}`,
  notConnected: "desconectada",
  bufferSize: "Tamanho do buffer",
  driverDefault: "Padrão do driver",
  frames: (n) => `${n} amostras`,
  openRouting: "Roteamento",
  openRoutingHint: "Envie cada faixa para qualquer saída da interface",
  outputNames: "NOMES DAS SAÍDAS",
  outputNamesHint:
    "Dê às saídas desta interface os nomes usados no palco (retorno baterista, PA baixo…). Salvo por dispositivo.",
  unnamed: "Sem nome",
  noOutput: "Nenhuma saída de áudio aberta",
  open: (name, channels, rate) => `${name} · ${channels} saídas · ${rate} Hz`,
  switchWhilePlaying: "Trocar a saída de áudio para a reprodução. Continuar?",
  routing: "Roteamento",
  close: "Fechar",
  track: "Faixa",
  click: "Clique",
  mono: "Mono",
  stereo: "Estéreo",
  allSongs: "Todas as músicas",
  thisSong: "Só nesta música",
  reset: "Restaurar",
  defaultRoute: "padrão",
  loadSongFirst: "Abra uma música para rotear as faixas.",
  monitorNote:
    "O modo monitor está ativo: tudo toca nas saídas 1–2 até você voltar para o modo dividido.",
  routingHelp:
    "Toque numa célula para enviar a faixa para aquela saída; uma faixa pode ir para várias saídas. Em estéreo, o toque escolhe o par (1–2, 3–4…). As rotas valem para todas as músicas com uma faixa de mesmo nome, a não ser que fixadas nesta música. Faixas sem rota seguem o layout do celular: retorno na saída 1, principal na saída 2.",
  missingOutputs: (name, n) =>
    `${name}: roteada para uma saída que este dispositivo não tem (ele tem ${n}); essa parte fica muda.`,
  routedNowhere: (name) =>
    `${name} não está roteada para nenhuma saída (muda).`,
  deviceProblem: (message) =>
    `Problema de áudio: ${message}. Reconecta sozinho quando o dispositivo voltar, ou escolha outro em Ajustes.`,
  engineUnresponsive:
    "O motor de áudio não está respondendo. O áudio pode ter parado.",
  orphanPlayback:
    "O motor ainda está tocando uma música que esta janela não mostra.",
  stop: "Parar",
  commandFailed: (message) => `Comando de áudio falhou: ${message}`,
  dismiss: "Fechar",
  silentTracks: (names) =>
    `Mudas neste dispositivo (roteadas para saídas que ele não tem): ${names}`,
  newInterface: (name, channels) =>
    `Interface de áudio conectada: ${name} (${channels} saídas)`,
  useIt: "Usar",
  shortcutsHeading: "ATALHOS DE TECLADO",
  shortcutsHint: "Pressione ? em qualquer tela para ver esta lista.",
  shortcutsTitle: "Atalhos de teclado",
  or: "ou",
  shortcutGroups: {
    transport: "Transporte",
    markers: "Marcadores",
    song: "Tela da música",
    help: "Ajuda",
  },
  shortcuts: {
    playPause: "Tocar / pausar",
    stop: "Parar e voltar ao início",
    toStart: "Ir para o início (continua tocando)",
    barBack: "Voltar um compasso (5 s sem tempo definido)",
    barForward: "Avançar um compasso (5 s sem tempo definido)",
    fourBarsBack: "Voltar quatro compassos",
    fourBarsForward: "Avançar quatro compassos",
    previousMarker: "Marcador anterior",
    nextMarker: "Próximo marcador",
    marker: "Ir para o marcador 1–9",
    previousSong: "Música anterior (fora da reprodução)",
    nextSong: "Próxima música (fora da reprodução)",
    toggleMixer: "Mostrar / ocultar o mixer",
    toggleLyrics: "Alternar entre faixas e letra",
    toggleClick: "Click liga / desliga",
    help: "Mostrar esta lista",
  },
};

const dictionaries: Record<Locale, DesktopStrings> = { en, "pt-BR": ptBR };

export function useDesktopStrings(): DesktopStrings {
  const { locale } = useTranslation();
  return dictionaries[locale];
}
