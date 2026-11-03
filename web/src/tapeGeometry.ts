// Geometry of the tape inside a see-through cassette (200x126 viewBox, y points down).
//
// The tape runs along the lower edge of four circles: the left pack, the left guide roller, the right
// roller and the right pack. Between neighbouring circles it follows their external common tangent, so
// the film always meets each spool and roller tangentially, and wraps each roller with a small arc.

export const REEL_Y = 57.25;
export const LEFT_X = 57;
export const RIGHT_X = 143; // symmetric about the cassette's centre line, x = 100
export const HUB_RADIUS = 9.2; // empty spool: the film is wound on the hub itself
export const FULL_RADIUS = 26.5; // full pack
export const ROLLER_RADIUS = 3.2;
export const ROLLER_Y = 93;
export const LEFT_ROLLER_X = 66;
export const RIGHT_ROLLER_X = 134;

export interface Point {
  x: number;
  y: number;
}

export interface Circle extends Point {
  r: number;
}

/**
 * The line that touches circles `a` and `b` on the same side, with both circles on the left of the
 * direction of travel a to b (screen coordinates). Returns where it touches each.
 */
export function leftTangent(a: Circle, b: Circle): { from: Point; to: Point } {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const d = Math.hypot(dx, dy);
  const k = (b.r - a.r) / d;
  if (Math.abs(k) >= 1) throw new Error('one circle contains the other');
  const s = Math.sqrt(1 - k * k);
  const ux = dx / d;
  const uy = dy / d;

  for (const sign of [1, -1]) {
    // n points from the tangent line towards the centres, and must be perpendicular to the line.
    const nx = k * ux - sign * s * uy;
    const ny = k * uy + sign * s * ux;
    const tx = dx - (b.r - a.r) * nx;
    const ty = dy - (b.r - a.r) * ny;
    if (nx * ty - ny * tx > 0) {
      return {
        from: { x: a.x - a.r * nx, y: a.y - a.r * ny },
        to: { x: b.x - b.r * nx, y: b.y - b.r * ny },
      };
    }
  }
  throw new Error('no tangent found');
}

/** Pack radii when the tape is `progress` (0..1) of the way through: tape moves from left to right. */
export function packRadii(progress: number): { left: number; right: number } {
  const f = Math.min(Math.max(progress, 0), 1);
  const area = FULL_RADIUS * FULL_RADIUS - HUB_RADIUS * HUB_RADIUS; // tape is area, so it is conserved
  return {
    left: Math.sqrt(HUB_RADIUS * HUB_RADIUS + (1 - f) * area),
    right: Math.sqrt(HUB_RADIUS * HUB_RADIUS + f * area),
  };
}

const f = (n: number) => Number(n.toFixed(3));

export function tapeGeometry(progress: number) {
  const { left, right } = packRadii(progress);
  const leftPack: Circle = { x: LEFT_X, y: REEL_Y, r: left };
  const rightPack: Circle = { x: RIGHT_X, y: REEL_Y, r: right };
  const leftRoller: Circle = { x: LEFT_ROLLER_X, y: ROLLER_Y, r: ROLLER_RADIUS };
  const rightRoller: Circle = { x: RIGHT_ROLLER_X, y: ROLLER_Y, r: ROLLER_RADIUS };

  const feed = leftTangent(leftPack, leftRoller); // off the left pack, onto the left roller
  const take = leftTangent(rightRoller, rightPack); // off the right roller, onto the right pack
  const bottomY = ROLLER_Y + ROLLER_RADIUS;

  // Round each roller counter-clockwise (on screen) to the flat run between them.
  const path = [
    `M${f(feed.from.x)} ${f(feed.from.y)}`,
    `L${f(feed.to.x)} ${f(feed.to.y)}`,
    `A${ROLLER_RADIUS} ${ROLLER_RADIUS} 0 0 0 ${f(leftRoller.x)} ${f(bottomY)}`,
    `L${f(rightRoller.x)} ${f(bottomY)}`,
    `A${ROLLER_RADIUS} ${ROLLER_RADIUS} 0 0 0 ${f(take.from.x)} ${f(take.from.y)}`,
    `L${f(take.to.x)} ${f(take.to.y)}`,
  ].join(' ');

  return { leftPack, rightPack, leftRoller, rightRoller, feed, take, path };
}
