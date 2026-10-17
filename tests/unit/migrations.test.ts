import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { getMigrationSql, createTestDatabase } from '../helpers/db_test_helper.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe('Database Migration Specifications & Rules', () => {
  const { up, down } = getMigrationSql();

  it('should define all 9 required domain entities in the initial schema', () => {
    const requiredTables = [
      'photographer',
      'events',
      'folders',
      'media',
      'face_embeddings',
      'processing_jobs',
      'download_jobs',
      'guest_sessions',
      'storage_usage',
    ];

    for (const table of requiredTables) {
      expect(up).toMatch(new RegExp(`CREATE TABLE (IF NOT EXISTS )?${table}\\b`, 'i'));
    }
  });

  it('must strictly forbid multi-tenant, billing, and permanent guest tables', () => {
    const prohibitedKeywords = [
      'tenant_id',
      'organization_id',
      'stripe_customer',
      'subscription_id',
      'subscription_plan',
      'invoices',
      'payment_methods',
      'CREATE TABLE users',
    ];

    for (const keyword of prohibitedKeywords) {
      expect(up.toLowerCase()).not.toContain(keyword.toLowerCase());
    }
  });

  it('should configure pgvector with 128 dimensions and HNSW index', () => {
    expect(up).toContain('vector(128)');
    expect(up).toContain('USING hnsw (embedding vector_cosine_ops)');
    expect(up).toContain('m = 16');
    expect(up).toContain('ef_construction = 64');
  });

  it('should enforce safe folder deletion with ON DELETE SET NULL on media', () => {
    expect(up).toContain('REFERENCES folders(id) ON DELETE SET NULL');
  });

  it('should cleanly drop all tables in down migration', () => {
    const tables = [
      'photographer',
      'events',
      'folders',
      'media',
      'face_embeddings',
      'processing_jobs',
      'download_jobs',
      'guest_sessions',
      'storage_usage',
    ];

    for (const table of tables) {
      expect(down).toMatch(new RegExp(`DROP TABLE (IF EXISTS )?${table}`, 'i'));
    }
  });

  it('should execute up and down migration successfully against an in-memory database', () => {
    const db = createTestDatabase();
    // Verify tables exist
    const photographerCount = db.public.many('SELECT COUNT(*) AS c FROM photographer');
    expect(photographerCount).toBeDefined();

    // Execute down migration
    db.public.many(down);

    // Verify photographer table is dropped
    expect(() => db.public.many('SELECT COUNT(*) FROM photographer')).toThrow();
  });
});
