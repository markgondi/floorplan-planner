import { useEffect, useRef, useState } from "react";
import "./App.css";
import Header from "./components/Header";
import RoomList from "./components/RoomList";
import FurniturePanel from "./components/FurniturePanel";
import CommentsPanel from "./components/CommentsPanel";
import FloorplanCanvas, { type FloorplanCanvasHandle, type WallTool } from "./components/FloorplanCanvas";
import SideView from "./components/SideView";
import UnitsToggle from "./components/UnitsToggle";
import Sidebar from "./components/Sidebar";
import ToolRail, { type Mode } from "./components/ToolRail";
import StatusBar from "./components/StatusBar";
import DimensionInput from "./components/DimensionInput";
import type { Comment, Folder, Room, Furniture, FurniturePreset } from "./lib/types";
import { FURNITURE_PRESETS } from "./lib/types";
import type { Point } from "./lib/geometry";
import type { LibraryEntry, LibraryItem } from "./lib/library";
import { belongsInLibrary, libraryKey } from "./lib/library";
import type { Unit } from "./lib/units";
import { formatArea, formatDimensions, formatLength, formatScale } from "./lib/units";
import { computeScale, mergeCollinearWalls, polygonPerimeterSegments, pxToReal, setWallFixed, setWallLength } from "./lib/geometry";
import {
  createComment,
  createFolder,
  createRoom as apiCreateRoom,
  deleteComment,
  deleteFolder,
  deleteRoom,
  listComments,
  listFolders,
  listLibrary,
  listRooms,
  removeLibraryItem,
  renameFolder,
  saveRoom,
  setCommentResolved,
} from "./lib/api";

const MODE_HELP: Record<Mode, string> = {
  select: "Select — click a wall or an item to select it. Drag empty space to pan around.",
  walls: "Walls — trace the room outline, or switch to Inner Walls to draw walls inside it.",
  scale: "Scale — click two points on a wall of known length, then enter it. Or use Grid = 1m.",
  arrange: "Arrange — drag items to move them, then rotate or resize from the Items panel.",
  comment: "Comment — click anywhere to leave a pin for reviewers.",
};

const PRESETS_STORAGE_KEY = "floorplan-planner:presets";
const LABELS_STORAGE_KEY = "floorplan-planner:labels";
const SNAP_STORAGE_KEY = "floorplan-planner:grid-snap";

