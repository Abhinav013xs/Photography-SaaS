-- ====================================================================
-- MIGRATION 016 DOWN: ROLLBACK SAAS BILLING ENGINE SCHEMA
-- ====================================================================

DROP TABLE IF EXISTS processed_webhook_events CASCADE;
DROP TABLE IF EXISTS billing_events CASCADE;
DROP TABLE IF EXISTS invoices CASCADE;
DROP TABLE IF EXISTS photographer_storage_addons CASCADE;
DROP TABLE IF EXISTS storage_addons CASCADE;
DROP TABLE IF EXISTS subscriptions CASCADE;
DROP TABLE IF EXISTS plans CASCADE;
