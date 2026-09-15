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

export const FURNITURE_PRESETS: FurniturePreset[] = [
  { id: "wall", label: "Wall", kind: "wall", width: 200, depth: 10, height: 240, elevation: 0, color: "#4a453b" },
  { id: "door", label: "Door", kind: "door", width: 90, depth: 5, height: 200, elevation: 0, color: "#8a7c62" },
  { id: "access-reader", label: "Access Reader", kind: "reader", width: 10, depth: 10, height: 12, elevation: 110, color: "#b3593a" },
  { id: "screen-34", label: '34" Curved Monitor', kind: "screen", width: 80, depth: 12, height: 50, elevation: 75, color: "#2a2721" },
  { id: "shelf-unit", label: "Shelf Unit", kind: "shelf", width: 90, depth: 35, height: 180, elevation: 0, color: "#8a6a45" },
  { id: "bench", label: "Bench", kind: "bench", width: 120, depth: 45, height: 45, elevation: 0, color: "#a9754e" },
  { id: "custom-item", label: "Custom Item", kind: "generic", width: 60, depth: 60, height: 60, elevation: 0, color: "#b3593a" },
];

export interface Room {
  id: string;
  name: string;
  folderId: string | null;
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
