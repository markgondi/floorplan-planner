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

export const handler: Handler = async (event) => {
  const id = event.queryStringParameters?.id;

  if (event.httpMethod === "GET") {
    const res = await db.execute("SELECT * FROM folders ORDER BY name ASC");
    return json(200, (res.rows as any[]).map((r) => ({ id: r.id, name: r.name })));
  }

  if (event.httpMethod === "POST") {
    const body = JSON.parse(event.body ?? "{}");
    const newId = crypto.randomUUID();
    await db.execute({ sql: "INSERT INTO folders (id, name) VALUES (?, ?)", args: [newId, body.name] });
    return json(201, { id: newId, name: body.name });
  }

  if (event.httpMethod === "PUT") {
    if (!id) return json(400, { error: "Missing id" });
    const body = JSON.parse(event.body ?? "{}");
    await db.execute({ sql: "UPDATE folders SET name = ? WHERE id = ?", args: [body.name, id] });
    return json(200, { id, name: body.name });
  }

  if (event.httpMethod === "DELETE") {
    if (!id) return json(400, { error: "Missing id" });
    await db.execute({ sql: "UPDATE rooms SET folder_id = NULL WHERE folder_id = ?", args: [id] });
    await db.execute({ sql: "DELETE FROM folders WHERE id = ?", args: [id] });
    return { statusCode: 204, body: "" };
  }

  return { statusCode: 405, headers: { Allow: "GET, POST, PUT, DELETE" }, body: "Method Not Allowed" };
};
