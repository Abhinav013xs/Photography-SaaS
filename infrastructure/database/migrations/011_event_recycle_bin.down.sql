-- Rollback Migration 011: Event Recycle Bin

DROP INDEX IF EXISTS idx_events_owner_status;
DROP INDEX IF EXISTS idx_events_status_purge_after;

ALTER TABLE events DROP COLUMN IF EXISTS deleted_by;
ALTER TABLE events DROP COLUMN IF EXISTS purge_after;
ALTER TABLE events DROP COLUMN IF EXISTS deleted_at;

ALTER TABLE events DROP CONSTRAINT IF EXISTS events_status_check;
ALTER TABLE events ADD CONSTRAINT events_status_check CHECK (status IN ('draft', 'active', 'archived', 'deleting'));
