import type { Unit } from "../lib/units";

interface UnitsToggleProps {
  unit: Unit;
  onChange: (unit: Unit) => void;
}

const UNITS: Unit[] = ["mm", "cm", "m"];

export default function UnitsToggle({ unit, onChange }: UnitsToggleProps) {
  return (
    <div className="units-toggle mono">
      {UNITS.map((u) => (
        <button key={u} className={unit === u ? "active" : ""} onClick={() => onChange(u)}>
          {u}
        </button>
      ))}
    </div>
  );
}
