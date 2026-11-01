/**
 * Desktop replacement for `expo-sharing`. A computer has no share sheet; the
 * equivalent is "Save as…": the user picks where the file (a `.vvs` bundle)
 * goes - a USB stick, a synced Drive/Dropbox folder, the desktop.
 */
import { File } from "./expo-file-system";
import { tauri, uriToPath } from "../tauri";

export async function isAvailableAsync(): Promise<boolean> {
  return true;
}

export async function shareAsync(
  url: string,
  options: { dialogTitle?: string; mimeType?: string; UTI?: string } = {},
): Promise<void> {
  const source = new File(uriToPath(url));
  const extension = source.extension.slice(1);
  const destination = await tauri().dialog.save({
    title: options.dialogTitle,
    defaultPath: source.name,
    filters: extension
      ? [{ name: extension.toUpperCase(), extensions: [extension] }]
      : undefined,
  });
  if (!destination) return;
  const target = new File(destination);
  if (target.exists) target.delete();
  source.copy(target);
}
