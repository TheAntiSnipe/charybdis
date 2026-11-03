import { describe, expect, it } from 'vitest';
import {
  FULL_RADIUS, HUB_RADIUS, LEFT_X, REEL_Y, RIGHT_X, ROLLER_RADIUS, leftTangent, packRadii, tapeGeometry, type Circle, type Point,
} from './tapeGeometry';

const dot = (a: Point, b: Point) => a.x * b.x + a.y * b.y;
const sub = (a: Point, b: Point): Point => ({ x: a.x - b.x, y: a.y - b.y });
const dist = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
const PROGRESS = [0, 0.05, 0.25, 0.5, 0.75, 0.95, 1];

/** A line through `from` and `to` is tangent to the circle at `touch` when the radius there is perpendicular to it. */
function expectTangentAt(circle: Circle, touch: Point, from: Point, to: Point) {
  expect(dist(touch, circle)).toBeCloseTo(circle.r, 6); // the point is on the circle
  const along = sub(to, from);
  const radius = sub(touch, circle);
  expect(dot(radius, along) / (Math.hypot(along.x, along.y) * circle.r)).toBeCloseTo(0, 6); // and the line is perpendicular to the radius
}

describe('tape geometry', () => {
  it('conserves the tape as it moves from the left spool to the right', () => {
    const area = (r: number) => r * r - HUB_RADIUS * HUB_RADIUS;
    for (const p of PROGRESS) {
      const { left, right } = packRadii(p);
      expect(area(left) + area(right)).toBeCloseTo(FULL_RADIUS * FULL_RADIUS - HUB_RADIUS * HUB_RADIUS, 6);
    }
    expect(packRadii(0).left).toBeCloseTo(FULL_RADIUS, 6);
    expect(packRadii(0).right).toBeCloseTo(HUB_RADIUS, 6);
    expect(packRadii(1).left).toBeCloseTo(HUB_RADIUS, 6);
    expect(packRadii(1).right).toBeCloseTo(FULL_RADIUS, 6);
    expect(packRadii(0.5).left).toBeCloseTo(packRadii(0.5).right, 6);
    expect(packRadii(-1)).toEqual(packRadii(0));
    expect(packRadii(5)).toEqual(packRadii(1));
  });

  it.each(PROGRESS)('the film leaves the LEFT spool tangentially (progress %s)', (p) => {
    const g = tapeGeometry(p);
    expectTangentAt(g.leftPack, g.feed.from, g.feed.from, g.feed.to);
    expectTangentAt(g.leftRoller, g.feed.to, g.feed.from, g.feed.to);
  });

  it.each(PROGRESS)('the film winds onto the RIGHT spool tangentially (progress %s)', (p) => {
    const g = tapeGeometry(p);
    expectTangentAt(g.rightRoller, g.take.from, g.take.from, g.take.to);
    expectTangentAt(g.rightPack, g.take.to, g.take.from, g.take.to);
  });

  it.each(PROGRESS)('meets the spools on the sides the film really travels (progress %s)', (p) => {
    const g = tapeGeometry(p);
    // Left reel pays out from its lower left, heading down and to the right.
    expect(g.feed.from.x).toBeLessThan(g.leftPack.x);
    expect(g.feed.from.y).toBeGreaterThan(g.leftPack.y);
    expect(g.feed.to.y).toBeGreaterThan(g.feed.from.y);
    expect(g.feed.to.x).toBeGreaterThan(g.feed.from.x);
    // Right reel takes up on its lower right, the film arriving from below and to the left.
    expect(g.take.to.x).toBeGreaterThan(g.rightPack.x);
    expect(g.take.to.y).toBeGreaterThan(g.rightPack.y);
    expect(g.take.to.y).toBeLessThan(g.take.from.y);
    expect(g.take.to.x).toBeGreaterThan(g.take.from.x);
  });

  it('is mirror-symmetric when the two spools hold equal tape', () => {
    const g = tapeGeometry(0.5);
    const mirror = (x: number) => 200 - x; // about the cassette's centre line
    expect(mirror(g.feed.from.x)).toBeCloseTo(g.take.to.x, 6);
    expect(g.feed.from.y).toBeCloseTo(g.take.to.y, 6);
    expect(mirror(g.feed.to.x)).toBeCloseTo(g.take.from.x, 6);
    expect(g.feed.to.y).toBeCloseTo(g.take.from.y, 6);
    expect(LEFT_X + RIGHT_X).toBe(200);
  });

  it('keeps the tape inside the cassette and clear of the head', () => {
    for (const p of PROGRESS) {
      const g = tapeGeometry(p);
      for (const pt of [g.feed.from, g.feed.to, g.take.from, g.take.to]) {
        expect(pt.x).toBeGreaterThan(2);
        expect(pt.x).toBeLessThan(198);
        expect(pt.y).toBeGreaterThan(2);
        expect(pt.y).toBeLessThan(100);
      }
    }
  });

  it('draws one continuous strand: tangent, round the roller, flat run, round the roller, tangent', () => {
    const { path } = tapeGeometry(0.4);
    const commands = path.match(/[MLA]/g);
    expect(commands).toEqual(['M', 'L', 'A', 'L', 'A', 'L']);
    expect(path).toContain(`A${ROLLER_RADIUS} ${ROLLER_RADIUS} 0 0 0`);
  });

  it('the flat run is the bottom of the rollers, so the arcs join the line with no kink', () => {
    const g = tapeGeometry(0.4);
    const numbers = (path: string) => path.match(/-?\d+(\.\d+)?/g)!.map(Number);
    const n = numbers(g.path);
    // M x y, L x y, A r r 0 0 0 x y, L x y, A r r 0 0 0 x y, L x y
    const flatLeft = { x: n[9], y: n[10] }; // end of the arc round the left roller
    const flatRight = { x: n[11], y: n[12] }; // end of the flat run
    expect(n).toHaveLength(22);
    expect(flatLeft.y).toBeCloseTo(g.leftRoller.y + ROLLER_RADIUS, 3);
    expect(flatRight.y).toBeCloseTo(flatLeft.y, 6);
    expect(flatLeft.x).toBeCloseTo(g.leftRoller.x, 3);
    expect(flatRight.x).toBeCloseTo(g.rightRoller.x, 3);
  });
});

