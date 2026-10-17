import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import type pg from 'pg';
import { getDatabasePool } from './database.js';
import { log } from '../middleware/logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Default migrations directory located at repo root
const DEFAULT_MIGRATIONS_DIR = path.resolve(__dirname, '../../../../infrastructure/database/migrations');

export interface MigrationInfo {
  name: string;
  applied: boolean;
  appliedAt: Date | null;
}

/**
 * Ensures the schema_migrations tracking table exists.
 */
export async function ensureMigrationTable(client: pg.PoolClient | pg.Pool): Promise<void> {
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id SERIAL PRIMARY KEY,
      name VARCHAR(255) UNIQUE NOT NULL,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
}

/**
 * Retrieves list of all available and applied migrations.
 */
export async function getMigrationStatus(
  migrationsDir = DEFAULT_MIGRATIONS_DIR,
  pool?: pg.Pool
): Promise<MigrationInfo[]> {
  const p = pool || getDatabasePool();
  await ensureMigrationTable(p);

  const appliedRows = await p.query<{ name: string; applied_at: Date }>(
    'SELECT name, applied_at FROM schema_migrations ORDER BY id ASC'
  );
  const appliedMap = new Map(appliedRows.rows.map((r) => [r.name, r.applied_at]));

  if (!fs.existsSync(migrationsDir)) {
    return [];
  }

  const files = fs
    .readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql') && !f.endsWith('.down.sql'))
    .sort();

  return files.map((file) => ({
    name: file,
    applied: appliedMap.has(file),
    appliedAt: appliedMap.get(file) || null,
  }));
}

/**
 * Executes all pending migrations in alphabetical order inside individual transactions.
 */
export async function migrateUp(
  migrationsDir = DEFAULT_MIGRATIONS_DIR,
  pool?: pg.Pool
): Promise<string[]> {
  const p = pool || getDatabasePool();
  const client = await p.connect();

  try {
    await ensureMigrationTable(client);

    const appliedRows = await client.query<{ name: string }>(
      'SELECT name FROM schema_migrations ORDER BY id ASC'
    );
    const appliedNames = new Set(appliedRows.rows.map((r) => r.name));

    if (!fs.existsSync(migrationsDir)) {
      throw new Error(`Migrations directory not found at: ${migrationsDir}`);
    }

    const availableFiles = fs
      .readdirSync(migrationsDir)
      .filter((f) => f.endsWith('.sql') && !f.endsWith('.down.sql'))
      .sort();

    const pendingFiles = availableFiles.filter((f) => !appliedNames.has(f));
    const appliedFiles: string[] = [];

    for (const file of pendingFiles) {
      const filePath = path.join(migrationsDir, file);
      const sql = fs.readFileSync(filePath, 'utf-8');

      log({
        timestamp: new Date().toISOString(),
        level: 'info',
        service: 'photography-api',
        message: `Applying migration: ${file}`,
      });

      try {
        await client.query('BEGIN');
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file]);
        await client.query('COMMIT');
        appliedFiles.push(file);
      } catch (err) {
        await client.query('ROLLBACK');
        const msg = err instanceof Error ? err.message : String(err);
        log({
          timestamp: new Date().toISOString(),
          level: 'error',
          service: 'photography-api',
          message: `Migration failed on ${file}: ${msg}`,
        });
        throw new Error(`Migration ${file} failed: ${msg}`);
      }
    }

    return appliedFiles;
  } finally {
    client.release();
  }
}

/**
 * Rolls back the single most recently applied migration.
 */
export async function migrateDown(
  migrationsDir = DEFAULT_MIGRATIONS_DIR,
  pool?: pg.Pool
): Promise<string | null> {
  const p = pool || getDatabasePool();
  const client = await p.connect();

  try {
    await ensureMigrationTable(client);

    const latestRow = await client.query<{ id: number; name: string }>(
      'SELECT id, name FROM schema_migrations ORDER BY id DESC LIMIT 1'
    );

    if (latestRow.rows.length === 0) {
      return null;
    }

    const latestMigration = latestRow.rows[0];
    const downFileName = latestMigration.name.replace(/\.sql$/, '.down.sql');
    const downFilePath = path.join(migrationsDir, downFileName);

    if (!fs.existsSync(downFilePath)) {
      throw new Error(`Down migration file not found: ${downFilePath}`);
    }

    const downSql = fs.readFileSync(downFilePath, 'utf-8');

    log({
      timestamp: new Date().toISOString(),
      level: 'info',
      service: 'photography-api',
      message: `Rolling back migration: ${latestMigration.name}`,
    });

    try {
      await client.query('BEGIN');
      await client.query(downSql);
      await client.query('DELETE FROM schema_migrations WHERE id = $1', [latestMigration.id]);
      await client.query('COMMIT');
      return latestMigration.name;
    } catch (err) {
      await client.query('ROLLBACK');
      const msg = err instanceof Error ? err.message : String(err);
      log({
        timestamp: new Date().toISOString(),
        level: 'error',
        service: 'photography-api',
        message: `Rollback failed for ${latestMigration.name}: ${msg}`,
      });
      throw new Error(`Rollback for ${latestMigration.name} failed: ${msg}`);
    }
  } finally {
    client.release();
  }
}

/**
 * Resets all migrations by rolling back all applied migrations and reapplying from scratch.
 */
export async function migrateReset(
  migrationsDir = DEFAULT_MIGRATIONS_DIR,
  pool?: pg.Pool
): Promise<{ rolledBack: string[]; reapplied: string[] }> {
  const rolledBack: string[] = [];

  let nextRollback = await migrateDown(migrationsDir, pool);
  while (nextRollback) {
    rolledBack.push(nextRollback);
    nextRollback = await migrateDown(migrationsDir, pool);
  }

  const reapplied = await migrateUp(migrationsDir, pool);
  return { rolledBack, reapplied };
}
