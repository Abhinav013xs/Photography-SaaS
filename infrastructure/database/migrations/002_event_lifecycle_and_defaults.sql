-- ===================================================================
-- STUDIO LUMINA — MIGRATION 002: EVENT LIFECYCLE & SAFE DEFAULTS
-- ===================================================================

-- 1. Update status constraint to include 'draft'
ALTER TABLE events DROP CONSTRAINT IF EXISTS events_status_check;
ALTER TABLE events ADD CONSTRAINT events_status_check CHECK (status IN ('draft', 'active', 'archived', 'deleting'));

-- 2. Update column defaults to safe baselines (private, draft, downloads disabled)
ALTER TABLE events ALTER COLUMN status SET DEFAULT 'draft';
ALTER TABLE events ALTER COLUMN visibility SET DEFAULT 'private';
ALTER TABLE events ALTER COLUMN allow_downloads SET DEFAULT FALSE;

-- 3. Composite index for photographer events listing and filtering
CREATE INDEX IF NOT EXISTS idx_events_owner_status_created ON events (owner_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_events_slug ON events (slug);
