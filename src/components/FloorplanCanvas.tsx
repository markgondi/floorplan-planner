import { forwardRef, useImperativeHandle, useRef, useState } from "react";
import type { Point } from "../lib/geometry";
import { distance, polygonPerimeterSegments, pxToReal, snapAngle } from "../lib/geometry";
import type { Furniture } from "../lib/types";
import type { Unit } from "../lib/units";
import { formatLength } from "../lib/units";
import { exportSvgAsPng } from "../lib/export";

type Mode = "trace" | "calibrate" | "place" | "pan";

interface FloorplanCanvasProps {
  roomName: string;
  outline: Point[];
  scalePxPerUnit: number;
  unit: Unit;
  furniture: Furniture[];
  selectedFurnitureId: string | null;
  imageUrl: string | null;
  mode: Mode;
  onOutlineChange: (points: Point[]) => void;
  onCalibrate: (pixelDistance: number, realLength: number) => void;
  onFurnitureChange: (id: string, patch: Partial<Furniture>) => void;
  onSelectFurniture: (id: string | null) => void;
}

export interface FloorplanCanvasHandle {
  exportPng: () => void;
}

const VIEW_W = 1600;
const VIEW_H = 1100;
const MIN_ZOOM = 0.25;
const MAX_ZOOM = 4;

function FurnitureGlyph({ item, scalePxPerUnit }: { item: Furniture; scalePxPerUnit: number }) {
  const wPx = item.width / (scalePxPerUnit || 1);
  const dPx = item.depth / (scalePxPerUnit || 1);
  const x = -wPx / 2;
  const y = -dPx / 2;

  if (item.kind === "screen") {
    const bezel = Math.min(dPx * 0.18, 6);
    return (
      <>
        <rect x={x} y={y} width={wPx} height={dPx} rx={dPx * 0.12} fill="url(#screenBezel)" stroke="var(--color-line)" strokeWidth="1.2" />
        <rect
          x={x + bezel}
          y={y + bezel}
          width={wPx - bezel * 2}
          height={dPx - bezel * 2}
          rx={2}
          fill="url(#screenGlass)"
        />
      </>
    );
  }

  if (item.kind === "shelf") {
    const shelfCount = Math.max(2, Math.round(wPx / 40));
    const slats = Array.from({ length: shelfCount });
    return (
      <>
        <rect x={x} y={y} width={wPx} height={dPx} fill="url(#shelfWood)" stroke="var(--color-line)" strokeWidth="1.2" />
        {slats.map((_, i) => {
          if (i === 0) return null;
          const sx = x + (wPx / shelfCount) * i;
          return <line key={i} x1={sx} y1={y} x2={sx} y2={y + dPx} stroke="var(--color-charcoal)" strokeOpacity="0.25" strokeWidth="1" />;
        })}
      </>
    );
  }

  if (item.kind === "bench") {
    return (
      <>
        <rect x={x} y={y} width={wPx} height={dPx} rx={3} fill="url(#benchWood)" stroke="var(--color-line)" strokeWidth="1.2" />
        {Array.from({ length: Math.max(2, Math.round(wPx / 30)) - 1 }).map((_, i, arr) => {
          const sx = x + (wPx / (arr.length + 1)) * (i + 1);
          return <line key={i} x1={sx} y1={y + 2} x2={sx} y2={y + dPx - 2} stroke="var(--color-charcoal)" strokeOpacity="0.15" strokeWidth="1" />;
        })}
      </>
    );
  }

  return <rect x={x} y={y} width={wPx} height={dPx} fill="url(#genericFill)" stroke="var(--color-line)" strokeWidth="1.2" />;
}

