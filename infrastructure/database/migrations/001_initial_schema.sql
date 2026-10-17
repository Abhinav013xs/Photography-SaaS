-- ===================================================================
-- STUDIO LUMINA — INITIAL DATABASE SCHEMA MIGRATION (001)
-- PostgreSQL 16+ with pgvector Extension
-- ===================================================================

-- 1. Enable Required PostgreSQL Extensions
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "vector";

-- 2. Photographer / Sole Owner Account
CREATE TABLE IF NOT EXISTS photographer (
    id SERIAL PRIMARY KEY,
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    business_name VARCHAR(255) NOT NULL DEFAULT 'Studio Lumina',
    tagline VARCHAR(255) DEFAULT 'Editorial & Fine Art Photography',
    bio TEXT,
    website VARCHAR(255),
    instagram VARCHAR(255),
    avatar_url VARCHAR(500),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 3. Events / Galleries Container
CREATE TABLE IF NOT EXISTS events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id INT NOT NULL REFERENCES photographer(id) ON DELETE RESTRICT,
    slug VARCHAR(100) UNIQUE NOT NULL,
    name VARCHAR(255) NOT NULL,
    client_name VARCHAR(255) NOT NULL,
    client_email VARCHAR(255),
    event_date DATE NOT NULL,
    location VARCHAR(255),
    description TEXT,
    cover_photo_id UUID,
    status VARCHAR(50) NOT NULL DEFAULT 'draft' CONSTRAINT events_status_check CHECK (status IN ('draft', 'active', 'archived', 'deleting')),
    visibility VARCHAR(50) NOT NULL DEFAULT 'private' CHECK (visibility IN ('public', 'private')),
    public_start TIMESTAMPTZ,
    public_until TIMESTAMPTZ,
    pin_enabled BOOLEAN NOT NULL DEFAULT FALSE,
    pin_hash VARCHAR(255),
    allow_downloads BOOLEAN NOT NULL DEFAULT FALSE,
    watermark_enabled BOOLEAN NOT NULL DEFAULT FALSE,
    watermark_text VARCHAR(100) DEFAULT 'Studio Lumina',
    face_search_enabled BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_events_public_dates CHECK (public_until IS NULL OR public_start IS NULL OR public_until >= public_start)
);

-- 4. Ceremony / Category Folders
CREATE TABLE IF NOT EXISTS folders (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    sort_order INT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_folders_event_name UNIQUE (event_id, name)
);

