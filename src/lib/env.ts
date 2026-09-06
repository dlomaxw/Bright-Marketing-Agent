import { z } from 'zod';

/**
 * Environment is validated once, at import. A malformed value fails the process
 * at boot rather than at 2am inside a send handler.
 */

const bool = (def: 'true' | 'false') =>
  z
    .enum(['true', 'false'])
    .default(def)
    .transform((v) => v === 'true');

const int = (def: number) =>
  z.coerce.number().int().positive().default(def);

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  SESSION_SECRET: z
    .string()
    .min(32, 'SESSION_SECRET must be at least 32 characters. Generate one with: node -e "console.log(require(\'crypto\').randomBytes(48).toString(\'base64url\'))"'),
  APP_URL: z.string().url().default('http://localhost:3000'),
  SESSION_TTL_HOURS: int(12),

  AUDIT_USER_AGENT: z
    .string()
    .default('BrightScopeBot/0.1 (+https://brightthoughts.example/bot; marketing audit)'),
  AUDIT_REQUEST_TIMEOUT_MS: int(15_000),
  AUDIT_MIN_INTERVAL_MS: int(1_500),
  AUDIT_MAX_REDIRECTS: int(10),
  AUDIT_MAX_PAGES_PER_RUN: int(12),
  AUDIT_MAX_BYTES: int(3_000_000),
  AUDIT_RESPECT_ROBOTS: bool('true'),
  EVIDENCE_FRESHNESS_HOURS: int(168),

  EMAIL_PROVIDER: z.enum(['console', 'smtp']).default('console'),
  EMAIL_FROM_NAME: z.string().default('Bright Thoughts Services'),
  EMAIL_FROM_ADDRESS: z.string().default(''),
  EMAIL_FREQUENCY_CAP_DAYS: int(30),
  EMAIL_FREQUENCY_CAP_COUNT: int(1),
  ALLOW_SELF_SEND_AFTER_APPROVAL: bool('false'),
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().int().optional(),
  SMTP_USER: z.string().optional(),
  SMTP_PASSWORD: z.string().optional(),

  // Spaceship manages domains and DNS. It CANNOT send email — sending goes over
  // SMTP to Spacemail. Both key and secret are required by their API.
  SPACESHIP_API_KEY: z.string().default(''),
  SPACESHIP_API_SECRET: z.string().default(''),

  // Cloudflare. R2 is object storage (S3 API) for evidence and documents.
  // D1 is listed for completeness — see docs/LIMITATIONS.md on why it is not
  // the primary database for this application.
  CLOUDFLARE_ACCOUNT_ID: z.string().default(''),
  CLOUDFLARE_API_TOKEN: z.string().default(''),
  CLOUDFLARE_D1_DATABASE_ID: z.string().default(''),
  R2_ACCOUNT_ID: z.string().default(''),
  R2_ACCESS_KEY_ID: z.string().default(''),
  R2_SECRET_ACCESS_KEY: z.string().default(''),
  R2_S3_ENDPOINT: z.string().default(''),
  R2_BUCKET: z.string().default('brightscope'),

  ANTHROPIC_API_KEY: z.string().default(''),
  GEMINI_API_KEY: z.string().default(''),
  GOOGLE_AI_API_KEY: z.string().default(''),
  GOOGLE_CLIENT_ID: z.string().default(''),
  GOOGLE_CLIENT_SECRET: z.string().default(''),
  GEMINI_MODEL: z.string().default('gemini-2.5-flash'),
  AI_PROVIDER: z.enum(['auto', 'gemini', 'anthropic', 'deterministic']).default('auto'),
  AI_MODEL: z.string().default('claude-sonnet-5'),

  PAGESPEED_API_KEY: z.string().default(''),
  GOOGLE_PLACES_API_KEY: z.string().default(''),
  META_ACCESS_TOKEN: z.string().default(''),
  LINKEDIN_ACCESS_TOKEN: z.string().default(''),
  YOUTUBE_API_KEY: z.string().default(''),

  /** Shared secret for scheduled runs. Unset disables the cron endpoints. */
  CRON_SECRET: z.string().default(''),

  STORAGE_DRIVER: z.enum(['local','r2']).default('local'),
  STORAGE_LOCAL_PATH: z.string().default('./storage'),
});

/**
 * An unset variable and one set to the empty string mean the same thing here:
 * not configured. They are not the same to Zod — `.default()` applies only to
 * `undefined`, so an empty string reaches the validator and `z.coerce.number()`
 * turns it into 0, which then fails `.positive()`.
 *
 * This is not hypothetical tidying. Hosting platforms hand unset variables to
 * the build as empty strings, so a deployment failed on eighteen variables that
 * all had perfectly good defaults — while every local run passed, because a
 * local `.env` sets them. Empty means absent, and absent means use the default.
 */
export function withoutBlanks(source: NodeJS.ProcessEnv): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(source)) {
    if (typeof value === 'string' && value.trim() === '') continue;
    if (value !== undefined) out[key] = value;
  }
  return out;
}

function load() {
  const parsed = schema.safeParse(withoutBlanks(process.env));
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}\n\nSee .env.example.`);
  }
  return parsed.data;
}

export const env = load();

/** Which optional integrations are live. Drives the "manual review" fallbacks. */
export const integrations = {
  ai: env.GEMINI_API_KEY.length > 0 || env.ANTHROPIC_API_KEY.length > 0,
  gemini: env.GEMINI_API_KEY.length > 0,
  anthropic: env.ANTHROPIC_API_KEY.length > 0,
  pagespeed: env.PAGESPEED_API_KEY.length > 0,
  googlePlaces: env.GOOGLE_PLACES_API_KEY.length > 0,
  meta: env.META_ACCESS_TOKEN.length > 0,
  linkedin: env.LINKEDIN_ACCESS_TOKEN.length > 0,
  youtube: env.YOUTUBE_API_KEY.length > 0,
  emailProvider: env.EMAIL_PROVIDER !== 'console',
  spaceship: env.SPACESHIP_API_KEY.length > 0 && env.SPACESHIP_API_SECRET.length > 0,
  r2:
    env.R2_ACCESS_KEY_ID.length > 0 &&
    env.R2_SECRET_ACCESS_KEY.length > 0 &&
    env.R2_S3_ENDPOINT.length > 0,
  cloudflare: env.CLOUDFLARE_ACCOUNT_ID.length > 0 && env.CLOUDFLARE_API_TOKEN.length > 0,
} as const;

export const isProd = env.NODE_ENV === 'production';
