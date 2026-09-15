import type { Unit } from "./units";
import { formatLength } from "./units";

interface ExportMeta {
  roomName: string;
  unit: Unit;
  scalePxPerUnit: number;
  perimeterCm?: number;
}

const CSS_VAR_PATTERN = /var\((--[a-zA-Z0-9-]+)\)/g;

function resolveCssVars(svgMarkup: string): string {
  const styles = getComputedStyle(document.documentElement);
  const appShell = document.querySelector(".app-shell");
  const shellStyles = appShell ? getComputedStyle(appShell) : null;
  return svgMarkup.replace(CSS_VAR_PATTERN, (match, varName) => {
    const fromShell = shellStyles?.getPropertyValue(varName)?.trim();
    const fromRoot = styles.getPropertyValue(varName)?.trim();
    return fromShell || fromRoot || match;
  });
}

export function exportSvgAsPng(svg: SVGSVGElement, viewW: number, viewH: number, meta: ExportMeta) {
  const clone = svg.cloneNode(true) as SVGSVGElement;
  clone.setAttribute("width", String(viewW));
  clone.setAttribute("height", String(viewH));
  clone.removeAttribute("style");

  const serialized = resolveCssVars(new XMLSerializer().serializeToString(clone));
  const svgBlob = new Blob([serialized], { type: "image/svg+xml;charset=utf-8" });
  const svgUrl = URL.createObjectURL(svgBlob);

  const scale = 2;
  const titleBarHeight = 70;
  const img = new Image();
  img.onload = () => {
    const canvas = document.createElement("canvas");
    canvas.width = viewW * scale;
    canvas.height = (viewH + titleBarHeight) * scale;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.fillStyle = "#131110";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, viewW * scale, viewH * scale);

    const barY = viewH * scale;
    ctx.fillStyle = "#f7f1e3";
    ctx.fillRect(0, barY, canvas.width, titleBarHeight * scale);
    ctx.strokeStyle = "#2a2721";
    ctx.lineWidth = 2 * scale;
    ctx.beginPath();
    ctx.moveTo(0, barY);
    ctx.lineTo(canvas.width, barY);
    ctx.stroke();

    ctx.fillStyle = "#2a2721";
    ctx.font = `${16 * scale}px "Cascadia Code", Consolas, monospace`;
    ctx.textBaseline = "middle";
    const textY = barY + (titleBarHeight * scale) / 2;
    ctx.fillText(`ROOM: ${meta.roomName.toUpperCase()}`, 20 * scale, textY);

    const dateStr = new Date().toLocaleDateString();
    const scaleStr = meta.scalePxPerUnit
      ? `SCALE 1PX = ${formatLength(meta.scalePxPerUnit, meta.unit, 3)}`
      : "SCALE NOT SET";
    const perimeterStr = meta.perimeterCm ? `PERIMETER ${formatLength(meta.perimeterCm, meta.unit)}` : null;
    const rightText = [scaleStr, perimeterStr, dateStr].filter(Boolean).join("   |   ");
    const textWidth = ctx.measureText(rightText).width;
    ctx.fillText(rightText, canvas.width - textWidth - 20 * scale, textY);

    canvas.toBlob((blob) => {
      if (!blob) return;
      const pngUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = pngUrl;
      a.download = `${meta.roomName.replace(/[^a-z0-9]+/gi, "-").toLowerCase() || "floorplan"}.png`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(pngUrl);
      URL.revokeObjectURL(svgUrl);
    }, "image/png");
  };
  img.onerror = () => {
    URL.revokeObjectURL(svgUrl);
    window.alert("Export failed to render. Try again, or reduce the number of items on the canvas.");
  };
  img.src = svgUrl;
}
