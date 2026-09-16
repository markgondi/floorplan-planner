import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import type { Point } from "../lib/geometry";
import { distance, mergeCollinearWalls, polygonPerimeterSegments, pxToReal, snapAngle } from "../lib/geometry";
import type { Comment, Furniture } from "../lib/types";
import { KIND_COLOR, itemOrigin } from "../lib/types";
import type { Unit } from "../lib/units";
import { formatLength } from "../lib/units";
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
      fill={KIND_COLOR[item.kind]}
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
          fill={KIND_COLOR[item.kind]}
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

// How far below its centre an item's drawing reaches once rotated, so its label clears it.
// Doors draw their open leaf and swing arc outside their footprint, so they get a taller box.
function itemBottomExtent(item: Furniture, scalePxPerUnit: number): number {
  const s = scalePxPerUnit || 1;
  const hw = item.width / s / 2;
  const hd = item.depth / s / 2;
  const [y0, y1] = item.kind === "door" ? [-2 * hw, Math.max(hd, 1.25)] : [-hd, hd];
  const rad = (item.rotation * Math.PI) / 180;
  const sin = Math.sin(rad);
  const cos = Math.cos(rad);
  return Math.max(...[-hw, hw].flatMap((x) => [y0, y1].map((y) => x * sin + y * cos)));
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
              const dx = run.to.x - run.from.x;
              const dy = run.to.y - run.from.y;
              const len = Math.hypot(dx, dy) || 1;
              const nx = -dy / len;
              const ny = dx / len;
              const offset = 16;
              const midX = (run.from.x + run.to.x) / 2 + nx * offset;
              const midY = (run.from.y + run.to.y) / 2 + ny * offset;
              const realLength = scalePxPerUnit ? pxToReal(run.length, scalePxPerUnit) : run.length;
              return (
                <text key={i} x={midX} y={midY} className="mono floorplan-canvas__dim-label" textAnchor="middle">
                  {scalePxPerUnit ? formatLength(realLength, unit) : `${run.length.toFixed(0)} px`}
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
                <title>{`${item.label} — ${formatLength(item.width, unit)} x ${formatLength(item.depth, unit)}`}</title>
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

          {/* Item names live in their own upright layer, so a rotated item's label stays
              readable and every placed item says what it is and which preset it came from.
              Styling is set as attributes rather than CSS classes so it survives PNG export. */}
          {showLabels && (
            <g pointerEvents="none">
              {furniture.map((item) => {
                const labelY = item.y + itemBottomExtent(item, scalePxPerUnit) + 13;
                const origin = itemOrigin(item);
                const isSelected = item.id === selectedFurnitureId;
                const dims = `${formatLength(item.width, unit)} × ${formatLength(item.depth, unit)}`;
                return (
                  <g key={item.id} className="floorplan-canvas__item-label">
                    <text
                      x={item.x}
                      y={labelY}
                      textAnchor="middle"
                      className="mono"
                      fontFamily="monospace"
                      fontSize="10"
                      fontWeight={isSelected ? 700 : 500}
                      fill={isSelected ? "var(--color-accent)" : "var(--color-charcoal-soft)"}
                      paintOrder="stroke"
                      stroke="var(--color-canvas)"
                      strokeWidth="3"
                      strokeLinejoin="round"
                    >
                      {item.label}
                    </text>
                    <text
                      x={item.x}
                      y={labelY + 11}
                      textAnchor="middle"
                      className="mono"
                      fontFamily="monospace"
                      fontSize="8.5"
                      fill="var(--color-line-soft)"
                      opacity={isSelected ? 0.9 : 0.6}
                      paintOrder="stroke"
                      stroke="var(--color-canvas)"
                      strokeWidth="2.5"
                      strokeLinejoin="round"
                    >
                      {origin ? `${origin.toUpperCase()} · ${dims}` : dims}
                    </text>
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
