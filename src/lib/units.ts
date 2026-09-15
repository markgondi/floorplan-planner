export type Unit = "cm" | "in";

// Canonical storage unit is always cm.
export function fromCm(valueCm: number, unit: Unit): number {
  return unit === "cm" ? valueCm : valueCm / 2.54;
}

export function toCm(value: number, unit: Unit): number {
  return unit === "cm" ? value : value * 2.54;
}

export function formatLength(valueCm: number, unit: Unit, precision = 1): string {
  const converted = fromCm(valueCm, unit);
  return `${converted.toFixed(precision)}${unit === "cm" ? " cm" : '"'}`;
}
