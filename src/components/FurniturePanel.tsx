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
  onUpdatePreset: (id: string, patch: Partial<FurniturePreset>) => void;
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
  onUpdatePreset,
  onUpdate,
  onDelete,
  onDuplicate,
}: FurniturePanelProps) {
  return (
    <div className="furniture-panel">
      <div className="furniture-panel__section-label mono">ADD ITEM</div>
      <div className="furniture-panel__presets">
        {presets.map((preset) => (
          <div key={preset.id} className="furniture-panel__preset">
            <input
              className="furniture-panel__preset-label"
              value={preset.label}
              onChange={(e) => onUpdatePreset(preset.id, { label: e.target.value })}
            />
            <div className="furniture-panel__preset-dims mono">
              <label>
                W
                <input
                  type="number"
                  value={fromCm(preset.width, unit).toFixed(1)}
                  onChange={(e) => onUpdatePreset(preset.id, { width: toCm(Number(e.target.value), unit) })}
                />
              </label>
              <label>
                D
                <input
                  type="number"
                  value={fromCm(preset.depth, unit).toFixed(1)}
                  onChange={(e) => onUpdatePreset(preset.id, { depth: toCm(Number(e.target.value), unit) })}
                />
              </label>
              <button
                className="furniture-panel__preset-add"
                title={`Add ${preset.label} to the canvas`}
                onClick={() => onAddPreset(preset)}
              >
                + Add
              </button>
            </div>
          </div>
        ))}
      </div>

      <div className="furniture-panel__section-label mono">PLACED ITEMS</div>
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
        {furniture.length === 0 && <li className="furniture-panel__empty">No items placed yet</li>}
      </ul>
    </div>
  );
}
