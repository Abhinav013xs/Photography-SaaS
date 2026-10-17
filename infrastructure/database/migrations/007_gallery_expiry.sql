-- ===================================================================
-- STUDIO LUMINA — PHASE 20: AUTOMATIC GALLERY EXPIRY SCHEMA (007)
-- Configurable public duration (up to 30 days), audit timestamps,
-- and optimized partial index for due-event reconciliation.
-- ===================================================================

-- 1. Add public_duration_days column (1 to 30 days, default 30)
ALTER TABLE events 
    ADD COLUMN IF NOT EXISTS public_duration_days INT NOT NULL DEFAULT 30 
    CHECK (public_duration_days >= 1 AND public_duration_days <= 30);

-- 2. Add expired_at audit timestamp (null while public or active, set when transition occurs)
ALTER TABLE events 
    ADD COLUMN IF NOT EXISTS expired_at TIMESTAMPTZ;

-- 3. Composite partial index for ultra-fast, bounded background reconciliation queries
CREATE INDEX IF NOT EXISTS idx_events_public_due 
    ON events (public_until ASC) 
    WHERE visibility = 'public' AND public_until IS NOT NULL;
