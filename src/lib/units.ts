export type Unit = "mm" | "cm" | "m";

const FACTOR: Record<Unit, number> = { mm: 10, cm: 1, m: 0.01 };
const SUFFIX: Record<Unit, string> = { mm: " mm", cm: " cm", m: " m" };
const PRECISION: Record<Unit, number> = { mm: 0, cm: 1, m: 2 };

// Canonical storage unit is always cm.
export function fromCm(valueCm: number, unit: Unit): number {
  return valueCm * FACTOR[unit];
}

export function toCm(value: number, unit: Unit): number {
  return value / FACTOR[unit];
}

export function formatLength(valueCm: number, unit: Unit, precision = PRECISION[unit]): string {
  const converted = fromCm(valueCm, unit);
  return `${converted.toFixed(precision)}${SUFFIX[unit]}`;
}
