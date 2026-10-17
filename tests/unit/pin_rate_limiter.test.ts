import { describe, it, expect, beforeEach } from 'vitest';
import {
  checkPinRateLimit,
  recordFailedPinAttempt,
  clearPinRateLimit,
  resetPinRateLimiterStore,
  MAX_PIN_ATTEMPTS,
} from '../../apps/api/src/middleware/pinRateLimiter.js';

describe('Phase 18: PIN Rate Limiter Unit Tests', () => {
  const testIp = '192.168.1.100';
  const testEventId = 'a0000000-0000-0000-0000-000000000001';

  beforeEach(() => {
    resetPinRateLimiterStore();
  });

  it('INITIAL STATE: Allows attempts when no prior failures exist', () => {
    const status = checkPinRateLimit(testIp, testEventId);
    expect(status.allowed).toBe(true);
    expect(status.remainingAttempts).toBe(MAX_PIN_ATTEMPTS);
    expect(status.retryAfterSeconds).toBe(0);
  });

  it('PROGRESSIVE ATTEMPTS: Decrements remaining attempts on repeated failures', () => {
    const res1 = recordFailedPinAttempt(testIp, testEventId);
    expect(res1.remainingAttempts).toBe(4);

    const res2 = recordFailedPinAttempt(testIp, testEventId);
    expect(res2.remainingAttempts).toBe(3);

    const status = checkPinRateLimit(testIp, testEventId);
    expect(status.allowed).toBe(true);
    expect(status.remainingAttempts).toBe(3);
  });

  it('LOCKOUT: Locks out after exactly 5 failed attempts', () => {
    for (let i = 0; i < 4; i++) {
      recordFailedPinAttempt(testIp, testEventId);
    }
    expect(checkPinRateLimit(testIp, testEventId).allowed).toBe(true);

    // 5th attempt triggers lockout
    const res5 = recordFailedPinAttempt(testIp, testEventId);
    expect(res5.remainingAttempts).toBe(0);
    expect(res5.retryAfterSeconds).toBeGreaterThan(0);

    const status = checkPinRateLimit(testIp, testEventId);
    expect(status.allowed).toBe(false);
    expect(status.remainingAttempts).toBe(0);
    expect(status.retryAfterSeconds).toBeGreaterThan(0);
  });

  it('ISOLATION BY EVENT: Lockout on Event A does NOT block attempts for Event B', () => {
    const eventB = 'b0000000-0000-0000-0000-000000000002';
    // Lock out Event A
    for (let i = 0; i < 5; i++) {
      recordFailedPinAttempt(testIp, testEventId);
    }

    expect(checkPinRateLimit(testIp, testEventId).allowed).toBe(false);
    // Event B should still be allowed
    expect(checkPinRateLimit(testIp, eventB).allowed).toBe(true);
    expect(checkPinRateLimit(testIp, eventB).remainingAttempts).toBe(MAX_PIN_ATTEMPTS);
  });

  it('ISOLATION BY IP: Lockout for one client IP does NOT block other client IPs', () => {
    const innocentIp = '192.168.1.200';
    // Lock out testIp
    for (let i = 0; i < 5; i++) {
      recordFailedPinAttempt(testIp, testEventId);
    }

    expect(checkPinRateLimit(testIp, testEventId).allowed).toBe(false);
    // Innocent IP should still be allowed
    expect(checkPinRateLimit(innocentIp, testEventId).allowed).toBe(true);
    expect(checkPinRateLimit(innocentIp, testEventId).remainingAttempts).toBe(MAX_PIN_ATTEMPTS);
  });

  it('CLEAR ON SUCCESS: Successful PIN verification clears rate limit state', () => {
    for (let i = 0; i < 3; i++) {
      recordFailedPinAttempt(testIp, testEventId);
    }
    expect(checkPinRateLimit(testIp, testEventId).remainingAttempts).toBe(2);

    // Clear after success
    clearPinRateLimit(testIp, testEventId);
    expect(checkPinRateLimit(testIp, testEventId).remainingAttempts).toBe(MAX_PIN_ATTEMPTS);
  });
});
