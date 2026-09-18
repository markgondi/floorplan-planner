import type { Point } from "../lib/geometry";
import type { Unit } from "../lib/units";
import { formatLength, formatScale } from "../lib/units";

interface StatusBarProps {
  view: "top" | "side";
  zoom: number;
  cursor: Point | null;
  scalePxPerUnit: number;
  unit: Unit;
  perimeterCm: number | null;
  selectionLabel: string | null;
  wallLabel: string | null;
  // Floor areas mapped out in this room, e.g. "Lino Floor 12.4 m² · Carpet Floor 8.0 m²".
  floorLabel: string | null;
  hint: string;
}

function Cell({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className={accent ? "status-bar__cell status-bar__cell--accent" : "status-bar__cell"}>
      <span className="status-bar__label">{label}</span>
      <span className="status-bar__value mono">{value}</span>
    </div>
  );
}

export default function StatusBar({
  view,
  zoom,
  cursor,
  scalePxPerUnit,
  unit,
  perimeterCm,
  selectionLabel,
  wallLabel,
  floorLabel,
  hint,
}: StatusBarProps) {
  return (
    <footer className="status-bar">
      <div className="status-bar__group">
        <Cell label="View" value={view === "top" ? "Top" : "Side"} />
        {view === "top" && <Cell label="Zoom" value={`${(zoom * 100).toFixed(0)}%`} />}
        <Cell
          label="Scale"
          value={scalePxPerUnit ? `1px = ${formatScale(scalePxPerUnit, unit)}` : "not set"}
          accent={!scalePxPerUnit}
        />
        {view === "top" && (
          <Cell
            label="Cursor"
            value={
              cursor && scalePxPerUnit
                ? `${formatLength(cursor.x * scalePxPerUnit, unit)}, ${formatLength(cursor.y * scalePxPerUnit, unit)}`
                : "—"
            }
          />
        )}
        {perimeterCm !== null && <Cell label="Perimeter" value={formatLength(perimeterCm, unit)} />}
        {floorLabel && <Cell label="Floors" value={floorLabel} />}
        {wallLabel && <Cell label="Wall" value={wallLabel} accent />}
        {selectionLabel && <Cell label="Selected" value={selectionLabel} accent />}
      </div>
      <div className="status-bar__hint">{hint}</div>
    </footer>
  );
}
