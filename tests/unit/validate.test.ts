import { describe, it, expect, vi } from 'vitest';
import { z } from 'zod';
import { validateRequest } from '../../apps/api/src/middleware/validate.js';
import { ValidationError } from '../../packages/errors/src/AppError.js';

describe('Zod Validation Middleware Unit Tests', () => {
  const schema = {
    body: z.object({
      email: z.string().email(),
      age: z.number().min(18),
    }),
  };

  it('should call next() with no errors on valid input', async () => {
    const middleware = validateRequest(schema);
    const req: any = {
      body: {
        email: 'test@example.com',
        age: 25,
      },
    };
    const res: any = {};
    const next = vi.fn();

    await middleware(req, res, next);

    expect(next).toHaveBeenCalledWith();
  });

  it('should call next(ValidationError) with details on invalid input', async () => {
    const middleware = validateRequest(schema);
    const req: any = {
      body: {
        email: 'not-an-email',
        age: 15,
      },
    };
    const res: any = {};
    const next = vi.fn();

    await middleware(req, res, next);

    expect(next).toHaveBeenCalled();
    const passedError = next.mock.calls[0][0];
    expect(passedError).toBeInstanceOf(ValidationError);
    expect(passedError.statusCode).toBe(400);
    expect(passedError.details).toBeDefined();
    expect(Array.isArray(passedError.details)).toBe(true);
  });
});
