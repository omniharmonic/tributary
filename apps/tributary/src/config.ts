/**
 * Env parsing. Everything Tributary needs is declared here and nowhere else.
 * Nothing in this file is ever logged; `redactedConfig()` is the only thing allowed
 * near a log line.
 */
import { z } from 'zod'
import { parseKeyRing, type KeyRing } from '@tributary/identity'

const csv = (s: string) => s.split(',').map((x) => x.trim()).filter(Boolean)

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  DATABASE_URL: z.string().default('postgres://localhost:5432/tributary'),
  TRIBUTARY_PORT: z.coerce.number().int().positive().default(4100),
  /** This deployment's public origin: links in mail, `createdWith`, OAuth client id. */
  WEB_PUBLIC_URL: z.string().url().default('http://localhost:5174'),

  /** The Directory PDS (custodial accounts are minted here). */
  PDS_URL: z.string().url().default('http://localhost:3000'),
  /** The PDS reached directly on the compose network, for health and the TLS gate. */
  PDS_INTERNAL_URL: z.string().default(''),
  PDS_ADMIN_PASSWORD: z.string().default(''),
  /** Handle domain for custodial hosts, no leading dot. */
  PDS_HANDLE_DOMAIN: z.string().default('test'),
  /** For local development against a local PDS: skip the SSRF private-range check for this origin only. */
  PDS_ALLOW_PRIVATE: z.stringbool().default(false),

  /** The region this deployment serves. */
  REGION_SLUG: z.string().default('boulder'),
  REGION_NAME: z.string().default('Boulder'),
  REGION_TZ: z.string().default('America/Denver'),
  REGION_COUNTRY: z.string().default('US'),
  BRAND_NAME: z.string().default('Boulder Events Directory'),
  ADAPTER_NAME: z.string().default('Tributary'),

  /** The Gate. */
  GATE_URL: z.string().url().default('http://localhost:4200'),
  GATE_SERVICE_SECRET: z.string().default('dev-gate-secret'),

  /** Secrets. */
  SESSION_SECRET: z.string().min(16).default('dev-session-secret-change-me'),
  SESSION_TTL_DAYS: z.coerce.number().int().positive().default(30),
  CUSTODY_KEYS: z.string().default(`v1:${Buffer.alloc(32, 7).toString('base64')}`),
  CUSTODY_KEY_VERSION: z.string().default('v1'),
  INBOUND_EMAIL_SECRET: z.string().default(''),
  TELEGRAM_BOT_TOKEN: z.string().default(''),
  TELEGRAM_WEBHOOK_SECRET: z.string().default(''),
  STEWARD_KEY: z.string().default(''),
  OAUTH_PRIVATE_JWK: z.string().default(''),

  /** Search. Empty = the Postgres substring fallback. */
  MEILI_URL: z.string().default(''),
  MEILI_MASTER_KEY: z.string().default(''),
  MEILI_INDEX: z.string().default('tb_events'),

  /** Enrichment. */
  GOOGLE_API_KEY: z.string().default(''),
  PHOTON_URL: z.string().default(''),
  EXTRACT_MODEL_API_KEY: z.string().default(''),
  EXTRACT_MODEL: z.string().default('claude-haiku-4-5'),

  /** Email. Unset locally: mail is appended to `.dev-mail.log` instead of sent. */
  SMTP_URL: z.string().default(''),
  MAIL_FROM: z.string().default('Tributary <no-reply@localhost>'),
  DEV_MAIL_LOG: z.string().default(''),
  INBOUND_EMAIL_DOMAIN: z.string().default('in.localhost'),

  /** Console build to serve in production (empty = API only). */
  CONSOLE_DIST: z.string().default(''),
  TRIBUTARY_NO_JOBS: z.stringbool().default(false),
  /** Comma-separated DIDs allowed to use steward routes. */
  STEWARD_DIDS: z.string().default('').transform(csv),
})

export type Config = z.infer<typeof schema> & {
  custodyKeys: KeyRing
  handleDomain: string
  createdWith: string
}

let cached: Config | undefined

export function config(): Config {
  if (cached) return cached
  const parsed = schema.parse(process.env)
  cached = {
    ...parsed,
    custodyKeys: parseKeyRing(parsed.CUSTODY_KEYS),
    handleDomain: parsed.PDS_HANDLE_DOMAIN.replace(/^\./, ''),
    createdWith: parsed.WEB_PUBLIC_URL,
  }
  if (cached.NODE_ENV === 'production') {
    if (!parsed.SMTP_URL) throw new Error('SMTP_URL is required in production (the magic-link door cannot work without it)')
    if (parsed.SESSION_SECRET.startsWith('dev-')) throw new Error('SESSION_SECRET must be set in production')
    if (parsed.GATE_SERVICE_SECRET.startsWith('dev-')) throw new Error('GATE_SERVICE_SECRET must be set in production')
    if (parsed.CUSTODY_KEYS.startsWith('v1:BwcHBw')) throw new Error('CUSTODY_KEYS must be set in production')
  }
  return cached
}

export function resetConfigForTests(): void {
  cached = undefined
}

export function redactedConfig(c: Config): Record<string, string | number | boolean> {
  return {
    env: c.NODE_ENV,
    port: c.TRIBUTARY_PORT,
    web: c.WEB_PUBLIC_URL,
    pds: c.PDS_URL,
    handleDomain: c.handleDomain,
    region: c.REGION_SLUG,
    gate: c.GATE_URL,
    smtp: c.SMTP_URL ? 'configured' : 'file-sink',
    photon: c.PHOTON_URL ? 'configured' : 'off',
    googleApi: c.GOOGLE_API_KEY ? 'configured' : 'off',
    extraction: c.EXTRACT_MODEL_API_KEY ? 'configured' : 'off',
    telegram: c.TELEGRAM_BOT_TOKEN ? 'configured' : 'off',
    search: c.MEILI_URL ? 'configured' : 'off',
  }
}
