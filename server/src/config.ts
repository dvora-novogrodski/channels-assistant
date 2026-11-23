import { z } from 'zod';

const optionalString = z
  .string()
  .optional()
  .transform((value) => value?.trim() || undefined);

const EnvSchema = z.object({
  GEMINI_API_KEY: z.string().trim().min(1, 'GEMINI_API_KEY is required (see .env.example)'),
  LLM_MODEL: z.string().trim().min(1).default('gemini-2.5-flash'),
  LLM_FALLBACK_MODEL: optionalString,
  SLACK_BOT_TOKEN: optionalString,
  SLACK_APP_TOKEN: optionalString,
  PORT: z.coerce.number().int().positive().default(3000),
  DEMO_FAILURES: z
    .enum(['true', 'false'])
    .default('false')
    .transform((value) => value === 'true'),
});

export type Config = z.infer<typeof EnvSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = EnvSchema.safeParse(env);
  if (parsed.success) return parsed.data;

  const problems = parsed.error.issues.map(({ path, message }) => `  - ${path.join('.')}: ${message}`);
  throw new Error(`Invalid environment configuration:\n${problems.join('\n')}`);
}
