/** The words come in at the caret (or over the selection), with a space on each side where the neighbouring text needs one. Cut to `max` characters. */
export function insertAtCaret(value: string, start: number, end: number, words: string, max: number): { value: string; caret: number } {
  const before = value.slice(0, start);
  const after = value.slice(end);
  const lead = before && !/\s$/.test(before) ? " " : "";
  const tail = after && !/^\s/.test(after) ? " " : "";
  const room = Math.max(0, max - before.length - after.length - lead.length - tail.length);
  const text = `${lead}${words.trim().slice(0, room)}${tail}`;
  return { value: before + text + after, caret: before.length + text.length - tail.length };
}

/** Linear resampling of mono audio, for a browser that cannot capture at the rate asked for. */
export function resample(samples: Float32Array, from: number, to: number): Float32Array {
  if (from === to) return samples;
  const length = Math.floor((samples.length * to) / from);
  const out = new Float32Array(length);
  const ratio = from / to;
  for (let i = 0; i < length; i++) {
    const at = i * ratio;
    const low = Math.floor(at);
    const next = samples[Math.min(low + 1, samples.length - 1)];
    out[i] = samples[low] + (next - samples[low]) * (at - low);
  }
  return out;
}
