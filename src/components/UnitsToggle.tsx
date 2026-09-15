import type { Unit } from "../lib/units";

interface UnitsToggleProps {
  unit: Unit;
  onChange: (unit: Unit) => void;
}

export default function UnitsToggle({ unit, onChange }: UnitsToggleProps) {
  return (
    <div className="units-toggle mono">
      <button className={unit === "cm" ? "active" : ""} onClick={() => onChange("cm")}>
        cm
      </button>
      <button className={unit === "in" ? "active" : ""} onClick={() => onChange("in")}>
        in
      </button>
    </div>
  );
}
