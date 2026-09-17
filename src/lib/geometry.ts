export interface Point {
  x: number;
  y: number;
  // On an outline corner: the wall that starts here has a fixed length. It was measured, so
  // only typing a new length for that wall may change it.
  fixed?: boolean;
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
  // The wall's length was measured and must not change (see Point.fixed).
  fixed?: boolean;
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
  return wallRunsWithCorners(points).map(({ from, to, length }) => ({ from, to, length, fixed: !!from.fixed }));
}

// Makes one wall of the outline exactly `length` long (canvas px) and fixes it there.
//
// One of its corners slides along the wall — its end, or its start when `moveStart` — taking
// the walls beyond it along unchanged, until the nearest wall running the same way that isn't
// fixed, which lengthens or shortens to make up the difference. In a square-cornered room
// that's the whole side moving in or out. Fixed walls are never resized: if every wall that
// could take up the change is fixed (in both directions), nothing moves and `blockedBy` lists
// those walls. Typing the old length back puts everything back where it was.
export function setWallLength(
  points: Point[],
  runIndex: number,
  length: number,
  moveStart = false,
): { points: Point[]; blockedBy: number[] | null; leaned?: { wall: number; fixedWalls: number[] } } {
  const runs = wallRunsWithCorners(points);
  const run = runs[runIndex];
  if (!run || runs.length < 3 || !(length > 0) || !(run.length > 0)) return { points, blockedBy: null };
  const n = points.length;
  const m = runs.length;
  const ux = (run.to.x - run.from.x) / run.length;
  const uy = (run.to.y - run.from.y) / run.length;
  const delta = length - run.length;
  const cornersBetween = (from: number, to: number) => {
    const set = new Set<number>();
    for (let i = from; ; i = (i + 1) % n) {
      set.add(i);
      if (i === to) break;
    }
    return set;
  };

  const fixedInTheWay: number[] = [];
  for (const backwards of moveStart ? [true, false] : [false, true]) {
    for (let k = 1; k < m; k++) {
      const j = backwards ? (runIndex - k + m) % m : (runIndex + k) % m;
      const other = runs[j];
      const ox = (other.to.x - other.from.x) / (other.length || 1);
      const oy = (other.to.y - other.from.y) / (other.length || 1);
      if (Math.abs(ox * uy - oy * ux) > 0.02) continue; // not running the same way
      if (other.from.fixed) {
        if (!fixedInTheWay.includes(j)) fixedInTheWay.push(j);
        continue;
      }
      const sameWay = ox * ux + oy * uy > 0;
      const shift = backwards ? -delta : delta;
      const otherLength = other.length + (backwards === sameWay ? shift : -shift);
      if (otherLength <= 1) continue; // too short to take up that much

      const moved = backwards ? cornersBetween(other.endIndex, run.startIndex) : cornersBetween(run.endIndex, other.startIndex);
      const next = points.map((p, i) => (moved.has(i) ? { ...p, x: p.x + ux * shift, y: p.y + uy * shift } : p));
      next[run.startIndex] = { ...next[run.startIndex], fixed: true };
      return { points: next, blockedBy: null };
    }
  }

  // Every wall running the same way is fixed. Measured lengths don't guarantee square corners,
  // so let the wall at the moving corner take up the difference by leaning, if it isn't fixed:
  // only that one corner moves, and every fixed wall keeps its length.
  for (const atStart of moveStart ? [true, false] : [false, true]) {
    const neighbourIndex = atStart ? (runIndex - 1 + m) % m : (runIndex + 1) % m;
    const neighbour = runs[neighbourIndex];
    if (neighbour.from.fixed) continue;
    const corner = atStart ? run.startIndex : run.endIndex;
    const shift = atStart ? -delta : delta;
    const moved = { ...points[corner], x: points[corner].x + ux * shift, y: points[corner].y + uy * shift };
    const far = atStart ? neighbour.from : neighbour.to;
    if (Math.hypot(far.x - moved.x, far.y - moved.y) <= 1) continue; // would collapse the wall
    const next = points.map((p, i) => (i === corner ? moved : p));
    next[run.startIndex] = { ...next[run.startIndex], fixed: true };
    return { points: next, blockedBy: null, leaned: { wall: neighbourIndex, fixedWalls: fixedInTheWay } };
  }
  return { points, blockedBy: fixedInTheWay };
}

// Marks one wall of the outline as fixed (measured) or free to change.
export function setWallFixed(points: Point[], runIndex: number, fixed: boolean): Point[] {
  const run = wallRunsWithCorners(points)[runIndex];
  if (!run) return points;
  return points.map((p, i) => (i === run.startIndex ? { ...p, fixed } : p));
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
