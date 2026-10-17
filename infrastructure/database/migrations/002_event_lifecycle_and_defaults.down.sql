-- ===================================================================
-- STUDIO LUMINA — ROLLBACK MIGRATION 002
-- ===================================================================

DROP INDEX IF EXISTS idx_events_slug;
DROP INDEX IF EXISTS idx_events_owner_status_created;

ALTER TABLE events DROP CONSTRAINT IF EXISTS events_status_check;
ALTER TABLE events ADD CONSTRAINT events_status_check CHECK (status IN ('active', 'archived', 'deleting'));

ALTER TABLE events ALTER COLUMN status SET DEFAULT 'active';
ALTER TABLE events ALTER COLUMN visibility SET DEFAULT 'public';
ALTER TABLE events ALTER COLUMN allow_downloads SET DEFAULT TRUE;