-- 5. Media Assets (Photos and Videos)
CREATE TABLE IF NOT EXISTS media (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    folder_id UUID REFERENCES folders(id) ON DELETE SET NULL, -- SAFE FOLDER DELETION: photos survive!
    type VARCHAR(20) NOT NULL CHECK (type IN ('photo', 'video')),
    filename VARCHAR(255) NOT NULL,
    original_name VARCHAR(255) NOT NULL,
    mime_type VARCHAR(100) NOT NULL,
    file_size BIGINT NOT NULL CHECK (file_size > 0),
    width INT,
    height INT,
    storage_key_original VARCHAR(500) NOT NULL,
    storage_key_preview VARCHAR(500),
    storage_key_thumbnail VARCHAR(500),
    video_duration REAL,
    checksum VARCHAR(64),
    camera_make VARCHAR(100),
    camera_model VARCHAR(100),
    focal_length VARCHAR(50),
    aperture VARCHAR(50),
    shutter_speed VARCHAR(50),
    iso INT,
    date_taken TIMESTAMPTZ,
    status VARCHAR(50) NOT NULL DEFAULT 'uploaded' CHECK (status IN ('uploaded', 'processing', 'ready', 'failed')),
    faces_detected INT NOT NULL DEFAULT 0 CHECK (faces_detected >= 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Add forward-reference FK from events.cover_photo_id to media.id
ALTER TABLE events 
    ADD CONSTRAINT fk_events_cover_photo 
    FOREIGN KEY (cover_photo_id) 
    REFERENCES media(id) 
    ON DELETE SET NULL;

-- 6. Biometric Face Embeddings (128-D Dense Vectors from OpenCV SFace)
CREATE TABLE IF NOT EXISTS face_embeddings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    photo_id UUID NOT NULL REFERENCES media(id) ON DELETE CASCADE,
    face_index INT NOT NULL DEFAULT 0 CHECK (face_index >= 0),
    box_x REAL NOT NULL CHECK (box_x >= 0 AND box_x <= 1),
    box_y REAL NOT NULL CHECK (box_y >= 0 AND box_y <= 1),
    box_w REAL NOT NULL CHECK (box_w > 0 AND box_w <= 1),
    box_h REAL NOT NULL CHECK (box_h > 0 AND box_h <= 1),
    confidence REAL NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
    model_name VARCHAR(100) NOT NULL DEFAULT 'SFace',
    model_version VARCHAR(50) NOT NULL DEFAULT 'v1',
    embedding vector(128) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 7. Asynchronous Background Processing Jobs (BullMQ audit mirror)
CREATE TABLE IF NOT EXISTS processing_jobs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    media_id UUID REFERENCES media(id) ON DELETE CASCADE,
    type VARCHAR(50) NOT NULL CHECK (type IN ('photo_processing', 'face_indexing', 'video_processing', 'zip_generation')),
    status VARCHAR(50) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
    progress INT NOT NULL DEFAULT 0 CHECK (progress >= 0 AND progress <= 100),
    total_items INT NOT NULL DEFAULT 0 CHECK (total_items >= 0),
    processed_items INT NOT NULL DEFAULT 0 CHECK (processed_items >= 0),
    error_message TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 8. Persistent Bulk ZIP Download Jobs
CREATE TABLE IF NOT EXISTS download_jobs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    status VARCHAR(50) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
    storage_key VARCHAR(500),
    file_size BIGINT,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at TIMESTAMPTZ
);

-- 9. Ephemeral Guest PIN Verification Sessions
CREATE TABLE IF NOT EXISTS guest_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    token_hash VARCHAR(64) UNIQUE NOT NULL,
    ip_address_hash VARCHAR(64),
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_used_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 10. Measured Per-Event Cloudflare R2 Storage Consumption
CREATE TABLE IF NOT EXISTS storage_usage (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_id UUID UNIQUE NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    original_bytes BIGINT NOT NULL DEFAULT 0 CHECK (original_bytes >= 0),
    preview_bytes BIGINT NOT NULL DEFAULT 0 CHECK (preview_bytes >= 0),
    thumbnail_bytes BIGINT NOT NULL DEFAULT 0 CHECK (thumbnail_bytes >= 0),
    video_bytes BIGINT NOT NULL DEFAULT 0 CHECK (video_bytes >= 0),
    total_bytes BIGINT NOT NULL DEFAULT 0 CHECK (total_bytes >= 0),
    last_calculated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ===================================================================
-- INDEXES & PERFORMANCE OPTIMIZATION
-- ===================================================================

-- Events Indexes
CREATE INDEX IF NOT EXISTS idx_events_owner ON events(owner_id);
CREATE INDEX IF NOT EXISTS idx_events_slug ON events(slug);
CREATE INDEX IF NOT EXISTS idx_events_status ON events(status);
CREATE INDEX IF NOT EXISTS idx_events_visibility_public_until ON events(visibility, public_until);

-- Folders Indexes
CREATE INDEX IF NOT EXISTS idx_folders_event_id ON folders(event_id);

-- Media Indexes
CREATE INDEX IF NOT EXISTS idx_media_event_id ON media(event_id);
CREATE INDEX IF NOT EXISTS idx_media_event_folder ON media(event_id, folder_id);
CREATE INDEX IF NOT EXISTS idx_media_event_status ON media(event_id, status);
CREATE INDEX IF NOT EXISTS idx_media_checksum ON media(checksum) WHERE checksum IS NOT NULL;

-- Face Embeddings Indexes
CREATE INDEX IF NOT EXISTS idx_face_embeddings_event_id ON face_embeddings(event_id);
CREATE INDEX IF NOT EXISTS idx_face_embeddings_photo_id ON face_embeddings(photo_id);
CREATE INDEX IF NOT EXISTS idx_face_embeddings_hnsw 
    ON face_embeddings 
    USING hnsw (embedding vector_cosine_ops) 
    WITH (m = 16, ef_construction = 64);

-- Processing Jobs Indexes
CREATE INDEX IF NOT EXISTS idx_processing_jobs_event_status ON processing_jobs(event_id, status);

-- Download Jobs Indexes
CREATE INDEX IF NOT EXISTS idx_download_jobs_event_id ON download_jobs(event_id);

-- Guest Sessions Indexes
CREATE INDEX IF NOT EXISTS idx_guest_sessions_event_id ON guest_sessions(event_id);
CREATE INDEX IF NOT EXISTS idx_guest_sessions_token_hash ON guest_sessions(token_hash);
