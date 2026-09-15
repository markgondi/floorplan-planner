export interface Point {
  x: number;
  y: number;
}

export function distance(a: Point, b: Point): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

// scale = real-world units per pixel, derived from a calibration segment.
export function computeScale(pixelDistance: number, knownRealLength: number): number {
  if (pixelDistance === 0) return 0;
  return knownRealLength / pixelDistance;
}

export function pxToReal(px: number, scaleUnitsPerPx: number): number {
  return px * scaleUnitsPerPx;
}

export function realToPx(real: number, scaleUnitsPerPx: number): number {
  return scaleUnitsPerPx === 0 ? 0 : real / scaleUnitsPerPx;
}

export function polygonPerimeterSegments(points: Point[]): { from: Point; to: Point; length: number }[] {
  const segments = [];
  for (let i = 0; i < points.length; i++) {
    const from = points[i];
    const to = points[(i + 1) % points.length];
    segments.push({ from, to, length: distance(from, to) });
  }
  return segments;
}

export interface WallRun {
  from: Point;
  to: Point;
  length: number;
}

function angleOf(a: Point, b: Point): number {
  return Math.atan2(b.y - a.y, b.x - a.x);
}

// Merges consecutive collinear perimeter segments (a straight wall traced across
// several points) into single runs, so each straight wall gets one length label
// instead of one per sub-segment.
export function mergeCollinearWalls(points: Point[]): WallRun[] {
  const segments = polygonPerimeterSegments(points);
  if (segments.length === 0) return [];

  const runs: WallRun[] = [];
  let run = { from: segments[0].from, to: segments[0].to, length: segments[0].length };
  let runAngle = angleOf(segments[0].from, segments[0].to);

  for (let i = 1; i < segments.length; i++) {
    const seg = segments[i];
    const angle = angleOf(seg.from, seg.to);
    const diff = Math.abs(Math.atan2(Math.sin(angle - runAngle), Math.cos(angle - runAngle)));
    if (diff < 0.02) {
      run = { from: run.from, to: seg.to, length: run.length + seg.length };
    } else {
      runs.push(run);
      run = { from: seg.from, to: seg.to, length: seg.length };
      runAngle = angle;
    }
  }
  runs.push(run);

  // If the outline closes back into the same direction as the first run, merge the wrap-around.
  if (runs.length > 1) {
    const firstAngle = angleOf(runs[0].from, runs[0].to);
    const lastAngle = angleOf(runs[runs.length - 1].from, runs[runs.length - 1].to);
    const diff = Math.abs(Math.atan2(Math.sin(firstAngle - lastAngle), Math.cos(firstAngle - lastAngle)));
    if (diff < 0.02) {
      const last = runs.pop()!;
      runs[0] = { from: last.from, to: runs[0].to, length: runs[0].length + last.length };
    }
  }

  return runs;
}

export function snapAngle(degrees: number, step = 15): number {
  return Math.round(degrees / step) * step;
}

// Signed position of `p` along the wall's direction, measured from `wall.from` (in the
// same px units as the points). Negative or > length means the item is past an endpoint.
export function projectAlongWall(p: Point, wall: WallRun): number {
  const dx = wall.to.x - wall.from.x;
  const dy = wall.to.y - wall.from.y;
  const len = Math.hypot(dx, dy) || 1;
  return ((p.x - wall.from.x) * dx + (p.y - wall.from.y) * dy) / len;
}

// Perpendicular distance from `p` to the infinite line through the wall.
export function distanceFromWallLine(p: Point, wall: WallRun): number {
  const dx = wall.to.x - wall.from.x;
  const dy = wall.to.y - wall.from.y;
  const len = Math.hypot(dx, dy) || 1;
  return Math.abs((p.x - wall.from.x) * dy - (p.y - wall.from.y) * dx) / len;
}
