// Ageing for the cassettes: hairline scratches and dust specks, different on every tape but the same every time
// the same tape is drawn. Coordinates are in the cassette's 200x126 viewBox.

export interface Scratch {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  light: boolean; // light lines catch the light on dark plastic, dark ones are grime in the grooves
  opacity: number;
  width: number;
}

export interface Speck {
  x: number;
  y: number;
  r: number;
  opacity: number;
}

export interface Wear {
  scratches: Scratch[];
  specks: Speck[];
}

export function hash(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619) >>> 0;
  return h;
}

export function random(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const round = (n: number) => Math.round(n * 10) / 10;

export function wearFor(seed: string, scratchCount = 26, speckCount = 14): Wear {
  const rand = random(hash(seed));
  const scratches: Scratch[] = [];
  for (let i = 0; i < scratchCount; i++) {
    const long = rand() < 0.12;
    const length = long ? 40 + rand() * 45 : 4 + rand() * 26;
    // Most scuffs run the way a cassette slides in and out of a pocket; the rest are anywhere.
    const angle = ((rand() < 0.7 ? (rand() - 0.5) * 50 : rand() * 180) * Math.PI) / 180;
    const x = 4 + rand() * 192;
    const y = 4 + rand() * 118;
    const light = rand() < 0.72;
    scratches.push({
      x1: round(x),
      y1: round(y),
      x2: round(x + Math.cos(angle) * length),
      y2: round(y + Math.sin(angle) * length),
      light,
      opacity: round((light ? 0.16 + rand() * 0.28 : 0.1 + rand() * 0.16) * 100) / 100,
      width: round(0.18 + rand() * 0.2),
    });
  }
  const specks: Speck[] = [];
  for (let i = 0; i < speckCount; i++) {
    specks.push({ x: round(3 + rand() * 194), y: round(3 + rand() * 120), r: round(0.25 + rand() * 0.45), opacity: round(0.18 + rand() * 0.25) });
  }
  return { scratches, specks };
}
