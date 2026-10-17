import { describe, it, expect } from 'vitest';
import { censorSensitiveData } from '../../apps/api/src/middleware/logger.js';

describe('Logger Sensitive Data Censoring Unit Tests', () => {
  it('should redact sensitive keys such as passwords, pins, and tokens', () => {
    const rawPayload = {
      username: 'photographer@studiolumina.photo',
      password: 'my_super_secret_password',
      pin: '1234',
      token: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
      metadata: {
        nestedSecret: 'confidential_key',
        safeProperty: 'public_value',
      },
    };

    const safe = censorSensitiveData(rawPayload) as any;

    expect(safe.username).toBe('photographer@studiolumina.photo');
    expect(safe.password).toBe('[REDACTED]');
    expect(safe.pin).toBe('[REDACTED]');
    expect(safe.token).toBe('[REDACTED]');
    expect(safe.metadata.nestedSecret).toBe('[REDACTED]');
    expect(safe.metadata.safeProperty).toBe('public_value');
  });

  it('should redact dense float vector embeddings from log payloads', () => {
    // 128-dimensional dense float vector
    const embeddingVector = Array.from({ length: 128 }, (_, i) => i * 0.01);
    const payloadWithEmbedding = {
      action: 'face_match',
      embedding: embeddingVector,
    };

    const safe = censorSensitiveData(payloadWithEmbedding) as any;

    // Both the key 'embedding' is redacted and large numeric arrays are redacted
    expect(safe.embedding).toBe('[REDACTED]');
  });
});
