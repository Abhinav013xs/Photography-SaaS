import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { createApp } from '../../apps/api/src/app.js';
import { closeDatabase } from '../../apps/api/src/infrastructure/database.js';
import { closeRedis } from '../../apps/api/src/infrastructure/redis.js';

describe('Health and API Foundation Integration Tests', () => {
  const app = createApp();

  afterAll(async () => {
    await Promise.all([closeDatabase(), closeRedis()]);
  });

  it('GET /health/live should return 200 OK liveness response', async () => {
    const res = await request(app).get('/health/live');

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.service).toBe('photography-api');
    expect(res.header['x-request-id']).toBeDefined();
  });

  it('GET /health should return system status envelope with checks structure', async () => {
    const res = await request(app).get('/health');

    // In a test environment without running local Postgres/Redis, it returns 503 with subsystem diagnostics
    expect([200, 503]).toContain(res.status);
    expect(res.body.timestamp).toBeDefined();
    expect(res.body.checks).toBeDefined();
    expect(res.body.checks.database).toBeDefined();
    expect(res.body.checks.redis).toBeDefined();
    expect(res.body.checks.aiService).toBeDefined();
  });

  it('GET /non-existent-endpoint should return 404 with standard ApiError envelope', async () => {
    const res = await request(app).get('/non-existent-endpoint');

    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
    expect(res.body.error).toBeDefined();
    expect(res.body.error.code).toBe('NOT_FOUND');
    expect(res.body.error.requestId).toBeDefined();
    expect(res.header['x-request-id']).toBeDefined();
  });
});
