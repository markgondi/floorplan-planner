import type { Furniture } from "../lib/types";
import type { Unit } from "../lib/units";
import { formatLength } from "../lib/units";

interface SideViewProps {
  furniture: Furniture[];
  scalePxPerUnit: number;
  unit: Unit;
  ceilingHeightCm: number;
  selectedFurnitureId: string | null;
  onSelectFurniture: (id: string | null) => void;
}

const VIEW_W = 1600;
const VIEW_H = 700;
const FLOOR_Y = 600;
const PX_PER_CM = 2;

export default function SideView({
  furniture,
  unit,
  scalePxPerUnit,
  ceilingHeightCm,
  selectedFurnitureId,
  onSelectFurniture,
}: SideViewProps) {
  const ceilingPx = ceilingHeightCm * PX_PER_CM;
  const selectedItem = furniture.find((f) => f.id === selectedFurnitureId) ?? null;

  // Walls drawn first so they sit behind furniture/doors/readers instead of covering them.
  const ordered = [...furniture].sort((a, b) => (a.kind === "wall" ? -1 : 0) - (b.kind === "wall" ? -1 : 0));

  return (
    <div className="floorplan-canvas">
      <div className="floorplan-canvas__scroll">
        <svg
          viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
          className="floorplan-canvas__svg"
          style={{ width: VIEW_W * 0.6, height: VIEW_H * 0.6 }}
          onClick={() => onSelectFurniture(null)}
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

          {/* Ceiling reference line at room's configured height */}
          <line
            x1="0"
            y1={FLOOR_Y - ceilingPx}
            x2={VIEW_W}
            y2={FLOOR_Y - ceilingPx}
            stroke="var(--color-line-soft)"
            strokeWidth="1"
            strokeDasharray="6 4"
          />
          <text x="8" y={FLOOR_Y - ceilingPx - 6} className="mono floorplan-canvas__dim-label" fontSize="11">
            CEILING {formatLength(ceilingHeightCm, unit)}
          </text>

          {ordered.map((item) => {
            const wPx = item.width * PX_PER_CM;
            const hPx = item.height * PX_PER_CM;
            const itemXCm = item.x * (scalePxPerUnit || 1);
            const itemX = itemXCm * PX_PER_CM - wPx / 2;
            const itemBottom = FLOOR_Y - item.elevation * PX_PER_CM;
            const itemY = itemBottom - hPx;
            const isSelected = item.id === selectedFurnitureId;
            const isWall = item.kind === "wall";
            return (
              <g
                key={item.id}
                className="floorplan-canvas__item-group"
                onClick={(e) => {
                  e.stopPropagation();
                  onSelectFurniture(item.id);
                }}
                style={{ cursor: "pointer" }}
              >
                <title>{`${item.label} — ${formatLength(item.width, unit)} wide x ${formatLength(item.height, unit)} tall`}</title>
                <rect
                  x={itemX}
                  y={itemY}
                  width={wPx}
                  height={hPx}
                  rx={2}
                  fill={item.color}
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
                    {/* Floor marker showing this item's X position */}
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
      <div className="floorplan-canvas__hud mono">
        <span>SIDE VIEW</span>
        {selectedItem ? (
          <span className="floorplan-canvas__hud-selected">
            SELECTED: {selectedItem.label} — {formatLength(selectedItem.width, unit)} W × {formatLength(selectedItem.height, unit)} H
          </span>
        ) : (
          <span>CLICK AN ITEM TO SELECT IT</span>
        )}
        <span>ITEMS PROJECTED ALONG X — DEPTH NOT SHOWN</span>
      </div>
    </div>
  );
}
