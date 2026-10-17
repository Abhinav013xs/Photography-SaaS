import { describe, it, expect } from 'vitest';
import { parseConfig } from '../../packages/config/src/schema.js';

describe('Configuration Module Unit Tests', () => {
  it('should parse valid environment variables into strongly typed AppConfig', () => {
    const rawEnv = {
      NODE_ENV: 'development',
      PORT: '5001',
      APP_URL: 'http://localhost:3000',
      AUTH_SECRET: 'super_secret_test_key_for_development',
      DATABASE_URL: 'postgresql://postgres:postgres@localhost:5432/photography_test',
      REDIS_URL: 'redis://localhost:6379',
      AI_SERVICE_URL: 'http://localhost:8000',
    };

    const config = parseConfig(rawEnv);

    expect(config.nodeEnv).toBe('development');
    expect(config.port).toBe(5001);
    expect(config.appUrl).toBe('http://localhost:3000');
    expect(config.authSecret).toBe('super_secret_test_key_for_development');
    expect(config.database.url).toBe('postgresql://postgres:postgres@localhost:5432/photography_test');
    expect(config.redis.url).toBe('redis://localhost:6379');
    expect(config.aiService.url).toBe('http://localhost:8000');
  });

  it('should reject invalid PORT values', () => {
    const invalidEnv = {
      PORT: '999999', // Out of range
    };

    expect(() => parseConfig(invalidEnv)).toThrowError(/PORT/);
  });

  it('should reject insecure AUTH_SECRET in production mode', () => {
    const prodEnv = {
      NODE_ENV: 'production',
      AUTH_SECRET: 'short', // Too short for production
      APP_URL: 'https://studiolumina.photo',
    };

    expect(() => parseConfig(prodEnv)).toThrowError(/AUTH_SECRET/);
  });
});
