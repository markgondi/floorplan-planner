import { useEffect, useRef, useState } from "react";
import "./App.css";
import Header from "./components/Header";
import RoomList from "./components/RoomList";
import FurniturePanel from "./components/FurniturePanel";
import CommentsPanel from "./components/CommentsPanel";
import FloorplanCanvas, { type FloorplanCanvasHandle } from "./components/FloorplanCanvas";
import SideView from "./components/SideView";
import UnitsToggle from "./components/UnitsToggle";
import Sidebar from "./components/Sidebar";
import ToolRail, { type Mode } from "./components/ToolRail";
import StatusBar from "./components/StatusBar";
import type { Comment, Folder, Room, Furniture, FurniturePreset } from "./lib/types";
import { FURNITURE_PRESETS } from "./lib/types";
import type { Point } from "./lib/geometry";
import type { Unit } from "./lib/units";
import { formatLength, fromCm, toCm } from "./lib/units";
import { computeScale, mergeCollinearWalls, polygonPerimeterSegments, pxToReal } from "./lib/geometry";
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

const MODE_HELP: Record<Mode, string> = {
  select: "Select — click a wall or an item to select it. Drag empty space to pan around.",
  walls: "Walls — click points to draw the room outline. Points snap to the grid.",
  scale: "Scale — click two points on a wall of known length, then enter it. Or use Grid = 1m.",
  arrange: "Arrange — drag items to move them, then rotate or resize from the Items panel.",
  comment: "Comment — click anywhere to leave a pin for reviewers.",
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
  const [mode, setMode] = useState<Mode>("select");
  const [view, setView] = useState<"top" | "side">("top");
  const [theme, setTheme] = useState<"light" | "dark">("dark");
  const [selectedFurnitureId, setSelectedFurnitureId] = useState<string | null>(null);
  const [selectedWallIndex, setSelectedWallIndex] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [comments, setComments] = useState<Comment[]>([]);
  const [presets, setPresets] = useState<FurniturePreset[]>(loadPresets);
  const [leftCollapsed, setLeftCollapsed] = useState(false);
  const [rightCollapsed, setRightCollapsed] = useState(false);
  const [rightTab, setRightTab] = useState("items");
  const [zoom, setZoom] = useState(0.6);
  const [cursor, setCursor] = useState<Point | null>(null);
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
      } catch {
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

  useEffect(() => {
    setSelectedWallIndex(null);
    setSelectedFurnitureId(null);
  }, [activeRoomId]);

  // Side view always shows exactly one wall, so pick the first if none is chosen yet.
  useEffect(() => {
    if (view !== "side") return;
    setSelectedWallIndex((current) => {
      if (current !== null) return current;
      const room = rooms.find((r) => r.id === activeRoomId);
      const runs = room ? mergeCollinearWalls(room.outline) : [];
      return runs.length > 0 ? 0 : null;
    });
  }, [view, activeRoomId, rooms]);

  const activeRoom = rooms.find((r) => r.id === activeRoomId) ?? null;
  const wallRuns = activeRoom ? mergeCollinearWalls(activeRoom.outline) : [];
  const selectedWall = selectedWallIndex !== null ? (wallRuns[selectedWallIndex] ?? null) : null;
  const selectedItem = activeRoom?.furniture.find((f) => f.id === selectedFurnitureId) ?? null;
  const wallCount = wallRuns.length;
  const perimeterPx = activeRoom
    ? polygonPerimeterSegments(activeRoom.outline).reduce((sum, s) => sum + s.length, 0)
    : 0;

  // Selecting an item and selecting a wall are mutually exclusive, like most CAD tools.
  function handleSelectFurniture(id: string | null) {
    setSelectedFurnitureId(id);
    if (id !== null) setSelectedWallIndex(null);
  }

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
    handleSelectFurniture(item.id);
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

  async function handleAddComment(point: Point) {
    if (!activeRoom) return;
    const text = window.prompt("Add a comment:");
    if (!text) return;
    try {
      const comment = await createComment(activeRoom.id, point.x, point.y, text);
      setComments((prev) => [...prev, comment]);
      setRightTab("comments");
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
        <div className="app-loading mono">Loading rooms…</div>
      </div>
    );
  }

  const openComments = comments.filter((c) => !c.resolved).length;
  const unit = activeRoom?.unit ?? "cm";

  return (
    <div className="app-shell" data-theme={theme}>
      <Header
        theme={theme}
        onToggleTheme={() => setTheme((t) => (t === "light" ? "dark" : "light"))}
        roomName={activeRoom?.name ?? null}
        folderName={folders.find((f) => f.id === activeRoom?.folderId)?.name ?? null}
      />

      {syncError && (
        <div className="sync-banner">
          <span>{syncError}</span>
          <button className="sync-banner__dismiss" onClick={() => setSyncError(null)}>
            Dismiss
          </button>
        </div>
      )}

      {activeRoom && (
        <div className="action-bar">
          <div className="action-bar__group">
            <div className="seg mono">
              <button className={view === "top" ? "seg__btn seg__btn--active" : "seg__btn"} onClick={() => setView("top")}>
                Top
              </button>
              <button className={view === "side" ? "seg__btn seg__btn--active" : "seg__btn"} onClick={() => setView("side")}>
                Side
              </button>
            </div>
            <UnitsToggle unit={activeRoom.unit} onChange={handleUnitChange} />
            {view === "side" && wallCount > 0 && (
              <div className="stepper mono" title="Which wall this elevation is looking at">
                <button
                  className="stepper__btn"
                  onClick={() => setSelectedWallIndex(((selectedWallIndex ?? 0) - 1 + wallCount) % wallCount)}
                  disabled={wallCount < 2}
                >
                  ‹
                </button>
                <span className="stepper__value">
                  Wall {(selectedWallIndex ?? 0) + 1} <span className="stepper__of">of {wallCount}</span>
                </span>
                <button
                  className="stepper__btn"
                  onClick={() => setSelectedWallIndex(((selectedWallIndex ?? 0) + 1) % wallCount)}
                  disabled={wallCount < 2}
                >
                  ›
                </button>
              </div>
            )}
            {view === "side" && (
              <label className="field mono" title="Ceiling height for the Side view reference line">
                <span>Ceiling</span>
                <input
                  type="number"
                  value={fromCm(activeRoom.ceilingHeight, activeRoom.unit).toFixed(1)}
                  onChange={(e) => handleCeilingHeightChange(Number(e.target.value))}
                />
                <span className="field__unit">{activeRoom.unit}</span>
              </label>
            )}
          </div>

          <div className="action-bar__group">
            {mode === "walls" && activeRoom.outline.length > 0 && (
              <>
                <button className="btn-ghost" onClick={handleUndoOutlinePoint}>
                  Undo Point
                </button>
                <button className="btn-ghost" onClick={handleClearOutline}>
                  Clear Outline
                </button>
                <span className="action-bar__divider" />
              </>
            )}
            {mode === "scale" && (
              <>
                <button className="btn-ghost" onClick={handleSetGridScale} title="One major grid square = 1 metre">
                  Grid = 1m
                </button>
                <span className="action-bar__divider" />
              </>
            )}
            <button className="btn-ghost" onClick={handleUploadClick}>
              Upload Plan
            </button>
            {activeRoom.floorplanImageUrl && (
              <button className="btn-ghost" onClick={handleRemoveFloorplanImage}>
                Remove Plan
              </button>
            )}
            <input ref={fileInputRef} type="file" accept="image/*" hidden onChange={handleFileChange} />
            <button
              className="btn-primary"
              onClick={() => canvasRef.current?.exportPng()}
              disabled={view === "side"}
              title={view === "side" ? "Switch to Top view to export" : "Export this plan as a PNG"}
            >
              Export PNG
            </button>
          </div>
        </div>
      )}

      <div className="workspace">
        <ToolRail mode={mode} onModeChange={setMode} help={MODE_HELP} />

        <Sidebar side="left" title="Rooms" collapsed={leftCollapsed} onToggle={() => setLeftCollapsed((c) => !c)}>
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
        </Sidebar>

        <main className="canvas-area">
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
                onSelectFurniture={handleSelectFurniture}
                onAddComment={handleAddComment}
                selectedWallIndex={selectedWallIndex}
                onSelectWall={setSelectedWallIndex}
                zoom={zoom}
                onZoomChange={(updater) => setZoom((z) => updater(z))}
                onCursorMove={setCursor}
              />
            ) : (
              <SideView
                furniture={activeRoom.furniture}
                scalePxPerUnit={activeRoom.scalePxPerUnit}
                unit={activeRoom.unit}
                ceilingHeightCm={activeRoom.ceilingHeight}
                selectedWall={selectedWall}
                selectedWallIndex={selectedWallIndex}
                selectedFurnitureId={selectedFurnitureId}
                onSelectFurniture={handleSelectFurniture}
              />
            )
          ) : (
            <div className="canvas-area__empty mono">Create a room to get started</div>
          )}
        </main>

        {activeRoom && (
          <Sidebar
            side="right"
            title={rightTab === "items" ? "Items" : "Comments"}
            collapsed={rightCollapsed}
            onToggle={() => setRightCollapsed((c) => !c)}
            tabs={[
              { id: "items", label: "Items", badge: activeRoom.furniture.length || undefined },
              { id: "comments", label: "Comments", badge: openComments || undefined },
            ]}
            activeTab={rightTab}
            onTabChange={setRightTab}
          >
            {rightTab === "items" ? (
              <FurniturePanel
                furniture={activeRoom.furniture}
                unit={activeRoom.unit}
                selectedId={selectedFurnitureId}
                presets={presets}
                onSelect={handleSelectFurniture}
                onAddPreset={handleAddPreset}
                onUpdatePreset={handleUpdatePreset}
                onUpdate={handleUpdateFurniture}
                onDelete={handleDeleteFurniture}
                onDuplicate={handleDuplicateFurniture}
              />
            ) : (
              <CommentsPanel comments={comments} onResolve={handleResolveComment} onDelete={handleDeleteComment} />
            )}
          </Sidebar>
        )}
      </div>

      <StatusBar
        view={view}
        zoom={zoom}
        cursor={cursor}
        scalePxPerUnit={activeRoom?.scalePxPerUnit ?? 0}
        unit={unit}
        perimeterCm={
          activeRoom && activeRoom.outline.length > 1 && activeRoom.scalePxPerUnit
            ? pxToReal(perimeterPx, activeRoom.scalePxPerUnit)
            : null
        }
        selectionLabel={selectedItem ? `${selectedItem.label} · ${formatLength(selectedItem.width, unit)} × ${formatLength(selectedItem.height, unit)}` : null}
        wallLabel={
          selectedWall && selectedWallIndex !== null && activeRoom?.scalePxPerUnit
            ? `${selectedWallIndex + 1} · ${formatLength(pxToReal(selectedWall.length, activeRoom.scalePxPerUnit), unit)}`
            : null
        }
        hint={MODE_HELP[mode]}
      />
    </div>
  );
}
