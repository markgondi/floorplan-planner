import { useEffect, useRef, useState } from "react";
import "./App.css";
import Header from "./components/Header";
import RoomList from "./components/RoomList";
import FurniturePanel from "./components/FurniturePanel";
import CommentsPanel from "./components/CommentsPanel";
import FloorplanCanvas, { type FloorplanCanvasHandle } from "./components/FloorplanCanvas";
import SideView from "./components/SideView";
import UnitsToggle from "./components/UnitsToggle";
import DraggablePanel from "./components/DraggablePanel";
import type { Comment, Folder, Room, Furniture, FurniturePreset } from "./lib/types";
import { FURNITURE_PRESETS } from "./lib/types";
import type { Point } from "./lib/geometry";
import type { Unit } from "./lib/units";
import { fromCm, toCm } from "./lib/units";
import { computeScale } from "./lib/geometry";
import {
  createComment,
  createFolder,
  createRoom as apiCreateRoom,
  deleteComment,
  deleteFolder,
  deleteRoom,
  listComments,
  listFolders,
  listRooms,
  renameFolder,
  saveRoom,
  setCommentResolved,
} from "./lib/api";

type Mode = "trace" | "calibrate" | "place" | "pan" | "comment";

const MODE_HELP: Record<Mode, string> = {
  trace: "Click points on the canvas to draw the room's wall outline — points snap to the grid. Click near the first point to close the shape.",
  calibrate: "Click two points on a known wall segment, then enter its real-world length — or use \"Grid = 1m\" to set the scale from the grid directly.",
  place: "Drag items around the canvas. Click one to select it, then use the rotate controls or the side panel to resize it.",
  pan: "Click and drag anywhere on the canvas to move around. Nothing is added or changed while panning.",
  comment: "Click anywhere on the canvas to leave a comment pin for reviewers. Resolve or delete comments from the panel.",
};

const PRESETS_STORAGE_KEY = "floorplan-planner:presets";
const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

function loadPresets(): FurniturePreset[] {
  try {
    const saved = localStorage.getItem(PRESETS_STORAGE_KEY);
    if (saved) {
      const parsed = JSON.parse(saved) as Partial<FurniturePreset>[];
      // Backfill fields added after a preset was cached (e.g. height/elevation) so stale
      // localStorage doesn't produce blank/NaN inputs, and append any preset kinds shipped
      // after this browser last cached the list (e.g. Wall/Door/Access Reader).
      const merged = parsed
        .filter((p) => p.id)
        .map((p) => {
          const fallback = FURNITURE_PRESETS.find((d) => d.id === p.id) ?? FURNITURE_PRESETS[FURNITURE_PRESETS.length - 1];
          return { ...fallback, ...p } as FurniturePreset;
        });
      const knownIds = new Set(merged.map((p) => p.id));
      for (const preset of FURNITURE_PRESETS) {
        if (!knownIds.has(preset.id)) merged.push(preset);
      }
      return merged;
    }
  } catch {
    // ignore malformed local storage
  }
  return FURNITURE_PRESETS;
}

