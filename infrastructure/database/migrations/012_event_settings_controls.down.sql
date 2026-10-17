-- ===================================================================
-- STUDIO LUMINA — EVENT SETTINGS CONTROLS MIGRATION ROLLBACK (012)
-- ===================================================================

ALTER TABLE events
  DROP COLUMN IF EXISTS allow_photo_downloads,
  DROP COLUMN IF EXISTS allow_bulk_downloads,
  DROP COLUMN IF EXISTS allow_video_downloads;
