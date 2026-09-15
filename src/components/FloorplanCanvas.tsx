import { useRef, useState } from "react";
import type { Point } from "../lib/geometry";
import { distance, polygonPerimeterSegments, pxToReal, snapAngle } from "../lib/geometry";
import type { Furniture } from "../lib/types";
import type { Unit } from "../lib/units";
import { formatLength } from "../lib/units";

type Mode = "trace" | "calibrate" | "place";

interface FloorplanCanvasProps {
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

const VIEW_W = 900;
const VIEW_H = 600;

export default function FloorplanCanvas({
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
}: FloorplanCanvasProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [calibrationPoints, setCalibrationPoints] = useState<Point[]>([]);
  const [dragId, setDragId] = useState<string | null>(null);
  const [dragOffset, setDragOffset] = useState<Point>({ x: 0, y: 0 });

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

  function handleMouseMove(e: React.MouseEvent) {
    if (!dragId) return;
    const p = toSvgPoint(e);
    onFurnitureChange(dragId, { x: p.x - dragOffset.x, y: p.y - dragOffset.y });
  }

  function handleMouseUp() {
    setDragId(null);
  }

  function rotateSelected(delta: number) {
    if (!selectedFurnitureId) return;
    const item = furniture.find((f) => f.id === selectedFurnitureId);
    if (!item) return;
    onFurnitureChange(selectedFurnitureId, { rotation: snapAngle(item.rotation + delta) });
  }

  const segments = polygonPerimeterSegments(outline);

  return (
    <div className="floorplan-canvas">
      <svg
        ref={svgRef}
        viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
        className="floorplan-canvas__svg"
        onClick={handleSvgClick}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
      >
        <defs>
          <pattern id="grid" width="20" height="20" patternUnits="userSpaceOnUse">
            <path d="M 20 0 L 0 0 0 20" fill="none" stroke="var(--color-line-soft)" strokeWidth="0.4" opacity="0.3" />
          </pattern>
        </defs>
        <rect x="0" y="0" width={VIEW_W} height={VIEW_H} fill="var(--color-paper)" />
        <rect x="0" y="0" width={VIEW_W} height={VIEW_H} fill="url(#grid)" />

        {imageUrl && <image href={imageUrl} x="0" y="0" width={VIEW_W} height={VIEW_H} opacity="0.35" />}

        {outline.length > 1 && (
          <polygon
            points={outline.map((p) => `${p.x},${p.y}`).join(" ")}
            fill="var(--color-accent-soft)"
            fillOpacity="0.08"
            stroke="var(--color-line)"
            strokeWidth="2"
          />
        )}

        {outline.length > 1 &&
          segments.map((seg, i) => {
            const mid = { x: (seg.from.x + seg.to.x) / 2, y: (seg.from.y + seg.to.y) / 2 };
            const realLength = scalePxPerUnit ? pxToReal(seg.length, scalePxPerUnit) : seg.length;
            return (
              <text
                key={i}
                x={mid.x}
                y={mid.y - 6}
                className="mono floorplan-canvas__dim-label"
                textAnchor="middle"
              >
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
            >
              <rect
                x={-item.width / 2 / (scalePxPerUnit || 1)}
                y={-item.depth / 2 / (scalePxPerUnit || 1)}
                width={item.width / (scalePxPerUnit || 1)}
                height={item.depth / (scalePxPerUnit || 1)}
                fill="var(--color-surface)"
                stroke={isSelected ? "var(--color-accent)" : "var(--color-line)"}
                strokeWidth={isSelected ? 2.5 : 1.5}
              />
              <text textAnchor="middle" dy="4" className="mono floorplan-canvas__furniture-label">
                {item.label}
              </text>
            </g>
          );
        })}
      </svg>

      {mode === "place" && selectedFurnitureId && (
        <div className="floorplan-canvas__rotate-controls">
          <button onClick={() => rotateSelected(-15)}>⟲ 15°</button>
          <button onClick={() => rotateSelected(15)}>⟳ 15°</button>
        </div>
      )}
    </div>
  );
}
