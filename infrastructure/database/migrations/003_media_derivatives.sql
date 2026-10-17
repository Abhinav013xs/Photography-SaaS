-- ===================================================================
-- STUDIO LUMINA — MIGRATION 003: MEDIA DERIVATIVES & IMAGE PROCESSING
-- ===================================================================
-- Adds thumbnail and preview derivative tracking, error reporting,
-- and processing completion timestamps to media table.

-- 1. Add derivative size tracking columns (bytes)
ALTER TABLE media ADD COLUMN IF NOT EXISTS thumbnail_size BIGINT;
ALTER TABLE media ADD COLUMN IF NOT EXISTS preview_size BIGINT;

-- 2. Add processing failure diagnostic column and completion timestamp
ALTER TABLE media ADD COLUMN IF NOT EXISTS processing_error TEXT;
ALTER TABLE media ADD COLUMN IF NOT EXISTS processed_at TIMESTAMPTZ;

-- 3. Index for querying media by processing status (pending, processing, ready, failed)
CREATE INDEX IF NOT EXISTS idx_media_status ON media (status);
CREATE INDEX IF NOT EXISTS idx_media_event_status ON media (event_id, status);
