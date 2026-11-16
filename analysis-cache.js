// Bump when the decoder/analysis algorithm or cached representation changes.
// Hash the actual File bytes: names, paths, timestamps and album order are not
// reliable identities (in-place edits may preserve all of them).
export const ANALYSIS_VERSION = 'audio-v1';
const fingerprints = new WeakMap();
async function digest(bytes) {
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(v => v.toString(16).padStart(2, '0')).join('');
}
export async function analysisKey(file, profile) {
  let fingerprint = fingerprints.get(file);
  if (!fingerprint) { fingerprint = file.arrayBuffer().then(digest); fingerprints.set(file, fingerprint); }
  return digest(new TextEncoder().encode(`${ANALYSIS_VERSION}:${profile}:${await fingerprint}`));
}
export function validWaveform(value) {
  return value && Number.isFinite(value.duration) && value.duration > 0 && value.duration < 1e8
    && [value.peakDb, value.lufs].every(v => v === null || (Number.isFinite(v) && Math.abs(v) < 10000))
    && Array.isArray(value.waveform) && value.waveform.length >= 1 && value.waveform.length <= 4096
    && value.waveform.every(p => Array.isArray(p) && p.length === 2 && p.every(v => Number.isFinite(v) && Math.abs(v) < 1e10) && p[0] <= p[1]);
}
export function packSpectrum(part) {
  const bytes = new Uint8Array(part.values.buffer, part.values.byteOffset, part.values.byteLength);
  let binary = ''; for (let start = 0; start < bytes.length; start += 8192) binary += String.fromCharCode(...bytes.subarray(start, start + 8192));
  return { columns: part.columns, rows: part.rows, peakDb: part.peakDb, data: btoa(binary) };
}
export function unpackSpectrum(value, columns, rows) {
  if (!value || value.columns !== columns || value.rows !== rows || !Number.isFinite(value.peakDb) || typeof value.data !== 'string' || value.data.length !== Math.ceil(columns * rows * 4 / 3) * 4) return null;
  try {
    const bytes = Uint8Array.from(atob(value.data), c => c.charCodeAt(0));
    if (bytes.byteLength !== columns * rows * 4) return null;
    const values = new Float32Array(bytes.buffer);
    if (!values.every(v => Number.isFinite(v) && Math.abs(v) < 10000)) return null;
    return { columns, rows, peakDb: value.peakDb, values };
  } catch { return null; }
}
// Recompose the current sequence from independent track spectra. Reordering,
// insertion and removal never change which source a cached spectrum belongs to.
export function fitSpectrum(part, columns) {
  const values = new Float32Array(columns * part.rows); values.fill(-160);
  for (let x = 0; x < columns; x++) {
    const first = Math.min(part.columns - 1, Math.floor(x * part.columns / columns));
    const end = Math.min(part.columns, Math.max(first + 1, Math.ceil((x + 1) * part.columns / columns)));
    for (let row = 0; row < part.rows; row++) for (let source = first; source < end; source++) values[x * part.rows + row] = Math.max(values[x * part.rows + row], part.values[source * part.rows + row]);
  }
  return values;
}
