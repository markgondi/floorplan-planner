import type { Room } from "../lib/types";

interface RoomListProps {
  rooms: Room[];
  activeRoomId: string | null;
  onSelect: (id: string) => void;
  onCreate: () => void;
  onRename: (id: string) => void;
  onDelete: (id: string) => void;
}

export default function RoomList({ rooms, activeRoomId, onSelect, onCreate, onRename, onDelete }: RoomListProps) {
  return (
    <nav className="room-list">
      <div className="room-list__header">
        <button onClick={onCreate}>+ New Room</button>
      </div>
      <ul>
        {rooms.map((room) => (
          <li key={room.id} className="room-list__row">
            <button
              className={room.id === activeRoomId ? "room-list__item room-list__item--active" : "room-list__item"}
              onClick={() => onSelect(room.id)}
            >
              {room.name}
            </button>
            <button
              className="room-list__rename"
              title="Rename room"
              onClick={(e) => {
                e.stopPropagation();
                onRename(room.id);
              }}
            >
              ✎
            </button>
            <button
              className="room-list__delete"
              title="Delete room"
              onClick={(e) => {
                e.stopPropagation();
                onDelete(room.id);
              }}
            >
              🗑
            </button>
          </li>
        ))}
        {rooms.length === 0 && <li className="room-list__empty">No rooms yet</li>}
      </ul>
    </nav>
  );
}
