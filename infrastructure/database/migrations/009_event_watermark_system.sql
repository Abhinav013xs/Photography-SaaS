-- Migration 009: Event Watermark System & Derivative Versioning (Phase 22)
-- Adds opacity, size, position, color, and version tracking to events,
-- and watermark application state and version tracking to media.

ALTER TABLE events
    ADD COLUMN IF NOT EXISTS watermark_opacity REAL NOT NULL DEFAULT 0.35 CHECK (watermark_opacity >= 0.05 AND watermark_opacity <= 1.0),
    ADD COLUMN IF NOT EXISTS watermark_size VARCHAR(20) NOT NULL DEFAULT 'medium' CHECK (watermark_size IN ('small', 'medium', 'large')),
    ADD COLUMN IF NOT EXISTS watermark_position VARCHAR(30) NOT NULL DEFAULT 'bottom-right' CHECK (watermark_position IN ('center', 'bottom-right', 'bottom-center')),
    ADD COLUMN IF NOT EXISTS watermark_color VARCHAR(20) NOT NULL DEFAULT 'white' CHECK (watermark_color IN ('white', 'black')),
    ADD COLUMN IF NOT EXISTS watermark_version INT NOT NULL DEFAULT 1;

ALTER TABLE media
    ADD COLUMN IF NOT EXISTS watermark_applied BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS watermark_version INT NOT NULL DEFAULT 0;

-- Bounded index for event media watermark version tracking and reprocessing queries
CREATE INDEX IF NOT EXISTS idx_media_event_watermark
    ON media (event_id, type, watermark_version)
    WHERE type = 'photo';
