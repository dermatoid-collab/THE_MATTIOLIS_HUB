-- Existing and future category pages allow member contributions unless explicitly disabled.
CREATE TABLE IF NOT EXISTS page_permissions(page_key TEXT PRIMARY KEY,members_can_add INTEGER NOT NULL DEFAULT 1 CHECK(members_can_add IN (0,1)));
