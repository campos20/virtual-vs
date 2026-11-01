/**
 * Desktop replacement for `expo-document-picker`: the native open dialog,
 * returning assets shaped like the mobile picker's. The files are used in
 * place (no copy to a cache directory) - the storage code copies stems into
 * the project itself, and reading a bundle doesn't need a private copy.
 */
import { File } from "./expo-file-system";
import { pathToUri, tauri } from "../tauri";

export interface DocumentPickerAsset {
  uri: string;
  name: string;
  size?: number;
  mimeType?: string;
  lastModified?: number;
}

export type DocumentPickerResult =
  | { canceled: false; assets: DocumentPickerAsset[] }
  | { canceled: true; assets: null };

export interface DocumentPickerOptions {
  type?: string | string[];
  multiple?: boolean;
  copyToCacheDirectory?: boolean;
}

/** What the decoder (symphonia) reads; offered when the app asks for audio. */
const AUDIO_EXTENSIONS = [
  "wav",
  "wave",
  "aif",
  "aiff",
  "aifc",
  "flac",
  "mp3",
  "m4a",
  "mp4",
  "aac",
  "ogg",
  "oga",
  "caf",
];

const MIME_BY_EXTENSION: Record<string, string> = {
  wav: "audio/wav",
  wave: "audio/wav",
  aif: "audio/aiff",
  aiff: "audio/aiff",
  flac: "audio/flac",
  mp3: "audio/mpeg",
  m4a: "audio/mp4",
  mp4: "audio/mp4",
  aac: "audio/aac",
  ogg: "audio/ogg",
  oga: "audio/ogg",
  caf: "audio/x-caf",
};

function wantsAudio(type: string | string[] | undefined): boolean {
  const types = Array.isArray(type) ? type : type ? [type] : [];
  return types.some((t) => t.startsWith("audio/"));
}

export async function getDocumentAsync(
  options: DocumentPickerOptions = {},
): Promise<DocumentPickerResult> {
  const selection = await tauri().dialog.open({
    multiple: !!options.multiple,
    directory: false,
    filters: wantsAudio(options.type)
      ? [{ name: "Audio", extensions: AUDIO_EXTENSIONS }]
      : undefined,
  });
  if (selection === null) return { canceled: true, assets: null };

  const paths = Array.isArray(selection) ? selection : [selection];
  if (paths.length === 0) return { canceled: true, assets: null };

  const assets = paths.map((path): DocumentPickerAsset => {
    const file = new File(path);
    const extension = file.extension.slice(1).toLowerCase();
    return {
      uri: pathToUri(path),
      name: file.name,
      size: file.size ?? undefined,
      mimeType: MIME_BY_EXTENSION[extension] ?? "application/octet-stream",
      lastModified: file.modificationTime ?? undefined,
    };
  });
  return { canceled: false, assets };
}
