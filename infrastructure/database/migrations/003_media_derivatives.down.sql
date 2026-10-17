-- ===================================================================
-- STUDIO LUMINA — ROLLBACK 003: MEDIA DERIVATIVES & IMAGE PROCESSING
-- ===================================================================

DROP INDEX IF EXISTS idx_media_event_status;
DROP INDEX IF EXISTS idx_media_status;

ALTER TABLE media DROP COLUMN IF EXISTS processed_at;
ALTER TABLE media DROP COLUMN IF EXISTS processing_error;
ALTER TABLE media DROP COLUMN IF EXISTS preview_size;
ALTER TABLE media DROP COLUMN IF EXISTS thumbnail_size;
