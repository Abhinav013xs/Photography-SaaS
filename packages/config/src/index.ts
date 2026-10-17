import dotenv from 'dotenv';
import path from 'path';
import { parseConfig } from './schema.js';
import type { AppConfig } from '@photography-saas/types';

// Load .env automatically if present
dotenv.config();

let cachedConfig: AppConfig | null = null;

/**
 * Retrieves the application configuration singleton.
 * Validates environment variables on first invocation.
 */
export function getConfig(overrideEnv?: Record<string, string | undefined>): AppConfig {
  if (overrideEnv) {
    return parseConfig(overrideEnv);
  }
  if (!cachedConfig) {
    cachedConfig = parseConfig(process.env);
  }
  return cachedConfig;
}

/**
 * Resets cached configuration (primarily for testing purposes).
 */
export function resetConfig(): void {
  cachedConfig = null;
}

export * from './schema.js';
