// ALBUM BUILDER — BACKGROUND AUDIO ANALYSIS
// This worker keeps long LUFS calculations away from the interface, so playback and controls remain responsive.
import './loudness.js';

self.onmessage = (event) => {
  try {
    const { sampleRate, channelData } = event.data;
    // The small object below gives the vetted analyser the same methods it expects from a browser AudioBuffer.
    const buffer = { sampleRate, numberOfChannels: channelData.length, length: channelData[0]?.length || 0, getChannelData: (channel) => channelData[channel] };
    const waveform = buildWaveformEnvelope(buffer);
    const loudness = self.AlbumBuilderLoudness.analyseLoudness(buffer);
    self.postMessage({ waveform, peakDb: loudness.peakDb, lufs: loudness.lufs });
  } catch (error) {
    self.postMessage({ error: error instanceof Error ? error.message : String(error) });
  }
};

function buildWaveformEnvelope(buffer) {
  const duration = buffer.length / Math.max(1, buffer.sampleRate);
  const slices = Math.min(4096, Math.max(512, Math.ceil(duration * 24)));
  const blockSize = Math.max(1, Math.ceil(buffer.length / slices)); const waveform = [];
  // Sampling up to 256 positions inside each narrow slice preserves the musical shape without doing a second full-file scan.
  const sampleStep = Math.max(1, Math.floor(blockSize / 256));
  for (let slice = 0; slice < slices; slice += 1) {
    const start = slice * blockSize; const end = Math.min(buffer.length, start + blockSize); let minimum = 0; let maximum = 0;
    for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
      const samples = buffer.getChannelData(channel);
      for (let index = start; index < end; index += sampleStep) { minimum = Math.min(minimum, samples[index]); maximum = Math.max(maximum, samples[index]); }
      // Always include the last sample in a slice because the step may not land on it exactly.
      if (end > start) { minimum = Math.min(minimum, samples[end - 1]); maximum = Math.max(maximum, samples[end - 1]); }
    }
    waveform.push([minimum, maximum]);
  }
  return waveform;
}
