/**
 * Configuration Typing
 */

export type NodeEnvironment = 'development' | 'test' | 'production';

export interface DatabaseConfig {
  url: string;
  maxConnections: number;
  idleTimeoutMillis: number;
  connectionTimeoutMillis: number;
}

export interface RedisConfig {
  url: string;
  keyPrefix: string;
  maxRetriesPerRequest: number | null;
}

export interface AiServiceConfig {
  url: string;
  timeoutMs: number;
  internalKey?: string;
}

export interface R2Config {
  accountId?: string;
  accessKeyId?: string;
  secretAccessKey?: string;
  bucketName?: string;
  endpoint?: string;
  publicDomain?: string;
}


export interface VideoConfig {
  maxSizeBytes: number;
  concurrency: number;
  timeoutMs: number;
  posterTimestampSeconds: number;
  playbackMaxWidth: number;
  playbackMaxHeight: number;
  ffmpegPath?: string;
  ffprobePath?: string;
}

export interface RecycleBinConfig {
  retentionDays: number;
}

export interface AppConfig {
  nodeEnv: NodeEnvironment;
  port: number;
  appUrl: string;
  authSecret: string;
  internalServiceKey?: string;
  database: DatabaseConfig;
  redis: RedisConfig;
  aiService: AiServiceConfig;
  r2: R2Config;
  video?: VideoConfig;
  recycleBin?: RecycleBinConfig;
}