const FloorplanCanvas = forwardRef<FloorplanCanvasHandle, FloorplanCanvasProps>(function FloorplanCanvas(
  {
    roomName,
    outline,
    scalePxPerUnit,
    unit,
    furniture,
    selectedFurnitureId,
    imageUrl,
    mode,
    onOutlineChange,
    onCalibrate,
    onFurnitureChange,
    onSelectFurniture,
  },
  ref,
) {
  const svgRef = useRef<SVGSVGElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [calibrationPoints, setCalibrationPoints] = useState<Point[]>([]);
  const [dragId, setDragId] = useState<string | null>(null);
  const [dragOffset, setDragOffset] = useState<Point>({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(0.6);
  const [cursorPos, setCursorPos] = useState<Point | null>(null);
  const panState = useRef<{ x: number; y: number; scrollLeft: number; scrollTop: number } | null>(null);
  const [isPanning, setIsPanning] = useState(false);

  useImperativeHandle(ref, () => ({
    exportPng: () => {
      if (svgRef.current) {
        exportSvgAsPng(svgRef.current, VIEW_W, VIEW_H, { roomName, unit, scalePxPerUnit });
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

  function handleSvgClick(e: React.MouseEvent) {
    if (mode === "pan") return;
    const p = toSvgPoint(e);
    if (mode === "trace") {
      onOutlineChange([...outline, p]);
    } else if (mode === "calibrate") {
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
    } else {
      onSelectFurniture(null);
    }
  }

  function startDragFurniture(e: React.MouseEvent, item: Furniture) {
    e.stopPropagation();
    if (mode !== "place") return;
    onSelectFurniture(item.id);
    const p = toSvgPoint(e);
    setDragId(item.id);
    setDragOffset({ x: p.x - item.x, y: p.y - item.y });
  }

  function handleScrollMouseDown(e: React.MouseEvent) {
    if (mode !== "pan" && e.button !== 1) return;
    e.preventDefault();
    const container = scrollRef.current;
    if (!container) return;
    panState.current = { x: e.clientX, y: e.clientY, scrollLeft: container.scrollLeft, scrollTop: container.scrollTop };
    setIsPanning(true);
  }

  function handleMouseMove(e: React.MouseEvent) {
    if (panState.current && scrollRef.current) {
      const dx = e.clientX - panState.current.x;
      const dy = e.clientY - panState.current.y;
      scrollRef.current.scrollLeft = panState.current.scrollLeft - dx;
      scrollRef.current.scrollTop = panState.current.scrollTop - dy;
      return;
    }
    const p = toSvgPoint(e);
    setCursorPos(p);
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

  function handleWheel(e: React.WheelEvent) {
    e.preventDefault();
    setZoom((z) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z - e.deltaY * 0.001)));
  }

  const segments = polygonPerimeterSegments(outline);
  const realWidthPx = scalePxPerUnit ? pxToReal(VIEW_W, scalePxPerUnit) : null;

  return (
    <div className="floorplan-canvas">
      <div
        ref={scrollRef}
        className={mode === "pan" ? "floorplan-canvas__scroll floorplan-canvas__scroll--pan" : "floorplan-canvas__scroll"}
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
          style={{ width: VIEW_W * zoom, height: VIEW_H * zoom }}
          onClick={handleSvgClick}
          onMouseLeave={() => setCursorPos(null)}
        >
          <defs>
            <pattern id="grid" width="20" height="20" patternUnits="userSpaceOnUse">
              <path d="M 20 0 L 0 0 0 20" fill="none" stroke="var(--color-grid)" strokeWidth="0.5" opacity="0.5" />
            </pattern>
            <pattern id="gridMajor" width="100" height="100" patternUnits="userSpaceOnUse">
              <path d="M 100 0 L 0 0 0 100" fill="none" stroke="var(--color-grid)" strokeWidth="1" opacity="0.8" />
            </pattern>
            <linearGradient id="screenBezel" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#3a3630" />
              <stop offset="100%" stopColor="#161412" />
            </linearGradient>
            <linearGradient id="screenGlass" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor="#4a6a78" />
              <stop offset="100%" stopColor="#1c2a30" />
            </linearGradient>
            <linearGradient id="shelfWood" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#a9764c" />
              <stop offset="100%" stopColor="#7a5533" />
            </linearGradient>
            <linearGradient id="benchWood" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#c08a58" />
              <stop offset="100%" stopColor="#8f6136" />
            </linearGradient>
            <linearGradient id="genericFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--color-accent-soft)" />
              <stop offset="100%" stopColor="var(--color-accent)" />
            </linearGradient>
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
            segments.map((seg, i) => {
              const mid = { x: (seg.from.x + seg.to.x) / 2, y: (seg.from.y + seg.to.y) / 2 };
              const realLength = scalePxPerUnit ? pxToReal(seg.length, scalePxPerUnit) : seg.length;
              return (
                <text key={i} x={mid.x} y={mid.y - 6} className="mono floorplan-canvas__dim-label" textAnchor="middle">
                  {scalePxPerUnit ? formatLength(realLength, unit) : `${seg.length.toFixed(0)} px`}
                </text>
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
                transform={`translate(${item.x} ${item.y}) rotate(${item.rotation})`}
                onMouseDown={(e) => startDragFurniture(e, item)}
                style={{ cursor: mode === "place" ? "move" : "default" }}
                filter="url(#dropShadow)"
              >
                <title>{`${item.label} — ${formatLength(item.width, unit)} x ${formatLength(item.depth, unit)}`}</title>
                <FurnitureGlyph item={item} scalePxPerUnit={scalePxPerUnit} />
                {isSelected && (
                  <>
                    <rect
                      x={-item.width / 2 / (scalePxPerUnit || 1) - 3}
                      y={-item.depth / 2 / (scalePxPerUnit || 1) - 3}
                      width={item.width / (scalePxPerUnit || 1) + 6}
                      height={item.depth / (scalePxPerUnit || 1) + 6}
                      fill="none"
                      stroke="var(--color-accent)"
                      strokeWidth="1.5"
                      strokeDasharray="4 3"
                    />
                    <text textAnchor="middle" dy={item.depth / 2 / (scalePxPerUnit || 1) + 14} className="mono floorplan-canvas__furniture-label">
                      {item.label}
                    </text>
                  </>
                )}
              </g>
            );
          })}
        </svg>
      </div>

      <div className="floorplan-canvas__hud mono">
        <span>ZOOM {(zoom * 100).toFixed(0)}%</span>
        {cursorPos && scalePxPerUnit ? (
          <span>
            X {formatLength(pxToReal(cursorPos.x, scalePxPerUnit), unit)} · Y {formatLength(pxToReal(cursorPos.y, scalePxPerUnit), unit)}
          </span>
        ) : (
          <span>X — · Y —</span>
        )}
        {realWidthPx && <span>VIEW {formatLength(realWidthPx, unit)} WIDE</span>}
      </div>

      <div className="floorplan-canvas__zoom-controls">
        <button className="floorplan-canvas__zoom-btn" onClick={() => setZoom((z) => Math.max(MIN_ZOOM, z - 0.15))}>−</button>
        <button className="floorplan-canvas__zoom-reset" onClick={() => setZoom(0.6)}>Reset</button>
        <button className="floorplan-canvas__zoom-btn" onClick={() => setZoom((z) => Math.min(MAX_ZOOM, z + 0.15))}>+</button>
      </div>

      {mode === "place" && selectedFurnitureId && (
        <div className="floorplan-canvas__rotate-controls">
          <button onClick={() => rotateSelected(-15)}>⟲ 15°</button>
          <button onClick={() => rotateSelected(15)}>⟳ 15°</button>
        </div>
      )}
    </div>
  );
});

export default FloorplanCanvas;
