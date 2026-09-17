import { useRef, useState } from "react";
import type { Unit } from "../lib/units";
import { fromCm, toCm } from "../lib/units";

interface DimensionInputProps {
  valueCm: number;
  unit: Unit;
  onChange: (valueCm: number) => void;
  onClick?: (e: React.MouseEvent<HTMLInputElement>) => void;
  title?: string;
  // Apply the value only on Enter or leaving the field, not while typing — for changes that
  // would jump around as each digit arrives, like a wall's length.
  commitOnEnter?: boolean;
  className?: string;
}

// Shows a stored measurement without trailing zeros: 1800, 180.5, 0.6.
function display(valueCm: number, unit: Unit): string {
  return String(Number(fromCm(valueCm, unit).toFixed(3)));
}

function parse(text: string): number | null {
  const value = Number(text.trim().replace(",", "."));
  return text.trim() !== "" && Number.isFinite(value) && value > 0 ? value : null;
}

// A free-typing measurement field. While focused it keeps exactly what you type — so "12."
// or an empty field on the way to "12.5" isn't reformatted underneath you — and passes each
// valid positive number up as you go (or on Enter, with `commitOnEnter`). Leaving the field
// tidies it back to the stored value; Escape abandons the edit.
export default function DimensionInput({ valueCm, unit, onChange, onClick, title, commitOnEnter, className }: DimensionInputProps) {
  const [draft, setDraft] = useState<string | null>(null);
  const cancelled = useRef(false);

  return (
    <input
      type="text"
      inputMode="decimal"
      autoComplete="off"
      spellCheck={false}
      className={className ? `dimension-input ${className}` : "dimension-input"}
      title={title}
      value={draft ?? display(valueCm, unit)}
      onClick={onClick}
      onFocus={(e) => {
        cancelled.current = false;
        setDraft(display(valueCm, unit));
        e.currentTarget.select();
      }}
      onChange={(e) => {
        const text = e.target.value;
        setDraft(text);
        const value = parse(text);
        if (!commitOnEnter && value !== null) onChange(toCm(value, unit));
      }}
      onBlur={() => {
        if (commitOnEnter && !cancelled.current && draft !== null) {
          const value = parse(draft);
          if (value !== null && draft.trim() !== display(valueCm, unit)) onChange(toCm(value, unit));
        }
        setDraft(null);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
        if (e.key === "Escape") {
          cancelled.current = true;
          setDraft(null);
          e.currentTarget.blur();
        }
      }}
    />
  );
}
