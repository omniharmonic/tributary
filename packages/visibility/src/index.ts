/**
 * The classify stage (architecture §9.4) and the narrowing rule.
 *
 * Inputs, in priority order: the per-event host override, source signals, host rules,
 * the source default. Output: `visibility`, `audience`, `gatedFields`, `visibilitySource`.
 *
 * Visibility only narrows on its own. `isWidening(from, to)` is what reconcile uses to
 * route a change to the confirmation queue instead of applying it.
 */
import { rehash, type Audience, type GatedField, type NormalizedEvent, type Visibility, type VisibilitySource } from '@tributary/event-model'

/** Higher is more visible. */
export const VISIBILITY_RANK: Record<Visibility, number> = { public: 5, unlisted: 4, gated: 3, members: 2, invite: 1, held: 0 }

export function isWidening(from: Visibility, to: Visibility): boolean {
  return VISIBILITY_RANK[to] > VISIBILITY_RANK[from]
}

export function narrower(a: Visibility, b: Visibility): Visibility {
  return VISIBILITY_RANK[a] <= VISIBILITY_RANK[b] ? a : b
}

export interface RuleMatch {
  titleContains?: string
  /** The source's own calendar/collection name (from `raw.extra.calendar`). */
  calendar?: string
  category?: string
  locationType?: 'home' | 'venue' | 'online'
  flag?: 'private' | 'membersOnly' | 'conference'
}

export interface VisibilityRule {
  match: RuleMatch
  level: Visibility
  audience?: Audience
  gatedFields?: GatedField[]
}

export interface Override {
  visibility?: Visibility
  audience?: Audience
  gatedFields?: GatedField[]
  hidden?: boolean
}

export interface ClassifyContext {
  sourceDefault: Visibility
  sourceAudience?: Audience
  /** When the source is mapped to a space, private source events go there instead of Held. */
  sourceMappedToSpace?: boolean
  rules?: VisibilityRule[]
  override?: Override | null
  /** Source-level calendar/collection name for `calendar` rules. */
  calendarName?: string
}

export interface Classification {
  visibility: Visibility
  visibilitySource: VisibilitySource
  audience?: Audience
  gatedFields: GatedField[]
  /** Why, for the dashboard. */
  reason: string
}

function matches(rule: RuleMatch, e: NormalizedEvent, ctx: ClassifyContext): boolean {
  if (rule.titleContains && !e.name.toLowerCase().includes(rule.titleContains.toLowerCase())) return false
  if (rule.calendar && (ctx.calendarName ?? '').toLowerCase() !== rule.calendar.toLowerCase()) return false
  if (rule.category && (e.category ?? '') !== rule.category && !e.tags.includes(rule.category.toLowerCase())) return false
  if (rule.locationType) {
    const l = e.locations[0]
    const type = e.mode === 'virtual' ? 'online' : l?.private ? 'home' : 'venue'
    if (type !== rule.locationType) return false
  }
  if (rule.flag === 'private' && !(e.sourcePrivacy === 'private' || e.sourcePrivacy === 'confidential')) return false
  if (rule.flag === 'membersOnly' && e.sourcePrivacy !== 'unlisted') return false
  if (rule.flag === 'conference' && !e.joinUrl) return false
  return true
}

/** The source's own signal caps how visible an event may be (§9.4 table). */
export function sourceCeiling(e: NormalizedEvent, ctx: ClassifyContext): { level: Visibility; reason: string } | null {
  if (e.sourcePrivacy === 'private' || e.sourcePrivacy === 'confidential') {
    if (ctx.sourceMappedToSpace && ctx.sourceAudience && (ctx.sourceDefault === 'members' || ctx.sourceDefault === 'invite')) {
      return { level: ctx.sourceDefault, reason: `marked ${e.sourcePrivacy} at the source; sent to the source's audience` }
    }
    return { level: 'held', reason: `marked ${e.sourcePrivacy} at the source` }
  }
  if (e.sourcePrivacy === 'unlisted') return { level: 'unlisted', reason: 'unlisted or members-only at the source' }
  return null
}

export function classify(e: NormalizedEvent, ctx: ClassifyContext): Classification {
  const gated = new Set<GatedField>()
  // Conference links are gated by default on anything public: a public Zoom link is an invitation to strangers.
  if (e.joinUrl) gated.add('joinUrl')
  // A home address publishes coarse until the host says otherwise.
  if (e.locations.some((l) => l.private)) gated.add('exactLocation')

  let level: Visibility = ctx.sourceDefault
  let source: VisibilitySource = 'host-default'
  let audience = ctx.sourceAudience
  let reason = 'source default'

  for (const rule of ctx.rules ?? []) {
    if (matches(rule.match, e, ctx)) {
      level = rule.level
      source = 'rule'
      audience = rule.audience ?? audience
      for (const g of rule.gatedFields ?? []) gated.add(g)
      reason = `rule: ${describeRule(rule)}`
      break
    }
  }

  const ceiling = sourceCeiling(e, ctx)
  if (ceiling && VISIBILITY_RANK[ceiling.level] < VISIBILITY_RANK[level]) {
    level = ceiling.level
    source = 'source-signal'
    reason = ceiling.reason
  }

  if (ctx.override?.visibility) {
    // A per-event override is the host's explicit choice, but it still cannot lift a source signal above its ceiling.
    const wanted = ctx.override.visibility
    if (ceiling && VISIBILITY_RANK[wanted] > VISIBILITY_RANK[ceiling.level]) {
      reason = `${ceiling.reason}; the per-event choice (${wanted}) cannot override a source signal`
    } else {
      level = wanted
      source = 'per-event'
      reason = 'set by the host on this event'
    }
    audience = ctx.override.audience ?? audience
    for (const g of ctx.override.gatedFields ?? []) gated.add(g)
  }
  if (ctx.override?.hidden) {
    level = 'held'
    source = 'per-event'
    reason = 'hidden by the host'
  }

  if (level === 'gated' && gated.size === 0) gated.add('exactLocation')
  if ((level === 'members' || level === 'invite') && !audience) {
    // No audience means nobody could ever see it; hold rather than publish to nobody or to everyone.
    return { visibility: 'held', visibilitySource: source, gatedFields: [...gated], reason: `${reason}; no audience configured` }
  }
  return { visibility: level, visibilitySource: source, audience: level === 'members' || level === 'invite' ? audience : undefined, gatedFields: [...gated], reason }
}

export function applyClassification(e: NormalizedEvent, c: Classification): NormalizedEvent {
  return rehash({ ...e, visibility: c.visibility, visibilitySource: c.visibilitySource, audience: c.audience, gatedFields: c.gatedFields })
}

export function describeRule(r: VisibilityRule): string {
  const m = r.match
  const parts: string[] = []
  if (m.titleContains) parts.push(`title contains "${m.titleContains}"`)
  if (m.calendar) parts.push(`calendar "${m.calendar}"`)
  if (m.category) parts.push(`category ${m.category}`)
  if (m.locationType) parts.push(`${m.locationType} location`)
  if (m.flag) parts.push(`flagged ${m.flag}`)
  return `${parts.join(' and ') || 'everything'} → ${r.level}`
}

/** Public-surface hygiene: what a public store may hold for this level (F27). */
export function isPublicLevel(v: Visibility): boolean {
  return v === 'public' || v === 'unlisted' || v === 'gated'
}
export function isDiscoverable(v: Visibility): boolean {
  return v === 'public' || v === 'gated'
}
