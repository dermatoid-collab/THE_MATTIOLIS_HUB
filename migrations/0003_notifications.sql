-- Additive notification schema, initialized automatically by the Worker.
CREATE TABLE IF NOT EXISTS notification_preferences(user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,push_enabled INTEGER NOT NULL DEFAULT 0,email_enabled INTEGER NOT NULL DEFAULT 0,links INTEGER NOT NULL DEFAULT 1,shopping INTEGER NOT NULL DEFAULT 1,releases INTEGER NOT NULL DEFAULT 1,ignore_own INTEGER NOT NULL DEFAULT 1,updated_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS notification_config(key TEXT PRIMARY KEY,value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS push_subscriptions(id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,endpoint TEXT NOT NULL UNIQUE,subscription TEXT NOT NULL,device_name TEXT NOT NULL,created_at INTEGER NOT NULL,last_seen INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS push_subscriptions_user ON push_subscriptions(user_id);
CREATE TABLE IF NOT EXISTS notification_events(id TEXT PRIMARY KEY,event_key TEXT UNIQUE,category TEXT NOT NULL CHECK(category IN ('links','shopping','releases')),actor_id TEXT REFERENCES users(id),title TEXT NOT NULL,body TEXT NOT NULL,url TEXT NOT NULL,created_at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS notification_events_time ON notification_events(created_at);
CREATE TABLE IF NOT EXISTS notification_reads(user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,last_read_at INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS notification_jobs(event_id TEXT NOT NULL REFERENCES notification_events(id) ON DELETE CASCADE,user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,channel TEXT NOT NULL CHECK(channel IN ('push','email')),target_id TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'pending',attempts INTEGER NOT NULL DEFAULT 0,available_at INTEGER NOT NULL,lease_until INTEGER NOT NULL DEFAULT 0,last_error TEXT,PRIMARY KEY(event_id,user_id,channel,target_id));
CREATE INDEX IF NOT EXISTS notification_jobs_pending ON notification_jobs(status,available_at,lease_until);
