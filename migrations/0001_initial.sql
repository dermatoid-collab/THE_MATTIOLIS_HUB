PRAGMA foreign_keys = ON;
CREATE TABLE users (
 id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE COLLATE NOCASE,
 name TEXT NOT NULL, password TEXT, role TEXT NOT NULL CHECK(role IN ('admin','user')),
 active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)), created_at INTEGER NOT NULL
);
CREATE TABLE categories (
 id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE COLLATE NOCASE,
 color TEXT NOT NULL DEFAULT 'teal', icon TEXT NOT NULL DEFAULT 'folder', position INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE links (
 id TEXT PRIMARY KEY, title TEXT NOT NULL, url TEXT NOT NULL, description TEXT NOT NULL DEFAULT '',
 category_id TEXT REFERENCES categories(id) ON DELETE SET NULL, position INTEGER NOT NULL DEFAULT 0,
 created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
CREATE TABLE favorites (
 user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 link_id TEXT NOT NULL REFERENCES links(id) ON DELETE CASCADE, PRIMARY KEY(user_id, link_id)
);
CREATE TABLE sessions (
 hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, expires_at INTEGER NOT NULL
);
CREATE INDEX sessions_user ON sessions(user_id);
CREATE TABLE tokens (
 hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 purpose TEXT NOT NULL CHECK(purpose IN ('reset','invite')), expires_at INTEGER NOT NULL, used_at INTEGER
);
CREATE INDEX tokens_user ON tokens(user_id);
CREATE TABLE rate_limits (key TEXT PRIMARY KEY, attempts INTEGER NOT NULL, until_at INTEGER NOT NULL);
CREATE TRIGGER last_admin_update BEFORE UPDATE OF active,role,password ON users
 WHEN OLD.role='admin' AND OLD.active=1 AND OLD.password IS NOT NULL AND (NEW.role<>'admin' OR NEW.active=0 OR NEW.password IS NULL)
 AND (SELECT COUNT(*) FROM users WHERE role='admin' AND active=1 AND password IS NOT NULL)<=1
 BEGIN SELECT RAISE(ABORT, 'LAST_ADMIN'); END;
CREATE TRIGGER last_admin_delete BEFORE DELETE ON users
 WHEN OLD.role='admin' AND OLD.active=1 AND OLD.password IS NOT NULL AND (SELECT COUNT(*) FROM users WHERE role='admin' AND active=1 AND password IS NOT NULL)<=1
 BEGIN SELECT RAISE(ABORT, 'LAST_ADMIN'); END;
-- No personal links or default passwords are inserted in production.
INSERT INTO categories(id,name,color,icon,position) VALUES
 ('scienza','Scienza','violet','flask',10),
 ('viaggi','Viaggi','blue','globe',20),
 ('casa','Casa','green','home',30);
