-- ===================================================================
-- STUDIO LUMINA — PHASE 14: FACE DETECTIONS SCHEMA (006)
-- Dedicated records for detected human face bounding boxes and landmarks
-- ===================================================================

CREATE TABLE IF NOT EXISTS face_detections (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    media_id UUID NOT NULL REFERENCES media(id) ON DELETE CASCADE,
    face_index INT NOT NULL DEFAULT 0 CHECK (face_index >= 0),
    box_x REAL NOT NULL CHECK (box_x >= 0 AND box_x <= 1),
    box_y REAL NOT NULL CHECK (box_y >= 0 AND box_y <= 1),
    box_w REAL NOT NULL CHECK (box_w > 0 AND box_w <= 1),
    box_h REAL NOT NULL CHECK (box_h > 0 AND box_h <= 1),
    confidence REAL NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
    landmarks JSONB,
    detector_name VARCHAR(100) NOT NULL DEFAULT 'YuNet',
    detector_version VARCHAR(50) NOT NULL DEFAULT '2023mar',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_face_detections_media_face UNIQUE (media_id, face_index)
);

CREATE INDEX IF NOT EXISTS idx_face_detections_event_id ON face_detections(event_id);
CREATE INDEX IF NOT EXISTS idx_face_detections_media_id ON face_detections(media_id);
