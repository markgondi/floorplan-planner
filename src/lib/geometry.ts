export interface Point {
  x: number;
  y: number;
}

export function distance(a: Point, b: Point): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

// scale = real-world units per pixel, derived from a calibration segment.
export function computeScale(pixelDistance: number, knownRealLength: number): number {
  if (pixelDistance === 0) return 0;
  return knownRealLength / pixelDistance;
}

export function pxToReal(px: number, scaleUnitsPerPx: number): number {
  return px * scaleUnitsPerPx;
}

export function realToPx(real: number, scaleUnitsPerPx: number): number {
  return scaleUnitsPerPx === 0 ? 0 : real / scaleUnitsPerPx;
}

export function polygonPerimeterSegments(points: Point[]): { from: Point; to: Point; length: number }[] {
  const segments = [];
  for (let i = 0; i < points.length; i++) {
    const from = points[i];
    const to = points[(i + 1) % points.length];
    segments.push({ from, to, length: distance(from, to) });
  }
  return segments;
}

export function snapAngle(degrees: number, step = 15): number {
  return Math.round(degrees / step) * step;
}
