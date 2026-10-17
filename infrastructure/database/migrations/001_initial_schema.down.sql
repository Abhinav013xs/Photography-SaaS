-- ===================================================================
-- STUDIO LUMINA — ROLLBACK INITIAL DATABASE SCHEMA MIGRATION (001.down)
-- Drops all tables, indexes, and constraints created in 001_initial_schema.sql
-- ===================================================================

-- Drop Indexes
DROP INDEX IF EXISTS idx_guest_sessions_token_hash;
DROP INDEX IF EXISTS idx_guest_sessions_event_id;
DROP INDEX IF EXISTS idx_download_jobs_event_id;
DROP INDEX IF EXISTS idx_processing_jobs_event_status;
DROP INDEX IF EXISTS idx_face_embeddings_hnsw;
DROP INDEX IF EXISTS idx_face_embeddings_photo_id;
DROP INDEX IF EXISTS idx_face_embeddings_event_id;
DROP INDEX IF EXISTS idx_media_checksum;
DROP INDEX IF EXISTS idx_media_event_status;
DROP INDEX IF EXISTS idx_media_event_folder;
DROP INDEX IF EXISTS idx_media_event_id;
DROP INDEX IF EXISTS idx_folders_event_id;
DROP INDEX IF EXISTS idx_events_visibility_public_until;
DROP INDEX IF EXISTS idx_events_status;
DROP INDEX IF EXISTS idx_events_slug;
DROP INDEX IF EXISTS idx_events_owner;

-- Drop Tables in Reverse Dependency Order with CASCADE
DROP TABLE IF EXISTS storage_usage CASCADE;
DROP TABLE IF EXISTS guest_sessions CASCADE;
DROP TABLE IF EXISTS download_jobs CASCADE;
DROP TABLE IF EXISTS processing_jobs CASCADE;
DROP TABLE IF EXISTS face_embeddings CASCADE;
DROP TABLE IF EXISTS media CASCADE;
DROP TABLE IF EXISTS folders CASCADE;
DROP TABLE IF EXISTS events CASCADE;
DROP TABLE IF EXISTS photographer CASCADE;
