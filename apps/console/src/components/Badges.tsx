import type { ProvenanceLevel, Visibility } from '../lib/types'

export const PLATFORM_LABEL: Record<string, string> = {
  luma: 'Luma',
  meetup: 'Meetup',
  google: 'Google Calendar',
  wordpress: 'WordPress',
  squarespace: 'Squarespace',
  eventbrite: 'Eventbrite',
  ics: 'calendar feed',
  file: 'file',
  extract: 'flyer or text',
  flyer: 'flyer',
  text: 'text',
  email: 'email',
  api: 'API',
  manual: 'form',
  humanitix: 'Humanitix',
  dandelion: 'Dandelion',
  localist: 'Localist',
  mobilize: 'Mobilize',
  web: 'their website',
}

export function platformLabel(p: string): string {
  return PLATFORM_LABEL[p] ?? p
}

export function SourceBadge({ platform }: { platform: string }) {
  if (!platform || platform === 'manual' || platform === 'api') return null
  return <span className="badge">via {platformLabel(platform)}</span>
}

const PROVENANCE: Record<ProvenanceLevel, { text: string; cls: string; title: string }> = {
  domain: { text: 'Verified domain', cls: 'badge-pine', title: 'This host’s handle is a domain they control.' },
  source: { text: 'Verified source', cls: 'badge-pine', title: 'This host proved control of the calendar these events come from.' },
  email: { text: 'Email verified', cls: 'badge-slate', title: 'This host confirmed their email address.' },
  listed: { text: 'Listed, unclaimed', cls: 'badge', title: 'Added by a curator. The host has not claimed it yet.' },
}

export function ProvenanceBadge({ level }: { level: ProvenanceLevel }) {
  const p = PROVENANCE[level]
  return (
    <span className={`badge ${p.cls}`} title={p.title}>
      {level !== 'listed' ? <CheckIcon /> : null}
      {p.text}
    </span>
  )
}

export const VISIBILITY_LABEL: Record<Visibility, string> = {
  public: 'Public',
  unlisted: 'Unlisted',
  gated: 'Public, details for guests',
  members: 'Members',
  invite: 'Invite only',
  held: 'Held',
}

export function VisibilityBadge({ level, audienceName }: { level: Visibility; audienceName?: string | null }) {
  if (level === 'public') return null
  const cls = level === 'held' ? 'badge-held' : level === 'unlisted' ? 'badge' : 'badge-slate'
  return (
    <span className={`badge ${cls}`}>
      {level !== 'unlisted' && level !== 'held' ? <LockIcon /> : null}
      {audienceName ? audienceName : VISIBILITY_LABEL[level]}
    </span>
  )
}

export function StatusBadge({ status }: { status: 'scheduled' | 'cancelled' | 'postponed' | 'rescheduled' | 'planned' }) {
  if (status === 'scheduled') return null
  const text = { cancelled: 'Cancelled', postponed: 'Postponed', rescheduled: 'Rescheduled', planned: 'Not final yet' }[status]
  return <span className={`badge ${status === 'cancelled' ? 'badge-warn' : 'badge-held'}`}>{text}</span>
}

export function LockIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
      <rect x="4" y="10" width="16" height="11" rx="2" />
      <path d="M8 10V7a4 4 0 0 1 8 0v3" />
    </svg>
  )
}

export function CheckIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" aria-hidden="true">
      <path d="M4 12.5l5 5L20 6.5" />
    </svg>
  )
}
