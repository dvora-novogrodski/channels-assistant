import type { z } from 'zod';

export class RequestValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RequestValidationError';
  }
}

export function parseRequest<TSchema extends z.ZodType>(schema: TSchema, input: unknown): z.infer<TSchema> {
  const parsed = schema.safeParse(input);
  if (parsed.success) return parsed.data;

  const problems = parsed.error.issues.map(({ path, message }) => `${path.join('.') || 'request'}: ${message}`);
  throw new RequestValidationError(`Invalid request. ${problems.join('; ')}`);
}
