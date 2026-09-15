import type { Room } from "../lib/types";

interface PrintViewProps {
  room: Room;
}

export default function PrintView({ room }: PrintViewProps) {
  return (
    <div className="print-view">
      <div className="print-view__title-block mono">
        <span>ROOM: {room.name}</span>
        <span>DATE: {new Date().toLocaleDateString()}</span>
        <span>SCALE: 1 PX = {room.scalePxPerUnit} {room.unit}</span>
      </div>
      <p className="print-view__hint">Use your browser's Print dialog (Ctrl/Cmd + P) to export this room to PDF.</p>
    </div>
  );
}
