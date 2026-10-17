-- ====================================================================
-- MIGRATION 016: SAAS BUSINESS ENGINE & SUBSCRIPTION BILLING SCHEMA
-- ====================================================================

-- 1. Subscription Plans Table
CREATE TABLE IF NOT EXISTS plans (
  id VARCHAR(50) PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  description TEXT,
  price_cents INT NOT NULL DEFAULT 0,
  annual_price_cents INT NOT NULL DEFAULT 0,
  currency VARCHAR(10) NOT NULL DEFAULT 'USD',
  billing_interval VARCHAR(20) NOT NULL DEFAULT 'month',
  storage_limit_bytes BIGINT NOT NULL DEFAULT 5368709120, -- 5 GB
  event_limit INT NOT NULL DEFAULT 2,
  face_search_limit INT NOT NULL DEFAULT 50,
  video_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  custom_branding_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  features JSONB NOT NULL DEFAULT '[]',
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2. Subscriptions Table
CREATE TABLE IF NOT EXISTS subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  photographer_id INT NOT NULL REFERENCES photographer(id) ON DELETE CASCADE,
  plan_id VARCHAR(50) NOT NULL REFERENCES plans(id),
  status VARCHAR(30) NOT NULL DEFAULT 'active', -- 'trialing', 'active', 'past_due', 'paused', 'cancelled', 'expired'
  billing_cycle VARCHAR(20) NOT NULL DEFAULT 'month', -- 'month' | 'year'
  provider VARCHAR(50) NOT NULL DEFAULT 'stripe',
  provider_customer_id VARCHAR(100),
  provider_subscription_id VARCHAR(100),
  current_period_start TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  current_period_end TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '30 days'),
  cancel_at_period_end BOOLEAN NOT NULL DEFAULT FALSE,
  cancelled_at TIMESTAMPTZ,
  grace_period_until TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 3. Storage Add-ons Catalog
