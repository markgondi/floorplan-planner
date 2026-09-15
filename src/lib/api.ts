import type { Comment, Room } from "./types";

const BASE = "/api";

export async function listRooms(): Promise<Room[]> {
  const res = await fetch(`${BASE}/rooms`);
  if (!res.ok) throw new Error("Failed to load rooms");
  return res.json();
}

export async function getRoom(id: string): Promise<Room> {
  const res = await fetch(`${BASE}/rooms?id=${encodeURIComponent(id)}`);
  if (!res.ok) throw new Error("Failed to load room");
  return res.json();
}

export async function saveRoom(room: Room): Promise<Room> {
  const res = await fetch(`${BASE}/rooms`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(room),
  });
  if (!res.ok) throw new Error("Failed to save room");
  return res.json();
}

export async function createRoom(name: string): Promise<Room> {
  const res = await fetch(`${BASE}/rooms`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });
  if (!res.ok) throw new Error("Failed to create room");
  return res.json();
}

export async function deleteRoom(id: string): Promise<void> {
  const res = await fetch(`${BASE}/rooms?id=${encodeURIComponent(id)}`, { method: "DELETE" });
  if (!res.ok) throw new Error("Failed to delete room");
}

export async function listComments(roomId: string): Promise<Comment[]> {
  const res = await fetch(`${BASE}/comments?roomId=${encodeURIComponent(roomId)}`);
  if (!res.ok) throw new Error("Failed to load comments");
  return res.json();
}

export async function createComment(roomId: string, x: number, y: number, text: string, author?: string): Promise<Comment> {
  const res = await fetch(`${BASE}/comments`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ roomId, x, y, text, author }),
  });
  if (!res.ok) throw new Error("Failed to add comment");
  return res.json();
}

export async function setCommentResolved(id: string, resolved: boolean): Promise<void> {
  const res = await fetch(`${BASE}/comments?id=${encodeURIComponent(id)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ resolved }),
  });
  if (!res.ok) throw new Error("Failed to update comment");
}

export async function deleteComment(id: string): Promise<void> {
  const res = await fetch(`${BASE}/comments?id=${encodeURIComponent(id)}`, { method: "DELETE" });
  if (!res.ok) throw new Error("Failed to delete comment");
}
