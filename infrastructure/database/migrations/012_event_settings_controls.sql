-- ===================================================================
-- STUDIO LUMINA — EVENT SETTINGS CONTROLS MIGRATION (012)
-- Granular download permissions for individual photos, bulk ZIP, and video
-- ===================================================================

ALTER TABLE events
  ADD COLUMN IF NOT EXISTS allow_photo_downloads BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS allow_bulk_downloads BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS allow_video_downloads BOOLEAN NOT NULL DEFAULT TRUE;

COMMENT ON COLUMN events.allow_photo_downloads IS 'Granular permission toggle for individual full-resolution photo downloads';
COMMENT ON COLUMN events.allow_bulk_downloads IS 'Granular permission toggle for bulk ZIP archive downloads';
COMMENT ON COLUMN events.allow_video_downloads IS 'Granular permission toggle for video asset downloads';
