import { useEffect, useRef, useState } from "react";
import "./App.css";
import Header from "./components/Header";
import RoomList from "./components/RoomList";
import FurniturePanel from "./components/FurniturePanel";
import FloorplanCanvas from "./components/FloorplanCanvas";
import UnitsToggle from "./components/UnitsToggle";
import PrintView from "./components/PrintView";
import DraggablePanel from "./components/DraggablePanel";
import type { Room, Furniture, FurniturePreset } from "./lib/types";
import { FURNITURE_PRESETS } from "./lib/types";
import type { Unit } from "./lib/units";
import { computeScale } from "./lib/geometry";
import { createRoom as apiCreateRoom, listRooms, saveRoom } from "./lib/api";

type Mode = "trace" | "calibrate" | "place";

const MODE_HELP: Record<Mode, string> = {
  trace: "Click points on the canvas to draw the room's wall outline. Click near the first point to close the shape.",
  calibrate: "Click two points on a known wall segment, then enter its real-world length to set the drawing scale.",
  place: "Drag furniture around the canvas. Click a piece to select it, then use the rotate controls or the side panel to resize it.",
};

export default function App() {
  const [rooms, setRooms] = useState<Room[]>([]);
  const [activeRoomId, setActiveRoomId] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>("trace");
  const [theme, setTheme] = useState<"light" | "dark">("dark");
  const [selectedFurnitureId, setSelectedFurnitureId] = useState<string | null>(null);
  const [showPrint, setShowPrint] = useState(false);
  const [loading, setLoading] = useState(true);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [panelOrder, setPanelOrder] = useState<("rooms" | "furniture")[]>(["rooms", "furniture"]);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const didInit = useRef(false);

  useEffect(() => {
    if (didInit.current) return;
    didInit.current = true;
    (async () => {
      try {
        const loaded = await listRooms();
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

  const activeRoom = rooms.find((r) => r.id === activeRoomId) ?? null;

  function updateActiveRoom(patch: Partial<Room>) {
    if (!activeRoomId) return;
    setRooms((prev) => prev.map((r) => (r.id === activeRoomId ? { ...r, ...patch } : r)));

    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      const updated = rooms.find((r) => r.id === activeRoomId);
      const next = updated ? { ...updated, ...patch } : null;
      if (next) saveRoom(next).catch(() => setSyncError("Failed to save changes to the server."));
    }, 500);
  }

  async function handleCreateRoom() {
    const name = window.prompt("Room name:", "New Room");
    if (!name) return;
    try {
      const room = await apiCreateRoom(name);
      setRooms((prev) => [...prev, room]);
      setActiveRoomId(room.id);
    } catch {
      setSyncError("Failed to create room on the server.");
    }
  }

  function handleCalibrate(pixelDistance: number, realLength: number) {
    updateActiveRoom({ scalePxPerUnit: computeScale(pixelDistance, realLength) });
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
      x: 800 + offset,
      y: 550 + offset,
      rotation: 0,
      color: preset.color,
    };
    updateActiveRoom({ furniture: [...activeRoom.furniture, item] });
    setSelectedFurnitureId(item.id);
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

  function bringToFront(panel: "rooms" | "furniture") {
    setPanelOrder((prev) => (prev[1] === panel ? prev : [prev[1], panel]));
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
      {syncError && <div className="sync-banner">{syncError}</div>}

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
              Place furniture
            </button>
            <span className="mode-bar__help mono" title={MODE_HELP[mode]}>?</span>
          </div>
          <div className="mode-bar__right">
            <UnitsToggle unit={activeRoom.unit} onChange={handleUnitChange} />
            <button onClick={() => setShowPrint((v) => !v)}>{showPrint ? "Back to editor" : "Print / Export"}</button>
          </div>
        </div>
      )}
      {activeRoom && <div className="mode-bar__status mono">{MODE_HELP[mode]}</div>}

      <div className="app-body">
        {activeRoom ? (
          showPrint ? (
            <PrintView room={activeRoom} />
          ) : (
            <FloorplanCanvas
              outline={activeRoom.outline}
              scalePxPerUnit={activeRoom.scalePxPerUnit}
              unit={activeRoom.unit}
              furniture={activeRoom.furniture}
              selectedFurnitureId={selectedFurnitureId}
              imageUrl={activeRoom.floorplanImageUrl}
              mode={mode}
              onOutlineChange={(outline) => updateActiveRoom({ outline })}
              onCalibrate={handleCalibrate}
              onFurnitureChange={handleUpdateFurniture}
              onSelectFurniture={setSelectedFurnitureId}
            />
          )
        ) : (
          <div className="app-main__empty">Create a room to get started.</div>
        )}

        <DraggablePanel
          title="ROOMS"
          defaultPosition={{ x: 16, y: 16 }}
          width={190}
          zIndex={panelOrder.indexOf("rooms") + 10}
          onFocus={() => bringToFront("rooms")}
        >
          <RoomList rooms={rooms} activeRoomId={activeRoomId} onSelect={setActiveRoomId} onCreate={handleCreateRoom} />
        </DraggablePanel>

        {activeRoom && !showPrint && (
          <DraggablePanel
            title="FURNITURE"
            defaultPosition={{ x: 900, y: 16 }}
            width={230}
            zIndex={panelOrder.indexOf("furniture") + 10}
            onFocus={() => bringToFront("furniture")}
          >
            <FurniturePanel
              furniture={activeRoom.furniture}
              unit={activeRoom.unit}
              selectedId={selectedFurnitureId}
              presets={FURNITURE_PRESETS}
              onSelect={setSelectedFurnitureId}
              onAddPreset={handleAddPreset}
              onUpdate={handleUpdateFurniture}
              onDelete={handleDeleteFurniture}
              onDuplicate={handleDuplicateFurniture}
            />
          </DraggablePanel>
        )}
      </div>
    </div>
  );
}
