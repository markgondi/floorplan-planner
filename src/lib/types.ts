import type { Point } from "./geometry";
import type { Unit } from "./units";

export type FurnitureShape = "rect" | "circle" | "lshape";
export type FurnitureKind = "generic" | "screen" | "shelf" | "bench" | "wall" | "door" | "reader";

export interface Furniture {
  id: string;
  roomId: string;
  label: string;
  shape: FurnitureShape;
  kind: FurnitureKind;
  width: number;
  depth: number;
  height: number;
  elevation: number;
  x: number;
  y: number;
  rotation: number;
  color: string;
}

export interface FurniturePreset {
  id: string;
  label: string;
  kind: FurnitureKind;
  width: number;
  depth: number;
  height: number;
  elevation: number;
  color: string;
}

// One colour per kind so the plan reads consistently: neutral greys for structure,
// blue-grey for technology, warm neutrals for furniture, the accent for access control.
// Colour isn't user-editable, so rendering derives from this rather than stored values.
export const KIND_COLOR: Record<FurnitureKind, string> = {
  wall: "#6b7076",
  door: "#8a9299",
  reader: "#c47f5e",
  screen: "#4a5560",
  shelf: "#8a7f6e",
  bench: "#9a8a72",
  generic: "#7d8288",
};

export const KIND_LABEL: Record<FurnitureKind, string> = {
  wall: "Wall",
  door: "Door",
  reader: "Access Reader",
  screen: "Screen",
  shelf: "Shelf",
  bench: "Bench",
  generic: "Custom",
};

// Colours people can give an item, chosen to read well on both the dark and light canvas.
export const ITEM_PALETTE: { name: string; value: string }[] = [
  { name: "Slate", value: "#5f7c99" },
  { name: "Teal", value: "#4f8a84" },
  { name: "Sage", value: "#7c9a6c" },
  { name: "Sand", value: "#b59b6d" },
  { name: "Terracotta", value: "#c47f5e" },
  { name: "Plum", value: "#8d6c92" },
  { name: "Steel", value: "#7d8288" },
  { name: "Charcoal", value: "#4b5057" },
];

// An item's fill: the palette colour chosen for it, otherwise its kind's default. Colours
// saved by older versions of the app (outside the palette) are ignored rather than revived.
export function itemColor(item: Pick<Furniture, "kind" | "color">): string {
  const chosen = item.color?.toLowerCase();
  return chosen && ITEM_PALETTE.some((p) => p.value === chosen) ? chosen : KIND_COLOR[item.kind];
}

// The preset type an item was placed from — or null when its name already says so (an
// unrenamed "Door" doesn't need "DOOR"), or when it came from Custom Item, where the tag
// says nothing useful.
export function itemOrigin(item: Pick<Furniture, "kind" | "label">): string | null {
  if (item.kind === "generic") return null;
  const name = item.label.trim().toLowerCase();
  const type = KIND_LABEL[item.kind];
  const preset = FURNITURE_PRESETS.find((p) => p.kind === item.kind);
  if (name === type.toLowerCase() || (preset && name === preset.label.toLowerCase())) return null;
  return type;
}

export const FURNITURE_PRESETS: FurniturePreset[] = [
  { id: "wall", label: "Wall", kind: "wall", width: 200, depth: 10, height: 240, elevation: 0, color: KIND_COLOR.wall },
  { id: "door", label: "Door", kind: "door", width: 90, depth: 5, height: 200, elevation: 0, color: KIND_COLOR.door },
  { id: "access-reader", label: "Access Reader", kind: "reader", width: 10, depth: 10, height: 12, elevation: 110, color: KIND_COLOR.reader },
  { id: "screen-34", label: '34" Curved Monitor', kind: "screen", width: 80, depth: 12, height: 50, elevation: 75, color: KIND_COLOR.screen },
  { id: "shelf-unit", label: "Shelf Unit", kind: "shelf", width: 90, depth: 35, height: 180, elevation: 0, color: KIND_COLOR.shelf },
  { id: "bench", label: "Bench", kind: "bench", width: 120, depth: 45, height: 45, elevation: 0, color: KIND_COLOR.bench },
  { id: "custom-item", label: "Custom Item", kind: "generic", width: 60, depth: 60, height: 60, elevation: 0, color: KIND_COLOR.generic },
];

export interface Room {
  id: string;
  name: string;
  folderId: string | null;
  ceilingHeight: number;
  scalePxPerUnit: number;
  unit: Unit;
  floorplanImageUrl: string | null;
  outline: Point[];
  furniture: Furniture[];
}

export interface Folder {
  id: string;
  name: string;
}

export interface Comment {
  id: string;
  roomId: string;
  x: number;
  y: number;
  author: string | null;
  text: string;
  resolved: boolean;
  createdAt: string;
}
