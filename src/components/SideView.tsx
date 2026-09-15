import { useRef, useState } from "react";
import type { WallRun } from "../lib/geometry";
import { distanceFromWallLine, pointOnWall, projectAlongWall, pxToReal, signedDistanceFromWall } from "../lib/geometry";
import type { Furniture } from "../lib/types";
import { KIND_COLOR } from "../lib/types";
import type { Unit } from "../lib/units";
import { formatLength } from "../lib/units";

interface SideViewProps {
  furniture: Furniture[];
  scalePxPerUnit: number;
  unit: Unit;
  ceilingHeightCm: number;
  selectedWall: WallRun | null;
  selectedWallIndex: number | null;
  selectedFurnitureId: string | null;
  onSelectFurniture: (id: string | null) => void;
  onFurnitureChange: (id: string, patch: Partial<Furniture>) => void;
}

const PX_PER_CM = 2;
const LEFT_MARGIN = 70;
const RIGHT_MARGIN = 70;
const TOP_MARGIN = 70;
const BELOW_FLOOR = 60;
// Items further than this from the selected wall (perpendicular) are considered
// to belong to another wall and are left out of that wall's elevation.
const NEAR_WALL_CM = 150;

export default function SideView({
  furniture,
  unit,
  scalePxPerUnit,
  ceilingHeightCm,
  selectedWall,
  selectedWallIndex,
  selectedFurnitureId,
  onSelectFurniture,
  onFurnitureChange,
}: SideViewProps) {
  const ceilingPx = ceilingHeightCm * PX_PER_CM;
  const scale = scalePxPerUnit || 1;
  const svgRef = useRef<SVGSVGElement>(null);
  const drag = useRef<{ id: string; startX: number; startY: number; alongPx: number; perpPx: number; elevation: number } | null>(null);
  const [dragging, setDragging] = useState(false);

  // Screen -> viewBox, which matters here because the drawing is letterboxed to fit.
  function toViewBox(e: React.MouseEvent) {
    const svg = svgRef.current;
    if (!svg) return { x: 0, y: 0 };
    const ctm = svg.getScreenCTM();
    if (!ctm) return { x: 0, y: 0 };
    const pt = new DOMPoint(e.clientX, e.clientY).matrixTransform(ctm.inverse());
    return { x: pt.x, y: pt.y };
  }

  function startDrag(e: React.MouseEvent, item: Furniture) {
    e.stopPropagation();
    onSelectFurniture(item.id);
    const p = toViewBox(e);
    drag.current = {
      id: item.id,
      startX: p.x,
      startY: p.y,
      alongPx: selectedWall ? projectAlongWall({ x: item.x, y: item.y }, selectedWall) : item.x,
      perpPx: selectedWall ? signedDistanceFromWall({ x: item.x, y: item.y }, selectedWall) : 0,
      elevation: item.elevation,
    };
    setDragging(true);
  }

  function handleMove(e: React.MouseEvent) {
    const d = drag.current;
    if (!d) return;
    const p = toViewBox(e);
    // Horizontal drag slides the item along the wall; vertical drag changes its height off the floor.
    const dAlongPx = (p.x - d.startX) / PX_PER_CM / scale;
    const dElevationCm = -(p.y - d.startY) / PX_PER_CM;
    const elevation = Math.max(0, Math.round(d.elevation + dElevationCm));
    if (selectedWall) {
      const next = pointOnWall(selectedWall, d.alongPx + dAlongPx, d.perpPx);
      onFurnitureChange(d.id, { x: next.x, y: next.y, elevation });
    } else {
      onFurnitureChange(d.id, { x: d.alongPx + dAlongPx, elevation });
    }
  }

  function endDrag() {
    drag.current = null;
    setDragging(false);
  }

  // Resolve each item to a horizontal position (cm along the viewed wall) and whether
  // it belongs to this wall's elevation at all.
  const placed = furniture
    .map((item) => {
      if (selectedWall) {
        const alongCm = pxToReal(projectAlongWall({ x: item.x, y: item.y }, selectedWall), scale);
        const awayCm = pxToReal(distanceFromWallLine({ x: item.x, y: item.y }, selectedWall), scale);
        return { item, alongCm, include: awayCm <= NEAR_WALL_CM };
      }
      return { item, alongCm: item.x * scale, include: true };
    })
    .filter((p) => p.include);

  const excludedCount = furniture.length - placed.length;
  const wallLengthCm = selectedWall ? pxToReal(selectedWall.length, scale) : null;

  // Walls drawn first so they sit behind furniture/doors/readers instead of covering them.
  const ordered = [...placed].sort((a, b) => (a.item.kind === "wall" ? -1 : 0) - (b.item.kind === "wall" ? -1 : 0));

  // Size the drawing to its content so a short wall doesn't float in a mostly empty frame.
  const spanCm = Math.max(
    wallLengthCm ?? 0,
    ...placed.map((p) => p.alongCm + p.item.width / 2),
    200,
  );
  const tallestCm = Math.max(ceilingHeightCm, ...placed.map((p) => p.item.elevation + p.item.height), 100);
  const VIEW_W = LEFT_MARGIN + spanCm * PX_PER_CM + RIGHT_MARGIN;
  const VIEW_H = TOP_MARGIN + tallestCm * PX_PER_CM + BELOW_FLOOR;
  const FLOOR_Y = VIEW_H - BELOW_FLOOR;
  const ceilingPxClamped = Math.min(ceilingPx, tallestCm * PX_PER_CM);

  return (
    <div className="floorplan-canvas">
      <div className="floorplan-canvas__scroll floorplan-canvas__scroll--fit">
        <svg
          ref={svgRef}
          viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
          className="floorplan-canvas__svg floorplan-canvas__svg--fit"
          preserveAspectRatio="xMidYMid meet"
          style={dragging ? { cursor: "grabbing" } : undefined}
          onClick={() => {
            if (!drag.current) onSelectFurniture(null);
          }}
          onMouseMove={handleMove}
          onMouseUp={endDrag}
          onMouseLeave={endDrag}
        >
          <defs>
            <pattern id="sideGrid" width={PX_PER_CM * 10} height={PX_PER_CM * 10} patternUnits="userSpaceOnUse">
              <path d={`M ${PX_PER_CM * 10} 0 L 0 0 0 ${PX_PER_CM * 10}`} fill="none" stroke="var(--color-grid)" strokeWidth="0.5" opacity="0.5" />
            </pattern>
          </defs>
          <rect x="0" y="0" width={VIEW_W} height={VIEW_H} fill="var(--color-canvas)" />
          <rect x="0" y="0" width={VIEW_W} height={VIEW_H} fill="url(#sideGrid)" />

          {/* Floor line */}
          <line x1="0" y1={FLOOR_Y} x2={VIEW_W} y2={FLOOR_Y} stroke="var(--color-line)" strokeWidth="2" />
          <text x="8" y={FLOOR_Y + 16} className="mono floorplan-canvas__dim-label" fontSize="11">
            FLOOR
          </text>

          {/* The selected wall's own extent along the floor, so you can see where it starts and ends */}
          {selectedWall && wallLengthCm !== null && (
            <>
              <line
                x1={LEFT_MARGIN}
                y1={FLOOR_Y}
                x2={LEFT_MARGIN + wallLengthCm * PX_PER_CM}
                y2={FLOOR_Y}
                stroke="var(--color-accent)"
                strokeWidth="4"
              />
              <line x1={LEFT_MARGIN} y1={FLOOR_Y - 10} x2={LEFT_MARGIN} y2={FLOOR_Y + 10} stroke="var(--color-accent)" strokeWidth="2" />
              <line
                x1={LEFT_MARGIN + wallLengthCm * PX_PER_CM}
                y1={FLOOR_Y - 10}
                x2={LEFT_MARGIN + wallLengthCm * PX_PER_CM}
                y2={FLOOR_Y + 10}
                stroke="var(--color-accent)"
                strokeWidth="2"
              />
              <text
                x={LEFT_MARGIN + (wallLengthCm * PX_PER_CM) / 2}
                y={FLOOR_Y + 32}
                textAnchor="middle"
                className="mono floorplan-canvas__dim-label"
                fontSize="11"
                fill="var(--color-accent)"
              >
                WALL {(selectedWallIndex ?? 0) + 1} · {formatLength(wallLengthCm, unit)}
              </text>
            </>
          )}

          {/* Ceiling reference line at room's configured height */}
          <line
            x1="0"
            y1={FLOOR_Y - ceilingPxClamped}
            x2={VIEW_W}
            y2={FLOOR_Y - ceilingPxClamped}
            stroke="var(--color-line-soft)"
            strokeWidth="1"
            strokeDasharray="6 4"
          />
          <text x="8" y={FLOOR_Y - ceilingPxClamped - 6} className="mono floorplan-canvas__dim-label" fontSize="11">
            CEILING {formatLength(ceilingHeightCm, unit)}
          </text>

          {ordered.map(({ item, alongCm }) => {
            const wPx = item.width * PX_PER_CM;
            const hPx = item.height * PX_PER_CM;
            const itemX = LEFT_MARGIN + alongCm * PX_PER_CM - wPx / 2;
            const itemBottom = FLOOR_Y - item.elevation * PX_PER_CM;
            const itemY = itemBottom - hPx;
            const isSelected = item.id === selectedFurnitureId;
            const isWall = item.kind === "wall";
            return (
              <g
                key={item.id}
                className="floorplan-canvas__item-group"
                onMouseDown={(e) => startDrag(e, item)}
                onClick={(e) => e.stopPropagation()}
                style={{ cursor: "grab" }}
              >
                <title>
                  {`${item.label} — ${formatLength(item.width, unit)} wide x ${formatLength(item.height, unit)} tall, ` +
                    `${formatLength(item.elevation, unit)} off the floor. Drag to move along the wall or change its height.`}
                </title>
                <rect
                  x={itemX}
                  y={itemY}
                  width={wPx}
                  height={hPx}
                  rx={2}
                  fill={KIND_COLOR[item.kind]}
                  fillOpacity={isWall ? 0.4 : 0.8}
                  stroke={isSelected ? "var(--color-accent)" : "var(--color-line)"}
                  strokeWidth={isSelected ? 3 : 1.2}
                />
                {isSelected && (
                  <>
                    <rect
                      x={itemX - 5}
                      y={itemY - 5}
                      width={wPx + 10}
                      height={hPx + 10}
                      fill="none"
                      stroke="var(--color-accent)"
                      strokeWidth="1.5"
                      strokeDasharray="5 4"
                    />
                    <line x1={itemX + wPx / 2} y1={FLOOR_Y - 6} x2={itemX + wPx / 2} y2={FLOOR_Y + 6} stroke="var(--color-accent)" strokeWidth="2" />
                  </>
                )}
                <text
                  x={itemX + wPx / 2}
                  y={itemY - 8}
                  textAnchor="middle"
                  className="mono floorplan-canvas__furniture-label"
                  fontSize={isSelected ? 11 : 10}
                  fontWeight={isSelected ? 700 : 400}
                  fill={isSelected ? "var(--color-accent)" : undefined}
                  paintOrder="stroke"
                  stroke="var(--color-paper)"
                  strokeWidth="3"
                  strokeLinejoin="round"
                >
                  {item.label} · {formatLength(item.height, unit)}
                </text>
              </g>
            );
          })}
        </svg>
      </div>
      {selectedWall && excludedCount > 0 && (
        <div className="canvas-dock canvas-dock--note mono">
          {excludedCount} item{excludedCount === 1 ? "" : "s"} hidden — not near this wall
        </div>
      )}
      {!selectedWall && (
        <div className="canvas-dock canvas-dock--note mono">
          No wall selected — showing everything. In Top view, use Place and click a wall.
        </div>
      )}
    </div>
  );
}
