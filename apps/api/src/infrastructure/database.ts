import pg from 'pg';
import { getConfig } from '@photography-saas/config';
import type { SubsystemHealthCheck } from '@photography-saas/types';
import { log } from '../middleware/logger.js';

const { Pool } = pg;

let pool: pg.Pool | null = null;

/**
 * Returns the active PostgreSQL connection pool singleton.
 */
export function getDatabasePool(): pg.Pool {
  if (!pool) {
    const config = getConfig();
    pool = new Pool({
      connectionString: config.database.url,
      max: config.database.maxConnections,
      idleTimeoutMillis: config.database.idleTimeoutMillis,
      connectionTimeoutMillis: config.database.connectionTimeoutMillis,
    });

    pool.on('error', (err) => {
      log({
        timestamp: new Date().toISOString(),
        level: 'error',
        service: 'photography-api',
        message: `Unexpected PostgreSQL pool error: ${err.message}`,
      });
    });
  }
  return pool;
}

/**
 * Sets or overrides the active PostgreSQL connection pool (useful for test isolation).
 */
export function setDatabasePool(customPool: pg.Pool | null): void {
  pool = customPool;
}

export async function query<R extends pg.QueryResultRow = any>(
  text: string,
  params?: any[]
): Promise<pg.QueryResult<R>> {
  const p = getDatabasePool();
  return p.query<R>(text, params);
}

/**
 * Executes a callback within a managed PostgreSQL transaction.
 */
export async function withTransaction<T>(
  callback: (client: pg.PoolClient) => Promise<T>
): Promise<T> {
  const p = getDatabasePool();
  const client = await p.connect();
  try {
    await client.query('BEGIN');
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch {
      // Rollback error ignored
    }
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Checks PostgreSQL connectivity and pgvector extension availability.
 * Does NOT create or alter tables.
 */
export async function checkDatabaseHealth(): Promise<SubsystemHealthCheck> {
  const start = Date.now();
  try {
    const p = getDatabasePool();
    // Verify basic connectivity
    await p.query('SELECT 1 AS alive');

    // Verify whether pgvector extension is installed/available
    const extResult = await p.query<{ extname: string }>(
      "SELECT extname FROM pg_extension WHERE extname = 'vector'"
    );
    const pgvectorEnabled = extResult.rows.length > 0;

    const latencyMs = Date.now() - start;
    return {
      status: 'healthy',
      latencyMs,
      details: {
        pgvectorInstalled: pgvectorEnabled,
      },
    };
  } catch (error) {
    const latencyMs = Date.now() - start;
    const message = error instanceof Error ? error.message : 'Database connection failed';
    return {
      status: 'unhealthy',
      latencyMs,
      message,
    };
  }
}

/**
 * Gracefully shuts down the PostgreSQL connection pool.
 */
export async function closeDatabase(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
  }
}
