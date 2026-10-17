import type { Request, Response, NextFunction } from 'express';

const SENSITIVE_KEYS = new Set([
  'password',
  'currentpassword',
  'current_password',
  'newpassword',
  'new_password',
  'pin',
  'pin_hash',
  'token',
  'guest_token',
  'secret',
  'auth_secret',
  'jwt_secret',
  'access_key',
  'secret_access_key',
  'internal_service_key',
  'x-internal-service-key',
  'cookie',
  'set-cookie',
  'embedding',
  'embeddings',
  'selfie',
  'image',
  'imagebase64',
  'image_base64',
  'photo',
  'rawbase64',
  'raw_base64',
  'image_buffer',
  'database_url',
  'redis_url',
  'authorization',
  'x-guest-token',
]);

/**
 * Deeply censors sensitive properties from log payloads.
 */
export function censorSensitiveData(obj: unknown): unknown {
  if (obj === null || obj === undefined) return obj;
  if (typeof obj === 'string') {
    // Mask potential JWT tokens (format: xxx.yyy.zzz)
    if (/^[A-Za-z0-9-_]+\.[A-Za-z0-9-_]+\.[A-Za-z0-9-_]+$/.test(obj)) {
      return '[REDACTED_JWT_TOKEN]';
    }
    // Redact base64 image data strings or data URIs
    if (obj.startsWith('data:image/') || (obj.length > 300 && /^[A-Za-z0-9+/=]+$/.test(obj.slice(0, 100)))) {
      return '[REDACTED_IMAGE_DATA]';
    }
    return obj;
  }
  if (typeof obj !== 'object') return obj;

  if (Array.isArray(obj)) {
    // If it's a vector embedding array of numbers, redact it
    if (obj.length > 50 && typeof obj[0] === 'number') {
      return `[REDACTED_VECTOR_${obj.length}D]`;
    }
    return obj.map((item) => censorSensitiveData(item));
  }

  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
    const lowerKey = key.toLowerCase();
    if (
      SENSITIVE_KEYS.has(lowerKey) ||
      lowerKey.includes('password') ||
      lowerKey.includes('secret') ||
      lowerKey.includes('cookie') ||
      lowerKey.includes('token') ||
      lowerKey.includes('selfie')
    ) {
      result[key] = '[REDACTED]';
    } else {
      result[key] = censorSensitiveData(value);
    }
  }
  return result;
}

export interface LogEntry {
  timestamp: string;
  level: 'info' | 'warn' | 'error' | 'debug';
  service: string;
  message: string;
  requestId?: string;
  route?: string;
  method?: string;
  statusCode?: number;
  durationMs?: number;
  details?: unknown;
}

/**
 * Emits a structured JSON log line.
 */
export function log(entry: LogEntry): void {
  const safeEntry = censorSensitiveData(entry) as LogEntry;
  const line = JSON.stringify(safeEntry);

  if (entry.level === 'error') {
    process.stderr.write(line + '\n');
  } else {
    process.stdout.write(line + '\n');
  }
}

/**
 * Express HTTP Request Logger Middleware
 */
export function requestLoggerMiddleware(req: Request, res: Response, next: NextFunction): void {
  const startTime = Date.now();

  res.on('finish', () => {
    const durationMs = Date.now() - startTime;
    const level = res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info';

    log({
      timestamp: new Date().toISOString(),
      level,
      service: 'photography-api',
      message: `${req.method} ${req.originalUrl} - ${res.statusCode} (${durationMs}ms)`,
      requestId: req.requestId,
      route: req.originalUrl,
      method: req.method,
      statusCode: res.statusCode,
      durationMs,
    });
  });

  next();
}
