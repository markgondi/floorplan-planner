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

export function closestPointOnSegment(p: Point, a: Point, b: Point): Point {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const t = Math.min(1, Math.max(0, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy || 1)));
  return { x: a.x + t * dx, y: a.y + t * dy };
}

// Even-odd ray cast: true when p lies inside the (possibly concave) polygon.
export function pointInPolygon(p: Point, polygon: Point[]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i];
    const b = polygon[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) {
      inside = !inside;
    }
  }
  return inside;
}

export interface WallRun {
  from: Point;
  to: Point;
  length: number;
}

function angleOf(a: Point, b: Point): number {
  return Math.atan2(b.y - a.y, b.x - a.x);
}

// A wall run plus the outline corners it starts and ends at (indices into the outline).
type WallRunWithCorners = WallRun & { startIndex: number; endIndex: number };

function wallRunsWithCorners(points: Point[]): WallRunWithCorners[] {
  const segments = polygonPerimeterSegments(points);
  if (segments.length === 0) return [];
  const n = points.length;

  const runs: WallRunWithCorners[] = [];
  let run = { from: segments[0].from, to: segments[0].to, length: segments[0].length, startIndex: 0, endIndex: 1 % n };
  let runAngle = angleOf(segments[0].from, segments[0].to);

  for (let i = 1; i < segments.length; i++) {
    const seg = segments[i];
    const angle = angleOf(seg.from, seg.to);
    const diff = Math.abs(Math.atan2(Math.sin(angle - runAngle), Math.cos(angle - runAngle)));
    if (diff < 0.02) {
      run = { ...run, to: seg.to, length: run.length + seg.length, endIndex: (i + 1) % n };
    } else {
      runs.push(run);
      run = { from: seg.from, to: seg.to, length: seg.length, startIndex: i, endIndex: (i + 1) % n };
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
      runs[0] = { from: last.from, to: runs[0].to, length: runs[0].length + last.length, startIndex: last.startIndex, endIndex: runs[0].endIndex };
    }
  }

  return runs;
}

// Merges consecutive collinear perimeter segments (a straight wall traced across
// several points) into single runs, so each straight wall gets one length label
// instead of one per sub-segment.
export function mergeCollinearWalls(points: Point[]): WallRun[] {
  return wallRunsWithCorners(points).map(({ from, to, length }) => ({ from, to, length }));
}

// Makes one wall of the outline exactly `length` long (canvas px). One of its corners slides
// along the wall — its end, or its start when `moveStart` — and carries the neighbouring wall
// with it, so that wall keeps its length and direction; the wall beyond absorbs the change.
// In a square-cornered room that's the whole side moving out or in, like pushing a wall.
// Typing the old length back puts everything back where it was.
export function setWallLength(points: Point[], runIndex: number, length: number, moveStart = false): Point[] {
  const runs = wallRunsWithCorners(points);
  const run = runs[runIndex];
  if (!run || runs.length < 3 || !(length > 0) || !(run.length > 0)) return points;
  const n = points.length;
  const shift = (length - run.length) * (moveStart ? -1 : 1);
  const dx = ((run.to.x - run.from.x) / run.length) * shift;
  const dy = ((run.to.y - run.from.y) / run.length) * shift;

  // Corners that move: from this wall's moving corner round to the far end of the neighbour.
  const moved = new Set<number>();
  if (moveStart) {
    const prev = runs[(runIndex - 1 + runs.length) % runs.length];
    for (let i = prev.startIndex; ; i = (i + 1) % n) {
      moved.add(i);
      if (i === run.startIndex) break;
    }
  } else {
    const next = runs[(runIndex + 1) % runs.length];
    for (let i = run.endIndex; ; i = (i + 1) % n) {
      moved.add(i);
      if (i === next.endIndex) break;
    }
  }
  return points.map((p, i) => (moved.has(i) ? { x: p.x + dx, y: p.y + dy } : p));
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
  return Math.abs(signedDistanceFromWall(p, wall));
}

// Perpendicular offset from the wall line, keeping the sign so a point can be moved along
// the wall without hopping to the other side of it.
export function signedDistanceFromWall(p: Point, wall: WallRun): number {
  const dx = wall.to.x - wall.from.x;
  const dy = wall.to.y - wall.from.y;
  const len = Math.hypot(dx, dy) || 1;
  return ((p.x - wall.from.x) * -dy + (p.y - wall.from.y) * dx) / len;
}

// Rebuild a plan-space point from wall-relative coordinates — the inverse of
// projectAlongWall + signedDistanceFromWall.
export function pointOnWall(wall: WallRun, alongPx: number, perpPx: number): Point {
  const dx = wall.to.x - wall.from.x;
  const dy = wall.to.y - wall.from.y;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len;
  const uy = dy / len;
  return {
    x: wall.from.x + ux * alongPx + -uy * perpPx,
    y: wall.from.y + uy * alongPx + ux * perpPx,
  };
}
