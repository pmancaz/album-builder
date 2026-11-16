/*
  ALBUM BUILDER — OFFLINE LOUDNESS MEASUREMENTS

  This is the vetted Music Analyser implementation, kept as a small separate
  file so its standards-based maths remains independent from interface code.
  It follows ITU-R BS.1770-5 / EBU R 128 integrated loudness:
  K-weighting, overlapping 400 ms blocks, then absolute and relative gates.
*/
(function attachLoudnessTools(root, createTools) {
  const tools = createTools();
  if (typeof module === "object" && module.exports) module.exports = tools;
  else root.AlbumBuilderLoudness = tools;
}(typeof globalThis !== "undefined" ? globalThis : this, function createLoudnessTools() {
  const LOUDNESS_OFFSET = -0.691;
  const ABSOLUTE_GATE_LUFS = -70;
  const RELATIVE_GATE_LU = -10;
  const BLOCK_SECONDS = 0.4;
  const BLOCK_STEP_SECONDS = 0.1;
  const REFERENCE_SAMPLE_RATE = 48000;

  // Official 48 kHz K-weighting coefficients from BS.1770-5.
  const K_WEIGHTING_48K = [
    { b0: 1.53512485958697, b1: -2.69169618940638, b2: 1.19839281085285, a1: -1.69065929318241, a2: 0.73248077421585 },
    { b0: 1, b1: -2, b2: 1, a1: -1.99004745483398, a2: 0.99007225036621 },
  ];

  function analyseLoudness(audioBuffer) {
    const sampleRate = Number(audioBuffer.sampleRate);
    const channelCount = Number(audioBuffer.numberOfChannels);
    const sampleCount = Number(audioBuffer.length || audioBuffer.getChannelData(0).length);
    if (!(sampleRate > 0) || !(channelCount > 0) || !(sampleCount > 0)) return { peakDb: -Infinity, rmsDb: -Infinity, lufs: -Infinity };

    // Complete 400 ms blocks arrive every 100 ms; an unfinished ending is ignored.
    const blockLength = Math.max(1, Math.round(sampleRate * BLOCK_SECONDS));
    const blockStep = Math.max(1, Math.round(sampleRate * BLOCK_STEP_SECONDS));
    const blockCount = sampleCount < blockLength ? 0 : 1 + Math.floor((sampleCount - blockLength) / blockStep);
    const blockPowers = new Float64Array(blockCount);
    const [shelf, highPass] = K_WEIGHTING_48K.map((filter) => remapBiquad(filter, sampleRate));
    let peak = 0; let rmsSum = 0; let rmsCount = 0;

    for (let channel = 0; channel < channelCount; channel += 1) {
      const samples = audioBuffer.getChannelData(channel);
      const loudnessWeight = channelWeight(channel, channelCount);
      const recentPowers = blockCount ? new Float64Array(blockLength) : null;
      let recentPowerSum = 0; let recentPowerPosition = 0; let nextBlock = 0;
      // Direct Form II Transposed needs just two state values per filter stage.
      let shelfState1 = 0; let shelfState2 = 0; let highPassState1 = 0; let highPassState2 = 0;

      for (let index = 0; index < sampleCount; index += 1) {
        const sample = samples[index]; const absolute = Math.abs(sample); const rawPower = sample * sample;
        if (absolute > peak) peak = absolute;
        rmsSum += rawPower; rmsCount += 1;
        // LFE contributes to peak/RMS but deliberately has zero integrated-loudness weight.
        if (!blockCount || loudnessWeight === 0) continue;
        const shelfOutput = shelf.b0 * sample + shelfState1;
        shelfState1 = shelf.b1 * sample - shelf.a1 * shelfOutput + shelfState2;
        shelfState2 = shelf.b2 * sample - shelf.a2 * shelfOutput;
        const filtered = highPass.b0 * shelfOutput + highPassState1;
        highPassState1 = highPass.b1 * shelfOutput - highPass.a1 * filtered + highPassState2;
        highPassState2 = highPass.b2 * shelfOutput - highPass.a2 * filtered;
        const filteredPower = filtered * filtered;
        recentPowerSum += filteredPower - recentPowers[recentPowerPosition];
        recentPowers[recentPowerPosition] = filteredPower;
        recentPowerPosition = (recentPowerPosition + 1) % blockLength;
        const samplesSeen = index + 1;
        if (samplesSeen >= blockLength && (samplesSeen - blockLength) % blockStep === 0) {
          blockPowers[nextBlock] += loudnessWeight * (recentPowerSum / blockLength);
          nextBlock += 1;
        }
      }
    }
    const rms = Math.sqrt(rmsSum / Math.max(1, rmsCount));
    return { peakDb: amplitudeToDb(peak), rmsDb: amplitudeToDb(rms), lufs: integratedLoudnessFromBlocks(blockPowers) };
  }

  function integratedLoudnessFromBlocks(blockPowers) {
    if (!blockPowers.length) return -Infinity;
    // First gate removes silence and blocks below -70 LUFS.
    const absolutePowers = [];
    for (const power of blockPowers) if (powerToLufs(power) > ABSOLUTE_GATE_LUFS) absolutePowers.push(power);
    if (!absolutePowers.length) return -Infinity;
    // Second gate removes material more than 10 LU below the first result.
    const relativeThreshold = powerToLufs(mean(absolutePowers)) + RELATIVE_GATE_LU;
    const finalPowers = absolutePowers.filter((power) => powerToLufs(power) > relativeThreshold);
    return finalPowers.length ? powerToLufs(mean(finalPowers)) : -Infinity;
  }

  function channelWeight(channelIndex, channelCount) {
    if (channelCount <= 3) return 1;
    if (channelCount === 6) { if (channelIndex === 3) return 0; return channelIndex >= 4 ? 1.41 : 1; }
    if (channelCount === 4) return channelIndex >= 2 ? 1.41 : 1;
    if (channelCount === 5) return channelIndex >= 3 ? 1.41 : 1;
    return 1;
  }

  function remapBiquad(coefficients, sampleRate) {
    if (sampleRate === REFERENCE_SAMPLE_RATE) return { ...coefficients };
    // Convert the 48 kHz digital filter to a continuous form, then map it to the decoded sample rate.
    const referenceScale = 2 * REFERENCE_SAMPLE_RATE; const targetScale = 2 * sampleRate;
    const { b0, b1, b2, a1, a2 } = coefficients;
    const numerator0 = b0 + b1 + b2; const numerator1 = (2 * b0 - 2 * b2) / referenceScale; const numerator2 = (b0 - b1 + b2) / (referenceScale * referenceScale);
    const denominator0 = 1 + a1 + a2; const denominator1 = (2 - 2 * a2) / referenceScale; const denominator2 = (1 - a1 + a2) / (referenceScale * referenceScale);
    const targetSquared = targetScale * targetScale;
    const targetB0 = numerator0 + numerator1 * targetScale + numerator2 * targetSquared; const targetB1 = 2 * numerator0 - 2 * numerator2 * targetSquared; const targetB2 = numerator0 - numerator1 * targetScale + numerator2 * targetSquared;
    const targetA0 = denominator0 + denominator1 * targetScale + denominator2 * targetSquared; const targetA1 = 2 * denominator0 - 2 * denominator2 * targetSquared; const targetA2 = denominator0 - denominator1 * targetScale + denominator2 * targetSquared;
    return { b0: targetB0 / targetA0, b1: targetB1 / targetA0, b2: targetB2 / targetA0, a1: targetA1 / targetA0, a2: targetA2 / targetA0 };
  }

  function mean(values) { let total = 0; for (const value of values) total += value; return total / values.length; }
  function powerToLufs(power) { return power > 0 ? LOUDNESS_OFFSET + 10 * Math.log10(power) : -Infinity; }
  function amplitudeToDb(amplitude) { return amplitude > 0 ? 20 * Math.log10(amplitude) : -Infinity; }

  return { analyseLoudness, amplitudeToDb, integratedLoudnessFromBlocks, remapBiquad };
}));
