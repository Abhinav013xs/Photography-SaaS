-- ===================================================================
-- STUDIO LUMINA — ROW LEVEL SECURITY REVERSION (013.down)
-- ===================================================================

DROP POLICY IF EXISTS photographer_owner_select ON photographer;
DROP POLICY IF EXISTS photographer_owner_update ON photographer;
DROP POLICY IF EXISTS events_public_read ON events;
DROP POLICY IF EXISTS events_owner_all ON events;
DROP POLICY IF EXISTS folders_public_read ON folders;
DROP POLICY IF EXISTS folders_owner_all ON folders;
DROP POLICY IF EXISTS media_public_read ON media;
DROP POLICY IF EXISTS media_owner_all ON media;
DROP POLICY IF EXISTS face_embeddings_service_only ON face_embeddings;
DROP POLICY IF EXISTS face_detections_service_only ON face_detections;
DROP POLICY IF EXISTS guest_sessions_service_only ON guest_sessions;
DROP POLICY IF EXISTS processing_jobs_service_only ON processing_jobs;
DROP POLICY IF EXISTS download_jobs_service_only ON download_jobs;
DROP POLICY IF EXISTS event_deletion_jobs_service_only ON event_deletion_jobs;

ALTER TABLE photographer DISABLE ROW LEVEL SECURITY;
ALTER TABLE events DISABLE ROW LEVEL SECURITY;
ALTER TABLE folders DISABLE ROW LEVEL SECURITY;
ALTER TABLE media DISABLE ROW LEVEL SECURITY;
ALTER TABLE face_embeddings DISABLE ROW LEVEL SECURITY;
ALTER TABLE face_detections DISABLE ROW LEVEL SECURITY;
ALTER TABLE guest_sessions DISABLE ROW LEVEL SECURITY;
ALTER TABLE processing_jobs DISABLE ROW LEVEL SECURITY;
ALTER TABLE download_jobs DISABLE ROW LEVEL SECURITY;
ALTER TABLE event_deletion_jobs DISABLE ROW LEVEL SECURITY;
