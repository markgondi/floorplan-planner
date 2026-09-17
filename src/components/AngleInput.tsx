import { useState } from "react";
import { rotateBy } from "../lib/geometry";

interface AngleInputProps {
  degrees: number;
  onChange: (degrees: number) => void;
  className?: string;
}

// An item's rotation, typed in degrees (e.g. 37.5, or -10 for 350). Applies on Enter or leaving
// the field; Escape abandons the edit.
export default function AngleInput({ degrees, onChange, className }: AngleInputProps) {
  const [draft, setDraft] = useState<string | null>(null);
  const shown = String(rotateBy(degrees, 0));

  return (
    <span className={className}>
      <input
        type="text"
        inputMode="decimal"
        autoComplete="off"
        spellCheck={false}
        aria-label="Rotation in degrees"
        title="Type an angle in degrees and press Enter"
        value={draft ?? shown}
        onClick={(e) => e.stopPropagation()}
        onFocus={(e) => {
          setDraft(shown);
          e.currentTarget.select();
        }}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          const value = Number((draft ?? "").trim().replace(",", ".").replace("°", ""));
          if (draft !== null && draft.trim() !== "" && Number.isFinite(value) && rotateBy(value, 0) !== rotateBy(degrees, 0)) {
            onChange(rotateBy(value, 0));
          }
          setDraft(null);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
          if (e.key === "Escape") {
            setDraft(shown);
            e.currentTarget.blur();
          }
        }}
      />
      °
    </span>
  );
}
