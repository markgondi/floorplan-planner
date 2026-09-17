import type { Comment, Folder, Room } from "./types";
import type { LibraryItem } from "./library";

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

export async function createRoom(name: string, folderId?: string | null): Promise<Room> {
  const res = await fetch(`${BASE}/rooms`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, folderId }),
  });
  if (!res.ok) throw new Error("Failed to create room");
  return res.json();
}

export async function deleteRoom(id: string): Promise<void> {
  const res = await fetch(`${BASE}/rooms?id=${encodeURIComponent(id)}`, { method: "DELETE" });
  if (!res.ok) throw new Error("Failed to delete room");
}

export async function listFolders(): Promise<Folder[]> {
  const res = await fetch(`${BASE}/folders`);
  if (!res.ok) throw new Error("Failed to load folders");
  return res.json();
}

export async function createFolder(name: string): Promise<Folder> {
  const res = await fetch(`${BASE}/folders`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });
  if (!res.ok) throw new Error("Failed to create folder");
  return res.json();
}

export async function renameFolder(id: string, name: string): Promise<void> {
  const res = await fetch(`${BASE}/folders?id=${encodeURIComponent(id)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });
  if (!res.ok) throw new Error("Failed to rename folder");
}

export async function deleteFolder(id: string): Promise<void> {
  const res = await fetch(`${BASE}/folders?id=${encodeURIComponent(id)}`, { method: "DELETE" });
  if (!res.ok) throw new Error("Failed to delete folder");
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

export async function listLibrary(): Promise<LibraryItem[]> {
  const res = await fetch(`${BASE}/library`);
  if (!res.ok) throw new Error("Failed to load the item library");
  return res.json();
}

export async function removeLibraryItem(item: LibraryItem): Promise<void> {
  const res = await fetch(`${BASE}/library?key=${encodeURIComponent(item.key)}`, {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(item),
  });
  if (!res.ok) throw new Error("Failed to remove the item from the library");
}