CREATE TABLE IF NOT EXISTS storage_addons (
  id VARCHAR(50) PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  capacity_bytes BIGINT NOT NULL,
  price_cents INT NOT NULL,
  currency VARCHAR(10) NOT NULL DEFAULT 'USD',
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 4. Photographer Active Storage Add-ons
CREATE TABLE IF NOT EXISTS photographer_storage_addons (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  photographer_id INT NOT NULL REFERENCES photographer(id) ON DELETE CASCADE,
  addon_id VARCHAR(50) NOT NULL REFERENCES storage_addons(id),
  status VARCHAR(30) NOT NULL DEFAULT 'active', -- 'active', 'cancelled', 'expired'
  provider_subscription_id VARCHAR(100),
  current_period_end TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '30 days'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 5. Invoices & Billing History
CREATE TABLE IF NOT EXISTS invoices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  photographer_id INT NOT NULL REFERENCES photographer(id) ON DELETE CASCADE,
  subscription_id UUID REFERENCES subscriptions(id) ON DELETE SET NULL,
  provider_invoice_id VARCHAR(100),
  amount_cents INT NOT NULL,
  currency VARCHAR(10) NOT NULL DEFAULT 'USD',
  status VARCHAR(30) NOT NULL DEFAULT 'paid', -- 'draft', 'open', 'paid', 'uncollectible', 'void'
  description VARCHAR(255),
  invoice_pdf_url TEXT,
  issued_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  paid_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 6. Billing Audit Log
CREATE TABLE IF NOT EXISTS billing_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  photographer_id INT NOT NULL REFERENCES photographer(id) ON DELETE CASCADE,
  event_type VARCHAR(100) NOT NULL,
  description TEXT,
  metadata JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 7. Webhook Idempotency Registry
CREATE TABLE IF NOT EXISTS processed_webhook_events (
  idempotency_key VARCHAR(255) PRIMARY KEY,
  provider VARCHAR(50) NOT NULL DEFAULT 'stripe',
  event_type VARCHAR(100) NOT NULL,
  processed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 8. Performance Indexes
CREATE INDEX IF NOT EXISTS idx_subscriptions_photographer ON subscriptions(photographer_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_status ON subscriptions(status);
CREATE INDEX IF NOT EXISTS idx_photographer_addons ON photographer_storage_addons(photographer_id, status);
CREATE INDEX IF NOT EXISTS idx_invoices_photographer ON invoices(photographer_id, issued_at DESC);
CREATE INDEX IF NOT EXISTS idx_billing_events_photographer ON billing_events(photographer_id, created_at DESC);

-- 9. Seed Standard Database-Driven Plans
INSERT INTO plans (
  id, name, description, price_cents, annual_price_cents, currency, billing_interval,
  storage_limit_bytes, event_limit, face_search_limit, video_enabled, custom_branding_enabled, features
) VALUES
  (
    'plan_free',
    'Free Trial',
    'Essential gallery sharing for evaluation and emerging artists.',
    0, 0, 'USD', 'month',
    5368709120, -- 5 GB
    2, 50, FALSE, FALSE,
    '["5 GB Cloud Storage", "2 Active Events", "50 AI Face Searches/mo", "Responsive Web Gallery", "Standard Downloads"]'::jsonb
  ),
  (
    'plan_starter',
    'Starter',
    'Ideal for portrait and small boutique event photographers.',
    1500, 15000, 'USD', 'month',
    26843545600, -- 25 GB
    10, 500, TRUE, TRUE,
    '["25 GB Cloud Storage", "10 Active Events", "500 AI Face Searches/mo", "Full 1080p Video Support", "Custom Watermarks", "High-Speed Bulk Downloads"]'::jsonb
  ),
  (
    'plan_pro',
    'Professional',
    'Our most popular tier for high-volume wedding and documentary photographers.',
    3900, 39000, 'USD', 'month',
    107374182400, -- 100 GB
    50, -1, TRUE, TRUE,
    '["100 GB Cloud Storage", "50 Active Events", "Unlimited AI Face Searches", "4K Video Delivery", "Studio Branding & Watermarks", "PIN Protection & Priority Processing"]'::jsonb
  ),
  (
    'plan_studio',
    'Studio Master',
    'Maximum performance and massive capacity for commercial studios and high-volume wedding masters.',
    8900, 89000, 'USD', 'month',
    536870912000, -- 500 GB
    -1, -1, TRUE, TRUE,
    '["500 GB Cloud Storage", "Unlimited Active Events", "Unlimited AI Face Searches", "Master 4K Video Delivery", "Full White-Label Branding", "Modular Storage Add-Ons"]'::jsonb
  )
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  price_cents = EXCLUDED.price_cents,
  annual_price_cents = EXCLUDED.annual_price_cents,
  storage_limit_bytes = EXCLUDED.storage_limit_bytes,
  event_limit = EXCLUDED.event_limit,
  face_search_limit = EXCLUDED.face_search_limit,
  video_enabled = EXCLUDED.video_enabled,
  custom_branding_enabled = EXCLUDED.custom_branding_enabled,
  features = EXCLUDED.features;

-- 10. Seed Storage Add-ons Catalog
INSERT INTO storage_addons (id, name, capacity_bytes, price_cents, currency) VALUES
  ('addon_storage_50gb', '+50 GB Storage Expansion', 53687091200, 500, 'USD'),
  ('addon_storage_200gb', '+200 GB Storage Expansion', 214748364800, 1500, 'USD'),
  ('addon_storage_500gb', '+500 GB Storage Expansion', 536870912000, 3000, 'USD'),
  ('addon_storage_1tb', '+1 TB Storage Expansion', 1099511627776, 5000, 'USD')
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  capacity_bytes = EXCLUDED.capacity_bytes,
  price_cents = EXCLUDED.price_cents;

-- 11. Ensure existing photographers have an active Pro subscription assigned
INSERT INTO subscriptions (photographer_id, plan_id, status, billing_cycle, provider, current_period_start, current_period_end)
SELECT id, 'plan_pro', 'active', 'month', 'system_seed', NOW(), NOW() + INTERVAL '365 days'
FROM photographer
WHERE id NOT IN (SELECT photographer_id FROM subscriptions);
