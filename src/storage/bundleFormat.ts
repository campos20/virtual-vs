import type { ProjectManifest } from '@/types/project';
import type { SetlistManifest } from '@/types/setlist';

/**
 * The `.vvs` bundle container: one file holding whole projects (manifests
 * *and* their audio) plus the folders that group them, so a set can be backed
 * up, moved to a new phone, or handed to another musician.
 *
 * Layout:
 *
 *   offset 0   4 bytes   magic "VVSB"
 *   offset 4   4 bytes   format version, uint32 little-endian
 *   offset 8   4 bytes   header length in bytes, uint32 little-endian
 *   offset 12  n bytes   header JSON (ASCII, see below)
 *   offset 12+n          every file's bytes, back to back, in header order
 *
 * Deliberately not a zip. Zipping would mean either a native archive
 * dependency or compressing hundreds of megabytes on the JS thread, and it
 * would buy almost nothing: mp3/m4a stems are already compressed and the WAVs
 * barely shrink. This format needs no dependency at all, and both ends of it
 * stream - a bundle is never held in memory. The cost is that a bundle is not
 * something a desktop unzip tool opens; the version field is here so a future
 * format can change that without orphaning the files people already have.
 *
 * The header is written as pure ASCII, with every non-ASCII character escaped
 * as `\uXXXX` (see `toAsciiJson`). That keeps `String.fromCharCode` an exact
 * round trip, so the format needs no UTF-8 encoder - neither a hand-rolled one
 * nor a `TextEncoder` this runtime may or may not have - while project titles
 * keep their accents and anything else they were typed with.
 */
export const BUNDLE_MAGIC = 'VVSB';
export const BUNDLE_VERSION = 1;
export const BUNDLE_EXTENSION = 'vvs';
/** magic (4) + version (4) + header length (4). */
export const BUNDLE_PREAMBLE_BYTES = 12;

export interface BundledFile {
  /** Filename as it appears in the project's manifest (`TrackManifest.file`). */
  name: string;
  size: number;
}

export interface BundledProject {
  manifest: ProjectManifest;
  files: BundledFile[];
}

export interface BundleHeader {
  format: 'virtual-vs-bundle';
  version: number;
  /** App version that wrote it - for diagnosing a bundle someone mails you. */
  app?: string;
  createdAt?: string;
  /** Folders carried by this bundle. Their `songs` reference the projects below. */
  folders: SetlistManifest[];
  projects: BundledProject[];
}

/** One file's absolute position in the bundle, resolved from the header's sizes. */
export interface BundleEntry {
  projectId: string;
  name: string;
  offset: number;
  size: number;
}

export class BundleFormatError extends Error {}

/**
 * JSON with every non-ASCII character escaped, so the result is byte-for-byte
 * ASCII. The range covers surrogate halves too, so a character outside the BMP
 * (an emoji in a project title) survives as an escaped pair that `JSON.parse`
 * puts back together.
 */
function toAsciiJson(value: unknown): string {
  return JSON.stringify(value).replace(
    /[\u007f-\uffff]/g,
    (char) => `\\u${char.charCodeAt(0).toString(16).padStart(4, '0')}`
  );
}

/** Serialises the preamble and header. The payload is appended separately, by streaming. */
export function encodeBundleHeader(header: BundleHeader): Uint8Array {
  const json = toAsciiJson(header);
  const bytes = new Uint8Array(BUNDLE_PREAMBLE_BYTES + json.length);
  const view = new DataView(bytes.buffer);

  for (let i = 0; i < BUNDLE_MAGIC.length; i++) view.setUint8(i, BUNDLE_MAGIC.charCodeAt(i));
  view.setUint32(4, header.version, true);
  view.setUint32(8, json.length, true);
  for (let i = 0; i < json.length; i++) view.setUint8(BUNDLE_PREAMBLE_BYTES + i, json.charCodeAt(i));

  return bytes;
}

/**
 * Reads the preamble to find out how long the header is. Callers read this
 * much first, then come back for the header itself - a bundle is far too
 * large to read whole just to see what is in it.
 */
export function decodeBundlePreamble(bytes: Uint8Array): { version: number; headerLength: number } {
  if (bytes.length < BUNDLE_PREAMBLE_BYTES) {
    throw new BundleFormatError('Not a Virtual VS bundle: the file is too short.');
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  let magic = '';
  for (let i = 0; i < BUNDLE_MAGIC.length; i++) magic += String.fromCharCode(view.getUint8(i));
  if (magic !== BUNDLE_MAGIC) {
    throw new BundleFormatError('Not a Virtual VS bundle.');
  }

  const version = view.getUint32(4, true);
  if (version > BUNDLE_VERSION) {
    throw new BundleFormatError(
      `This bundle was made by a newer version of the app (format ${version}). Update to open it.`
    );
  }

  return { version, headerLength: view.getUint32(8, true) };
}

/** Parses the header JSON that follows the preamble. */
export function decodeBundleHeader(bytes: Uint8Array): BundleHeader {
  let json = '';
  for (let i = 0; i < bytes.length; i++) json += String.fromCharCode(bytes[i]);

  let header: BundleHeader;
  try {
    header = JSON.parse(json) as BundleHeader;
  } catch {
    throw new BundleFormatError("This bundle's index is damaged and can't be read.");
  }

  if (header?.format !== 'virtual-vs-bundle' || !Array.isArray(header.projects)) {
    throw new BundleFormatError('Not a Virtual VS bundle.');
  }
  // Written by every version, but a hand-edited or truncated bundle can lose
  // it - and the import walks it, so it has to be an array before we start.
  if (!Array.isArray(header.folders)) header.folders = [];

  return header;
}

/**
 * Where each file sits in the payload, derived by accumulating the sizes in
 * the header. Offsets are deliberately not stored: two sources of truth for
 * the same number is how a bundle ends up self-inconsistent.
 */
export function bundleEntries(header: BundleHeader, payloadOffset: number): BundleEntry[] {
  const entries: BundleEntry[] = [];
  let offset = payloadOffset;

  for (const project of header.projects) {
    for (const file of project.files) {
      entries.push({ projectId: project.manifest.id, name: file.name, offset, size: file.size });
      offset += file.size;
    }
  }

  return entries;
}

/** Total bytes a bundle with this header occupies, header included. */
export function bundleSize(header: BundleHeader): number {
  const payload = header.projects.reduce(
    (total, project) => total + project.files.reduce((sum, file) => sum + file.size, 0),
    0
  );
  return encodeBundleHeader(header).length + payload;
}
