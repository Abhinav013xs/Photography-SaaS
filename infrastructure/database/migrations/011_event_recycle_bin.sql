-- Migration 011: Event Recycle Bin, Restore & Automatic Permanent Deletion
-- Studio Lumina — Phase: Event Recycle Bin

-- 1. Extend events status check constraint to include 'trashed' and 'deleted'
ALTER TABLE events DROP CONSTRAINT IF EXISTS events_status_check;
ALTER TABLE events ADD CONSTRAINT events_status_check CHECK (status IN ('draft', 'active', 'archived', 'trashed', 'deleting', 'deleted'));

-- 2. Add Recycle Bin tracking columns
ALTER TABLE events ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE events ADD COLUMN IF NOT EXISTS purge_after TIMESTAMPTZ;
ALTER TABLE events ADD COLUMN IF NOT EXISTS deleted_by INT REFERENCES photographer(id) ON DELETE SET NULL;

-- 3. Composite indexes for efficient querying of trashed events and scheduled purge runner
CREATE INDEX IF NOT EXISTS idx_events_status_purge_after ON events (status, purge_after);
CREATE INDEX IF NOT EXISTS idx_events_owner_status ON events (owner_id, status);
