CREATE TABLE IF NOT EXISTS folders (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS rooms (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  folder_id TEXT REFERENCES folders(id) ON DELETE SET NULL,
  ceiling_height REAL NOT NULL DEFAULT 240,
  scale_px_per_unit REAL,
  unit TEXT DEFAULT 'cm',
  floorplan_image_url TEXT,
  outline_json TEXT,
  -- A locked room can't be changed until it is unlocked in the Rooms list.
  locked INTEGER NOT NULL DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS furniture (
  id TEXT PRIMARY KEY,
  room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  shape TEXT NOT NULL DEFAULT 'rect',
  kind TEXT NOT NULL DEFAULT 'generic',
  width REAL NOT NULL,
  depth REAL NOT NULL,
  height REAL NOT NULL DEFAULT 60,
  elevation REAL NOT NULL DEFAULT 0,
  x REAL NOT NULL DEFAULT 0,
  y REAL NOT NULL DEFAULT 0,
  rotation REAL NOT NULL DEFAULT 0,
  color TEXT DEFAULT '#b3593a',
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_furniture_room ON furniture(room_id);

CREATE TABLE IF NOT EXISTS comments (
  id TEXT PRIMARY KEY,
  room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  x REAL NOT NULL,
  y REAL NOT NULL,
  author TEXT,
  text TEXT NOT NULL,
  resolved INTEGER NOT NULL DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_comments_room ON comments(room_id);

-- Every distinct item made in any room, shared across rooms. Filled automatically when a room
-- is saved; `key` is the item's name (trimmed, lower-case), kind and size, so the same item
-- saved again doesn't duplicate. `hidden` = removed from the library by a person.
CREATE TABLE IF NOT EXISTS library_items (
  key TEXT PRIMARY KEY,
  id TEXT NOT NULL,
  label TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'generic',
  width REAL NOT NULL,
  depth REAL NOT NULL,
  height REAL NOT NULL,
  elevation REAL NOT NULL DEFAULT 0,
  color TEXT,
  hidden INTEGER NOT NULL DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);
