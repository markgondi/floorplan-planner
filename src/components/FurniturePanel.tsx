import type { Furniture, FurniturePreset } from "../lib/types";
import type { Unit } from "../lib/units";
import { formatLength, fromCm, toCm } from "../lib/units";

interface FurniturePanelProps {
  furniture: Furniture[];
  unit: Unit;
  selectedId: string | null;
  presets: FurniturePreset[];
  onSelect: (id: string) => void;
  onAddPreset: (preset: FurniturePreset) => void;
  onUpdate: (id: string, patch: Partial<Furniture>) => void;
  onDelete: (id: string) => void;
  onDuplicate: (id: string) => void;
}

export default function FurniturePanel({
  furniture,
  unit,
  selectedId,
  presets,
  onSelect,
  onAddPreset,
  onUpdate,
  onDelete,
  onDuplicate,
}: FurniturePanelProps) {
  return (
    <div className="furniture-panel">
      <div className="furniture-panel__header">
        <span className="mono">FURNITURE</span>
      </div>

      <div className="furniture-panel__presets">
        {presets.map((preset) => (
          <button
            key={preset.label}
            className="furniture-panel__preset"
            title={`Add ${preset.label} (${preset.width}cm x ${preset.depth}cm)`}
            onClick={() => onAddPreset(preset)}
          >
            + {preset.label}
          </button>
        ))}
      </div>

      <ul className="furniture-panel__list">
        {furniture.map((item) => (
          <li
            key={item.id}
            className={item.id === selectedId ? "furniture-panel__item furniture-panel__item--active" : "furniture-panel__item"}
            onClick={() => onSelect(item.id)}
          >
            <input
              value={item.label}
              onChange={(e) => onUpdate(item.id, { label: e.target.value })}
              onClick={(e) => e.stopPropagation()}
            />
            <div className="furniture-panel__dims mono">
              <label>
                W
                <input
                  type="number"
                  value={fromCm(item.width, unit).toFixed(1)}
                  onChange={(e) => onUpdate(item.id, { width: toCm(Number(e.target.value), unit) })}
                  onClick={(e) => e.stopPropagation()}
                />
              </label>
              <label>
                D
                <input
                  type="number"
                  value={fromCm(item.depth, unit).toFixed(1)}
                  onChange={(e) => onUpdate(item.id, { depth: toCm(Number(e.target.value), unit) })}
                  onClick={(e) => e.stopPropagation()}
                />
              </label>
              <span>{formatLength(item.width, unit)} x {formatLength(item.depth, unit)}</span>
            </div>
            <div className="furniture-panel__actions">
              <button onClick={(e) => { e.stopPropagation(); onDuplicate(item.id); }}>Duplicate</button>
              <button onClick={(e) => { e.stopPropagation(); onDelete(item.id); }}>Delete</button>
            </div>
          </li>
        ))}
        {furniture.length === 0 && <li className="furniture-panel__empty">No furniture placed</li>}
      </ul>
    </div>
  );
}
