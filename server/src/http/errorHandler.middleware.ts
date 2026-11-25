import type { ErrorRequestHandler } from 'express';
import { z } from 'zod';
import type { ApiErrorBody } from '@app/shared';
import { NotFoundError } from '../core/errors.js';

interface HttpError {
  status: number;
  message: string;
}

export const errorHandler: ErrorRequestHandler = (error, req, res, next) => {
  if (res.headersSent) {
    next(error);
    return;
  }
  const { status, message } = toHttpError(error);
  if (status >= 500) console.error(`${req.method} ${req.originalUrl} failed`, error);
  res.status(status).json({ error: message } satisfies ApiErrorBody);
};

function toHttpError(error: unknown): HttpError {
  if (error instanceof z.ZodError) {
    const problems = error.issues.map(({ path, message }) => `${path.join('.') || 'request'}: ${message}`);
    return { status: 400, message: `Invalid request. ${problems.join('; ')}` };
  }
  if (error instanceof NotFoundError) return { status: 404, message: error.message };
  if (isBodyParserError(error, 'entity.parse.failed')) return { status: 400, message: 'Malformed JSON body' };
  if (isBodyParserError(error, 'entity.too.large')) return { status: 413, message: 'Request body too large' };
  return { status: 500, message: 'Internal server error' };
}

// express.json() reports parse problems as errors tagged with a `type` string rather than an error class.
function isBodyParserError(error: unknown, type: string): boolean {
  return typeof error === 'object' && error !== null && 'type' in error && error.type === type;
}
