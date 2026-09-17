import type { Handler } from "@netlify/functions";
import { createClient } from "@libsql/client/web";

const db = createClient({
  url: process.env.TURSO_DATABASE_URL!,
  authToken: process.env.TURSO_AUTH_TOKEN!,
});

const json = (statusCode: number, body: unknown) => ({
  statusCode,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

// The shared item library. Entries are added by the rooms function whenever a room is saved;
// here they're listed, and removed (hidden, so saving a room that still uses one doesn't bring
// it back).
export const handler: Handler = async (event) => {
  if (event.httpMethod === "GET") {
    const res = await db.execute("SELECT * FROM library_items ORDER BY label COLLATE NOCASE ASC, width ASC");
    return json(
      200,
      (res.rows as any[]).map((r) => ({
        key: r.key,
        id: r.id,
        label: r.label,
        kind: r.kind,
        width: r.width,
        depth: r.depth,
        height: r.height,
        elevation: r.elevation,
        color: r.color,
        hidden: r.hidden === 1,
      })),
    );
  }

  if (event.httpMethod === "DELETE") {
    const key = event.queryStringParameters?.key;
    if (!key) return json(400, { error: "Missing key" });
    // The body carries the entry, so one that's only in a room so far (not yet saved to the
    // library) is recorded as removed too, rather than arriving with that room's next save.
    const f = JSON.parse(event.body || "{}");
    await db.execute({
      sql: `INSERT INTO library_items (key, id, label, kind, width, depth, height, elevation, color, hidden) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
            ON CONFLICT(key) DO UPDATE SET hidden = 1, updated_at = datetime('now')`,
      args: [key, crypto.randomUUID(), f.label ?? "", f.kind ?? "generic", f.width ?? 0, f.depth ?? 0, f.height ?? 0, f.elevation ?? 0, f.color ?? null],
    });
    return { statusCode: 204, body: "" };
  }

  return { statusCode: 405, headers: { Allow: "GET, DELETE" }, body: "Method Not Allowed" };
};
