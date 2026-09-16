import { useState } from "react";
import type { Unit } from "../lib/units";
import { fromCm, toCm } from "../lib/units";

interface DimensionInputProps {
  valueCm: number;
  unit: Unit;
  onChange: (valueCm: number) => void;
  onClick?: (e: React.MouseEvent<HTMLInputElement>) => void;
  title?: string;
}

// Shows a stored measurement without trailing zeros: 1800, 180.5, 0.6.
function display(valueCm: number, unit: Unit): string {
  return String(Number(fromCm(valueCm, unit).toFixed(3)));
}

// A free-typing measurement field. While focused it keeps exactly what you type — so "12."
// or an empty field on the way to "12.5" isn't reformatted underneath you — and passes each
// valid positive number up as you go. Leaving the field (or pressing Enter) tidies it back
// to the stored value; Escape abandons the edit.
export default function DimensionInput({ valueCm, unit, onChange, onClick, title }: DimensionInputProps) {
  const [draft, setDraft] = useState<string | null>(null);

  return (
    <input
      type="text"
      inputMode="decimal"
      autoComplete="off"
      spellCheck={false}
      className="dimension-input"
      title={title}
      value={draft ?? display(valueCm, unit)}
      onClick={onClick}
      onFocus={(e) => {
        setDraft(display(valueCm, unit));
        e.currentTarget.select();
      }}
      onChange={(e) => {
        const text = e.target.value;
        setDraft(text);
        const parsed = Number(text.trim().replace(",", "."));
        if (text.trim() !== "" && Number.isFinite(parsed) && parsed > 0) {
          onChange(toCm(parsed, unit));
        }
      }}
      onBlur={() => setDraft(null)}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
        if (e.key === "Escape") {
          setDraft(null);
          e.currentTarget.blur();
        }
      }}
    />
  );
}
