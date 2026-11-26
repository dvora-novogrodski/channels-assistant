import type { ErrorRequestHandler } from 'express';
import type { ApiErrorBody } from '@app/shared';
import { NotFoundError } from '../core/errors.js';
import { RequestValidationError } from './parseRequest.js';

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
  if (error instanceof RequestValidationError) return { status: 400, message: error.message };
  if (error instanceof NotFoundError) return { status: 404, message: error.message };
  if (isBodyParserError(error, 'entity.parse.failed')) return { status: 400, message: 'Malformed JSON body' };
  if (isBodyParserError(error, 'entity.too.large')) return { status: 413, message: 'Request body too large' };
  return { status: 500, message: 'Internal server error' };
}

function isBodyParserError(error: unknown, type: string): boolean {
  return typeof error === 'object' && error !== null && 'type' in error && error.type === type;
}