describe('leftTangent', () => {
  it('finds the external tangent of two circles with both on the left of travel', () => {
    const a: Circle = { x: 0, y: 0, r: 10 };
    const b: Circle = { x: 40, y: 30, r: 4 };
    const { from, to } = leftTangent(a, b);
    expectTangentAt(a, from, from, to);
    expectTangentAt(b, to, from, to);
    // both centres are on the left of from->to (screen coordinates, y down)
    const t = sub(to, from);
    const left = { x: t.y, y: -t.x };
    expect(dot(sub(a, from), left)).toBeGreaterThan(0);
    expect(dot(sub(b, to), left)).toBeGreaterThan(0);
  });

  it('works for circles of equal size and for a tiny circle against a huge one', () => {
    for (const [a, b] of [
      [{ x: 0, y: 0, r: 5 }, { x: 30, y: 0, r: 5 }],
      [{ x: 0, y: 0, r: 40 }, { x: 70, y: 50, r: 1 }],
    ] as [Circle, Circle][]) {
      const { from, to } = leftTangent(a, b);
      expectTangentAt(a, from, from, to);
      expectTangentAt(b, to, from, to);
    }
  });

  it('refuses circles where one contains the other', () => {
    expect(() => leftTangent({ x: 0, y: 0, r: 20 }, { x: 1, y: 1, r: 2 })).toThrow();
  });

  it('keeps the reels where the cassette window is', () => {
    expect(tapeGeometry(0.3).leftPack).toMatchObject({ x: LEFT_X, y: REEL_Y });
    expect(tapeGeometry(0.3).rightPack).toMatchObject({ x: RIGHT_X, y: REEL_Y });
  });
});
