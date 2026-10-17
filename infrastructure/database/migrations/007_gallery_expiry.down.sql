-- ===================================================================
-- STUDIO LUMINA — PHASE 20: REVERT AUTOMATIC GALLERY EXPIRY SCHEMA (007)
-- ===================================================================

DROP INDEX IF EXISTS idx_events_public_due;
ALTER TABLE events DROP COLUMN IF EXISTS expired_at;
ALTER TABLE events DROP COLUMN IF EXISTS public_duration_days;
