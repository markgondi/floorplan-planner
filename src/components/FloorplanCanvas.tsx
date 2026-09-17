import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import type { Point, WallRun } from "../lib/geometry";
import {
  closestPointOnSegment,
  distance,
  mergeCollinearWalls,
  pointInPolygon,
  polygonPerimeterSegments,
  pxToReal,
  snapAngle,
} from "../lib/geometry";
import type { Comment, Furniture } from "../lib/types";
import { itemColor, itemOrigin } from "../lib/types";
import type { Unit } from "../lib/units";
import { dimensionTokens, formatDimensions, formatLength, fromCm, toCm } from "../lib/units";
import { exportSvgAsPng } from "../lib/export";

type Mode = "select" | "walls" | "scale" | "arrange" | "comment";
export type WallTool = "outline" | "inner";

interface FloorplanCanvasProps {
  roomName: string;
  outline: Point[];
  scalePxPerUnit: number;
  unit: Unit;
  furniture: Furniture[];
  comments: Comment[];
  selectedFurnitureId: string | null;
  imageUrl: string | null;
  mode: Mode;
  onOutlineChange: (points: Point[]) => void;
  onCalibrate: (pixelDistance: number, realLengthCm: number) => void;
  onFurnitureChange: (id: string, patch: Partial<Furniture>) => void;
  onSelectFurniture: (id: string | null) => void;
  onAddComment: (point: Point) => void;
  selectedWallIndex: number | null;
  onSelectWall: (index: number | null) => void;
  zoom: number;
  onZoomChange: (updater: (zoom: number) => number) => void;
  onCursorMove: (point: Point | null) => void;
  showLabels: boolean;
  gridSnap: boolean;
  wallTool: WallTool;
  // Where the inner wall being drawn starts; null when no wall is in progress.
  wallStart: Point | null;
  onWallStartChange: (point: Point | null) => void;
  onDrawWall: (from: Point, to: Point) => void;
  // Leave the Walls tool — the outline is closed or you're done placing walls.
  onFinishDrawing: () => void;
  // Thickness (cm) new inner walls are drawn at — the Wall preset's depth.
  innerWallThickness: number;
}

export interface FloorplanCanvasHandle {
  exportPng: () => void;
}

const VIEW_W = 1600;
const VIEW_H = 1100;
const MIN_ZOOM = 0.25;
const MAX_ZOOM = 4;
const GRID_MINOR = 20;
const WALL_DIM_SIZE = 10;
// Gap between a wall's centre line and the near edge of its length label — clears the
// 6px selected-wall highlight with room to spare.
const WALL_DIM_CLEARANCE = 7;
// Least room to leave between a length label and any other wall line.
const WALL_DIM_MIN_GAP = 5;
// Letter-spacing of wall lengths, as a fraction of font size.
const WALL_DIM_TRACKING = 0.04;
// How close (in screen pixels, whatever the zoom) the pointer must be to a corner or wall
// line for a click to lock onto it.
const SNAP_RADIUS = 10;
// How far (screen pixels) the pointer can stray from a 15° line out of the last point and
// still lock onto it.
const TRACK_RADIUS = 6;

type SnapKind = "point" | "line" | "track" | "grid" | "free";
// `angle` (radians) is set when the point is locked onto a tracked line.
type SnappedPoint = Point & { kind: SnapKind; angle?: number };

// Every item is drawn the same way — the item's own colour as a flat fill, one hairline
// outline weight — with only the interior detail changing per kind. Keeps the plan reading
// as one drawing rather than a collage of different styles.
const GLYPH_STROKE = 1.2;
const DETAIL_STROKE = 0.9;

function FurnitureGlyph({ item, scalePxPerUnit }: { item: Furniture; scalePxPerUnit: number }) {
  const wPx = item.width / (scalePxPerUnit || 1);
  const dPx = item.depth / (scalePxPerUnit || 1);
  const x = -wPx / 2;
  const y = -dPx / 2;

  const base = (radius = 0, fillOpacity = 0.85) => (
    <rect
      x={x}
      y={y}
      width={wPx}
      height={dPx}
      rx={radius}
      fill={itemColor(item)}
      fillOpacity={fillOpacity}
      stroke="var(--color-line)"
      strokeWidth={GLYPH_STROKE}
    />
  );

  // Evenly spaced interior division lines, used by shelving and seating.
  const divisions = (count: number, inset: number, opacity: number) =>
    Array.from({ length: Math.max(0, count - 1) }).map((_, i, arr) => {
      const sx = x + (wPx / (arr.length + 1)) * (i + 1);
      return (
        <line
          key={i}
          x1={sx}
          y1={y + inset}
          x2={sx}
          y2={y + dPx - inset}
          stroke="var(--color-canvas)"
          strokeOpacity={opacity}
          strokeWidth={DETAIL_STROKE}
        />
      );
    });

  if (item.kind === "wall") {
    return base(0, 1);
  }

  if (item.kind === "door") {
    // Standard architectural door: an opening in the wall, the leaf shown open at 90°,
    // and a quarter-circle showing its swing back to the closed position.
    const leaf = wPx;
    const thickness = Math.max(dPx, 2.5);
    const hingeX = x;
    return (
      <>
        <rect
          x={x}
          y={-thickness / 2}
          width={leaf}
          height={thickness}
          fill="var(--color-canvas)"
          stroke="var(--color-line-soft)"
          strokeWidth={DETAIL_STROKE}
        />
        <path
          d={`M ${hingeX} ${-leaf} A ${leaf} ${leaf} 0 0 1 ${hingeX + leaf} 0`}
          fill="none"
          stroke="var(--color-line-soft)"
          strokeWidth={DETAIL_STROKE}
          strokeDasharray="4 3"
          opacity="0.5"
        />
        <rect
          x={hingeX}
          y={-leaf}
          width={thickness}
          height={leaf}
          fill={itemColor(item)}
          stroke="var(--color-line)"
          strokeWidth={GLYPH_STROKE}
        />
      </>
    );
  }

  if (item.kind === "reader") {
    return (
      <>
        {base(1.5)}
        <circle cx="0" cy="0" r={Math.min(wPx, dPx) * 0.22} fill="var(--color-canvas)" fillOpacity="0.8" />
      </>
    );
  }

  if (item.kind === "screen") {
    // Screens read as a bezel with a recessed face, and a tick marking which way they face.
    const bezel = Math.min(dPx * 0.22, 5);
    return (
      <>
        {base(1.5)}
        <rect
          x={x + bezel}
          y={y + bezel}
          width={Math.max(0, wPx - bezel * 2)}
          height={Math.max(0, dPx - bezel * 2)}
          rx={1}
          fill="var(--color-canvas)"
          fillOpacity="0.45"
        />
        <line x1={x} y1={y} x2={x + wPx} y2={y} stroke="var(--color-accent)" strokeWidth={GLYPH_STROKE} />
      </>
    );
  }

  if (item.kind === "shelf") {
    return (
      <>
        {base()}
        {divisions(Math.max(2, Math.round(wPx / 40)), 0, 0.35)}
      </>
    );
  }

  if (item.kind === "bench") {
    return (
      <>
        {base(2)}
        {divisions(Math.max(2, Math.round(wPx / 30)), 2, 0.22)}
      </>
    );
  }

  return base();
}

