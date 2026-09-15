CREATE TABLE IF NOT EXISTS folders (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS rooms (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  folder_id TEXT REFERENCES folders(id) ON DELETE SET NULL,
  scale_px_per_unit REAL,
  unit TEXT DEFAULT 'cm',
  floorplan_image_url TEXT,
  outline_json TEXT,
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
