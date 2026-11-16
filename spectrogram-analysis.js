// Pure spectrum calculation: keeping this separate lets regression tests feed
// synthetic stereo samples without starting a browser or opening real audio.
export function analyseSpectrumTrack({ sampleRate, channelData, columns, rows = 180 }) {
  const fftSize = 1024;
  const values = new Float32Array(columns * rows); values.fill(-160);
  let peakDb = -160;
  if (!columns || !channelData.length) return { values, columns, rows, peakDb };
  const sampleCount = channelData[0].length; const nyquist = sampleRate / 2;
  const real = new Float32Array(fftSize); const imaginary = new Float32Array(fftSize); const powers = new Float64Array(fftSize / 2);
  for (let column = 0; column < columns; column += 1) {
    const centre = Math.floor((column / Math.max(1, columns - 1)) * Math.max(0, sampleCount - 1)); const start = centre - fftSize / 2;
    powers.fill(0);
    for (const source of channelData) {
      for (let index = 0; index < fftSize; index += 1) {
        const sourceIndex = start + index; const sample = sourceIndex >= 0 && sourceIndex < source.length ? source[sourceIndex] : 0;
        real[index] = sample * (.5 * (1 - Math.cos((2 * Math.PI * index) / (fftSize - 1)))); imaginary[index] = 0;
      }
      fftSpectrum(real, imaginary);
      // Combine channel energy, not sample amplitudes. Opposite-polarity stereo
      // must remain visible instead of cancelling out in a mono sum.
      for (let bin = 0; bin < powers.length; bin += 1) powers[bin] += (real[bin] ** 2 + imaginary[bin] ** 2) / channelData.length;
    }
    for (let row = 0; row < rows; row += 1) {
      const frequency = nyquist * Math.pow(Math.min(20, nyquist) / nyquist, row / Math.max(1, rows - 1));
      const exactBin = (frequency / nyquist) * (powers.length - 1); const lower = Math.floor(exactBin); const mix = exactBin - lower;
      const magnitude = Math.sqrt(powers[lower] * (1 - mix) + powers[Math.min(lower + 1, powers.length - 1)] * mix);
      const decibels = 20 * Math.log10(magnitude / fftSize + 1e-8);
      values[column * rows + row] = decibels; peakDb = Math.max(peakDb, decibels);
    }
  }
  return { values, columns, rows, peakDb };
}

// This is the standard in-place FFT step used by the Music Analyser-derived spectrum view.
function fftSpectrum(real, imaginary) {
  for (let index = 1, reversed = 0; index < real.length; index += 1) { let bit = real.length >> 1; while (reversed & bit) { reversed ^= bit; bit >>= 1; } reversed ^= bit; if (index < reversed) { [real[index], real[reversed]] = [real[reversed], real[index]]; [imaginary[index], imaginary[reversed]] = [imaginary[reversed], imaginary[index]]; } }
  for (let size = 2; size <= real.length; size *= 2) { const angle = (-2 * Math.PI) / size; const cosineStep = Math.cos(angle); const sineStep = Math.sin(angle); for (let offset = 0; offset < real.length; offset += size) { let cosine = 1; let sine = 0; for (let index = 0; index < size / 2; index += 1) { const even = offset + index; const odd = even + size / 2; const oddReal = real[odd] * cosine - imaginary[odd] * sine; const oddImaginary = real[odd] * sine + imaginary[odd] * cosine; real[odd] = real[even] - oddReal; imaginary[odd] = imaginary[even] - oddImaginary; real[even] += oddReal; imaginary[even] += oddImaginary; const nextCosine = cosine * cosineStep - sine * sineStep; sine = sine * cosineStep + cosine * sineStep; cosine = nextCosine; } } }
}