const NAME_MAX_SIZE = 11;
const NAME_MIN_SIZE = 5.5;
const LINE_HEIGHT = 1.15;
// Rough advance width of a monospace glyph as a fraction of font size — close enough to
// decide whether a name fits without measuring text in the DOM.
const MONO_CHAR_WIDTH = 0.62;

// Turn an angle so text drawn at it never reads upside down: kept within [-90, 90), so a
// vertical label reads bottom-to-top, the usual convention on drawings.
function readableAngle(deg: number): number {
  const a = ((deg % 360) + 360) % 360;
  if (a >= 270) return a - 360;
  if (a >= 90) return a - 180;
  return a;
}

// Clearance between segment a–b and the box [-hw, hw] × [-hh, hh]; 0 when they touch or cross.
function segmentBoxGap(a: Point, b: Point, hw: number, hh: number): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  // Liang–Barsky clip: if any part of the segment survives, it passes through the box.
  let t0 = 0;
  let t1 = 1;
  let crosses = true;
  for (const [p, q] of [[-dx, a.x + hw], [dx, hw - a.x], [-dy, a.y + hh], [dy, hh - a.y]]) {
    if (p === 0) {
      if (q < 0) crosses = false;
    } else if (p < 0) {
      t0 = Math.max(t0, q / p);
    } else {
      t1 = Math.min(t1, q / p);
    }
    if (!crosses || t0 > t1) {
      crosses = false;
      break;
    }
  }
  if (crosses) return 0;
  const toBox = (p: Point) => Math.hypot(Math.max(Math.abs(p.x) - hw, 0), Math.max(Math.abs(p.y) - hh, 0));
  const toSegment = (x: number, y: number) => {
    const t = Math.min(1, Math.max(0, ((x - a.x) * dx + (y - a.y) * dy) / (dx * dx + dy * dy || 1)));
    return Math.hypot(x - a.x - t * dx, y - a.y - t * dy);
  };
  return Math.min(toBox(a), toBox(b), toSegment(-hw, -hh), toSegment(hw, -hh), toSegment(-hw, hh), toSegment(hw, hh));
}

// The side of an outline wall that faces away from the room.
function outwardNormal(run: Pick<WallRun, "from" | "to" | "length">, outline: Point[]): Point {
  const len = run.length || 1;
  const ux = (run.to.x - run.from.x) / len;
  const uy = (run.to.y - run.from.y) / len;
  const midX = (run.from.x + run.to.x) / 2;
  const midY = (run.from.y + run.to.y) / 2;
  return pointInPolygon({ x: midX - uy * 3, y: midY + ux * 3 }, outline) ? { x: uy, y: -ux } : { x: -uy, y: ux };
}

interface WallLine {
  from: Point;
  to: Point;
  thickness: number;
}

// Splits an outline wall into the stretches between the inner walls that meet it (measured
// to their faces), so a wall shared by two rooms can be read room by room. One stretch means
// nothing meets it.
function roomSpans(run: WallRun, walls: WallLine[]): { start: number; end: number }[] {
  const len = run.length;
  const ux = (run.to.x - run.from.x) / (len || 1);
  const uy = (run.to.y - run.from.y) / (len || 1);
  const cuts: { start: number; end: number }[] = [];
  for (const w of walls) {
    const wl = Math.hypot(w.to.x - w.from.x, w.to.y - w.from.y) || 1;
    const sin = Math.abs(((w.to.x - w.from.x) / wl) * uy - ((w.to.y - w.from.y) / wl) * ux);
    if (sin < 0.3) continue; // runs alongside this wall rather than meeting it
    const half = w.thickness / 2 / sin;
    for (const end of [w.from, w.to]) {
      const along = (end.x - run.from.x) * ux + (end.y - run.from.y) * uy;
      const off = Math.abs(-(end.x - run.from.x) * uy + (end.y - run.from.y) * ux);
      if (off <= w.thickness / 2 + 2 && along - half > 1 && along + half < len - 1) {
        cuts.push({ start: along - half, end: along + half });
      }
    }
  }
  cuts.sort((a, b) => a.start - b.start);
  const spans: { start: number; end: number }[] = [];
  let pos = 0;
  for (const cut of cuts) {
    if (cut.start > pos + 0.5) spans.push({ start: pos, end: cut.start });
    pos = Math.max(pos, cut.end);
  }
  if (len > pos + 0.5) spans.push({ start: pos, end: len });
  return spans;
}

// A wall length on the plan. Styled with attributes so it survives PNG export.
function DimText({ place, text, opacity }: { place: { x: number; y: number; angle: number }; text: string; opacity?: number }) {
  return (
    <text
      transform={`translate(${place.x} ${place.y}) rotate(${place.angle})`}
      className="mono floorplan-canvas__dim-label"
      fontFamily="monospace"
      fontSize={WALL_DIM_SIZE}
      letterSpacing={`${WALL_DIM_TRACKING}em`}
      fill="var(--color-line-soft)"
      opacity={opacity}
      textAnchor="middle"
      dominantBaseline="central"
      paintOrder="stroke"
      stroke="var(--color-canvas)"
      strokeWidth={3}
      strokeLinejoin="round"
    >
      {text}
    </text>
  );
}

