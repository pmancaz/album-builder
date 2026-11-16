// Synthetic samples verify signal handling, without private recordings or an audio device.
import test from 'node:test';
import assert from 'node:assert/strict';
import { analyseSpectrumTrack } from '../spectrogram-analysis.js';
const sampleRate = 48000;
const tone = Float32Array.from({ length: 4800 }, (_, i) => .5 * Math.sin(2 * Math.PI * 1000 * i / sampleRate));
const silence = new Float32Array(tone.length);
const spectrum = (channelData) => analyseSpectrumTrack({ sampleRate, channelData, columns: 12, rows: 40 });
test('right-only stereo remains visible', () => {
  const quiet = spectrum([silence, silence]); const right = spectrum([silence, tone]);
  assert.ok(right.peakDb > quiet.peakDb + 60);
  assert.ok([...right.values].every(Number.isFinite));
});
test('opposite-polarity stereo does not cancel its spectrum', () => {
  const same = spectrum([tone, tone]); const opposite = spectrum([tone, tone.map((value) => -value)]);
  assert.ok(Math.abs(same.peakDb - opposite.peakDb) < 1e-6);
});
test('empty column allocation is safe for very short tracks in a long album', () => {
  const result = analyseSpectrumTrack({ sampleRate, channelData: [tone], columns: 0, rows: 40 });
  assert.equal(result.values.length, 0); assert.equal(result.peakDb, -160);
});
