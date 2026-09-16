import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import type { Point, WallRun } from "../lib/geometry";
import { distance, mergeCollinearWalls, pointInPolygon, polygonPerimeterSegments, pxToReal, snapAngle } from "../lib/geometry";
import type { Comment, Furniture } from "../lib/types";
import { itemColor, itemOrigin } from "../lib/types";
import type { Unit } from "../lib/units";
import { dimensionTokens, formatDimensions, formatLength } from "../lib/units";
import { exportSvgAsPng } from "../lib/export";

type Mode = "select" | "walls" | "scale" | "arrange" | "comment";

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
  onCalibrate: (pixelDistance: number, realLength: number) => void;
  onFurnitureChange: (id: string, patch: Partial<Furniture>) => void;
  onSelectFurniture: (id: string | null) => void;
  onAddComment: (point: Point) => void;
  selectedWallIndex: number | null;
  onSelectWall: (index: number | null) => void;
  zoom: number;
  onZoomChange: (updater: (zoom: number) => number) => void;
  onCursorMove: (point: Point | null) => void;
  showLabels: boolean;
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

// Where a wall's length label goes: outside the room, parallel to the wall and clear of its
// line, like a dimension on a drawing. A label longer than a short wall would run into the
// neighbouring walls, so it slides along its wall — then steps further out — until every
// wall line is at least WALL_DIM_MIN_GAP away.
function placeWallLabel(run: WallRun, outline: Point[], text: string) {
  const len = run.length || 1;
  const ux = (run.to.x - run.from.x) / len;
  const uy = (run.to.y - run.from.y) / len;
  const midX = (run.from.x + run.to.x) / 2;
  const midY = (run.from.y + run.to.y) / 2;
  let nx = -uy;
  let ny = ux;
  if (pointInPolygon({ x: midX + nx * 3, y: midY + ny * 3 }, outline)) {
    nx = -nx;
    ny = -ny;
  }

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

  const base = WALL_DIM_CLEARANCE + hh;
  for (const out of [0, 8, 16]) {
    for (let step = 0; step * 3 <= hw; step++) {
      for (const along of step === 0 ? [0] : [step * 3, -step * 3]) {
        const x = midX + nx * (base + out) + ux * along;
        const y = midY + ny * (base + out) + uy * along;
        if (clearance(x, y) >= WALL_DIM_MIN_GAP) return { x, y, angle };
      }
    }
  }
  return { x: midX + nx * base, y: midY + ny * base, angle };
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
  const [crosshair, setCrosshair] = useState<Point | null>(null);
  const [spaceHeld, setSpaceHeld] = useState(false);

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
    const p = snapToGrid(toSvgPoint(e));
    if (mode === "walls") {
      onOutlineChange([...outline, p]);
    } else if (mode === "scale") {
      const next = [...calibrationPoints, p];
      if (next.length === 2) {
        const realLengthStr = window.prompt("Enter the real-world length of this segment (cm):", "100");
        const realLength = Number(realLengthStr);
        if (realLength > 0) {
          onCalibrate(distance(next[0], next[1]), realLength);
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
    setCrosshair(mode === "walls" || mode === "scale" ? snapToGrid(p) : p);
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

          {outline.length > 1 &&
            wallRuns.map((run, i) => {
              const text = scalePxPerUnit ? formatLength(pxToReal(run.length, scalePxPerUnit), unit) : `${run.length.toFixed(0)} px`;
              const place = placeWallLabel(run, outline, text);
              return (
                <text
                  key={i}
                  transform={`translate(${place.x} ${place.y}) rotate(${place.angle})`}
                  className="mono floorplan-canvas__dim-label"
                  fontFamily="monospace"
                  fontSize={WALL_DIM_SIZE}
                  letterSpacing={`${WALL_DIM_TRACKING}em`}
                  fill="var(--color-line-soft)"
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
            })}

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

                    {(dimsInside || isSelected) && (
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

          {/* Precision crosshair — snaps to the grid in the tools where clicks snap. */}
          {crosshair && (mode === "walls" || mode === "scale" || mode === "comment") && (
            <g className="floorplan-canvas__crosshair" pointerEvents="none">
              <line x1={crosshair.x} y1="0" x2={crosshair.x} y2={VIEW_H} />
              <line x1="0" y1={crosshair.y} x2={VIEW_W} y2={crosshair.y} />
              <circle cx={crosshair.x} cy={crosshair.y} r="3.5" />
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