export default function App() {
  const [rooms, setRooms] = useState<Room[]>([]);
  const [folders, setFolders] = useState<Folder[]>([]);
  const [activeRoomId, setActiveRoomId] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>("trace");
  const [view, setView] = useState<"top" | "side">("top");
  const [theme, setTheme] = useState<"light" | "dark">("dark");
  const [selectedFurnitureId, setSelectedFurnitureId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [panelOrder, setPanelOrder] = useState<("rooms" | "items" | "comments")[]>(["rooms", "items", "comments"]);
  const [comments, setComments] = useState<Comment[]>([]);
  const [presets, setPresets] = useState<FurniturePreset[]>(loadPresets);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const didInit = useRef(false);
  const canvasRef = useRef<FloorplanCanvasHandle>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (didInit.current) return;
    didInit.current = true;
    (async () => {
      try {
        const [loaded, loadedFolders] = await Promise.all([listRooms(), listFolders().catch(() => [])]);
        setFolders(loadedFolders);
        if (loaded.length > 0) {
          setRooms(loaded);
          setActiveRoomId(loaded[0].id);
        } else {
          const room = await apiCreateRoom("Living Room");
          setRooms([room]);
          setActiveRoomId(room.id);
        }
      } catch (err) {
        setSyncError("Could not reach the server — check TURSO_DATABASE_URL / TURSO_AUTH_TOKEN and that netlify dev is running.");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(PRESETS_STORAGE_KEY, JSON.stringify(presets));
    } catch {
      // ignore write failures (private browsing, quota, etc.)
    }
  }, [presets]);

  useEffect(() => {
    if (!activeRoomId) {
      setComments([]);
      return;
    }
    listComments(activeRoomId)
      .then(setComments)
      .catch(() => setComments([]));
  }, [activeRoomId]);

  const activeRoom = rooms.find((r) => r.id === activeRoomId) ?? null;

  function updateActiveRoom(patch: Partial<Room>) {
    if (!activeRoomId) return;
    setRooms((prev) => prev.map((r) => (r.id === activeRoomId ? { ...r, ...patch } : r)));

    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      const updated = rooms.find((r) => r.id === activeRoomId);
      const next = updated ? { ...updated, ...patch } : null;
      if (!next) return;
      saveRoom(next)
        .then(() => setSyncError(null))
        .catch(() =>
          // one retry after a beat — serverless functions cold-starting is common and transient
          saveRoom(next)
            .then(() => setSyncError(null))
            .catch(() => setSyncError("Failed to save changes to the server. Your edits are still here locally — try again in a moment.")),
        );
    }, 500);
  }

  async function handleCreateRoom(folderId?: string | null) {
    const name = window.prompt("Room name:", "New Room");
    if (!name) return;
    try {
      const room = await apiCreateRoom(name, folderId ?? null);
      setRooms((prev) => [...prev, room]);
      setActiveRoomId(room.id);
    } catch {
      setSyncError("Failed to create room on the server.");
    }
  }

  async function handleMoveRoomToFolder(roomId: string, folderId: string | null) {
    const room = rooms.find((r) => r.id === roomId);
    if (!room) return;
    const next = { ...room, folderId };
    setRooms((prev) => prev.map((r) => (r.id === roomId ? next : r)));
    try {
      await saveRoom(next);
    } catch {
      setSyncError("Failed to move the room on the server.");
    }
  }

  async function handleCreateFolder() {
    const name = window.prompt("Folder name:", "New Folder");
    if (!name) return;
    try {
      const folder = await createFolder(name);
      setFolders((prev) => [...prev, folder]);
    } catch {
      setSyncError("Failed to create folder on the server.");
    }
  }

  async function handleRenameFolder(id: string) {
    const folder = folders.find((f) => f.id === id);
    if (!folder) return;
    const name = window.prompt("Rename folder:", folder.name);
    if (!name || name === folder.name) return;
    setFolders((prev) => prev.map((f) => (f.id === id ? { ...f, name } : f)));
    try {
      await renameFolder(id, name);
    } catch {
      setSyncError("Failed to rename folder on the server.");
    }
  }

  async function handleDeleteFolder(id: string) {
    const folder = folders.find((f) => f.id === id);
    if (!folder) return;
    if (!window.confirm(`Delete folder "${folder.name}"? Its rooms will move to Ungrouped, not be deleted.`)) return;
    setFolders((prev) => prev.filter((f) => f.id !== id));
    setRooms((prev) => prev.map((r) => (r.folderId === id ? { ...r, folderId: null } : r)));
    try {
      await deleteFolder(id);
    } catch {
      setSyncError("Failed to delete folder on the server.");
    }
  }

  async function handleRenameRoom(id: string) {
    const room = rooms.find((r) => r.id === id);
    if (!room) return;
    const name = window.prompt("Rename room:", room.name);
    if (!name || name === room.name) return;
    const next = { ...room, name };
    setRooms((prev) => prev.map((r) => (r.id === id ? next : r)));
    try {
      await saveRoom(next);
    } catch {
      setSyncError("Failed to save the room name to the server.");
    }
  }

  async function handleDeleteRoom(id: string) {
    const room = rooms.find((r) => r.id === id);
    if (!room) return;
    if (!window.confirm(`Delete "${room.name}"? This removes its outline and all placed items — this can't be undone.`)) return;
    const remaining = rooms.filter((r) => r.id !== id);
    setRooms(remaining);
    if (activeRoomId === id) setActiveRoomId(remaining[0]?.id ?? null);
    try {
      await deleteRoom(id);
    } catch {
      setSyncError("Failed to delete the room on the server.");
    }
  }

  function handleUndoOutlinePoint() {
    if (!activeRoom || activeRoom.outline.length === 0) return;
    updateActiveRoom({ outline: activeRoom.outline.slice(0, -1) });
  }

  function handleClearOutline() {
    if (!activeRoom || activeRoom.outline.length === 0) return;
    if (!window.confirm("Clear the traced outline for this room?")) return;
    updateActiveRoom({ outline: [] });
  }

  function handleCalibrate(pixelDistance: number, realLength: number) {
    updateActiveRoom({ scalePxPerUnit: computeScale(pixelDistance, realLength) });
  }

  function handleSetGridScale() {
    // Major grid squares are 100 canvas px apart; this makes one square exactly 1 metre.
    updateActiveRoom({ scalePxPerUnit: 1 });
  }

  function handleAddPreset(preset: FurniturePreset) {
    if (!activeRoom) return;
    const offset = (activeRoom.furniture.length % 6) * 30;
    const item: Furniture = {
      id: crypto.randomUUID(),
      roomId: activeRoom.id,
      label: preset.label,
      shape: "rect",
      kind: preset.kind,
      width: preset.width,
      depth: preset.depth,
      height: preset.height,
      elevation: preset.elevation,
      x: 800 + offset,
      y: 550 + offset,
      rotation: 0,
      color: preset.color,
    };
    updateActiveRoom({ furniture: [...activeRoom.furniture, item] });
    setSelectedFurnitureId(item.id);
  }

  function handleUpdatePreset(id: string, patch: Partial<FurniturePreset>) {
    setPresets((prev) => prev.map((p) => (p.id === id ? { ...p, ...patch } : p)));
  }

  function handleUpdateFurniture(id: string, patch: Partial<Furniture>) {
    if (!activeRoom) return;
    updateActiveRoom({
      furniture: activeRoom.furniture.map((f) => (f.id === id ? { ...f, ...patch } : f)),
    });
  }

  function handleDeleteFurniture(id: string) {
    if (!activeRoom) return;
    updateActiveRoom({ furniture: activeRoom.furniture.filter((f) => f.id !== id) });
    if (selectedFurnitureId === id) setSelectedFurnitureId(null);
  }

  function handleDuplicateFurniture(id: string) {
    if (!activeRoom) return;
    const source = activeRoom.furniture.find((f) => f.id === id);
    if (!source) return;
    const copy: Furniture = { ...source, id: crypto.randomUUID(), x: source.x + 20, y: source.y + 20 };
    updateActiveRoom({ furniture: [...activeRoom.furniture, copy] });
  }

  function handleUnitChange(unit: Unit) {
    updateActiveRoom({ unit });
  }

  function handleCeilingHeightChange(valueInCurrentUnit: number) {
    if (!activeRoom) return;
    updateActiveRoom({ ceilingHeight: toCm(valueInCurrentUnit, activeRoom.unit) });
  }

  function bringToFront(panel: "rooms" | "items" | "comments") {
    setPanelOrder((prev) => [...prev.filter((p) => p !== panel), panel]);
  }

  async function handleAddComment(point: Point) {
    if (!activeRoom) return;
    const text = window.prompt("Add a comment:");
    if (!text) return;
    try {
      const comment = await createComment(activeRoom.id, point.x, point.y, text);
      setComments((prev) => [...prev, comment]);
    } catch {
      setSyncError("Failed to save the comment to the server.");
    }
  }

  async function handleResolveComment(id: string, resolved: boolean) {
    setComments((prev) => prev.map((c) => (c.id === id ? { ...c, resolved } : c)));
    try {
      await setCommentResolved(id, resolved);
    } catch {
      setSyncError("Failed to update the comment on the server.");
    }
  }

  async function handleDeleteComment(id: string) {
    setComments((prev) => prev.filter((c) => c.id !== id));
    try {
      await deleteComment(id);
    } catch {
      setSyncError("Failed to delete the comment on the server.");
    }
  }

  function handleUploadClick() {
    fileInputRef.current?.click();
  }

  function handleRemoveFloorplanImage() {
    if (!activeRoom?.floorplanImageUrl) return;
    if (!window.confirm("Remove the uploaded floorplan image? The traced outline and items stay.")) return;
    updateActiveRoom({ floorplanImageUrl: null });
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (file.size > MAX_UPLOAD_BYTES) {
      window.alert("That image is over 5MB — please use a smaller file.");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => updateActiveRoom({ floorplanImageUrl: reader.result as string });
    reader.readAsDataURL(file);
  }

  if (loading) {
    return (
      <div className="app-shell" data-theme={theme}>
        <Header theme={theme} onToggleTheme={() => setTheme((t) => (t === "light" ? "dark" : "light"))} />
        <div className="app-main__empty">Loading rooms…</div>
      </div>
    );
  }

  return (
    <div className="app-shell" data-theme={theme}>
      <Header theme={theme} onToggleTheme={() => setTheme((t) => (t === "light" ? "dark" : "light"))} />
      {syncError && (
        <div className="sync-banner">
          <span>{syncError}</span>
          <button className="sync-banner__dismiss" onClick={() => setSyncError(null)}>
            Dismiss
          </button>
        </div>
      )}

      {activeRoom && (
        <div className="mode-bar">
          <div className="mode-bar__modes">
            <button className={mode === "trace" ? "active" : ""} onClick={() => setMode("trace")} title={MODE_HELP.trace}>
              Trace outline
            </button>
            <button className={mode === "calibrate" ? "active" : ""} onClick={() => setMode("calibrate")} title={MODE_HELP.calibrate}>
              Calibrate scale
            </button>
            <button className={mode === "place" ? "active" : ""} onClick={() => setMode("place")} title={MODE_HELP.place}>
              Place items
            </button>
            <button className={mode === "pan" ? "active" : ""} onClick={() => setMode("pan")} title={MODE_HELP.pan}>
              Pan canvas
            </button>
            <button className={mode === "comment" ? "active" : ""} onClick={() => setMode("comment")} title={MODE_HELP.comment}>
              Comment
            </button>
            {mode === "trace" && activeRoom.outline.length > 0 && (
              <>
                <span className="mode-bar__divider" />
                <button onClick={handleUndoOutlinePoint} title="Remove the last traced point">
                  Undo Point
                </button>
                <button onClick={handleClearOutline} title="Clear the whole traced outline">
                  Clear Outline
                </button>
              </>
            )}
            {mode === "calibrate" && (
              <>
                <span className="mode-bar__divider" />
                <button onClick={handleSetGridScale} title="Set the scale so one major grid square equals exactly 1 metre">
                  Grid = 1m
                </button>
              </>
            )}
          </div>
          <div className="mode-bar__right">
            <div className="units-toggle mono">
              <button className={view === "top" ? "active" : ""} onClick={() => setView("top")} title="Top-down plan view">
                Top
              </button>
              <button className={view === "side" ? "active" : ""} onClick={() => setView("side")} title="Side elevation view — items projected along one wall">
                Side
              </button>
            </div>
            {view === "side" && (
              <label className="mode-bar__ceiling mono" title="Ceiling height used for the dashed reference line in Side view">
                Ceiling
                <input
                  type="number"
                  value={fromCm(activeRoom.ceilingHeight, activeRoom.unit).toFixed(1)}
                  onChange={(e) => handleCeilingHeightChange(Number(e.target.value))}
                />
                <span>{activeRoom.unit}</span>
              </label>
            )}
            <UnitsToggle unit={activeRoom.unit} onChange={handleUnitChange} />
            <button onClick={handleUploadClick}>Upload Floorplan</button>
            {activeRoom.floorplanImageUrl && (
              <button onClick={handleRemoveFloorplanImage} title="Remove the uploaded floorplan image">
                Remove Floorplan
              </button>
            )}
            <input ref={fileInputRef} type="file" accept="image/*" hidden onChange={handleFileChange} />
            <button onClick={() => canvasRef.current?.exportPng()} disabled={view === "side"} title={view === "side" ? "Switch to Top view to export" : undefined}>
              Export PNG
            </button>
          </div>
        </div>
      )}
      {activeRoom && <div className="mode-bar__status mono">{MODE_HELP[mode]}</div>}

      <div className="app-body">
        {activeRoom ? (
          view === "top" ? (
            <FloorplanCanvas
              ref={canvasRef}
              roomName={activeRoom.name}
              outline={activeRoom.outline}
              scalePxPerUnit={activeRoom.scalePxPerUnit}
              unit={activeRoom.unit}
              furniture={activeRoom.furniture}
              comments={comments}
              selectedFurnitureId={selectedFurnitureId}
              imageUrl={activeRoom.floorplanImageUrl}
              mode={mode}
              onOutlineChange={(outline) => updateActiveRoom({ outline })}
              onCalibrate={handleCalibrate}
              onFurnitureChange={handleUpdateFurniture}
              onSelectFurniture={setSelectedFurnitureId}
              onAddComment={handleAddComment}
            />
          ) : (
            <SideView
              furniture={activeRoom.furniture}
              scalePxPerUnit={activeRoom.scalePxPerUnit}
              unit={activeRoom.unit}
              ceilingHeightCm={activeRoom.ceilingHeight}
              selectedFurnitureId={selectedFurnitureId}
              onSelectFurniture={setSelectedFurnitureId}
            />
          )
        ) : (
          <div className="app-main__empty">Create a room to get started.</div>
        )}

        <DraggablePanel
          title="ROOMS"
          defaultPosition={{ x: 16, y: 16 }}
          width={260}
          height={340}
          zIndex={panelOrder.indexOf("rooms") + 10}
          onFocus={() => bringToFront("rooms")}
        >
          <RoomList
            rooms={rooms}
            folders={folders}
            activeRoomId={activeRoomId}
            onSelect={setActiveRoomId}
            onCreate={handleCreateRoom}
            onRename={handleRenameRoom}
            onDelete={handleDeleteRoom}
            onMoveToFolder={handleMoveRoomToFolder}
            onCreateFolder={handleCreateFolder}
            onRenameFolder={handleRenameFolder}
            onDeleteFolder={handleDeleteFolder}
          />
        </DraggablePanel>

        {activeRoom && (
          <DraggablePanel
            title="ITEMS"
            defaultPosition={{ x: Math.max(220, window.innerWidth - 340), y: 16 }}
            width={320}
            height={520}
            zIndex={panelOrder.indexOf("items") + 10}
            onFocus={() => bringToFront("items")}
          >
            <FurniturePanel
              furniture={activeRoom.furniture}
              unit={activeRoom.unit}
              selectedId={selectedFurnitureId}
              presets={presets}
              onSelect={setSelectedFurnitureId}
              onAddPreset={handleAddPreset}
              onUpdatePreset={handleUpdatePreset}
              onUpdate={handleUpdateFurniture}
              onDelete={handleDeleteFurniture}
              onDuplicate={handleDuplicateFurniture}
            />
          </DraggablePanel>
        )}

        {activeRoom && (
          <DraggablePanel
            title={`COMMENTS${comments.filter((c) => !c.resolved).length > 0 ? ` (${comments.filter((c) => !c.resolved).length})` : ""}`}
            defaultPosition={{ x: 16, y: Math.max(180, window.innerHeight - 340) }}
            width={260}
            height={300}
            zIndex={panelOrder.indexOf("comments") + 10}
            onFocus={() => bringToFront("comments")}
          >
            <CommentsPanel comments={comments} onResolve={handleResolveComment} onDelete={handleDeleteComment} />
          </DraggablePanel>
        )}
      </div>
    </div>
  );
}
