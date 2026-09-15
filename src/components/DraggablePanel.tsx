import { useRef, useState, type ReactNode } from "react";

interface DraggablePanelProps {
  title: string;
  children: ReactNode;
  defaultPosition: { x: number; y: number };
  width?: number;
  zIndex: number;
  onFocus: () => void;
}

export default function DraggablePanel({ title, children, defaultPosition, width = 220, zIndex, onFocus }: DraggablePanelProps) {
  const [position, setPosition] = useState(defaultPosition);
  const [collapsed, setCollapsed] = useState(false);
  const dragRef = useRef<{ startX: number; startY: number; originX: number; originY: number } | null>(null);

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
    setPosition({ x: dragRef.current.originX + dx, y: dragRef.current.originY + dy });
  }

  function handleMouseUp() {
    dragRef.current = null;
    window.removeEventListener("mousemove", handleMouseMove);
    window.removeEventListener("mouseup", handleMouseUp);
  }

  return (
    <div
      className="draggable-panel"
      style={{ left: position.x, top: position.y, width, zIndex }}
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
