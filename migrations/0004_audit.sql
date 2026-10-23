CREATE TABLE IF NOT EXISTS audit_log(id TEXT PRIMARY KEY,created_at INTEGER NOT NULL,actor_id TEXT,actor_name TEXT NOT NULL,action TEXT NOT NULL,resource TEXT NOT NULL,target_id TEXT,target_name TEXT,status INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS audit_log_time ON audit_log(created_at DESC,id DESC);