// Where a wall's length label goes: outside the room, parallel to the wall and clear of its
// line, like a dimension on a drawing. A label longer than a short wall would run into the
// neighbouring walls, so it slides along its wall — then steps further out — until every
// wall line is at least WALL_DIM_MIN_GAP away and it doesn't cover a label already placed
// (`avoid`). `thicknessPx` keeps it clear of a wall drawn with real thickness rather than as
// a line.
function placeWallLabel(run: WallRun, outline: Point[], text: string, thicknessPx = 0, avoid: Point[][] = []) {
  const len = run.length || 1;
  const ux = (run.to.x - run.from.x) / len;
  const uy = (run.to.y - run.from.y) / len;
  const midX = (run.from.x + run.to.x) / 2;
  const midY = (run.from.y + run.to.y) / 2;
  const { x: nx, y: ny } = outwardNormal(run, outline);

  const angle = readableAngle((Math.atan2(uy, ux) * 180) / Math.PI);
  const cos = Math.cos((angle * Math.PI) / 180);
  const sin = Math.sin((angle * Math.PI) / 180);
  const hw = (text.length * (MONO_CHAR_WIDTH + WALL_DIM_TRACKING) * WALL_DIM_SIZE) / 2 + 1;
  const hh = WALL_DIM_SIZE / 2;
  const walls = polygonPerimeterSegments(outline);
  const clearance = (x: number, y: number) => {
    const local = (p: Point) => ({ x: (p.x - x) * cos + (p.y - y) * sin, y: -(p.x - x) * sin + (p.y - y) * cos });
    return Math.min(...walls.map((w) => segmentBoxGap(local(w.from), local(w.to), hw, hh)));
  };

  const base = WALL_DIM_CLEARANCE + thicknessPx / 2 + hh;
  // Near the wall first; crowded corners (a column's short sides, say) search further out,
  // and as a last resort accept sitting on a line rather than on top of another label.
  const passes = avoid.length
    ? [
        { outs: [0, 8, 16, 24, 32], minGap: WALL_DIM_MIN_GAP },
        { outs: [40, 48, 56, 64, 72], minGap: WALL_DIM_MIN_GAP },
        { outs: [0, 8, 16, 24, 32, 40, 48, 56, 64, 72], minGap: -Infinity },
      ]
    : [{ outs: [0, 8, 16], minGap: WALL_DIM_MIN_GAP }];
  for (const pass of passes) {
    for (const out of pass.outs) {
      for (let step = 0; step * 3 <= hw * (avoid.length ? 1.5 : 1); step++) {
        for (const along of step === 0 ? [0] : [step * 3, -step * 3]) {
          const x = midX + nx * (base + out) + ux * along;
          const y = midY + ny * (base + out) + uy * along;
          if (clearance(x, y) < pass.minGap) continue;
          const box = labelBox({ x, y, angle }, text);
          if (avoid.some((other) => boxesOverlap(box, other))) continue;
          return { x, y, angle };
        }
      }
    }
  }
  return { x: midX + nx * base, y: midY + ny * base, angle };
}

// The corners of a wall length label's text, with a pixel of breathing room.
function labelBox(place: { x: number; y: number; angle: number }, text: string): Point[] {
  const hw = (text.length * (MONO_CHAR_WIDTH + WALL_DIM_TRACKING) * WALL_DIM_SIZE) / 2 + 2;
  const hh = WALL_DIM_SIZE / 2 + 1;
  const cos = Math.cos((place.angle * Math.PI) / 180);
  const sin = Math.sin((place.angle * Math.PI) / 180);
  return [
    [-hw, -hh],
    [hw, -hh],
    [hw, hh],
    [-hw, hh],
  ].map(([lx, ly]) => ({ x: place.x + lx * cos - ly * sin, y: place.y + lx * sin + ly * cos }));
}

// Separating-axis test for two convex quadrilaterals.
function boxesOverlap(a: Point[], b: Point[]): boolean {
  for (const poly of [a, b]) {
    for (let i = 0; i < poly.length; i++) {
      const p = poly[i];
      const q = poly[(i + 1) % poly.length];
      const ax = -(q.y - p.y);
      const ay = q.x - p.x;
      const pa = a.map((v) => v.x * ax + v.y * ay);
      const pb = b.map((v) => v.x * ax + v.y * ay);
      if (Math.max(...pa) < Math.min(...pb) || Math.max(...pb) < Math.min(...pa)) return false;
    }
  }
  return true;
}

// Where an item's name sits and which way it runs: centred on the item and laid along its
// longer side, so it rotates with the item the way a label does on a technical drawing.
// `length` is the room along the text, `thickness` the room across it. Doors put the name
// in the middle of their swing, running along the opening.
function labelFrame(item: Furniture, scalePxPerUnit: number) {
  const s = scalePxPerUnit || 1;
  const w = item.width / s;
  const d = item.depth / s;

  if (item.kind === "door") {
    const rad = (item.rotation * Math.PI) / 180;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);
    // Centroid of the quarter-circle swing, whose centre is the hinge at the left end.
    const lx = -w / 2 + 0.424 * w;
    const ly = -0.424 * w;
    return {
      cx: item.x + lx * cos - ly * sin,
      cy: item.y + lx * sin + ly * cos,
      angle: readableAngle(item.rotation),
      length: 0.55 * w,
      thickness: 0.35 * w,
    };
  }

  const alongWidth = w >= d;
  return {
    cx: item.x,
    cy: item.y,
    angle: readableAngle(item.rotation + (alongWidth ? 0 : 90)),
    length: alongWidth ? w : d,
    thickness: alongWidth ? d : w,
  };
}

// Greedy word-wrap to a maximum character count. A single word longer than the limit
// gets its own line rather than being broken mid-word.
function wrapTokens(tokens: string[], maxChars: number): string[] {
  const lines: string[] = [];
  let line = "";
  for (const token of tokens) {
    const next = line ? `${line} ${token}` : token;
    if (next.length <= maxChars || !line) {
      line = next;
    } else {
      lines.push(line);
      line = token;
    }
  }
  if (line) lines.push(line);
  return lines;
}

// Largest font size (stepping down to minSize) at which the tokens wrap to fit the given
// box. A narrow-but-tall item gets a stacked name rather than one line spilling past its
// edges. If nothing fits, returns the minimum size wrapped as tightly as possible, with
// fits=false so the caller can decide what to leave out.
function fitLines(tokens: string[], width: number, height: number, maxSize: number, minSize: number) {
  const charsAt = (size: number) => Math.max(1, Math.floor((width * 0.88) / (size * MONO_CHAR_WIDTH)));
  for (let size = maxSize; size >= minSize; size -= 0.5) {
    const maxChars = charsAt(size);
    const lines = wrapTokens(tokens, maxChars);
    const longest = Math.max(...lines.map((l) => l.length));
    if (longest <= maxChars && lines.length * size * LINE_HEIGHT <= height) {
      return { size, lines, fits: true };
    }
  }
  return { size: minSize, lines: wrapTokens(tokens, charsAt(minSize)), fits: false };
}

