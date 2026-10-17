import type { Request, Response, NextFunction } from 'express';
import { type ZodTypeAny, ZodError } from 'zod';
import { ValidationError } from '@photography-saas/errors';

export interface RequestValidationSchemas {
  body?: ZodTypeAny;
  query?: ZodTypeAny;
  params?: ZodTypeAny;
}

/**
 * Zod Request Validation Middleware Factory
 */
export function validateRequest(schemas: RequestValidationSchemas) {
  return async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
    try {
      if (schemas.params) {
        req.params = await schemas.params.parseAsync(req.params);
      }
      if (schemas.query) {
        req.query = await schemas.query.parseAsync(req.query);
      }
      if (schemas.body) {
        req.body = await schemas.body.parseAsync(req.body);
      }
      next();
    } catch (error) {
      if (error instanceof ZodError) {
        const details = error.errors.map((err) => ({
          field: err.path.join('.'),
          message: err.message,
          code: err.code,
        }));
        next(new ValidationError('Request validation failed', details));
      } else {
        next(error);
      }
    }
  };
}

export function validateBody(schema: ZodTypeAny) {
  return validateRequest({ body: schema });
}

export function validateQuery(schema: ZodTypeAny) {
  return validateRequest({ query: schema });
}

export function validateParams(schema: ZodTypeAny) {
  return validateRequest({ params: schema });
}
