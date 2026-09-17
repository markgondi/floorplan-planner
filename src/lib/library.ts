import type { Furniture, FurnitureKind } from "./types";

// One distinct item in the shared item library: a name, kind and size that has been made in a
// room. Sizes are in cm, like placed items.
export interface LibraryItem {
  key: string;
  id: string;
  label: string;
  kind: FurnitureKind;
  width: number;
  depth: number;
  height: number;
  elevation: number;
  color: string;
  // Removed from the library by a person; stays out even when rooms using it are saved again.
  hidden: boolean;
}

// What makes two items "the same" library item: name (ignoring case and surrounding spaces),
// kind and size to the millimetre. Used by both the app and the rooms function, so they agree.
export function libraryKey(item: Pick<Furniture, "label" | "kind" | "width" | "depth" | "height">): string {
  return [item.label.trim().toLowerCase(), item.kind, item.width.toFixed(1), item.depth.toFixed(1), item.height.toFixed(1)].join("|");
}

// Inner walls are drawn to whatever length a room needs, so each one would be a new entry;
// they're not kept in the library.
export function belongsInLibrary(item: Pick<Furniture, "kind" | "label">): boolean {
  return item.kind !== "wall" && item.label.trim() !== "";
}

// A library entry as shown in the Items panel: with the names of the rooms it's placed in.
export type LibraryEntry = LibraryItem & { rooms: string[] };
