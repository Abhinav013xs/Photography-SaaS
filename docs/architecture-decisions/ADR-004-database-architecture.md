# ADR-004: Database & Vector Storage Architecture

## Status
Accepted

## Context
The system must manage traditional relational data (photographer profile, events, ceremony folders, media asset metadata, job queues) while simultaneously indexing and querying thousands of 128-dimensional biometric facial embedding vectors. Face similarity searches must return in under 20ms and must guarantee mathematical event isolation.

## Decision
We select **PostgreSQL 16+ with the `pgvector` extension** as the primary database engine:

### 1. Unified Relational + Vector Storage
Storing relational metadata and vector embeddings in a single database eliminates distributed data divergence, avoids dual-database synchronization bugs, and enables atomic SQL transactions across media records and embeddings.

### 2. Core Relational Schema & Constraints
```sql
-- Photographer Owner (Single Record)
CREATE TABLE photographer (
    id SERIAL PRIMARY KEY,
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    business_name VARCHAR(255) NOT NULL DEFAULT 'Studio Lumina',
    tagline VARCHAR(255),
    bio TEXT,
    website VARCHAR(255),
    instagram VARCHAR(255),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Events / Galleries
CREATE TABLE events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    slug VARCHAR(100) UNIQUE NOT NULL,
    name VARCHAR(255) NOT NULL,
    client_name VARCHAR(255) NOT NULL,
    client_email VARCHAR(255),
    event_date DATE NOT NULL,
    location VARCHAR(255),
    description TEXT,
    cover_photo_id UUID,
    status VARCHAR(50) NOT NULL DEFAULT 'active',      -- 'active', 'archived'
    visibility VARCHAR(50) NOT NULL DEFAULT 'public',  -- 'public', 'private'
    public_start TIMESTAMPTZ,
    public_until TIMESTAMPTZ,                          -- Enforced max 30 days
    pin_enabled BOOLEAN NOT NULL DEFAULT FALSE,
    pin_hash VARCHAR(255),
    allow_downloads BOOLEAN NOT NULL DEFAULT TRUE,
    watermark_enabled BOOLEAN NOT NULL DEFAULT FALSE,
    watermark_text VARCHAR(100) DEFAULT 'Studio Lumina',
    face_search_enabled BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Folders (Safe Deletion: Photos survive folder deletion)
CREATE TABLE folders (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    sort_order INT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Media Assets (Photos & Videos)
CREATE TABLE media (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    folder_id UUID REFERENCES folders(id) ON DELETE SET NULL, -- SAFE DELETION!
    type VARCHAR(20) NOT NULL,                                -- 'photo', 'video'
    filename VARCHAR(255) NOT NULL,
    original_name VARCHAR(255) NOT NULL,
    mime_type VARCHAR(100) NOT NULL,
    file_size BIGINT NOT NULL,
    width INT,
    height INT,
    storage_key_original VARCHAR(500) NOT NULL,
    storage_key_preview VARCHAR(500),
    storage_key_thumbnail VARCHAR(500),
    video_duration REAL,
    camera_make VARCHAR(100),
    camera_model VARCHAR(100),
    focal_length VARCHAR(50),
    aperture VARCHAR(50),
    shutter_speed VARCHAR(50),
    iso INT,
    date_taken TIMESTAMPTZ,
    status VARCHAR(50) NOT NULL DEFAULT 'uploaded',            -- 'uploaded', 'processing', 'ready', 'failed'
    faces_detected INT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Biometric Face Embeddings (128-D Dense Vectors)
CREATE TABLE face_embeddings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    photo_id UUID NOT NULL REFERENCES media(id) ON DELETE CASCADE,
    face_index INT NOT NULL,
    box_x REAL NOT NULL,
    box_y REAL NOT NULL,
    box_w REAL NOT NULL,
    box_h REAL NOT NULL,
    confidence REAL NOT NULL,
    embedding vector(128) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Asynchronous Processing Jobs
CREATE TABLE processing_jobs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    media_id UUID REFERENCES media(id) ON DELETE CASCADE,
    type VARCHAR(50) NOT NULL,
    status VARCHAR(50) NOT NULL DEFAULT 'pending',             -- 'pending', 'processing', 'completed', 'failed'
    progress INT NOT NULL DEFAULT 0,
    total_items INT NOT NULL DEFAULT 0,
    processed_items INT NOT NULL DEFAULT 0,
    error_message TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

### 3. Vector Indexing & Event-Scoped Query Strategy
We use an **HNSW (Hierarchical Navigable Small World)** vector index on `embedding` using cosine distance operator (`vector_cosine_ops`):
```sql
CREATE INDEX idx_face_embeddings_hnsw 
ON face_embeddings 
USING hnsw (embedding vector_cosine_ops)
WITH (m = 16, ef_construction = 64);

CREATE INDEX idx_face_embeddings_event_id 
ON face_embeddings (event_id);
```

#### Event-Scoped Vector Similarity Query:
```sql
SELECT 
    fe.photo_id,
    fe.face_index,
    fe.box_x, fe.box_y, fe.box_w, fe.box_h,
    1 - (fe.embedding <=> $selfie_embedding) AS similarity_score
FROM face_embeddings fe
WHERE fe.event_id = $current_event_id
  AND (fe.embedding <=> $selfie_embedding) < $cosine_threshold
ORDER BY fe.embedding <=> $selfie_embedding ASC
LIMIT 100;
```

## Alternatives Considered
- **Standalone Vector DB (Pinecone, Qdrant, Milvus):** Rejected. Introduces an external SaaS subscription or additional distributed database cluster; risks synchronization drift between photo metadata in PostgreSQL and embeddings in Pinecone.
- **MongoDB / NoSQL:** Rejected. Lacks strict relational foreign keys, transactions, and robust vector algebra.

## Consequences
- **Positive:** Single database to manage and back up; atomic ACID transactions; mathematical event isolation enforced directly in SQL; high-speed HNSW vector queries.
- **Negative:** Requires installing the `pgvector` extension in the PostgreSQL database environment.
