import type { Point } from "./geometry";
import type { Unit } from "./units";

export type FurnitureShape = "rect" | "circle" | "lshape";
export type FurnitureKind = "generic" | "screen" | "shelf" | "bench";

export interface Furniture {
  id: string;
  roomId: string;
  label: string;
  shape: FurnitureShape;
  kind: FurnitureKind;
  width: number;
  depth: number;
  x: number;
  y: number;
  rotation: number;
  color: string;
}

export interface FurniturePreset {
  label: string;
  kind: FurnitureKind;
  width: number;
  depth: number;
  color: string;
}

export const FURNITURE_PRESETS: FurniturePreset[] = [
  { label: '34" Curved Monitor', kind: "screen", width: 80, depth: 12, color: "#2a2721" },
  { label: "Shelf Unit", kind: "shelf", width: 90, depth: 35, color: "#8a6a45" },
  { label: "Bench", kind: "bench", width: 120, depth: 45, color: "#a9754e" },
  { label: "Custom Box", kind: "generic", width: 60, depth: 60, color: "#b3593a" },
];

export interface Room {
  id: string;
  name: string;
  scalePxPerUnit: number;
  unit: Unit;
  floorplanImageUrl: string | null;
  outline: Point[];
  furniture: Furniture[];
}
