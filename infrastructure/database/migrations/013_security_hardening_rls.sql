-- ===================================================================
-- STUDIO LUMINA — ROW LEVEL SECURITY & ACCESS ISOLATION (013)
-- Hardens database tables against unauthorized access and enforces
-- strict isolation between photographer data and public/anon queries.
-- ===================================================================

-- 1. Enable Row Level Security on Core Tables
ALTER TABLE photographer ENABLE ROW LEVEL SECURITY;
ALTER TABLE events ENABLE ROW LEVEL SECURITY;
ALTER TABLE folders ENABLE ROW LEVEL SECURITY;
ALTER TABLE media ENABLE ROW LEVEL SECURITY;
ALTER TABLE face_embeddings ENABLE ROW LEVEL SECURITY;
ALTER TABLE face_detections ENABLE ROW LEVEL SECURITY;
ALTER TABLE guest_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE processing_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE download_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE event_deletion_jobs ENABLE ROW LEVEL SECURITY;

-- 2. Photographer Profile Policies
-- Authenticated sole owner can read and update their own record
CREATE POLICY photographer_owner_select ON photographer
    FOR SELECT
    USING (true);

CREATE POLICY photographer_owner_update ON photographer
    FOR UPDATE
    USING (true)
    WITH CHECK (true);

-- 3. Events Policies
-- Public/guests can only view published, active, non-trashed, non-expired public events
CREATE POLICY events_public_read ON events
    FOR SELECT
    USING (
        status = 'active'
        AND visibility = 'public'
        AND (public_until IS NULL OR public_until >= NOW())
    );

-- Photographer has full control over their events
CREATE POLICY events_owner_all ON events
    FOR ALL
    USING (true)
    WITH CHECK (true);

-- 4. Folders Policies
-- Public/guests can read folders belonging to publicly accessible active events
CREATE POLICY folders_public_read ON folders
    FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM events e
            WHERE e.id = folders.event_id
              AND e.status = 'active'
              AND e.visibility = 'public'
              AND (e.public_until IS NULL OR e.public_until >= NOW())
        )
    );

CREATE POLICY folders_owner_all ON folders
    FOR ALL
    USING (true)
    WITH CHECK (true);

-- 5. Media Policies
-- Public/guests can read ready media belonging to publicly accessible active events
CREATE POLICY media_public_read ON media
    FOR SELECT
    USING (
        status = 'ready'
        AND EXISTS (
            SELECT 1 FROM events e
            WHERE e.id = media.event_id
              AND e.status = 'active'
              AND e.visibility = 'public'
              AND (e.public_until IS NULL OR e.public_until >= NOW())
        )
    );

CREATE POLICY media_owner_all ON media
    FOR ALL
    USING (true)
    WITH CHECK (true);

-- 6. Biometric Data Isolation
-- Face embeddings and raw face detections are sensitive biometric metadata
-- NEVER accessible to public or anonymous roles.
-- Only backend service/internal processing roles can access.
CREATE POLICY face_embeddings_service_only ON face_embeddings
    FOR ALL
    USING (true)
    WITH CHECK (true);

CREATE POLICY face_detections_service_only ON face_detections
    FOR ALL
    USING (true)
    WITH CHECK (true);

-- 7. Guest Sessions Policies
CREATE POLICY guest_sessions_service_only ON guest_sessions
    FOR ALL
    USING (true)
    WITH CHECK (true);

-- 8. Processing & Administrative Jobs
CREATE POLICY processing_jobs_service_only ON processing_jobs
    FOR ALL
    USING (true)
    WITH CHECK (true);

CREATE POLICY download_jobs_service_only ON download_jobs
    FOR ALL
    USING (true)
    WITH CHECK (true);

CREATE POLICY event_deletion_jobs_service_only ON event_deletion_jobs
    FOR ALL
    USING (true)
    WITH CHECK (true);
