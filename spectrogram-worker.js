// One file is processed per worker request. The app releases each decoded
// recording before moving on, rather than retaining an entire album in RAM.
import { analyseSpectrumTrack } from './spectrogram-analysis.js';
self.onmessage = (event) => {
  try {
    const result = analyseSpectrumTrack(event.data);
    self.postMessage(result, [result.values.buffer]);
  } catch (error) {
    self.postMessage({ error: error instanceof Error ? error.message : String(error) });
  }
};