const WALL_TOOL_HELP: Record<WallTool, string> = {
  outline: "Outline — click to add corners; click the first corner to close it. Type a length + Enter for an exact side.",
  inner: "Inner Walls — click the start, then the end. Type a length + Enter for exact. Done or Esc when finished.",
};
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
  // A short explanation when something you asked for can't be done (e.g. a fixed wall is in the way).
  const [notice, setNotice] = useState<string | null>(null);
  // The shared item library as last loaded (entries rooms add after that show up via libraryEntries).
  const [library, setLibrary] = useState<LibraryItem[]>([]);
  const [comments, setComments] = useState<Comment[]>([]);
  const [presets, setPresets] = useState<FurniturePreset[]>(loadPresets);
  const [leftCollapsed, setLeftCollapsed] = useState(false);
  const [rightCollapsed, setRightCollapsed] = useState(false);
  const [rightTab, setRightTab] = useState("items");
  const [showLabels, setShowLabels] = useState<boolean>(() => {
    try {
      return localStorage.getItem(LABELS_STORAGE_KEY) !== "off";
    } catch {
      return true;
    }
  });
  const [gridSnap, setGridSnap] = useState<boolean>(() => {
    try {
      return localStorage.getItem(SNAP_STORAGE_KEY) !== "off";
    } catch {
      return true;
    }
  });
  const [wallTool, setWallTool] = useState<WallTool>("outline");
  const [wallStart, setWallStart] = useState<Point | null>(null);
  // Ids of inner walls drawn since this room was opened, newest last, so Undo Wall can step back.
  const [drawnWalls, setDrawnWalls] = useState<string[]>([]);
  // Which corner of a selected wall slides when its length is typed in: its end, or its start.
  const [moveWallStart, setMoveWallStart] = useState(false);
  const [zoom, setZoom] = useState(0.6);
  const [cursor, setCursor] = useState<Point | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingSaves = useRef(new Map<string, Room>());
  const savesInFlight = useRef(new Set<string>());
  const didInit = useRef(false);
  const canvasRef = useRef<FloorplanCanvasHandle>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (didInit.current) return;
    didInit.current = true;
    (async () => {
      try {
        const [loaded, loadedFolders, loadedLibrary] = await Promise.all([
          listRooms(),
          listFolders().catch(() => []),
          listLibrary().catch(() => []),
        ]);
        setFolders(loadedFolders);
        setLibrary(loadedLibrary);
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
    try {
      localStorage.setItem(LABELS_STORAGE_KEY, showLabels ? "on" : "off");
    } catch {
      // ignore write failures
    }
  }, [showLabels]);

  useEffect(() => {
    try {
      localStorage.setItem(SNAP_STORAGE_KEY, gridSnap ? "on" : "off");
    } catch {
      // ignore write failures
    }
  }, [gridSnap]);

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
    setWallStart(null);
    setDrawnWalls([]);
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

  // The item library as shown: everything saved to the shared library, plus any item in a room
  // that hasn't reached it yet (it's added when that room next saves), less anything removed —
  // each with the names of the rooms it's placed in.
  const libraryEntries: LibraryEntry[] = (() => {
    const removed = new Set(library.filter((l) => l.hidden).map((l) => l.key));
    const byKey = new Map<string, LibraryEntry>();
    for (const l of library) if (!l.hidden) byKey.set(l.key, { ...l, rooms: [] });
    for (const room of rooms) {
      for (const f of room.furniture) {
        if (!belongsInLibrary(f)) continue;
        const key = libraryKey(f);
        if (removed.has(key)) continue;
        let entry = byKey.get(key);
        if (!entry) {
          entry = { key, id: key, label: f.label.trim(), kind: f.kind, width: f.width, depth: f.depth, height: f.height, elevation: f.elevation, color: f.color, hidden: false, rooms: [] };
          byKey.set(key, entry);
        }
        if (!entry.rooms.includes(room.name.trim())) entry.rooms.push(room.name.trim());
      }
    }
    return [...byKey.values()].sort((a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: "base" }) || a.width - b.width);
  })();
  const wallCount = wallRuns.length;
  const perimeterPx = activeRoom
    ? polygonPerimeterSegments(activeRoom.outline).reduce((sum, s) => sum + s.length, 0)
    : 0;

  // A selected wall is the Side view's viewing context, not a rival selection — picking an
  // item keeps the wall you're looking at so you can still move and edit that item.
  function handleSelectFurniture(id: string | null) {
    setSelectedFurnitureId(id);
  }

  function updateActiveRoom(patch: Partial<Room>) {
    if (!activeRoomId) return;
    const roomId = activeRoomId;
    setRooms((prev) => {
      const next = prev.map((r) => (r.id === roomId ? { ...r, ...patch } : r));
      // Remember the room exactly as it now stands, so the save sends every change, not just
      // the last one.
      const room = next.find((r) => r.id === roomId);
      if (room) pendingSaves.current.set(roomId, room);
      return next;
    });

    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(flushSaves, 500);
  }

  // Sends waiting room saves, one at a time per room: a save that starts while another for the
  // same room is still going waits for it, then sends the newest version.
  function flushSaves() {
    for (const [roomId, room] of pendingSaves.current) {
      if (savesInFlight.current.has(roomId)) continue;
      pendingSaves.current.delete(roomId);
      savesInFlight.current.add(roomId);
      saveRoom(room)
        // one retry after a beat — serverless functions cold-starting is common and transient
        .catch(() => new Promise((resolve) => setTimeout(resolve, 800)).then(() => saveRoom(room)))
        .then(() => setSyncError(null))
        .catch(() => setSyncError("Failed to save changes to the server. Your edits are still here locally — try again in a moment."))
        .finally(() => {
          savesInFlight.current.delete(roomId);
          if (pendingSaves.current.has(roomId)) flushSaves();
        });
    }
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

  // Copies a room — outline, scale, units, ceiling, plan image and every item (with fresh
  // ids so the two rooms stay independent) — into the same folder, and opens the copy.
  // Comments stay with the original, since they're feedback on that room.
  async function handleDuplicateRoom(id: string) {
    const source = rooms.find((r) => r.id === id);
    if (!source) return;
    const name = window.prompt("Name for the copy:", `${source.name.trim()} (copy)`);
    if (!name) return;
    let createdId: string | null = null;
    try {
      const created = await apiCreateRoom(name, source.folderId);
      createdId = created.id;
      const copy: Room = {
        ...source,
        id: created.id,
        name,
        outline: source.outline.map((p) => ({ ...p })),
        furniture: source.furniture.map((f) => ({ ...f, id: crypto.randomUUID(), roomId: created.id })),
      };
      await saveRoom(copy).catch(() => saveRoom(copy));
      setRooms((prev) => {
        const next = [...prev];
        next.splice(next.findIndex((r) => r.id === id) + 1, 0, copy);
        return next;
      });
      setActiveRoomId(copy.id);
    } catch {
      // Don't leave an empty half-copy behind.
      if (createdId) deleteRoom(createdId).catch(() => {});
      setSyncError("Failed to duplicate the room on the server — nothing was copied. Try again in a moment.");
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

  // Opening the Walls tool on a room that already has its outline goes straight to drawing
  // inner walls, so clicks don't accidentally add corners to the finished outline.
  function handleModeChange(next: Mode) {
    if (next === "walls" && mode !== "walls") {
      setWallTool(activeRoom && activeRoom.outline.length >= 3 ? "inner" : "outline");
    }
    setWallStart(null);
    setMode(next);
  }

  function handleWallToolChange(next: WallTool) {
    setWallStart(null);
    setWallTool(next);
  }

  function handleDrawWall(from: Point, to: Point) {
    if (!activeRoom) return;
    const wall = presets.find((p) => p.kind === "wall") ?? FURNITURE_PRESETS[0];
    const scale = activeRoom.scalePxPerUnit || 1;
    const item: Furniture = {
      id: crypto.randomUUID(),
      roomId: activeRoom.id,
      label: wall.label,
      shape: "rect",
      kind: "wall",
      width: Math.hypot(to.x - from.x, to.y - from.y) * scale,
      depth: wall.depth,
      height: wall.height,
      elevation: wall.elevation,
      x: (from.x + to.x) / 2,
      y: (from.y + to.y) / 2,
      rotation: Math.round(((Math.atan2(to.y - from.y, to.x - from.x) * 180) / Math.PI) * 100) / 100,
      color: wall.color,
    };
    updateActiveRoom({ furniture: [...activeRoom.furniture, item] });
    setDrawnWalls((prev) => [...prev, item.id]);
    handleSelectFurniture(item.id);
  }

  // Removes the newest inner wall still on the plan.
  function handleUndoWall() {
    if (!activeRoom) return;
    const remaining = drawnWalls.filter((id) => activeRoom.furniture.some((f) => f.id === id));
    const last = remaining[remaining.length - 1];
    if (!last) return;
    updateActiveRoom({ furniture: activeRoom.furniture.filter((f) => f.id !== last) });
    setDrawnWalls(remaining.slice(0, -1));
    if (selectedFurnitureId === last) setSelectedFurnitureId(null);
    setWallStart(null);
  }

  // Typing a wall's length makes that wall exactly that long and fixes it there. Other walls
  // only move if they aren't fixed; if a fixed wall would have to change, nothing happens and
  // the notice says which walls are in the way.
  function setWallLengthCm(wallIndex: number, lengthCm: number) {
    if (!activeRoom) return;
    const lengthPx = lengthCm / (activeRoom.scalePxPerUnit || 1);
    const result = setWallLength(activeRoom.outline, wallIndex, lengthPx, moveWallStart);
    if (result.blockedBy) {
      const walls = result.blockedBy.map((i) => `Wall ${i + 1}`).join(", ");
      setNotice(
        `Wall ${wallIndex + 1} can't be ${formatLength(lengthCm, activeRoom.unit)} without changing a fixed wall` +
          (walls ? ` (${walls})` : "") +
          ". Select one of those walls and click Fixed to free it, then try again.",
      );
      return;
    }
    if (result.leaned) {
      const fixedWalls = result.leaned.fixedWalls.map((i) => `Wall ${i + 1}`).join(", ");
      setNotice(
        `Wall ${wallIndex + 1} is now ${formatLength(lengthCm, activeRoom.unit)}. ` +
          (fixedWalls ? `${fixedWalls} ${result.leaned.fixedWalls.length === 1 ? "is" : "are"} fixed, so ` : "") +
          `Wall ${result.leaned.wall + 1} (not fixed) now sits slightly off square to meet it.`,
      );
    } else {
      setNotice(null);
    }
    updateActiveRoom({ outline: result.points });
  }

  function handleWallLengthChange(lengthCm: number) {
    if (selectedWallIndex !== null) setWallLengthCm(selectedWallIndex, lengthCm);
  }

  function handleToggleWallFixed() {
    if (!activeRoom || selectedWallIndex === null || !selectedWall) return;
    updateActiveRoom({ outline: setWallFixed(activeRoom.outline, selectedWallIndex, !selectedWall.fixed) });
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

  // Changes the room's scale. The outline is traced over the plan, so its corners stay put and
  // its lengths are re-measured. Walls are part of that same drawing, so they're re-measured
  // too and stay joined to it. Everything else keeps the real size it was given, so it's
  // redrawn larger or smaller — which is asked about first, as it can look like items shrank.
  function applyScale(nextScale: number, measuredWallIndex: number | null) {
    if (!activeRoom || !(nextScale > 0)) return;
    const ratio = nextScale / (activeRoom.scalePxPerUnit || 1);
    // The wall just measured is now exact, so it's fixed.
    const outline = measuredWallIndex !== null ? setWallFixed(activeRoom.outline, measuredWallIndex, true) : activeRoom.outline;
    if (Math.abs(ratio - 1) < 1e-9) {
      updateActiveRoom({ scalePxPerUnit: nextScale, outline });
      return;
    }
    const walls = activeRoom.furniture.filter((f) => f.kind === "wall").length;
    const others = activeRoom.furniture.length - walls;
    if (walls + others > 0) {
      const lines = [`Set the scale to 1 px = ${formatScale(nextScale, activeRoom.unit)}?`, "", "Outline lengths will be re-measured at the new scale."];
      if (walls) lines.push(`${walls} wall${walls === 1 ? "" : "s"} will be re-measured too, staying joined to the outline.`);
      if (others) {
        lines.push(
          `${others} item${others === 1 ? " keeps its" : "s keep their"} real size, so ${others === 1 ? "it" : "they"}'ll be drawn at ${Math.round(100 / ratio)}% of the current size on the plan.`,
        );
      }
      if (!window.confirm(lines.join("\n"))) return;
    }
    updateActiveRoom({
      scalePxPerUnit: nextScale,
      outline,
      furniture: activeRoom.furniture.map((f) => (f.kind === "wall" ? { ...f, width: f.width * ratio } : f)),
    });
  }

  // The Scale tool. A wall measured between its own two corners is fixed at that length. Once
  // a room has fixed walls its scale can't change (that would change them), so measuring a
  // wall then simply sets that wall's length.
  function handleCalibrate(pixelDistance: number, realLengthCm: number, from: Point, to: Point) {
    if (!activeRoom) return;
    const near = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y) < 0.5;
    const wallIndex = wallRuns.findIndex((r) => (near(r.from, from) && near(r.to, to)) || (near(r.from, to) && near(r.to, from)));
    if (wallRuns.some((r) => r.fixed)) {
      if (wallIndex >= 0) setWallLengthCm(wallIndex, realLengthCm);
      else setNotice("This room has fixed wall lengths, so its scale can't change. Click a wall's two corners to set that wall's length instead.");
      return;
    }
    applyScale(computeScale(pixelDistance, realLengthCm), wallIndex >= 0 ? wallIndex : null);
  }

  function handleSetGridScale() {
    if (wallRuns.some((r) => r.fixed)) {
      setNotice("This room has fixed wall lengths, so its scale can't change.");
      return;
    }
    // Major grid squares are 100 canvas px apart; this makes one square exactly 1 metre.
    applyScale(1, null);
  }

  function handleAddPreset(preset: Pick<FurniturePreset, "label" | "kind" | "width" | "depth" | "height" | "elevation" | "color">) {
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

  async function handleRemoveFromLibrary(entry: LibraryEntry) {
    const size = formatDimensions([entry.width, entry.depth, entry.height], activeRoom?.unit ?? "mm");
    if (!window.confirm(`Remove "${entry.label}" (${size}) from the library?\n\nItems already placed in rooms stay where they are.`)) return;
    const { rooms: _rooms, ...item } = entry;
    try {
      await removeLibraryItem({ ...item, hidden: true });
      setLibrary((prev) => [...prev.filter((l) => l.key !== entry.key), { ...item, hidden: true }]);
    } catch {
      setSyncError("Failed to remove the item from the library. Try again in a moment.");
    }
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

  function handleApplyColorToName(label: string, color: string) {
    if (!activeRoom) return;
    const name = label.trim();
    updateActiveRoom({
      furniture: activeRoom.furniture.map((f) => (f.label.trim() === name ? { ...f, color } : f)),
    });
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

      {notice && (
        <div className="sync-banner">
          <span>{notice}</span>
          <button className="sync-banner__dismiss" onClick={() => setNotice(null)}>
            OK
          </button>
        </div>
      )}

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
            {view === "top" && (
              <button
                className={showLabels ? "btn-ghost btn-ghost--active" : "btn-ghost"}
                onClick={() => setShowLabels((v) => !v)}
                title={showLabels ? "Hide item names on the plan" : "Show item names on the plan"}
              >
                Labels {showLabels ? "On" : "Off"}
              </button>
            )}
            {view === "top" && selectedWall && selectedWallIndex !== null && (
              <>
                <label className="field mono" title="Type this wall's length and press Enter — the wall becomes exactly that long">
                  <span>Wall {selectedWallIndex + 1}</span>
                  <DimensionInput
                    key={`${activeRoom.id}-${selectedWallIndex}`}
                    valueCm={selectedWall.length * (activeRoom.scalePxPerUnit || 1)}
                    unit={activeRoom.unit}
                    onChange={handleWallLengthChange}
                    commitOnEnter
                    className="field__wall-length"
                  />
                  <span className="field__unit">{activeRoom.unit}</span>
                </label>
                <button
                  className="btn-ghost"
                  onClick={() => setMoveWallStart((v) => !v)}
                  title="Which end of the wall moves when you change its length (marked on the plan). The wall next to that end moves with it."
                >
                  {moveWallStart ? "◂ Start moves" : "End moves ▸"}
                </button>
                <button
                  className={selectedWall.fixed ? "btn-ghost btn-ghost--active" : "btn-ghost"}
                  onClick={handleToggleWallFixed}
                  title={
                    selectedWall.fixed
                      ? "This wall's length is fixed — nothing else can change it. Click to free it."
                      : "This wall's length can change when you set other walls. Click to fix it."
                  }
                >
                  {selectedWall.fixed ? "Fixed" : "Not fixed"}
                </button>
              </>
            )}
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
                <DimensionInput
                  valueCm={activeRoom.ceilingHeight}
                  unit={activeRoom.unit}
                  onChange={(ceilingHeight) => updateActiveRoom({ ceilingHeight })}
                />
                <span className="field__unit">{activeRoom.unit}</span>
              </label>
            )}
          </div>

          <div className="action-bar__group">
            {mode === "walls" && (
              <div className="seg mono" title="Trace the room's outline, or draw walls inside it">
                <button
                  className={wallTool === "outline" ? "seg__btn seg__btn--active" : "seg__btn"}
                  onClick={() => handleWallToolChange("outline")}
                >
                  Outline
                </button>
                <button
                  className={wallTool === "inner" ? "seg__btn seg__btn--active" : "seg__btn"}
                  onClick={() => handleWallToolChange("inner")}
                >
                  Inner Walls
                </button>
              </div>
            )}
            {mode === "walls" && wallTool === "outline" && activeRoom.outline.length > 0 && (
              <>
                <button className="btn-ghost" onClick={handleUndoOutlinePoint}>
                  Undo Point
                </button>
                <button className="btn-ghost" onClick={handleClearOutline}>
                  Clear Outline
                </button>
              </>
            )}
            {mode === "walls" &&
              wallTool === "inner" &&
              drawnWalls.some((id) => activeRoom.furniture.some((f) => f.id === id)) && (
                <button className="btn-ghost" onClick={handleUndoWall} title="Remove the last inner wall you drew">
                  Undo Wall
                </button>
              )}
            {mode === "scale" && (
              <button className="btn-ghost" onClick={handleSetGridScale} title="One major grid square = 1 metre">
                Grid = 1m
              </button>
            )}
            {(mode === "walls" || mode === "scale") && (
              <>
                <button
                  className={gridSnap ? "btn-ghost btn-ghost--active" : "btn-ghost"}
                  onClick={() => setGridSnap((v) => !v)}
                  title={
                    gridSnap
                      ? "Points lock to the grid. Turn off to place them anywhere (corners and walls still snap)."
                      : "Points go exactly where you click, locking only onto corners and walls."
                  }
                >
                  Grid Snap {gridSnap ? "On" : "Off"}
                </button>
                {mode === "walls" && (
                  <button
                    className="btn-primary"
                    onClick={() => handleModeChange("select")}
                    title="Stop drawing and go back to Select (Enter, or Esc when nothing is in progress)"
                  >
                    Done
                  </button>
                )}
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
        <ToolRail mode={mode} onModeChange={handleModeChange} help={MODE_HELP} />

        <Sidebar side="left" title="Rooms" collapsed={leftCollapsed} onToggle={() => setLeftCollapsed((c) => !c)}>
          <RoomList
            rooms={rooms}
            folders={folders}
            activeRoomId={activeRoomId}
            onSelect={setActiveRoomId}
            onCreate={handleCreateRoom}
            onRename={handleRenameRoom}
            onDuplicate={handleDuplicateRoom}
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
                movingWallCorner={moveWallStart ? "start" : "end"}
                zoom={zoom}
                onZoomChange={(updater) => setZoom((z) => updater(z))}
                onCursorMove={setCursor}
                showLabels={showLabels}
                gridSnap={gridSnap}
                wallTool={wallTool}
                wallStart={wallStart}
                onWallStartChange={setWallStart}
                onDrawWall={handleDrawWall}
                onFinishDrawing={() => handleModeChange("select")}
                innerWallThickness={(presets.find((p) => p.kind === "wall") ?? FURNITURE_PRESETS[0]).depth}
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
                onFurnitureChange={handleUpdateFurniture}
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
                onApplyColorToName={handleApplyColorToName}
                library={libraryEntries}
                onAddFromLibrary={handleAddPreset}
                onRemoveFromLibrary={handleRemoveFromLibrary}
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
        selectionLabel={
          selectedItem
            ? `${selectedItem.label} · ${formatDimensions(
                selectedItem.kind === "zone" ? [selectedItem.width, selectedItem.depth] : [selectedItem.width, selectedItem.depth, selectedItem.height],
                unit,
              )}`
            : null
        }
        floorLabel={
          (() => {
            // One total per floor finish (or any other area) mapped out in this room.
            const areas = new Map<string, number>();
            for (const f of activeRoom?.furniture ?? []) {
              if (f.kind !== "zone") continue;
              areas.set(f.label.trim(), (areas.get(f.label.trim()) ?? 0) + f.width * f.depth);
            }
            return areas.size === 0 ? null : [...areas].map(([label, cm2]) => `${label} ${formatArea(cm2, 1)}`).join(" · ");
          })()
        }
        wallLabel={
          selectedWall && selectedWallIndex !== null && activeRoom?.scalePxPerUnit
            ? `${selectedWallIndex + 1} · ${formatLength(pxToReal(selectedWall.length, activeRoom.scalePxPerUnit), unit)}`
            : null
        }
        hint={mode === "walls" ? WALL_TOOL_HELP[wallTool] : MODE_HELP[mode]}
      />
    </div>
  );
}
