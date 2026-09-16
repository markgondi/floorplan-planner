import { useState } from "react";
import type { Furniture, FurniturePreset } from "../lib/types";
import { KIND_COLOR, KIND_LABEL } from "../lib/types";
import type { Unit } from "../lib/units";
import { fromCm, toCm } from "../lib/units";
import { snapAngle } from "../lib/geometry";

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
  const [tab, setTab] = useState<"add" | "placed">("add");

  return (
    <div className="furniture-panel">
      <div className="furniture-panel__tabs">
        <button className={tab === "add" ? "active" : ""} onClick={() => setTab("add")}>
          Add Item
        </button>
        <button className={tab === "placed" ? "active" : ""} onClick={() => setTab("placed")}>
          Placed ({furniture.length})
        </button>
      </div>

      {tab === "add" && (
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
                  <span>W</span>
                  <input
                    type="number"
                    value={fromCm(preset.width, unit).toFixed(1)}
                    onChange={(e) => onUpdatePreset(preset.id, { width: toCm(Number(e.target.value), unit) })}
                  />
                </label>
                <label>
                  <span>D</span>
                  <input
                    type="number"
                    value={fromCm(preset.depth, unit).toFixed(1)}
                    onChange={(e) => onUpdatePreset(preset.id, { depth: toCm(Number(e.target.value), unit) })}
                  />
                </label>
                <label>
                  <span>H</span>
                  <input
                    type="number"
                    value={fromCm(preset.height, unit).toFixed(1)}
                    onChange={(e) => onUpdatePreset(preset.id, { height: toCm(Number(e.target.value), unit) })}
                  />
                </label>
              </div>
              <button
                className="furniture-panel__preset-add"
                title={`Add ${preset.label} to the canvas`}
                onClick={() => onAddPreset(preset)}
              >
                + Add {preset.label}
              </button>
            </div>
          ))}
        </div>
      )}

      {tab === "placed" && (
        <ul className="furniture-panel__list">
          {furniture.map((item) => (
            <li
              key={item.id}
              className={item.id === selectedId ? "furniture-panel__item furniture-panel__item--active" : "furniture-panel__item"}
              onClick={() => onSelect(item.id)}
            >
              <div className="furniture-panel__kind mono">
                <span className="furniture-panel__swatch" style={{ background: KIND_COLOR[item.kind] }} />
                {KIND_LABEL[item.kind]}
              </div>
              <input
                value={item.label}
                onChange={(e) => onUpdate(item.id, { label: e.target.value })}
                onClick={(e) => e.stopPropagation()}
              />
              <div className="furniture-panel__dims mono">
                <label>
                  <span>W</span>
                  <input
                    type="number"
                    value={fromCm(item.width, unit).toFixed(1)}
                    onChange={(e) => onUpdate(item.id, { width: toCm(Number(e.target.value), unit) })}
                    onClick={(e) => e.stopPropagation()}
                  />
                  <span className="furniture-panel__unit">{unit}</span>
                </label>
                <label>
                  <span>D</span>
                  <input
                    type="number"
                    value={fromCm(item.depth, unit).toFixed(1)}
                    onChange={(e) => onUpdate(item.id, { depth: toCm(Number(e.target.value), unit) })}
                    onClick={(e) => e.stopPropagation()}
                  />
                  <span className="furniture-panel__unit">{unit}</span>
                </label>
                <label>
                  <span>H</span>
                  <input
                    type="number"
                    value={fromCm(item.height, unit).toFixed(1)}
                    onChange={(e) => onUpdate(item.id, { height: toCm(Number(e.target.value), unit) })}
                    onClick={(e) => e.stopPropagation()}
                  />
                  <span className="furniture-panel__unit">{unit}</span>
                </label>
              </div>
              <div className="furniture-panel__rotate mono">
                <span>Rotate</span>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onUpdate(item.id, { rotation: snapAngle(item.rotation - 15) });
                  }}
                  title="Rotate 15° anticlockwise"
                >
                  ⟲
                </button>
                <span className="furniture-panel__angle">{(((item.rotation % 360) + 360) % 360)}°</span>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onUpdate(item.id, { rotation: snapAngle(item.rotation + 15) });
                  }}
                  title="Rotate 15° clockwise"
                >
                  ⟳
                </button>
                <button
                  className="furniture-panel__rotate-reset"
                  onClick={(e) => {
                    e.stopPropagation();
                    onUpdate(item.id, { rotation: 0 });
                  }}
                  title="Reset rotation"
                >
                  0°
                </button>
              </div>
              <div className="furniture-panel__actions">
                <button onClick={(e) => { e.stopPropagation(); onDuplicate(item.id); }}>Duplicate</button>
                <button onClick={(e) => { e.stopPropagation(); onDelete(item.id); }}>Delete</button>
              </div>
            </li>
          ))}
          {furniture.length === 0 && <li className="furniture-panel__empty">No items placed yet</li>}
        </ul>
      )}
    </div>
  );
}
