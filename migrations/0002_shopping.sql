-- Additive shopping schema. Also initialized safely on first authenticated use.
CREATE TABLE IF NOT EXISTS shopping_lists (
  id TEXT PRIMARY KEY, title TEXT NOT NULL,
  color TEXT NOT NULL DEFAULT 'teal' CHECK(color IN ('teal','blue','violet','green','rose','amber')),
  archived INTEGER NOT NULL DEFAULT 0 CHECK(archived IN (0,1)),
  created_by TEXT NOT NULL REFERENCES users(id), created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL, version INTEGER NOT NULL DEFAULT 1
 );
CREATE TABLE IF NOT EXISTS shopping_items (
  id TEXT PRIMARY KEY, list_id TEXT NOT NULL REFERENCES shopping_lists(id),
  name TEXT NOT NULL, quantity TEXT NOT NULL DEFAULT '', checked INTEGER NOT NULL DEFAULT 0 CHECK(checked IN (0,1)),
  position REAL NOT NULL DEFAULT 0, deleted INTEGER NOT NULL DEFAULT 0 CHECK(deleted IN (0,1)),
  created_by TEXT NOT NULL REFERENCES users(id), checked_by TEXT REFERENCES users(id),
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, version INTEGER NOT NULL DEFAULT 1
 );
CREATE INDEX IF NOT EXISTS shopping_items_list ON shopping_items(list_id,deleted,position);
CREATE INDEX IF NOT EXISTS shopping_lists_archive ON shopping_lists(archived,updated_at);
