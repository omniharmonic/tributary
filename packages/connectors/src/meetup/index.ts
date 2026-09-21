/**
 * `meetup` — a Meetup group (architecture §4.1). `meetup.com/<group>` (or any of its
 * event URLs) resolves to `https://www.meetup.com/<group>/events/ical/`. UIDs are
 * `event_<id>@meetup.com`; the event page is `https://www.meetup.com/<group>/events/<id>/`.
 * Images come from the event page's JSON-LD through page enrichment.
 */
import { ConnectorError, HOUR, type Connector, type DetectInput, type DetectMatch, type RawEvent } from '../sdk.js'
import { fetchAndParse } from '../ics/feed.js'

export interface MeetupConfig {
  group: string
  title?: string
}

const MEETUP_HOST = /(^|\.)meetup\.com$/i
const RESERVED = new Set(['find', 'login', 'register', 'events', 'groups', 'topics', 'cities', 'pro', 'home', 'messages', 'about', 'blog', 'help', 'api', 'organizer', 'start'])

export function meetupIcalUrl(group: string): string {
  return `https://www.meetup.com/${encodeURIComponent(group)}/events/ical/`
}

/** The group slug from a group, event list or event URL. */
export function groupFrom(u: URL): string | undefined {
  if (!MEETUP_HOST.test(u.hostname)) return undefined
  const parts = u.pathname.split('/').filter(Boolean)
  // Localized paths: /en-AU/<group>/...
  const first = parts[0]
  const start = first && /^[a-z]{2}(-[A-Za-z]{2})?$/.test(first) && parts.length > 1 ? 1 : 0
  const group = parts[start]
  if (!group || RESERVED.has(group.toLowerCase())) return undefined
  if (!/^[A-Za-z0-9_-]{2,}$/.test(group)) return undefined
  return group
}

export function eventIdFromUid(uid: string): string | undefined {
  return /^event_([A-Za-z0-9]+)@meetup\.com$/i.exec(uid)?.[1]
}

export const meetupConnector: Connector<MeetupConfig, null> = {
  type: 'meetup',
  platform: 'meetup',
  capabilities: { live: 'poll', delta: false, explicitDeletes: false, images: 'via-page', requiresAuth: 'none' },
  defaultInterval: HOUR,

  async detect(input: DetectInput): Promise<DetectMatch | null> {
    const u = input.url
    if (!u) return null
    const group = groupFrom(u)
    if (!group) return null
    const isEvent = /\/events\/[A-Za-z0-9]+\/?$/i.test(u.pathname)
    return {
      type: 'meetup',
      confidence: 0.96,
      platform: 'meetup',
      hint: { group },
      ...(isEvent ? { note: 'This is a single Meetup event; we will connect the whole group so new events appear too.' } : {}),
    }
  },

  async configure(input, ctx): Promise<MeetupConfig> {
    const hint = 'hint' in input ? (input as DetectMatch).hint : (input as Record<string, unknown>)
    let group = typeof hint.group === 'string' ? hint.group : undefined
    if (!group && typeof hint.url === 'string') {
      try {
        group = groupFrom(new URL(hint.url))
      } catch {
        /* no */
      }
    }
    if (!group) throw new ConnectorError('no Meetup group', 'Unsupported', false)
    const res = await fetchAndParse(meetupIcalUrl(group), { http: ctx.http, log: ctx.log, secrets: {}, window: { from: new Date(), to: new Date(Date.now() + 1) }, defaultTz: 'UTC' }).catch((err) => {
      if (err instanceof ConnectorError && (err.code === 'NotFound' || err.code === 'Gone')) throw new ConnectorError('that Meetup group does not exist (Meetup answered "Group not found")', 'NotFound', false)
      throw err
    })
    const cfg: MeetupConfig = { group }
    if (res.meta?.title) cfg.title = res.meta.title
    return cfg
  },

  async fetch(cfg, _cursor, ctx) {
    return fetchAndParse(meetupIcalUrl(cfg.group), ctx, (e) => {
      const out: RawEvent = { ...e }
      const id = eventIdFromUid(e.externalId)
      if (id && !out.url) out.url = `https://www.meetup.com/${cfg.group}/events/${id}/`
      delete out.imageUrl
      return out
    })
  },

  fingerprint(cfg) {
    return `meetup:${cfg.group.toLowerCase()}`
  },

  label(cfg) {
    return cfg.title ? `${cfg.title} (Meetup)` : `meetup.com/${cfg.group}`
  },
}
