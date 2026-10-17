import { z } from 'zod';
import type { AppConfig } from '@photography-saas/types';

/**
 * Raw Environment Variable Validation Schema
 */
export const envSchema = z.object({
  NODE_ENV: z
    .enum(['development', 'test', 'production'])
    .default('development'),
  PORT: z
    .string()
    .default('5000')
    .transform((val) => parseInt(val, 10))
    .refine((val) => val > 0 && val < 65536, {
      message: 'PORT must be between 1 and 65535',
    }),
  APP_URL: z.string().url().default('http://localhost:3000'),

  // Secrets
  AUTH_SECRET: z.string().min(8, {
    message: 'AUTH_SECRET must be at least 8 characters long',
  }).default('default_dev_auth_secret_do_not_use_in_prod'),

  // PostgreSQL Connection
  DATABASE_URL: z
    .string()
    .default('postgresql://postgres:postgres@localhost:5432/photography_saas'),
  DATABASE_MAX_CONNECTIONS: z
    .string()
    .default('20')
    .transform((val) => parseInt(val, 10)),
  DATABASE_IDLE_TIMEOUT_MS: z
    .string()
    .default('30000')
    .transform((val) => parseInt(val, 10)),
  DATABASE_CONNECT_TIMEOUT_MS: z
    .string()
    .default('5000')
    .transform((val) => parseInt(val, 10)),

  // Redis Connection
  REDIS_URL: z.string().default('redis://localhost:6379'),
  REDIS_KEY_PREFIX: z.string().default('studio_lumina:'),

  // Python AI Service & Internal Communication (Phase 26)
  AI_SERVICE_URL: z.string().url().default('http://localhost:8000'),
  AI_SERVICE_TIMEOUT_MS: z
    .string()
    .default('10000')
    .transform((val) => parseInt(val, 10)),
  INTERNAL_SERVICE_KEY: z.string().optional(),

  // Cloudflare R2 Credentials (Optional in local dev/test; verified in production)
  R2_ACCOUNT_ID: z.string().optional(),
  R2_ACCESS_KEY_ID: z.string().optional(),
  R2_SECRET_ACCESS_KEY: z.string().optional(),
  R2_BUCKET_NAME: z.string().optional(),
  R2_ENDPOINT: z.string().optional(),
  R2_PUBLIC_DOMAIN: z.string().optional(),

  // Video Processing (Phase 12)
  VIDEO_MAX_SIZE_BYTES: z
    .string()
    .default(String(500 * 1024 * 1024))
    .transform((val) => parseInt(val, 10)),
  VIDEO_CONCURRENCY: z
    .string()
    .default('1')
    .transform((val) => parseInt(val, 10)),
  VIDEO_TIMEOUT_MS: z
    .string()
    .default('120000')
    .transform((val) => parseInt(val, 10)),
  VIDEO_POSTER_TIMESTAMP_SECONDS: z
    .string()
    .default('1.0')
    .transform((val) => parseFloat(val)),
  VIDEO_PLAYBACK_MAX_WIDTH: z
    .string()
    .default('1920')
    .transform((val) => parseInt(val, 10)),
  VIDEO_PLAYBACK_MAX_HEIGHT: z
    .string()
    .default('1080')
    .transform((val) => parseInt(val, 10)),
  FFMPEG_PATH: z.string().optional(),
  FFPROBE_PATH: z.string().optional(),

  // Event Recycle Bin Retention (Phase: Event Recycle Bin)
  RECYCLE_BIN_RETENTION_DAYS: z
    .string()
    .default('30')
    .transform((val) => parseInt(val, 10))
    .refine((val) => val > 0 && val <= 365, {
      message: 'RECYCLE_BIN_RETENTION_DAYS must be between 1 and 365 days',
    }),
});

export type RawEnv = z.infer<typeof envSchema>;

/**
 * Validates and transforms environment variables into a strongly typed AppConfig.
 */
export function parseConfig(envInput: Record<string, string | undefined>): AppConfig {
  const result = envSchema.safeParse(envInput);

  if (!result.success) {
    const errorDetails = result.error.errors
      .map((err) => `  - ${err.path.join('.')}: ${err.message}`)
      .join('\n');
    throw new Error(
      `[Config] Invalid Environment Configuration:\n${errorDetails}\nCheck your .env file or environment variables.`
    );
  }

  const data = result.data;

  // Strict production assertions
  if (data.NODE_ENV === 'production') {
    if (data.AUTH_SECRET === 'default_dev_auth_secret_do_not_use_in_prod' || data.AUTH_SECRET.length < 32) {
      throw new Error(
        '[Config] In production, AUTH_SECRET must be explicitly set to a cryptographically secure string (minimum 32 characters).'
      );
    }
  }

  return {
    nodeEnv: data.NODE_ENV,
    port: data.PORT,
    appUrl: data.APP_URL,
    authSecret: data.AUTH_SECRET,
    internalServiceKey: data.INTERNAL_SERVICE_KEY || data.AUTH_SECRET,
    database: {
      url: data.DATABASE_URL,
      maxConnections: data.DATABASE_MAX_CONNECTIONS,
      idleTimeoutMillis: data.DATABASE_IDLE_TIMEOUT_MS,
      connectionTimeoutMillis: data.DATABASE_CONNECT_TIMEOUT_MS,
    },
    redis: {
      url: data.REDIS_URL,
      keyPrefix: data.REDIS_KEY_PREFIX,
      maxRetriesPerRequest: null,
    },
    aiService: {
      url: data.AI_SERVICE_URL,
      timeoutMs: data.AI_SERVICE_TIMEOUT_MS,
      internalKey: data.INTERNAL_SERVICE_KEY || data.AUTH_SECRET,
    },
    r2: {
      accountId: data.R2_ACCOUNT_ID,
      accessKeyId: data.R2_ACCESS_KEY_ID,
      secretAccessKey: data.R2_SECRET_ACCESS_KEY,
      bucketName: data.R2_BUCKET_NAME,
      endpoint: data.R2_ENDPOINT,
      publicDomain: data.R2_PUBLIC_DOMAIN,
    },
    video: {
      maxSizeBytes: data.VIDEO_MAX_SIZE_BYTES,
      concurrency: data.VIDEO_CONCURRENCY,
      timeoutMs: data.VIDEO_TIMEOUT_MS,
      posterTimestampSeconds: data.VIDEO_POSTER_TIMESTAMP_SECONDS,
      playbackMaxWidth: data.VIDEO_PLAYBACK_MAX_WIDTH,
      playbackMaxHeight: data.VIDEO_PLAYBACK_MAX_HEIGHT,
      ffmpegPath: data.FFMPEG_PATH,
      ffprobePath: data.FFPROBE_PATH,
    },
    recycleBin: {
      retentionDays: data.RECYCLE_BIN_RETENTION_DAYS,
    },
  };
}

/**
 * Checks whether Cloudflare R2 credentials are fully configured.
 */
export function isR2Configured(r2?: AppConfig['r2']): boolean {
  if (!r2) return false;
  // Account ID or explicit endpoint must be present, plus key, secret, and bucket name
  const hasEndpoint = Boolean(r2.endpoint || r2.accountId);
  if (!hasEndpoint || !r2.accessKeyId || !r2.secretAccessKey || !r2.bucketName) {
    return false;
  }

  // Treat unpopulated template placeholders as unconfigured
  if (
    r2.accountId?.startsWith('your_') ||
    r2.accessKeyId?.startsWith('your_') ||
    r2.secretAccessKey?.startsWith('your_') ||
    r2.bucketName?.startsWith('your_')
  ) {
    return false;
  }

  return true;
}

