import { useState } from "react";
import type { Furniture, FurniturePreset } from "../lib/types";
import { ITEM_PALETTE, KIND_LABEL, itemColor } from "../lib/types";
import type { Unit } from "../lib/units";
import DimensionInput from "./DimensionInput";
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
  onApplyColorToName: (label: string, color: string) => void;
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
  onApplyColorToName,
}: FurniturePanelProps) {
  const [tab, setTab] = useState<"add" | "placed">("add");
  const sameNameCount = (item: Furniture) => furniture.filter((f) => f.label.trim() === item.label.trim()).length;

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
                  <span>L</span>
                  <DimensionInput valueCm={preset.width} unit={unit} onChange={(v) => onUpdatePreset(preset.id, { width: v })} />
                </label>
                <label>
                  <span>D</span>
                  <DimensionInput valueCm={preset.depth} unit={unit} onChange={(v) => onUpdatePreset(preset.id, { depth: v })} />
                </label>
                <label>
                  <span>H</span>
                  <DimensionInput valueCm={preset.height} unit={unit} onChange={(v) => onUpdatePreset(preset.id, { height: v })} />
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
              {item.kind !== "generic" && <div className="furniture-panel__kind mono">{KIND_LABEL[item.kind]}</div>}
              <input
                value={item.label}
                onChange={(e) => onUpdate(item.id, { label: e.target.value })}
                onClick={(e) => e.stopPropagation()}
              />
              <div className="furniture-panel__dims mono">
                <label>
                  <span>L</span>
                  <DimensionInput valueCm={item.width} unit={unit} onChange={(v) => onUpdate(item.id, { width: v })} onClick={(e) => e.stopPropagation()} />
                  <span className="furniture-panel__unit">{unit}</span>
                </label>
                <label>
                  <span>D</span>
                  <DimensionInput valueCm={item.depth} unit={unit} onChange={(v) => onUpdate(item.id, { depth: v })} onClick={(e) => e.stopPropagation()} />
                  <span className="furniture-panel__unit">{unit}</span>
                </label>
                <label>
                  <span>H</span>
                  <DimensionInput valueCm={item.height} unit={unit} onChange={(v) => onUpdate(item.id, { height: v })} onClick={(e) => e.stopPropagation()} />
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
              <div className="furniture-panel__colors">
                {ITEM_PALETTE.map((c) => (
                  <button
                    key={c.value}
                    className={itemColor(item) === c.value ? "furniture-panel__color furniture-panel__color--active" : "furniture-panel__color"}
                    style={{ background: c.value }}
                    title={c.name}
                    aria-label={`Colour ${c.name}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      onUpdate(item.id, { color: c.value });
                    }}
                  />
                ))}
                {sameNameCount(item) > 1 && (
                  <button
                    className="furniture-panel__apply-all"
                    title={`Give every item named "${item.label}" this colour`}
                    onClick={(e) => {
                      e.stopPropagation();
                      onApplyColorToName(item.label, itemColor(item));
                    }}
                  >
                    Apply to all {sameNameCount(item)}
                  </button>
                )}
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
