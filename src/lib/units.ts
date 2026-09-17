export type Unit = "mm" | "cm" | "m";

const FACTOR: Record<Unit, number> = { mm: 10, cm: 1, m: 0.01 };
const SUFFIX: Record<Unit, string> = { mm: " mm", cm: " cm", m: " m" };
// Every unit shows to the millimetre: 4567 mm, 456.7 cm, 4.567 m.
const PRECISION: Record<Unit, number> = { mm: 0, cm: 1, m: 3 };

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

// "1800 ×", "750 ×", "900 mm" — dimensions with the unit written once at the end, split
// into pieces a label can wrap between.
export function dimensionTokens(valuesCm: number[], unit: Unit): string[] {
  return valuesCm.map((v, i) => {
    const n = fromCm(v, unit).toFixed(PRECISION[unit]);
    return i < valuesCm.length - 1 ? `${n} ×` : `${n}${SUFFIX[unit]}`;
  });
}

// The drawing scale (cm per canvas px) in the room's unit, with enough digits to be useful
// even in metres: "17.431 mm", "1.7431 cm", "0.017431 m".
export function formatScale(cmPerPx: number, unit: Unit): string {
  return formatLength(cmPerPx, unit, PRECISION[unit] + 3);
}

export function formatDimensions(valuesCm: number[], unit: Unit): string {
  return dimensionTokens(valuesCm, unit).join(" ");
}
