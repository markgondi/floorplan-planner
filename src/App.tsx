import { useEffect, useRef, useState } from "react";
import "./App.css";
import Header from "./components/Header";
import RoomList from "./components/RoomList";
import FurniturePanel from "./components/FurniturePanel";
import FloorplanCanvas from "./components/FloorplanCanvas";
import UnitsToggle from "./components/UnitsToggle";
import PrintView from "./components/PrintView";
import type { Room, Furniture } from "./lib/types";
import type { Unit } from "./lib/units";
import { computeScale } from "./lib/geometry";
import { createRoom as apiCreateRoom, listRooms, saveRoom } from "./lib/api";

type Mode = "trace" | "calibrate" | "place";

export default function App() {
  const [rooms, setRooms] = useState<Room[]>([]);
  const [activeRoomId, setActiveRoomId] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>("trace");
  const [theme, setTheme] = useState<"light" | "dark">("light");
  const [selectedFurnitureId, setSelectedFurnitureId] = useState<string | null>(null);
  const [showPrint, setShowPrint] = useState(false);
  const [loading, setLoading] = useState(true);
  const [syncError, setSyncError] = useState<string | null>(null);
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

  function handleAddFurniture() {
    if (!activeRoom) return;
    const item: Furniture = {
      id: crypto.randomUUID(),
      roomId: activeRoom.id,
      label: "New Item",
      shape: "rect",
      width: 80,
      depth: 40,
      x: 450,
      y: 300,
      rotation: 0,
      color: "#b3593a",
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
      <div className="app-body">
        <RoomList rooms={rooms} activeRoomId={activeRoomId} onSelect={setActiveRoomId} onCreate={handleCreateRoom} />

        <main className="app-main">
          {activeRoom ? (
            <>
              <div className="mode-bar">
                <div className="mode-bar__modes">
                  <button className={mode === "trace" ? "active" : ""} onClick={() => setMode("trace")}>
                    Trace outline
                  </button>
                  <button className={mode === "calibrate" ? "active" : ""} onClick={() => setMode("calibrate")}>
                    Calibrate scale
                  </button>
                  <button className={mode === "place" ? "active" : ""} onClick={() => setMode("place")}>
                    Place furniture
                  </button>
                </div>
                <div className="mode-bar__right">
                  <UnitsToggle unit={activeRoom.unit} onChange={handleUnitChange} />
                  <button onClick={() => setShowPrint((v) => !v)}>{showPrint ? "Back to editor" : "Print / Export"}</button>
                </div>
              </div>

              {showPrint ? (
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
              )}
            </>
          ) : (
            <div className="app-main__empty">Create a room to get started.</div>
          )}
        </main>

        {activeRoom && !showPrint && (
          <FurniturePanel
            furniture={activeRoom.furniture}
            unit={activeRoom.unit}
            selectedId={selectedFurnitureId}
            onSelect={setSelectedFurnitureId}
            onAdd={handleAddFurniture}
            onUpdate={handleUpdateFurniture}
            onDelete={handleDeleteFurniture}
            onDuplicate={handleDuplicateFurniture}
          />
        )}
      </div>
    </div>
  );
}
