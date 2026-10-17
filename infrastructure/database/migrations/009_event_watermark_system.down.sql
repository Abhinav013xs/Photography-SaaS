-- Rollback Migration 009: Event Watermark System & Derivative Versioning
DROP INDEX IF EXISTS idx_media_event_watermark;

ALTER TABLE media
    DROP COLUMN IF EXISTS watermark_applied,
    DROP COLUMN IF EXISTS watermark_version;

ALTER TABLE events
    DROP COLUMN IF EXISTS watermark_opacity,
    DROP COLUMN IF EXISTS watermark_size,
    DROP COLUMN IF EXISTS watermark_position,
    DROP COLUMN IF EXISTS watermark_color,
    DROP COLUMN IF EXISTS watermark_version;
