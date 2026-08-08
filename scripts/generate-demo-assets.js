// Regenerates the bundled demo project's test-tone WAV stems (assets/demo/).
// Not part of the app build - run with `node scripts/generate-demo-assets.js`
// only if you want to change the demo tones/tempo/duration.
const fs = require('fs');
const path = require('path');

const SAMPLE_RATE = 44100;
const BPM = 120;
const BARS = 8;
const BEATS_PER_BAR = 4;
const SECONDS_PER_BEAT = 60 / BPM;
const DURATION_SEC = BARS * BEATS_PER_BAR * SECONDS_PER_BEAT; // 16s at 120bpm

const OUT = path.join(__dirname, '..', 'assets', 'demo');

function writeWav(filePath, samples) {
  const numSamples = samples.length;
  const blockAlign = 2; // mono, 16-bit
  const byteRate = SAMPLE_RATE * blockAlign;
  const dataSize = numSamples * blockAlign;
  const buffer = Buffer.alloc(44 + dataSize);

  buffer.write('RIFF', 0, 'ascii');
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write('WAVE', 8, 'ascii');
  buffer.write('fmt ', 12, 'ascii');
  buffer.writeUInt32LE(16, 16); // PCM fmt chunk size
  buffer.writeUInt16LE(1, 20); // PCM format
  buffer.writeUInt16LE(1, 22); // mono
  buffer.writeUInt32LE(SAMPLE_RATE, 24);
  buffer.writeUInt32LE(byteRate, 28);
  buffer.writeUInt16LE(blockAlign, 32);
  buffer.writeUInt16LE(16, 34); // bits per sample
  buffer.write('data', 36, 'ascii');
  buffer.writeUInt32LE(dataSize, 40);

  for (let i = 0; i < numSamples; i++) {
    const clamped = Math.max(-1, Math.min(1, samples[i]));
    buffer.writeInt16LE(Math.round(clamped * 32767), 44 + i * 2);
  }

  fs.writeFileSync(filePath, buffer);
  console.log(
    `wrote ${filePath} (${(buffer.length / 1024).toFixed(1)} KB, ${(numSamples / SAMPLE_RATE).toFixed(2)}s)`
  );
}

function fadeGain(t, duration, fadeSec) {
  const fadeIn = Math.min(1, t / fadeSec);
  const fadeOut = Math.min(1, (duration - t) / fadeSec);
  return Math.max(0, Math.min(fadeIn, fadeOut));
}

// Soft pulse synced to the beat grid so all stems visibly/audibly breathe together,
// making sample-lock drift between stems obvious if it ever occurs.
function beatPulse(t) {
  const beatPhase = (t / SECONDS_PER_BEAT) % 1;
  const pulse = 0.55 + 0.45 * Math.pow(Math.sin(Math.PI * beatPhase), 2);
  return pulse;
}

function generateTone(freqHz, opts = {}) {
  const { harmonic2 = 0, amplitude = 0.5 } = opts;
  const numSamples = Math.round(DURATION_SEC * SAMPLE_RATE);
  const samples = new Float32Array(numSamples);
  for (let i = 0; i < numSamples; i++) {
    const t = i / SAMPLE_RATE;
    let s = Math.sin(2 * Math.PI * freqHz * t);
    if (harmonic2 > 0) {
      s += harmonic2 * Math.sin(2 * Math.PI * freqHz * 2 * t);
    }
    s *= amplitude * beatPulse(t) * fadeGain(t, DURATION_SEC, 0.02);
    samples[i] = s;
  }
  return samples;
}

fs.mkdirSync(OUT, { recursive: true });

// A2 - low sine, stands in for a bass stem.
writeWav(path.join(OUT, 'bass.wav'), generateTone(110, { amplitude: 0.6 }));
// E4 - mid sine with a touch of 2nd harmonic, stands in for a keys stem.
writeWav(path.join(OUT, 'keys.wav'), generateTone(329.63, { harmonic2: 0.25, amplitude: 0.45 }));
// A4 - higher sine, stands in for a guide-vocal reference sent to the performer's cue mix only.
writeWav(path.join(OUT, 'guide.wav'), generateTone(440, { amplitude: 0.5 }));

console.log('Demo stems generated:', OUT);
console.log('bpm', BPM, 'duration', DURATION_SEC, 'sec');
