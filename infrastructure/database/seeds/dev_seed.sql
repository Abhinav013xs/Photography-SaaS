-- ===================================================================
-- STUDIO LUMINA — ISOLATED DEVELOPMENT SEED DATA
-- Strictly for local development and non-production environments.
-- Contains ZERO real biometric data or production credentials.
-- All UUIDs strictly adhere to RFC 4122 hex characters [0-9a-f].
-- ===================================================================

-- 1. Development Photographer Account (Default test hash for 'photographer123')
INSERT INTO photographer (
    id, email, password_hash, business_name, tagline, bio, website, instagram
) VALUES (
    1,
    'photographer@studiolumina.photo',
    '$2a$10$0kQJgLhyQ1uV0t.XQ53hkeQvJ7BfN0z20vHkWVvP4vN/KkYf6J02W',
    'Studio Lumina',
    'Editorial & Fine Art Photography',
    'Capturing raw human emotion and timeless celebrations across the world.',
    'https://studiolumina.photo',
    '@studiolumina'
) ON CONFLICT (email) DO NOTHING;

-- Reset sequence if needed
SELECT setval(pg_get_serial_sequence('photographer', 'id'), coalesce(max(id), 1)) FROM photographer;

-- 2. Development Event A: Rahul & Priya Wedding
INSERT INTO events (
    id, owner_id, slug, name, client_name, client_email, event_date, location,
    description, status, visibility, public_start, public_until,
    pin_enabled, pin_hash, allow_downloads, watermark_enabled, face_search_enabled
) VALUES (
    'a0000000-0000-0000-0000-000000000001',
    1,
    'rahul-priya-wedding-4a9f',
    'Rahul & Priya Wedding',
    'Rahul Sharma',
    'rahul.sharma@example.com',
    '2026-11-15',
    'Umaid Bhawan Palace, Jodhpur',
    'Royal Indian destination wedding celebrating three days of heritage, emotion, and joy.',
    'active',
    'public',
    NOW() - INTERVAL '2 days',
    NOW() + INTERVAL '28 days',
    FALSE,
    NULL,
    TRUE,
    FALSE,
    TRUE
) ON CONFLICT (id) DO NOTHING;

-- 3. Development Event B: Elena & Marcus Coastal Union (PIN-Protected)
INSERT INTO events (
    id, owner_id, slug, name, client_name, client_email, event_date, location,
    description, status, visibility, public_start, public_until,
    pin_enabled, pin_hash, allow_downloads, watermark_enabled, face_search_enabled
) VALUES (
    'b0000000-0000-0000-0000-000000000002',
    1,
    'elena-marcus-coastal-8f2c',
    'Elena & Marcus Coastal Union',
    'Elena Vance',
    'elena.vance@example.com',
    '2026-10-20',
    'Big Sur, California',
    'Intimate cliffside vows overlooking the Pacific ocean.',
    'active',
    'public',
    NOW() - INTERVAL '1 day',
    NOW() + INTERVAL '29 days',
    TRUE,
    '$2a$10$7Z8qM0YV8pI1G9dKf2h6Q.J9K0L1M2N3O4P5Q6R7S8T9U0V1W2X3Y', -- hash of test PIN '4821'
    TRUE,
    TRUE,
    TRUE
) ON CONFLICT (id) DO NOTHING;

-- 4. Ceremony Folders for Event A
INSERT INTO folders (id, event_id, name, sort_order) VALUES
    ('c0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', 'Haldi Ceremony', 0),
    ('c0000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000001', 'Wedding Ceremony', 1),
    ('c0000000-0000-0000-0000-000000000003', 'a0000000-0000-0000-0000-000000000001', 'Reception', 2)
ON CONFLICT (id) DO NOTHING;

-- 5. Folders for Event B
INSERT INTO folders (id, event_id, name, sort_order) VALUES
    ('d0000000-0000-0000-0000-000000000004', 'b0000000-0000-0000-0000-000000000002', 'Cliffside Portraits', 0),
    ('d0000000-0000-0000-0000-000000000005', 'b0000000-0000-0000-0000-000000000002', 'Dinner & Speeches', 1)
ON CONFLICT (id) DO NOTHING;

-- 6. Sample Media Metadata for Event A
INSERT INTO media (
    id, event_id, folder_id, type, filename, original_name, mime_type, file_size,
    width, height, storage_key_original, storage_key_preview, storage_key_thumbnail,
    camera_make, camera_model, focal_length, aperture, shutter_speed, iso,
    status, faces_detected
) VALUES (
    '10000000-0000-0000-0000-000000000001',
    'a0000000-0000-0000-0000-000000000001',
    'c0000000-0000-0000-0000-000000000002',
    'photo',
    '10000000-0000-0000-0000-000000000001.jpg',
    'DSC_0042.jpg',
    'image/jpeg',
    8450123,
    6000,
    4000,
    'events/a0000000-0000-0000-0000-000000000001/originals/DSC_0042.jpg',
    'events/a0000000-0000-0000-0000-000000000001/previews/DSC_0042.webp',
    'events/a0000000-0000-0000-0000-000000000001/thumbnails/DSC_0042.webp',
    'Sony',
    'ILCE-7RM5',
    '85mm',
    'f/1.4',
    '1/500s',
    100,
    'ready',
    1
), (
    '10000000-0000-0000-0000-000000000002',
    'a0000000-0000-0000-0000-000000000001',
    'c0000000-0000-0000-0000-000000000001',
    'photo',
    '10000000-0000-0000-0000-000000000002.jpg',
    'DSC_0098.jpg',
    'image/jpeg',
    7230491,
    6000,
    4000,
    'events/a0000000-0000-0000-0000-000000000001/originals/DSC_0098.jpg',
    'events/a0000000-0000-0000-0000-000000000001/previews/DSC_0098.webp',
    'events/a0000000-0000-0000-0000-000000000001/thumbnails/DSC_0098.webp',
    'Sony',
    'ILCE-7RM5',
    '35mm',
    'f/1.8',
    '1/1000s',
    200,
    'ready',
    2
) ON CONFLICT (id) DO NOTHING;

-- 7. Initial Storage Usage
INSERT INTO storage_usage (
    id, event_id, original_bytes, preview_bytes, thumbnail_bytes, video_bytes, total_bytes
) VALUES
    ('70000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', 15680614, 450000, 95000, 0, 16225614),
    ('70000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-000000000002', 0, 0, 0, 0, 0)
ON CONFLICT (id) DO NOTHING;
