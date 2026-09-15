import { useEffect, useRef, useState, type ReactNode } from "react";

interface DraggablePanelProps {
  title: string;
  children: ReactNode;
  defaultPosition: { x: number; y: number };
  width?: number;
  height?: number;
  zIndex: number;
  onFocus: () => void;
}

function clamp(pos: { x: number; y: number }, width: number) {
  const margin = 40;
  const maxX = Math.max(margin, window.innerWidth - margin);
  const maxY = Math.max(margin, window.innerHeight - margin);
  return {
    x: Math.min(Math.max(pos.x, 0), Math.max(0, maxX - width)),
    y: Math.min(Math.max(pos.y, 0), maxY - 28),
  };
}

export default function DraggablePanel({ title, children, defaultPosition, width = 220, height, zIndex, onFocus }: DraggablePanelProps) {
  const [position, setPosition] = useState(() => clamp(defaultPosition, width));
  const [collapsed, setCollapsed] = useState(false);
  const dragRef = useRef<{ startX: number; startY: number; originX: number; originY: number } | null>(null);

  useEffect(() => {
    function handleResize() {
      setPosition((p) => clamp(p, width));
    }
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, [width]);

  function handleHeaderMouseDown(e: React.MouseEvent) {
    onFocus();
    dragRef.current = { startX: e.clientX, startY: e.clientY, originX: position.x, originY: position.y };
    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
  }

  function handleMouseMove(e: MouseEvent) {
    if (!dragRef.current) return;
    const dx = e.clientX - dragRef.current.startX;
    const dy = e.clientY - dragRef.current.startY;
    setPosition(clamp({ x: dragRef.current.originX + dx, y: dragRef.current.originY + dy }, width));
  }

  function handleMouseUp() {
    dragRef.current = null;
    window.removeEventListener("mousemove", handleMouseMove);
    window.removeEventListener("mouseup", handleMouseUp);
  }

  return (
    <div
      className="draggable-panel"
      style={{ left: position.x, top: position.y, width, height, zIndex }}
      onMouseDown={onFocus}
    >
      <div className="draggable-panel__header" onMouseDown={handleHeaderMouseDown}>
        <span className="mono">{title}</span>
        <button className="draggable-panel__collapse" onClick={() => setCollapsed((c) => !c)}>
          {collapsed ? "▢" : "—"}
        </button>
      </div>
      {!collapsed && <div className="draggable-panel__body">{children}</div>}
    </div>
  );
}
