-- Phase 27: Performance Optimization & Database Query Tuning Indexes

-- 1. Composite index for guest gallery media pagination & stable tie-breaker ordering:
-- Supports: WHERE m.event_id = $1 AND m.status = 'ready' ORDER BY m.created_at ASC, m.id ASC
CREATE INDEX IF NOT EXISTS idx_media_event_gallery_paging
  ON media (event_id, status, created_at ASC, id ASC);

-- 2. Composite index for folder-specific gallery pagination & ordering:
-- Supports: WHERE m.event_id = $1 AND m.folder_id = $2 AND m.status = 'ready' ORDER BY m.created_at ASC, m.id ASC
CREATE INDEX IF NOT EXISTS idx_media_folder_gallery_paging
  ON media (event_id, folder_id, status, created_at ASC, id ASC);

-- 3. Composite index for photographer dashboard media management:
-- Supports: WHERE m.event_id = $1 ORDER BY m.created_at DESC, m.id DESC
CREATE INDEX IF NOT EXISTS idx_media_dashboard_paging
  ON media (event_id, created_at DESC, id DESC);

-- 4. Index for folder photo counts & folder status queries:
-- Supports: LEFT JOIN media m ON m.folder_id = f.id AND m.status = 'ready'
CREATE INDEX IF NOT EXISTS idx_media_folder_status
  ON media (folder_id, status);

-- 5. Composite index for event-scoped model-filtered face embeddings:
-- Supports: WHERE fe.event_id = $1 AND fe.model_name = $2 AND fe.model_version = $3
CREATE INDEX IF NOT EXISTS idx_face_embeddings_event_model
  ON face_embeddings (event_id, model_name, model_version);
