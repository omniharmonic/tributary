/**
 * The builder surface (B1–B3): `POST /v1/events`, the inbound webhook and MCP all push
 * `RawEvent`-shaped JSON keyed by `externalId`. One source per host per channel.
 */
import type { Connector } from '../sdk.js'

export interface ApiConfig {
  hostKey: string
  /** api | webhook | mcp | email */
  channel: string
  tz?: string
}

export const apiConnector: Connector<ApiConfig, null> = {
  type: 'api',
  platform: 'api',
  capabilities: { live: 'push', delta: true, explicitDeletes: true, images: 'native', requiresAuth: 'apiKey' },
  defaultInterval: 0,
  async configure(input) {
    const c = ('hint' in input ? (input as { hint: Partial<ApiConfig> }).hint : input) as Partial<ApiConfig>
    return { hostKey: String(c.hostKey ?? 'default'), channel: String(c.channel ?? 'api'), tz: c.tz }
  },
  async fetch() {
    return { events: [], cursor: null, complete: false }
  },
  fingerprint: (cfg) => `api:${cfg.channel}:${cfg.hostKey}`,
  label: (cfg) => ({ api: 'API', webhook: 'Webhook (Zapier, Make, n8n)', mcp: 'MCP agent', email: 'Forwarded email' })[cfg.channel] ?? cfg.channel,
}

/** Source types whose events arrive by push and live in the pushed-event table. */
export const PUSH_SOURCE_TYPES = new Set(['upload', 'manual', 'api', 'email', 'extract'])
