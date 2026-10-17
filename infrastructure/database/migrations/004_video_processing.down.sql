-- ===================================================================
-- STUDIO LUMINA — MIGRATION 004 ROLLBACK: VIDEO METADATA & CODECS
-- ===================================================================

DROP INDEX IF EXISTS idx_media_event_type_status;
ALTER TABLE media DROP COLUMN IF EXISTS audio_codec;
ALTER TABLE media DROP COLUMN IF EXISTS video_codec;