const FloorplanCanvas = forwardRef<FloorplanCanvasHandle, FloorplanCanvasProps>(function FloorplanCanvas(
  {
    roomName,
    outline,
    scalePxPerUnit,
    unit,
    furniture,
    comments,
    selectedFurnitureId,
    imageUrl,
    mode,
    onOutlineChange,
    onCalibrate,
    onFurnitureChange,
    onSelectFurniture,
    onAddComment,
    selectedWallIndex,
    onSelectWall,
    zoom,
    onZoomChange,
    onCursorMove,
    showLabels,
    gridSnap,
    wallTool,
    wallStart,
    onWallStartChange,
    onDrawWall,
    onFinishDrawing,
    innerWallThickness,
  },
  ref,
) {
  const svgRef = useRef<SVGSVGElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [calibrationPoints, setCalibrationPoints] = useState<Point[]>([]);
  const [dragId, setDragId] = useState<string | null>(null);
  const [dragOffset, setDragOffset] = useState<Point>({ x: 0, y: 0 });
  const panState = useRef<{ x: number; y: number; scrollLeft: number; scrollTop: number } | null>(null);
  const didPan = useRef(false);
  const [crosshair, setCrosshair] = useState<SnappedPoint | null>(null);
  // The unsnapped pointer, which sets the direction a typed length runs in.
  const [pointer, setPointer] = useState<Point | null>(null);
  const [shiftHeld, setShiftHeld] = useState(false);
  // A length typed while drawing ("3000"), placed along the pointer's direction on Enter.
  // It belongs to the tool it was typed in, so switching tools starts afresh.
  const toolKey = `${mode}:${wallTool}`;
  const [typed, setTyped] = useState({ key: toolKey, text: "" });
  const typedLength = typed.key === toolKey ? typed.text : "";
  const setTypedLength = (next: string | ((text: string) => string)) =>
    setTyped((prev) => {
      const current = prev.key === toolKey ? prev.text : "";
      return { key: toolKey, text: typeof next === "function" ? next(current) : next };
    });
  const [spaceHeld, setSpaceHeld] = useState(false);

  const scale = scalePxPerUnit || 1;
  // Where the next point or wall end is measured from, if a line is being drawn.
  const anchor: Point | null =
    mode !== "walls" ? null : wallTool === "outline" ? (outline[outline.length - 1] ?? null) : wallStart;

  // The point a tracked line runs from: the last point placed while drawing walls, or the
  // first calibration point while measuring scale.
  const trackFrom: Point | null = mode === "scale" ? (calibrationPoints[0] ?? null) : anchor;

  // Inner walls are items, so their centre lines and ends are worked out from position,
  // rotation and length — they're snap targets just like the outline's corners and sides.
  const innerWallLines = furniture
    .filter((f) => f.kind === "wall")
    .map((f) => {
      const half = f.width / scale / 2;
      const r = (f.rotation * Math.PI) / 180;
      return {
        from: { x: f.x - Math.cos(r) * half, y: f.y - Math.sin(r) * half },
        to: { x: f.x + Math.cos(r) * half, y: f.y + Math.sin(r) * half },
        thickness: f.depth / scale,
      };
    });

  // Snapping, strongest first: an existing corner or wall end; then angle tracking — a line
  // from the last point within a few pixels of a 15° step locks to exactly that angle (ending
  // where it meets a wall, or on the grid); then the grid (when on); then anywhere along an
  // existing wall. Clicks land on whole screen pixels, so without tracking a wall meant to be
  // square comes out a fraction of a degree off. Holding Shift places the point exactly
  // where you click.
  function snapPoint(raw: Point, free: boolean): SnappedPoint {
    if (free) return { ...raw, kind: "free" };
    const radius = SNAP_RADIUS / zoom;
    const lines = [...(outline.length > 1 ? polygonPerimeterSegments(outline) : []), ...innerWallLines];

    let nearest: Point | null = null;
    let nearestDist = radius;
    for (const v of [...outline, ...innerWallLines.flatMap((l) => [l.from, l.to])]) {
      const d = distance(raw, v);
      if (d <= nearestDist) {
        nearest = v;
        nearestDist = d;
      }
    }
    if (nearest) return { ...nearest, kind: "point" };

    const from = trackFrom;
    if (from && distance(from, raw) > radius) {
      const step = Math.PI / 12;
      const angle = Math.round(Math.atan2(raw.y - from.y, raw.x - from.x) / step) * step;
      // Exact zeros for square lines, so they stay perfectly square.
      const dx = Math.abs(Math.cos(angle)) < 1e-9 ? 0 : Math.cos(angle);
      const dy = Math.abs(Math.sin(angle)) < 1e-9 ? 0 : Math.sin(angle);
      const along = (raw.x - from.x) * dx + (raw.y - from.y) * dy;
      const offTrack = Math.abs(-(raw.x - from.x) * dy + (raw.y - from.y) * dx);
      if (along > 0 && offTrack <= TRACK_RADIUS / zoom) {
        const onTrack = (t: number): SnappedPoint => ({ x: from.x + dx * t, y: from.y + dy * t, kind: "track", angle });

        // Where the tracked line meets a wall near the pointer.
        let meet: number | null = null;
        for (const line of lines) {
          const ex = line.to.x - line.from.x;
          const ey = line.to.y - line.from.y;
          const denom = dx * ey - dy * ex;
          if (Math.abs(denom) < 1e-9) continue;
          const t = ((line.from.x - from.x) * ey - (line.from.y - from.y) * ex) / denom;
          const u = ((line.from.x - from.x) * dy - (line.from.y - from.y) * dx) / denom;
          if (t > 0 && u >= -1e-9 && u <= 1 + 1e-9 && Math.abs(t - along) <= radius && (meet === null || Math.abs(t - along) < Math.abs(meet - along))) {
            meet = t;
          }
        }
        if (meet !== null) return onTrack(meet);

        if (gridSnap) {
          // Square lines land on the grid line they cross; others step in grid-sized lengths.
          const t =
            dy === 0
              ? (Math.round(raw.x / GRID_MINOR) * GRID_MINOR - from.x) / dx
              : dx === 0
                ? (Math.round(raw.y / GRID_MINOR) * GRID_MINOR - from.y) / dy
                : Math.round(along / GRID_MINOR) * GRID_MINOR;
          if (t > 0) return onTrack(t);
        }
        return onTrack(along);
      }
    }

    if (gridSnap) return { ...snapToGrid(raw), kind: "grid" };

    nearestDist = radius;
    for (const line of lines) {
      const c = closestPointOnSegment(raw, line.from, line.to);
      const d = distance(raw, c);
      if (d <= nearestDist) {
        nearest = c;
        nearestDist = d;
      }
    }
    return nearest ? { ...nearest, kind: "line" } : { ...raw, kind: "free" };
  }

  // Where a typed length ends: that far from the anchor, toward the pointer, in 15° steps
  // (so walls come out square) unless Shift is held.
  function typedEnd(): Point | null {
    const value = Number(typedLength.replace(",", "."));
    if (!anchor || !pointer || !(value > 0)) return null;
    let angle = Math.atan2(pointer.y - anchor.y, pointer.x - anchor.x);
    if (!shiftHeld) angle = Math.round(angle / (Math.PI / 12)) * (Math.PI / 12);
    const lengthPx = toCm(value, unit) / scale;
    return { x: anchor.x + Math.cos(angle) * lengthPx, y: anchor.y + Math.sin(angle) * lengthPx };
  }

  // Adds a point in the Walls tool: the next outline corner, or an inner wall's start or end.
  // Clicking back on the outline's first corner (or its last corner again) closes it and
  // finishes. An inner wall is done once its end is placed — to continue from it, start the
  // next wall on its end, which snaps.
  function placeWallPoint(p: Point) {
    setTypedLength("");
    if (wallTool === "outline") {
      const first = outline[0];
      const last = outline[outline.length - 1];
      if ((outline.length >= 3 && distance(p, first) < 0.5) || (last && distance(p, last) < 0.5)) {
        onFinishDrawing();
        return;
      }
      onOutlineChange([...outline, p]);
      return;
    }
    if (!wallStart) {
      onWallStartChange(p);
    } else if (distance(p, wallStart) < 0.5) {
      onWallStartChange(null);
    } else {
      onDrawWall(wallStart, p);
      onWallStartChange(null);
    }
  }

  // Esc (or right-click) backs out one step: clears a typed length, then drops a wall that's
  // only been started, then finishes drawing.
  function stepBack() {
    if (typedLength) setTypedLength("");
    else if (wallTool === "inner" && wallStart) onWallStartChange(null);
    else onFinishDrawing();
  }

  // While drawing, type a length and press Enter to place the next point exactly. Enter with
  // nothing typed finishes drawing.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Shift") setShiftHeld(e.type === "keydown");
      if (e.type !== "keydown" || mode !== "walls") return;
      const el = document.activeElement;
      if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) return;

      if (e.key === "Escape") {
        stepBack();
        return;
      }
      if (e.key === "Enter" && !typedLength) {
        e.preventDefault();
        onFinishDrawing();
        return;
      }
      if (!anchor) return;
      if (/^[0-9]$/.test(e.key) || ((e.key === "." || e.key === ",") && !/[.,]/.test(typedLength))) {
        e.preventDefault();
        setTypedLength((t) => t + e.key);
      } else if (e.key === "Backspace" && typedLength) {
        e.preventDefault();
        setTypedLength((t) => t.slice(0, -1));
      } else if (e.key === "Enter" && typedLength) {
        e.preventDefault();
        const end = typedEnd();
        if (end) placeWallPoint(end);
      }
    }
    window.addEventListener("keydown", onKey);
    window.addEventListener("keyup", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("keyup", onKey);
    };
  });

  // Hold space to pan from any tool, the way most drawing apps do — otherwise panning
  // means either switching tools or holding the middle mouse button.
  useEffect(() => {
    function down(e: KeyboardEvent) {
      if (e.code !== "Space" || e.repeat) return;
      const el = document.activeElement;
      if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) return;
      e.preventDefault();
      setSpaceHeld(true);
    }
    function up(e: KeyboardEvent) {
      if (e.code === "Space") setSpaceHeld(false);
    }
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, []);
  const [isPanning, setIsPanning] = useState(false);

  const segments = polygonPerimeterSegments(outline);
  const totalPerimeterPx = segments.reduce((sum, seg) => sum + seg.length, 0);
  const wallRuns = mergeCollinearWalls(outline);

  // Every outline wall's length, laid out together so no two labels cover each other: longer
  // walls are placed first and shorter walls' labels move out of their way. Where inner walls
  // meet a wall, each room's stretch gets its own length, with ticks where they divide, and
  // the overall length sits one row further out.
  const wallDimensions = (() => {
    const labels: { key: string; place: { x: number; y: number; angle: number }; text: string; opacity?: number }[] = [];
    const ticks: { key: string; x1: number; y1: number; x2: number; y2: number }[] = [];
    if (outline.length < 2) return { labels, ticks };
    const measure = (px: number) => (scalePxPerUnit ? formatLength(pxToReal(px, scalePxPerUnit), unit) : `${px.toFixed(0)} px`);
    const placed: Point[][] = [];
    const place = (key: string, run: WallRun, text: string, thicknessPx = 0, opacity?: number) => {
      const spot = placeWallLabel(run, outline, text, thicknessPx, placed);
      placed.push(labelBox(spot, text));
      labels.push({ key, place: spot, text, opacity });

      // A label that had to move well away from its wall (crowded short walls) gets a thin
      // leader back to the wall, drawn from the wall to the edge of the text.
      const onWall = closestPointOnSegment(spot, run.from, run.to);
      const usual = WALL_DIM_CLEARANCE + thicknessPx / 2 + WALL_DIM_SIZE / 2;
      if (distance(onWall, spot) > usual + 12) {
        const cos = Math.cos((spot.angle * Math.PI) / 180);
        const sin = Math.sin((spot.angle * Math.PI) / 180);
        const lx = (onWall.x - spot.x) * cos + (onWall.y - spot.y) * sin;
        const ly = -(onWall.x - spot.x) * sin + (onWall.y - spot.y) * cos;
        const hw = (text.length * (MONO_CHAR_WIDTH + WALL_DIM_TRACKING) * WALL_DIM_SIZE) / 2 + 2;
        const k = 1 / Math.max(Math.abs(lx) / hw, Math.abs(ly) / (WALL_DIM_SIZE / 2 + 2));
        const ex = lx * k, ey = ly * k;
        ticks.push({ key: `${key}-leader`, x1: onWall.x, y1: onWall.y, x2: spot.x + ex * cos - ey * sin, y2: spot.y + ex * sin + ey * cos });
      }
    };

    const firstRow: { key: string; run: WallRun }[] = [];
    const overalls: { key: string; run: WallRun }[] = [];
    wallRuns.forEach((run, i) => {
      const spans = roomSpans(run, innerWallLines);
      if (spans.length <= 1) {
        firstRow.push({ key: `wall-${i}`, run });
        return;
      }
      const ux = (run.to.x - run.from.x) / run.length;
      const uy = (run.to.y - run.from.y) / run.length;
      const at = (t: number) => ({ x: run.from.x + ux * t, y: run.from.y + uy * t });
      const out = outwardNormal(run, outline);
      const reach = WALL_DIM_CLEARANCE + WALL_DIM_SIZE + 2;
      spans.forEach((span, k) => {
        firstRow.push({ key: `wall-${i}-${k}`, run: { from: at(span.start), to: at(span.end), length: span.end - span.start } });
      });
      spans
        .flatMap((span) => [span.start, span.end])
        .filter((t) => t > 0.5 && t < run.length - 0.5)
        .forEach((t, k) => {
          const p = at(t);
          ticks.push({ key: `tick-${i}-${k}`, x1: p.x + out.x * 3, y1: p.y + out.y * 3, x2: p.x + out.x * reach, y2: p.y + out.y * reach });
        });
      overalls.push({ key: `wall-${i}-overall`, run });
    });
    firstRow.sort((a, b) => b.run.length - a.run.length).forEach(({ key, run }) => place(key, run, measure(run.length)));
    overalls.forEach(({ key, run }) => place(key, run, measure(run.length), 2 * (WALL_DIM_SIZE + 6), 0.7));
    return { labels, ticks };
  })();

  useImperativeHandle(ref, () => ({
    exportPng: () => {
      if (svgRef.current) {
        const perimeterCm = scalePxPerUnit ? pxToReal(totalPerimeterPx, scalePxPerUnit) : undefined;
        exportSvgAsPng(svgRef.current, VIEW_W, VIEW_H, { roomName, unit, scalePxPerUnit, perimeterCm });
      }
    },
  }));

  function toSvgPoint(e: React.MouseEvent): Point {
    const svg = svgRef.current;
    if (!svg) return { x: 0, y: 0 };
    const rect = svg.getBoundingClientRect();
    return {
      x: ((e.clientX - rect.left) / rect.width) * VIEW_W,
      y: ((e.clientY - rect.top) / rect.height) * VIEW_H,
    };
  }

  function snapToGrid(p: Point): Point {
    return {
      x: Math.round(p.x / GRID_MINOR) * GRID_MINOR,
      y: Math.round(p.y / GRID_MINOR) * GRID_MINOR,
    };
  }

  function handleSvgClick(e: React.MouseEvent) {
    if (mode === "comment") {
      onAddComment(toSvgPoint(e));
      return;
    }
    const snapped = snapPoint(toSvgPoint(e), e.shiftKey);
    const p = { x: snapped.x, y: snapped.y };
    if (mode === "walls") {
      placeWallPoint(p);
    } else if (mode === "scale") {
      const next = [...calibrationPoints, p];
      if (next.length === 2) {
        // Asked in the room's own unit, so a length read off a drawing in mm isn't taken as cm.
        // Suggests what the line measures at the current scale, if one is set.
        const measuredPx = distance(next[0], next[1]);
        const current = scalePxPerUnit ? String(Number(fromCm(measuredPx * scalePxPerUnit, unit).toFixed(unit === "mm" ? 0 : unit === "cm" ? 1 : 3))) : "";
        const answer = window.prompt(`Real length of the line you just measured, in ${unit}:`, current);
        const realLength = Number((answer ?? "").trim().replace(",", "."));
        if (realLength > 0) {
          onCalibrate(measuredPx, toCm(realLength, unit));
        }
        setCalibrationPoints([]);
      } else {
        setCalibrationPoints(next);
      }
    } else if (!didPan.current) {
      // A drag that panned the canvas shouldn't also clear the selection.
      onSelectFurniture(null);
      onSelectWall(null);
    }
  }

  function startDragFurniture(e: React.MouseEvent, item: Furniture) {
    if (spaceHeld) return;
    if (mode !== "arrange" && mode !== "select") return;
    e.stopPropagation();
    // Keep any selected wall — it's the Side view's viewing context, not a rival selection.
    onSelectFurniture(item.id);
    if (mode !== "arrange") return;
    const p = toSvgPoint(e);
    setDragId(item.id);
    setDragOffset({ x: p.x - item.x, y: p.y - item.y });
  }

  function handleScrollMouseDown(e: React.MouseEvent) {
    // Shift-clicking a free point shouldn't also select text on the page.
    if (e.shiftKey && (mode === "walls" || mode === "scale")) e.preventDefault();
    if (mode !== "select" && e.button !== 1 && !spaceHeld) return;
    e.preventDefault();
    const container = scrollRef.current;
    if (!container) return;
    panState.current = { x: e.clientX, y: e.clientY, scrollLeft: container.scrollLeft, scrollTop: container.scrollTop };
    didPan.current = false;
    setIsPanning(true);
  }

  function handleMouseMove(e: React.MouseEvent) {
    if (panState.current && scrollRef.current) {
      const dx = e.clientX - panState.current.x;
      const dy = e.clientY - panState.current.y;
      if (Math.abs(dx) > 3 || Math.abs(dy) > 3) didPan.current = true;
      scrollRef.current.scrollLeft = panState.current.scrollLeft - dx;
      scrollRef.current.scrollTop = panState.current.scrollTop - dy;
      return;
    }
    const p = toSvgPoint(e);
    onCursorMove(p);
    setPointer(p);
    setShiftHeld(e.shiftKey);
    setCrosshair(mode === "walls" || mode === "scale" ? snapPoint(p, e.shiftKey) : { ...p, kind: "free" });
    if (!dragId) return;
    onFurnitureChange(dragId, { x: p.x - dragOffset.x, y: p.y - dragOffset.y });
  }

  function handleMouseUp() {
    setDragId(null);
    panState.current = null;
    setIsPanning(false);
  }

  function rotateSelected(delta: number) {
    if (!selectedFurnitureId) return;
    const item = furniture.find((f) => f.id === selectedFurnitureId);
    if (!item) return;
    onFurnitureChange(selectedFurnitureId, { rotation: snapAngle(item.rotation + delta) });
  }

  function fitToView() {
    const container = scrollRef.current;
    if (!container) {
      onZoomChange(() => 0.6);
      return;
    }
    const fit = Math.min(container.clientWidth / VIEW_W, container.clientHeight / VIEW_H) * 0.94;
    onZoomChange(() => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, fit)));
  }

  function handleWheel(e: React.WheelEvent) {
    e.preventDefault();
    onZoomChange((z) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z - e.deltaY * 0.001)));
  }

  return (
    <div className="floorplan-canvas">
      <div
        ref={scrollRef}
        className={
          mode === "select" || spaceHeld ? "floorplan-canvas__scroll floorplan-canvas__scroll--pan" : "floorplan-canvas__scroll"
        }
        onWheel={handleWheel}
        onMouseDown={handleScrollMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        style={isPanning ? { cursor: "grabbing" } : undefined}
      >
        <svg
          ref={svgRef}
          viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
          className="floorplan-canvas__svg"
          style={{ width: VIEW_W * zoom, height: VIEW_H * zoom, cursor: mode === "comment" ? "crosshair" : undefined }}
          onClick={handleSvgClick}
          onContextMenu={(e) => {
            if (mode !== "walls") return;
            e.preventDefault();
            stepBack();
          }}
          onMouseLeave={() => {
            onCursorMove(null);
            setCrosshair(null);
          }}
        >
          <defs>
            <pattern id="grid" width="20" height="20" patternUnits="userSpaceOnUse">
              <path d="M 20 0 L 0 0 0 20" fill="none" stroke="var(--color-grid)" strokeWidth="0.5" opacity="0.5" />
            </pattern>
            <pattern id="gridMajor" width="100" height="100" patternUnits="userSpaceOnUse">
              <path d="M 100 0 L 0 0 0 100" fill="none" stroke="var(--color-grid)" strokeWidth="1" opacity="0.8" />
            </pattern>
            <filter id="dropShadow" x="-50%" y="-50%" width="200%" height="200%">
              <feDropShadow dx="0" dy="3" stdDeviation="3" floodColor="#000000" floodOpacity="0.45" />
            </filter>
          </defs>
          <rect x="0" y="0" width={VIEW_W} height={VIEW_H} fill="var(--color-canvas)" />
          <rect x="0" y="0" width={VIEW_W} height={VIEW_H} fill="url(#grid)" />
          <rect x="0" y="0" width={VIEW_W} height={VIEW_H} fill="url(#gridMajor)" />

          {imageUrl && <image href={imageUrl} x="0" y="0" width={VIEW_W} height={VIEW_H} opacity="0.35" />}

          {outline.length > 1 && (
            <polygon
              points={outline.map((p) => `${p.x},${p.y}`).join(" ")}
              fill="var(--color-accent-soft)"
              fillOpacity="0.06"
              stroke="var(--color-line)"
              strokeWidth="2"
            />
          )}

          {outline.length > 1 && (
            <g>
              {wallDimensions.ticks.map((t) => (
                <line key={t.key} x1={t.x1} y1={t.y1} x2={t.x2} y2={t.y2} stroke="var(--color-line-soft)" strokeWidth={0.8} opacity={0.8} />
              ))}
              {wallDimensions.labels.map((l) => (
                <DimText key={l.key} place={l.place} text={l.text} opacity={l.opacity} />
              ))}
            </g>
          )}

          {outline.length > 1 &&
            wallRuns.map((run, i) => {
              const isSelectedWall = i === selectedWallIndex;
              const wallLabel = scalePxPerUnit
                ? formatLength(pxToReal(run.length, scalePxPerUnit), unit)
                : `${run.length.toFixed(0)} px`;
              return (
                <g key={`wall-${i}`}>
                  {isSelectedWall && (
                    <line
                      x1={run.from.x}
                      y1={run.from.y}
                      x2={run.to.x}
                      y2={run.to.y}
                      stroke="var(--color-accent)"
                      strokeWidth="6"
                      strokeLinecap="round"
                      opacity="0.9"
                    />
                  )}
                  <line
                    x1={run.from.x}
                    y1={run.from.y}
                    x2={run.to.x}
                    y2={run.to.y}
                    stroke="transparent"
                    strokeWidth="16"
                    strokeLinecap="round"
                    style={{
                      cursor: mode === "select" ? "pointer" : undefined,
                      pointerEvents: mode === "select" ? "stroke" : "none",
                    }}
                    onClick={(e) => {
                      e.stopPropagation();
                      onSelectWall(isSelectedWall ? null : i);
                    }}
                  >
                    <title>{`Wall ${i + 1} — ${wallLabel}. Click to select, then switch to Side view.`}</title>
                  </line>
                </g>
              );
            })}

          {outline.map((p, i) => (
            <circle key={i} cx={p.x} cy={p.y} r="4" fill="var(--color-charcoal)" />
          ))}

          {calibrationPoints.map((p, i) => (
            <circle key={i} cx={p.x} cy={p.y} r="5" fill="var(--color-danger)" />
          ))}

          {furniture.map((item) => {
            const isSelected = item.id === selectedFurnitureId;
            return (
              <g
                key={item.id}
                className="floorplan-canvas__item-group"
                transform={`translate(${item.x} ${item.y}) rotate(${item.rotation})`}
                onMouseDown={(e) => startDragFurniture(e, item)}
                style={{ cursor: mode === "arrange" ? "move" : mode === "select" ? "pointer" : "default" }}
                filter="url(#dropShadow)"
              >
                <title>{`${item.label} — L × D × H ${formatDimensions([item.width, item.depth, item.height], unit)}`}</title>
                <FurnitureGlyph item={item} scalePxPerUnit={scalePxPerUnit} />
                {isSelected && (
                  <rect
                    x={-item.width / 2 / (scalePxPerUnit || 1) - 3}
                    y={-item.depth / 2 / (scalePxPerUnit || 1) - 3}
                    width={item.width / (scalePxPerUnit || 1) + 6}
                    height={item.depth / (scalePxPerUnit || 1) + 6}
                    fill="none"
                    stroke="var(--color-accent)"
                    strokeWidth="1.5"
                    className="floorplan-canvas__marching"
                  />
                )}
              </g>
            );
          })}

          {/* Item names are drawn on the item, laid along its longer side and rotating with it
              like a label on a technical drawing — turned so they never read upside down. Names
              size (and only if they must, wrap) to the item's length and thickness. Dimensions
              follow inside when there's room; otherwise they appear just outside the item while
              it's selected. Styling is set as attributes so it survives PNG export. */}
          {showLabels && (
            <g pointerEvents="none">
              {furniture.map((item) => {
                const origin = itemOrigin(item);
                const isSelected = item.id === selectedFurnitureId;
                const frame = labelFrame(item, scalePxPerUnit);

                const name = fitLines(item.label.trim().split(/\s+/), frame.length, frame.thickness, NAME_MAX_SIZE, NAME_MIN_SIZE);
                const nameBlock = name.lines.length * name.size * LINE_HEIGHT;

                const dimsTokens = [
                  ...(origin ? [`${origin.toUpperCase()} ·`] : []),
                  ...dimensionTokens([item.width, item.depth, item.height], unit),
                ];
                const gap = 2.5;
                const dims = fitLines(dimsTokens, frame.length, frame.thickness - nameBlock - gap, Math.min(8.5, name.size * 0.85), 5.5);
                const dimsInside = name.fits && dims.fits;
                const dimsBlock = dimsInside ? gap + dims.lines.length * dims.size * LINE_HEIGHT : 0;

                const top = -(nameBlock + dimsBlock) / 2;
                const lineY = (i: number, size: number, offset: number) => offset + (i + 0.5) * size * LINE_HEIGHT;
                // A dark halo sits behind light text so it stays legible on any item colour.
                const halo = { paintOrder: "stroke" as const, stroke: "var(--color-canvas)", strokeLinejoin: "round" as const };

                return (
                  <g
                    key={item.id}
                    className="floorplan-canvas__item-label"
                    transform={`translate(${frame.cx} ${frame.cy}) rotate(${frame.angle})`}
                  >
                    <text
                      textAnchor="middle"
                      dominantBaseline="central"
                      className="mono"
                      fontFamily="monospace"
                      fontSize={name.size}
                      fontWeight={isSelected ? 700 : 600}
                      fill={isSelected ? "var(--color-accent)" : "var(--color-charcoal)"}
                      strokeWidth={Math.max(1.4, name.size * 0.3)}
                      strokeOpacity={0.75}
                      {...halo}
                    >
                      {name.lines.map((line, i) => (
                        <tspan key={i} x={0} y={lineY(i, name.size, top)}>
                          {line}
                        </tspan>
                      ))}
                    </text>

                    {/* Walls are too thin for dimensions inside, so theirs always show beside them. */}
                    {(dimsInside || isSelected || item.kind === "wall") && (
                      <text
                        textAnchor="middle"
                        dominantBaseline="central"
                        className="mono"
                        fontFamily="monospace"
                        fontSize={dimsInside ? dims.size : 8}
                        fontWeight={500}
                        fill="var(--color-charcoal)"
                        opacity={isSelected ? 1 : 0.88}
                        strokeWidth={Math.max(1.6, (dimsInside ? dims.size : 8) * 0.34)}
                        strokeOpacity={0.8}
                        {...halo}
                      >
                        {dimsInside ? (
                          dims.lines.map((line, i) => (
                            <tspan key={i} x={0} y={lineY(i, dims.size, top + nameBlock + gap)}>
                              {line}
                            </tspan>
                          ))
                        ) : (
                          <tspan x={0} y={frame.thickness / 2 + 9}>
                            {dimsTokens.join(" ")}
                          </tspan>
                        )}
                      </text>
                    )}
                  </g>
                );
              })}
            </g>
          )}

          {/* The line being drawn, from the last point to the pointer — or to a typed length —
              measuring as it goes. Inner walls preview at their real thickness. */}
          {anchor &&
            (() => {
              const end = typedEnd() ?? (crosshair ? { x: crosshair.x, y: crosshair.y } : null);
              const length = end ? distance(anchor, end) : 0;
              const thicknessPx = wallTool === "inner" ? innerWallThickness / scale : 0;
              const text = typedLength
                ? `${typedLength}▏${unit} ↵`
                : scalePxPerUnit
                  ? formatLength(pxToReal(length, scalePxPerUnit), unit)
                  : `${length.toFixed(0)} px`;
              const label = end && length > 0.5 ? placeWallLabel({ from: anchor, to: end, length }, outline, text, thicknessPx) : null;
              return (
                <g pointerEvents="none">
                  {end && length > 0.5 && wallTool === "inner" && (
                    <rect
                      x={-length / 2}
                      y={-thicknessPx / 2}
                      width={length}
                      height={Math.max(thicknessPx, 1)}
                      transform={`translate(${(anchor.x + end.x) / 2} ${(anchor.y + end.y) / 2}) rotate(${(Math.atan2(end.y - anchor.y, end.x - anchor.x) * 180) / Math.PI})`}
                      fill="var(--color-accent)"
                      fillOpacity={0.22}
                      stroke="var(--color-accent)"
                      strokeWidth={1}
                      strokeDasharray="4 3"
                    />
                  )}
                  {end && length > 0.5 && wallTool === "outline" && (
                    <line
                      x1={anchor.x}
                      y1={anchor.y}
                      x2={end.x}
                      y2={end.y}
                      stroke="var(--color-accent)"
                      strokeWidth={1.5}
                      strokeDasharray="6 4"
                    />
                  )}
                  <circle cx={anchor.x} cy={anchor.y} r={3.5} fill="var(--color-accent)" />
                  {label && (
                    <text
                      transform={`translate(${label.x} ${label.y}) rotate(${label.angle})`}
                      fontFamily="monospace"
                      fontSize={WALL_DIM_SIZE}
                      fontWeight={typedLength ? 700 : 500}
                      fill="var(--color-accent)"
                      textAnchor="middle"
                      dominantBaseline="central"
                      paintOrder="stroke"
                      stroke="var(--color-canvas)"
                      strokeWidth={3}
                      strokeLinejoin="round"
                    >
                      {text}
                    </text>
                  )}
                </g>
              );
            })()}

          {/* Precision crosshair. A square marks a lock onto a corner or wall end, a cross a
              lock onto a wall line. */}
          {crosshair && (mode === "walls" || mode === "scale" || mode === "comment") && (
            <g className="floorplan-canvas__crosshair" pointerEvents="none">
              <line x1={crosshair.x} y1="0" x2={crosshair.x} y2={VIEW_H} />
              <line x1="0" y1={crosshair.y} x2={VIEW_W} y2={crosshair.y} />
              <circle cx={crosshair.x} cy={crosshair.y} r="3.5" />
              {crosshair.kind === "track" && crosshair.angle !== undefined && trackFrom && (
                <line
                  x1={trackFrom.x}
                  y1={trackFrom.y}
                  x2={trackFrom.x + Math.cos(crosshair.angle) * 4000}
                  y2={trackFrom.y + Math.sin(crosshair.angle) * 4000}
                  style={{ opacity: 0.7, strokeDasharray: "2 4" }}
                />
              )}
              {mode === "walls" &&
                wallTool === "outline" &&
                outline.length >= 3 &&
                crosshair.kind === "point" &&
                distance(crosshair, outline[0]) < 0.5 && (
                  <text
                    x={crosshair.x + 12 / zoom}
                    y={crosshair.y - 12 / zoom}
                    fontFamily="monospace"
                    fontSize={11 / zoom}
                    fontWeight={600}
                    fill="var(--color-accent)"
                    paintOrder="stroke"
                    stroke="var(--color-canvas)"
                    strokeWidth={3 / zoom}
                    strokeLinejoin="round"
                  >
                    Click to close outline
                  </text>
                )}
              {crosshair.kind === "point" && (
                <rect
                  x={crosshair.x - 6 / zoom}
                  y={crosshair.y - 6 / zoom}
                  width={12 / zoom}
                  height={12 / zoom}
                  fill="none"
                  stroke="var(--color-accent)"
                  strokeWidth={1.5 / zoom}
                />
              )}
              {crosshair.kind === "line" && (
                <path
                  d={`M ${crosshair.x - 5 / zoom} ${crosshair.y - 5 / zoom} L ${crosshair.x + 5 / zoom} ${crosshair.y + 5 / zoom} M ${crosshair.x - 5 / zoom} ${crosshair.y + 5 / zoom} L ${crosshair.x + 5 / zoom} ${crosshair.y - 5 / zoom}`}
                  fill="none"
                  stroke="var(--color-accent)"
                  strokeWidth={1.5 / zoom}
                />
              )}
            </g>
          )}

          {comments.map((c, i) => (
            <g
              key={c.id}
              transform={`translate(${c.x} ${c.y})`}
              className="floorplan-canvas__comment-pin"
              onMouseDown={(e) => e.stopPropagation()}
              onClick={(e) => e.stopPropagation()}
            >
              <title>{`${c.author ? c.author + ": " : ""}${c.text}`}</title>
              <circle r="11" fill={c.resolved ? "var(--color-line-soft)" : "var(--color-accent)"} stroke="var(--color-paper)" strokeWidth="2" />
              <text textAnchor="middle" dy="4" fontSize="11" fill="var(--color-paper)" className="mono">
                {i + 1}
              </text>
            </g>
          ))}
        </svg>
      </div>

      <div className="canvas-dock canvas-dock--left">
        <button className="canvas-dock__btn" onClick={() => onZoomChange((z) => Math.max(MIN_ZOOM, z - 0.15))} title="Zoom out">
          −
        </button>
        <button className="canvas-dock__btn canvas-dock__btn--wide" onClick={fitToView} title="Fit the plan to the window">
          Fit
        </button>
        <button className="canvas-dock__btn" onClick={() => onZoomChange((z) => Math.min(MAX_ZOOM, z + 0.15))} title="Zoom in">
          +
        </button>
      </div>

      {selectedFurnitureId && (
        <div className="canvas-dock canvas-dock--right">
          <button className="canvas-dock__btn" onClick={() => rotateSelected(-15)} title="Rotate 15° anticlockwise">
            ⟲
          </button>
          <span className="canvas-dock__readout mono">
            {(((furniture.find((f) => f.id === selectedFurnitureId)?.rotation ?? 0) % 360) + 360) % 360}°
          </span>
          <button className="canvas-dock__btn" onClick={() => rotateSelected(15)} title="Rotate 15° clockwise">
            ⟳
          </button>
        </div>
      )}
    </div>
  );
});

export default FloorplanCanvas;
