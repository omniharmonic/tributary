/**
 * The manual form (P4) and confirmed extractions (P2/P3): events a person typed or
 * confirmed. Push-style; one source per host holds all of them.
 */
import type { Connector } from '../sdk.js'

export interface ManualConfig {
  hostKey: string
  tz?: string
}

export const manualConnector: Connector<ManualConfig, null> = {
  type: 'manual',
  platform: 'manual',
  capabilities: { live: 'none', delta: false, explicitDeletes: true, images: 'native', requiresAuth: 'none' },
  defaultInterval: 0,
  async configure(input) {
    const c = ('hint' in input ? (input as { hint: Partial<ManualConfig> }).hint : input) as Partial<ManualConfig>
    return { hostKey: String(c.hostKey ?? 'default'), tz: c.tz }
  },
  async fetch() {
    return { events: [], cursor: null, complete: false }
  },
  fingerprint: (cfg) => `manual:${cfg.hostKey}`,
  label: () => 'Events you added by hand',
}
