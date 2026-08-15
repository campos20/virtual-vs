import { File, FileMode } from 'expo-file-system';

const RIFF_HEADER_BYTES = 4096;
const BYTES_PER_SAMPLE = 2; // 16-bit PCM
const STEREO = 2;

function readAscii(view: DataView, offset: number, length: number): string {
  let out = '';
  for (let i = 0; i < length; i++) out += String.fromCharCode(view.getUint8(offset + i));
  return out;
}

/**
 * Reads a WAV's channel count from its header without loading the audio.
 *
 * Only the first few KB are read, so this stays cheap even for the
 * hundred-megabyte multitrack exports people actually drop in. Returns null
 * for anything that isn't a RIFF/WAVE file (mp3, m4a, ...), which the caller
 * treats as "leave it alone".
 */
export function readWavChannelCount(file: File): number | null {
  let handle;
  try {
    handle = file.open(FileMode.ReadOnly);
    const bytes = handle.readBytes(RIFF_HEADER_BYTES);
    if (bytes.length < 16) return null;

    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    if (readAscii(view, 0, 4) !== 'RIFF' || readAscii(view, 8, 4) !== 'WAVE') return null;

    // Walk the chunk list rather than assuming `fmt ` sits at a fixed offset -
    // real-world files carry JUNK/LIST chunks ahead of it.
    let offset = 12;
    while (offset + 8 <= view.byteLength) {
      const chunkId = readAscii(view, offset, 4);
      const chunkSize = view.getUint32(offset + 4, true);
      if (chunkId === 'fmt ') {
        return offset + 10 + 2 <= view.byteLength ? view.getUint16(offset + 10, true) : null;
      }
      offset += 8 + chunkSize + (chunkSize % 2);
    }
    return null;
  } catch {
    return null;
  } finally {
    handle?.close();
  }
}

/** Encodes stereo float channels as a 16-bit PCM WAV file. */
export function encodeStereoWav(
  left: Float32Array,
  right: Float32Array,
  sampleRate: number
): Uint8Array {
  const frames = Math.min(left.length, right.length);
  const dataBytes = frames * STEREO * BYTES_PER_SAMPLE;
  const bytes = new Uint8Array(44 + dataBytes);
  const view = new DataView(bytes.buffer);

  const writeAscii = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i));
  };

  writeAscii(0, 'RIFF');
  view.setUint32(4, 36 + dataBytes, true);
  writeAscii(8, 'WAVE');
  writeAscii(12, 'fmt ');
  view.setUint32(16, 16, true); // PCM fmt chunk size
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, STEREO, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * STEREO * BYTES_PER_SAMPLE, true); // byte rate
  view.setUint16(32, STEREO * BYTES_PER_SAMPLE, true); // block align
  view.setUint16(34, 8 * BYTES_PER_SAMPLE, true);
  writeAscii(36, 'data');
  view.setUint32(40, dataBytes, true);

  let offset = 44;
  for (let i = 0; i < frames; i++) {
    view.setInt16(offset, toPcm16(left[i]), true);
    view.setInt16(offset + 2, toPcm16(right[i]), true);
    offset += 4;
  }

  return bytes;
}

function toPcm16(sample: number): number {
  const clamped = Math.max(-1, Math.min(1, sample));
  return Math.round(clamped * 32767);
}
