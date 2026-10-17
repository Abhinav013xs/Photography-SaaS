-- ===================================================================
-- STUDIO LUMINA — MIGRATION 004: VIDEO METADATA & CODEC TRACKING
-- ===================================================================
-- Adds video and audio codec tracking columns to the media table.
-- Compatible with PostgreSQL 16+ and existing media schema.

-- 1. Add video and audio codec tracking columns
ALTER TABLE media ADD COLUMN IF NOT EXISTS video_codec VARCHAR(50);
ALTER TABLE media ADD COLUMN IF NOT EXISTS audio_codec VARCHAR(50);

-- 2. Add composite index for filtering media by type and status
CREATE INDEX IF NOT EXISTS idx_media_event_type_status ON media (event_id, type, status);
