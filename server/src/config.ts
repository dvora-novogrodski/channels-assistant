import { z } from 'zod';

const optionalString = z
  .string()
  .optional()
  .transform((value) => value?.trim() || undefined);

const ROTATING_TOKEN_PREFIX = 'xoxe.';

// Slack issues rotating tokens with an extra "xoxe." prefix, e.g. "xoxe.xapp-1-...".
function optionalToken(prefix: string) {
  const hasPrefix = (value: string) => {
    const unwrapped = value.startsWith(ROTATING_TOKEN_PREFIX) ? value.slice(ROTATING_TOKEN_PREFIX.length) : value;
    return unwrapped.startsWith(prefix) && unwrapped.length > prefix.length;
  };
  return optionalString.refine((value) => value === undefined || hasPrefix(value), {
    message: `must start with ${prefix} (or ${ROTATING_TOKEN_PREFIX}${prefix})`,
  });
}

const EnvSchema = z.object({
  GEMINI_API_KEY: z.string().trim().min(1, 'GEMINI_API_KEY is required (see .env.example)'),
  LLM_MODEL: z.string().trim().min(1).default('gemini-flash-lite-latest'),
  LLM_FALLBACK_MODEL: optionalString,
  SLACK_BOT_TOKEN: optionalToken('xoxb-'),
  SLACK_APP_TOKEN: optionalToken('xapp-'),
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
