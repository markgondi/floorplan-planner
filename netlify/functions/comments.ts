import type { Handler } from "@netlify/functions";
import { createClient } from "@libsql/client/web";

const db = createClient({
  url: process.env.TURSO_DATABASE_URL!,
  authToken: process.env.TURSO_AUTH_TOKEN!,
});

function rowToComment(row: any) {
  return {
    id: row.id,
    roomId: row.room_id,
    x: row.x,
    y: row.y,
    author: row.author,
    text: row.text,
    resolved: !!row.resolved,
    createdAt: row.created_at,
  };
}

const json = (statusCode: number, body: unknown) => ({
  statusCode,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

export const handler: Handler = async (event) => {
  const roomId = event.queryStringParameters?.roomId;
  const id = event.queryStringParameters?.id;

  if (event.httpMethod === "GET") {
    if (!roomId) return json(400, { error: "Missing roomId" });
    const res = await db.execute({
      sql: "SELECT * FROM comments WHERE room_id = ? ORDER BY created_at ASC",
      args: [roomId],
    });
    return json(200, (res.rows as any[]).map(rowToComment));
  }

  if (event.httpMethod === "POST") {
    const body = JSON.parse(event.body ?? "{}");
    const newId = crypto.randomUUID();
    await db.execute({
      sql: "INSERT INTO comments (id, room_id, x, y, author, text) VALUES (?, ?, ?, ?, ?, ?)",
      args: [newId, body.roomId, body.x, body.y, body.author ?? null, body.text],
    });
    const res = await db.execute({ sql: "SELECT * FROM comments WHERE id = ?", args: [newId] });
    return json(201, rowToComment(res.rows[0]));
  }

  if (event.httpMethod === "PUT") {
    const body = JSON.parse(event.body ?? "{}");
    if (!id) return json(400, { error: "Missing id" });
    await db.execute({
      sql: "UPDATE comments SET resolved = ? WHERE id = ?",
      args: [body.resolved ? 1 : 0, id],
    });
    return json(200, { ok: true });
  }

  if (event.httpMethod === "DELETE") {
    if (!id) return json(400, { error: "Missing id" });
    await db.execute({ sql: "DELETE FROM comments WHERE id = ?", args: [id] });
    return { statusCode: 204, body: "" };
  }

  return { statusCode: 405, headers: { Allow: "GET, POST, PUT, DELETE" }, body: "Method Not Allowed" };
};
