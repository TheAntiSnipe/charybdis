import { describe, expect, it } from 'vitest';
import { wearFor } from './wear';

describe('wearFor', () => {
  it('is the same every time for the same tape and different between tapes', () => {
    expect(wearFor('album-aaaa')).toEqual(wearFor('album-aaaa'));
    expect(wearFor('album-aaaa').scratches).not.toEqual(wearFor('album-bbbb').scratches);
  });

  it('keeps every mark on the cassette, with the requested number of scratches and specks', () => {
    const wear = wearFor('album-aaaa', 30, 10);
    expect(wear.scratches).toHaveLength(30);
    expect(wear.specks).toHaveLength(10);
    for (const s of wear.scratches) {
      expect(s.x1).toBeGreaterThanOrEqual(0);
      expect(s.x1).toBeLessThanOrEqual(200);
      expect(s.y1).toBeGreaterThanOrEqual(0);
      expect(s.y1).toBeLessThanOrEqual(126);
      expect(s.opacity).toBeGreaterThan(0);
      expect(s.opacity).toBeLessThan(0.5);
    }
  });
});
