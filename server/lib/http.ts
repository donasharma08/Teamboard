import type { Request, Response, NextFunction } from 'express';
import { z, ZodError, type ZodType } from 'zod';
import { errorDetails, log } from './log.js';

export class HttpError extends Error {
  constructor(public status: number, message: string, public details?: unknown) {
    super(message);
  }
}
export const notFound = (what = 'Not found') => new HttpError(404, what);
export const forbidden = (msg = 'You do not have permission to do that') => new HttpError(403, msg);

/** Validate a request body/query against a schema; throws a readable 400 on failure. */
export function parse<S extends ZodType>(schema: S, value: unknown): z.infer<S> {
  const r = schema.safeParse(value);
  if (!r.success) {
    const fields: Record<string, string> = {};
    for (const issue of r.error.issues) fields[issue.path.join('.') || '_'] = issue.message;
    throw new HttpError(400, 'Please check the highlighted fields', fields);
  }
  return r.data;
}

export const idParam = (v: unknown) => {
  const n = Number(v);
  if (!Number.isInteger(n) || n <= 0) throw notFound();
  return n;
};

export function errorHandler(err: any, req: Request, res: Response, _next: NextFunction) {
  if (err instanceof HttpError) {
    return res.status(err.status).json({ error: err.message, details: err.details });
  }
  if (err instanceof ZodError) return res.status(400).json({ error: 'Invalid input' });
  if (err?.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ error: 'That file is larger than 5 MB' });
  if (err?.code === '23505') return res.status(409).json({ error: 'That already exists' });
  if (err?.type === 'entity.parse.failed') return res.status(400).json({ error: 'Malformed JSON' });
  const requestId = res.getHeader('X-Request-Id');
  log('error', 'unhandled API error', {
    requestId, method: req.method, path: req.originalUrl, userId: req.user?.id, orgId: req.org?.id, ...errorDetails(err),
  });
  res.status(500).json({ error: `Something went wrong on our side. Please try again. (Reference: ${requestId})` });
}
