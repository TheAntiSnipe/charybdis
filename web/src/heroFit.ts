export interface TitleMeasure {
  /** Width the text is allowed to use. */
  width: number;
  /** Width the text actually needs; larger than `width` when a single word is too wide and would have to break. */
  needed: number;
  /** Height of the wrapped text and the most we will give it. */
  height: number;
  maxHeight: number;
}

/**
 * Largest font size (in the caller's unit) between `min` and `max` at which the title wraps only between words and
 * stays within its height budget. `measure` applies a size to the real element and reports what it measured, because
 * the width of the handwriting face is different on every device and cannot be guessed.
 */
export function fitTitleSize(max: number, min: number, measure: (size: number) => TitleMeasure): number {
  let size = max;
  for (let i = 0; i < 8; i++) {
    const m = measure(size);
    if (!m.width || !m.height) return size; // not laid out (hidden); try again when it is shown
    const scale = Math.min(m.width / Math.max(m.needed, 1), m.maxHeight / m.height);
    if (scale >= 1) return size;
    size = Math.max(min, size * scale * 0.98);
    if (size === min) {
      measure(size);
      return size;
    }
  }
  return size;
}
