import type { Handler } from "@netlify/functions";
import { createClient } from "@libsql/client";

const db = createClient({
  url: process.env.TURSO_DATABASE_URL!,
  authToken: process.env.TURSO_AUTH_TOKEN!,
});

function rowToRoom(row: any, furnitureRows: any[]) {
  return {
    id: row.id,
    name: row.name,
    scalePxPerUnit: row.scale_px_per_unit,
    unit: row.unit,
    floorplanImageUrl: row.floorplan_image_url,
    outline: row.outline_json ? JSON.parse(row.outline_json) : [],
    furniture: furnitureRows.map((f) => ({
      id: f.id,
      roomId: f.room_id,
      label: f.label,
      shape: f.shape,
      width: f.width,
      depth: f.depth,
      x: f.x,
      y: f.y,
      rotation: f.rotation,
      color: f.color,
    })),
  };
}

const json = (statusCode: number, body: unknown) => ({
  statusCode,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

export const handler: Handler = async (event) => {
  const id = event.queryStringParameters?.id;

  if (event.httpMethod === "GET") {
    if (id) {
      const room = await db.execute({ sql: "SELECT * FROM rooms WHERE id = ?", args: [id] });
      if (room.rows.length === 0) return json(404, { error: "Not found" });
      const furniture = await db.execute({ sql: "SELECT * FROM furniture WHERE room_id = ?", args: [id] });
      return json(200, rowToRoom(room.rows[0], furniture.rows as any[]));
    }
    const rooms = await db.execute("SELECT * FROM rooms ORDER BY updated_at DESC");
    const result = [];
    for (const row of rooms.rows as any[]) {
      const furniture = await db.execute({ sql: "SELECT * FROM furniture WHERE room_id = ?", args: [row.id] });
      result.push(rowToRoom(row, furniture.rows as any[]));
    }
    return json(200, result);
  }

  if (event.httpMethod === "POST") {
    const { name } = JSON.parse(event.body ?? "{}");
    const newId = crypto.randomUUID();
    await db.execute({ sql: "INSERT INTO rooms (id, name) VALUES (?, ?)", args: [newId, name] });
    return json(
      201,
      rowToRoom(
        { id: newId, name, scale_px_per_unit: null, unit: "cm", floorplan_image_url: null, outline_json: null },
        [],
      ),
    );
  }

  if (event.httpMethod === "PUT") {
    const room = JSON.parse(event.body ?? "{}");
    await db.execute({
      sql: `UPDATE rooms SET name = ?, scale_px_per_unit = ?, unit = ?, floorplan_image_url = ?, outline_json = ?, updated_at = datetime('now') WHERE id = ?`,
      args: [room.name, room.scalePxPerUnit, room.unit, room.floorplanImageUrl, JSON.stringify(room.outline), room.id],
    });
    await db.execute({ sql: "DELETE FROM furniture WHERE room_id = ?", args: [room.id] });
    for (const f of room.furniture) {
      await db.execute({
        sql: `INSERT INTO furniture (id, room_id, label, shape, width, depth, x, y, rotation, color) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [f.id, room.id, f.label, f.shape, f.width, f.depth, f.x, f.y, f.rotation, f.color],
      });
    }
    return json(200, room);
  }

  return { statusCode: 405, headers: { Allow: "GET, POST, PUT" }, body: "Method Not Allowed" };
};
