import { encodeStereoWav } from './wav';

function ascii(bytes: Uint8Array, offset: number, length: number): string {
  return Array.from(bytes.slice(offset, offset + length))
    .map((b) => String.fromCharCode(b))
    .join('');
}

function view(bytes: Uint8Array): DataView {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

describe('encodeStereoWav', () => {
  it('writes a 16-bit stereo PCM header the decoder can read back', () => {
    const frames = 8;
    const bytes = encodeStereoWav(new Float32Array(frames), new Float32Array(frames), 44100);
    const v = view(bytes);

    expect(ascii(bytes, 0, 4)).toBe('RIFF');
    expect(ascii(bytes, 8, 4)).toBe('WAVE');
    expect(ascii(bytes, 12, 4)).toBe('fmt ');
    expect(v.getUint16(20, true)).toBe(1); // PCM
    expect(v.getUint16(22, true)).toBe(2); // stereo
    expect(v.getUint32(24, true)).toBe(44100);
    expect(v.getUint32(28, true)).toBe(44100 * 2 * 2); // byte rate
    expect(v.getUint16(32, true)).toBe(4); // block align
    expect(v.getUint16(34, true)).toBe(16); // bit depth
    expect(ascii(bytes, 36, 4)).toBe('data');
    expect(v.getUint32(40, true)).toBe(frames * 4);
    expect(bytes.length).toBe(44 + frames * 4);
  });

  it('interleaves left and right samples', () => {
    const bytes = encodeStereoWav(
      new Float32Array([1, 0]),
      new Float32Array([-1, 0]),
      44100
    );
    const v = view(bytes);

    expect(v.getInt16(44, true)).toBe(32767); // L full scale
    expect(v.getInt16(46, true)).toBe(-32767); // R full scale
  });

  it('clamps out-of-range samples instead of wrapping around', () => {
    const bytes = encodeStereoWav(new Float32Array([4]), new Float32Array([-4]), 44100);
    const v = view(bytes);

    expect(v.getInt16(44, true)).toBe(32767);
    expect(v.getInt16(46, true)).toBe(-32767);
  });

  it('encodes only as many frames as both channels have', () => {
    const bytes = encodeStereoWav(new Float32Array(10), new Float32Array(4), 44100);

    expect(view(bytes).getUint32(40, true)).toBe(4 * 4);
  });
});
