import type { Folder, Room } from "../lib/types";

interface RoomListProps {
  rooms: Room[];
  folders: Folder[];
  activeRoomId: string | null;
  onSelect: (id: string) => void;
  onCreate: (folderId?: string | null) => void;
  onRename: (id: string) => void;
  onDuplicate: (id: string) => void;
  onToggleLock: (id: string) => void;
  onDelete: (id: string) => void;
  onMoveToFolder: (roomId: string, folderId: string | null) => void;
  onCreateFolder: () => void;
  onRenameFolder: (id: string) => void;
  onDeleteFolder: (id: string) => void;
}

function RoomRow({
  room,
  folders,
  isActive,
  onSelect,
  onRename,
  onDuplicate,
  onToggleLock,
  onDelete,
  onMoveToFolder,
}: {
  room: Room;
  folders: Folder[];
  isActive: boolean;
  onSelect: (id: string) => void;
  onRename: (id: string) => void;
  onDuplicate: (id: string) => void;
  onToggleLock: (id: string) => void;
  onDelete: (id: string) => void;
  onMoveToFolder: (roomId: string, folderId: string | null) => void;
}) {
  return (
    <li className="room-list__row">
      <button
        className={isActive ? "room-list__item room-list__item--active" : "room-list__item"}
        onClick={() => onSelect(room.id)}
      >
        {room.name}
      </button>
      <select
        className="room-list__folder-select"
        value={room.folderId ?? ""}
        title="Move to folder"
        onClick={(e) => e.stopPropagation()}
        onChange={(e) => onMoveToFolder(room.id, e.target.value || null)}
      >
        <option value="">No folder</option>
        {folders.map((f) => (
          <option key={f.id} value={f.id}>
            {f.name}
          </option>
        ))}
      </select>
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
        className="room-list__duplicate"
        title="Duplicate room — a copy with its outline, scale, plan image and all items"
        aria-label="Duplicate room"
        onClick={(e) => {
          e.stopPropagation();
          onDuplicate(room.id);
        }}
      >
        <svg viewBox="0 0 12 12" width="11" height="11" fill="none" stroke="currentColor" strokeWidth="1.1">
          <rect x="3.5" y="3.5" width="7" height="7" rx="1" />
          <path d="M8.5 1.5h-6a1 1 0 00-1 1v6" />
        </svg>
      </button>
      <button
        className={room.locked ? "room-list__lock room-list__lock--on" : "room-list__lock"}
        title={room.locked ? "Locked — click to unlock and allow changes" : "Lock this room so it can't be changed"}
        aria-label={room.locked ? `Unlock ${room.name}` : `Lock ${room.name}`}
        aria-pressed={!!room.locked}
        onClick={(e) => {
          e.stopPropagation();
          onToggleLock(room.id);
        }}
      >
        {room.locked ? "🔒" : "🔓"}
      </button>
      <button
        className="room-list__delete"
        title={room.locked ? "Unlock the room before deleting it" : "Delete room"}
        onClick={(e) => {
          e.stopPropagation();
          onDelete(room.id);
        }}
      >
        🗑
      </button>
    </li>
  );
}

export default function RoomList({
  rooms,
  folders,
  activeRoomId,
  onSelect,
  onCreate,
  onRename,
  onDuplicate,
  onToggleLock,
  onDelete,
  onMoveToFolder,
  onCreateFolder,
  onRenameFolder,
  onDeleteFolder,
}: RoomListProps) {
  const ungrouped = rooms.filter((r) => !r.folderId);

  return (
    <nav className="room-list">
      <div className="room-list__header">
        <button onClick={() => onCreate(null)}>+ New Room</button>
        <button onClick={onCreateFolder} title="New folder">
          + Folder
        </button>
      </div>

      {folders.map((folder) => {
        const roomsInFolder = rooms.filter((r) => r.folderId === folder.id);
        return (
          <div key={folder.id} className="room-list__folder">
            <div className="room-list__folder-header">
              <span>📁 {folder.name}</span>
              <div className="room-list__folder-actions">
                <button title="Add room to this folder" onClick={() => onCreate(folder.id)}>
                  +
                </button>
                <button title="Rename folder" onClick={() => onRenameFolder(folder.id)}>
                  ✎
                </button>
                <button title="Delete folder" onClick={() => onDeleteFolder(folder.id)}>
                  🗑
                </button>
              </div>
            </div>
            <ul>
              {roomsInFolder.map((room) => (
                <RoomRow
                  key={room.id}
                  room={room}
                  folders={folders}
                  isActive={room.id === activeRoomId}
                  onSelect={onSelect}
                  onRename={onRename}
                  onDuplicate={onDuplicate}
                  onToggleLock={onToggleLock}
                  onDelete={onDelete}
                  onMoveToFolder={onMoveToFolder}
                />
              ))}
              {roomsInFolder.length === 0 && <li className="room-list__empty">Empty</li>}
            </ul>
          </div>
        );
      })}

      {folders.length > 0 && <div className="room-list__folder-header room-list__folder-header--plain">UNGROUPED</div>}
      <ul>
        {ungrouped.map((room) => (
          <RoomRow
            key={room.id}
            room={room}
            folders={folders}
            isActive={room.id === activeRoomId}
            onSelect={onSelect}
            onRename={onRename}
            onDuplicate={onDuplicate}
            onToggleLock={onToggleLock}
            onDelete={onDelete}
            onMoveToFolder={onMoveToFolder}
          />
        ))}
        {rooms.length === 0 && <li className="room-list__empty">No rooms yet</li>}
      </ul>
    </nav>
  );
}
