import { File } from 'expo-file-system';
import { isAvailableAsync, shareAsync } from 'expo-sharing';

/**
 * The app's one entry point to the OS share sheet.
 *
 * Handing a bundle to the share sheet is what makes "back this up to Google
 * Drive" work without the app ever knowing about Google: Drive, OneDrive,
 * Dropbox, AirDrop, email and a USB cable are all just targets in the same
 * sheet, and the account, the folder and the upload are the user's own app's
 * business. Coming back the other way needs nothing at all - a bundle someone
 * shares from their Drive arrives through the ordinary file picker.
 *
 * Wrapped here rather than imported directly at the call sites so the
 * dependency has a single seam - see AGENTS.md on runtime dependencies.
 */
export async function shareBundle(file: File, dialogTitle: string): Promise<void> {
  if (!(await isAvailableAsync())) {
    throw new Error('Sharing is not available on this device.');
  }

  await shareAsync(file.uri, {
    dialogTitle,
    // A bundle has no registered type of its own. Declaring it as generic
    // binary keeps every target in the sheet - a stricter type would hide the
    // cloud apps this exists to reach.
    mimeType: 'application/octet-stream',
    UTI: 'public.data',
  });
}
