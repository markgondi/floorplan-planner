import { useState } from "react";
import type { Furniture, FurniturePreset } from "../lib/types";
import { ITEM_PALETTE, KIND_LABEL, itemColor } from "../lib/types";
import type { LibraryEntry } from "../lib/library";
import type { Unit } from "../lib/units";
import { formatArea, formatDimensions } from "../lib/units";
import DimensionInput from "./DimensionInput";
import { ROTATE_STEP, ROTATE_STEP_LARGE, rotateBy } from "../lib/geometry";
import AngleInput from "./AngleInput";

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
  // Every distinct item made in any room, to place again in this one.
  library: LibraryEntry[];
  onAddFromLibrary: (entry: LibraryEntry) => void;
  onRemoveFromLibrary: (entry: LibraryEntry) => void;
}

// A name field that applies on Enter or leaving the field (Esc abandons), so a half-typed name
// isn't saved — and doesn't end up in the item library.
function NameInput({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const [draft, setDraft] = useState<string | null>(null);
  return (
    <input
      value={draft ?? value}
      onClick={(e) => e.stopPropagation()}
      onFocus={() => setDraft(value)}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        if (draft !== null && draft.trim() !== "" && draft !== value) onChange(draft);
        setDraft(null);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
        if (e.key === "Escape") {
          setDraft(value);
          e.currentTarget.blur();
        }
      }}
    />
  );
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
  library,
  onAddFromLibrary,
  onRemoveFromLibrary,
}: FurniturePanelProps) {
  const [tab, setTab] = useState<"add" | "placed" | "library">("add");
  const [query, setQuery] = useState("");
  const shownLibrary = library.filter((entry) => entry.label.toLowerCase().includes(query.trim().toLowerCase()));
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
        <button className={tab === "library" ? "active" : ""} onClick={() => setTab("library")}>
          Library ({library.length})
        </button>
      </div>

      {tab === "library" && (
        <div className="furniture-panel__library">
          <input
            className="furniture-panel__search"
            placeholder="Search the library"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          {library.length === 0 && <div className="furniture-panel__empty">Items you make in any room are added here automatically</div>}
          {library.length > 0 && shownLibrary.length === 0 && <div className="furniture-panel__empty">Nothing matches "{query}"</div>}
          <ul className="furniture-panel__list">
            {shownLibrary.map((entry) => (
              <li key={entry.key} className="furniture-panel__lib-item">
                <span className="furniture-panel__lib-swatch" style={{ background: itemColor(entry) }} />
                <div className="furniture-panel__lib-text">
                  <div className="furniture-panel__lib-name">{entry.label}</div>
                  <div className="furniture-panel__lib-size mono">{formatDimensions([entry.width, entry.depth, entry.height], unit)}</div>
                  <div className="furniture-panel__lib-rooms">
                    {entry.rooms.length ? `In ${entry.rooms.join(", ")}` : "Not placed in any room"}
                  </div>
                </div>
                <div className="furniture-panel__lib-actions">
                  <button className="furniture-panel__lib-add" onClick={() => onAddFromLibrary(entry)} title={`Place a ${entry.label} in this room`}>
                    + Add
                  </button>
                  <button
                    className="furniture-panel__lib-remove"
                    onClick={() => onRemoveFromLibrary(entry)}
                    title="Remove from the library (items already placed stay)"
                    aria-label={`Remove ${entry.label} from the library`}
                  >
                    ×
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

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
                {preset.kind !== "zone" && (
                  <label>
                    <span>H</span>
                    <DimensionInput valueCm={preset.height} unit={unit} onChange={(v) => onUpdatePreset(preset.id, { height: v })} />
                  </label>
                )}
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
              <NameInput value={item.label} onChange={(label) => onUpdate(item.id, { label })} />
              {item.kind === "zone" && <div className="furniture-panel__area mono">{formatArea(item.width, item.depth)}</div>}
              <div className="furniture-panel__dims mono">
                <label>
                  <span>L</span>
                  <DimensionInput valueCm={item.width} unit={unit} onChange={(v) => onUpdate(item.id, { width: v })} onClick={(e) => e.stopPropagation()} commitOnEnter />
                  <span className="furniture-panel__unit">{unit}</span>
                </label>
                <label>
                  <span>D</span>
                  <DimensionInput valueCm={item.depth} unit={unit} onChange={(v) => onUpdate(item.id, { depth: v })} onClick={(e) => e.stopPropagation()} commitOnEnter />
                  <span className="furniture-panel__unit">{unit}</span>
                </label>
                {item.kind !== "zone" && (
                  <label>
                    <span>H</span>
                    <DimensionInput valueCm={item.height} unit={unit} onChange={(v) => onUpdate(item.id, { height: v })} onClick={(e) => e.stopPropagation()} commitOnEnter />
                    <span className="furniture-panel__unit">{unit}</span>
                  </label>
                )}
              </div>
              <div className="furniture-panel__rotate mono">
                <span>Rotate</span>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onUpdate(item.id, { rotation: rotateBy(item.rotation, -(e.shiftKey ? ROTATE_STEP_LARGE : ROTATE_STEP)) });
                  }}
                  title={`Rotate ${ROTATE_STEP}° anticlockwise (Shift: ${ROTATE_STEP_LARGE}°)`}
                >
                  ⟲
                </button>
                <AngleInput className="furniture-panel__angle" degrees={item.rotation} onChange={(rotation) => onUpdate(item.id, { rotation })} />
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onUpdate(item.id, { rotation: rotateBy(item.rotation, e.shiftKey ? ROTATE_STEP_LARGE : ROTATE_STEP) });
                  }}
                  title={`Rotate ${ROTATE_STEP}° clockwise (Shift: ${ROTATE_STEP_LARGE}°)`}
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
