/**
 * THE card. The preview, the ledger and the directory all render this one component
 * from the same `EventCard` model, so what a host sees before publishing is what an
 * attendee sees after.
 */
import type { ReactNode } from 'react'
import type { EventCard as EventCardModel, ProvenanceLevel, Visibility } from '../lib/types'
import { ProvenanceBadge, SourceBadge, StatusBadge, VisibilityBadge } from './Badges'

export interface EventCardProps {
  card: EventCardModel
  hostName?: string
  provenance?: ProvenanceLevel
  audienceName?: string | null
  href?: string
  /** Renders the card as a link-less row (preview) or with the RSVP action (directory). */
  action?: ReactNode
  compact?: boolean
  showMissing?: boolean
}

export function EventCard({ card, hostName, provenance, audienceName, href, action, compact, showMissing }: EventCardProps) {
  const cancelled = card.status === 'cancelled'
  const Title = href ? 'a' : 'span'
  return (
    <article className={`flex gap-3 sm:gap-4 ${cancelled ? 'opacity-70' : ''}`} aria-label={card.name}>
      <div className={`shrink-0 overflow-hidden rounded-[var(--r-md)] bg-surface-2 ${compact ? 'h-16 w-16' : 'h-20 w-20 sm:h-24 sm:w-32'}`}>
        {card.imageUrl ? (
          <img src={card.imageUrl} alt="" className="h-full w-full object-cover" loading="lazy" />
        ) : (
          <Placeholder name={card.name} />
        )}
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-sm text-ink-soft">{card.when}</p>
        <h3 className={`mt-0.5 leading-tight ${cancelled ? 'line-through decoration-2' : ''}`}>
          <Title {...(href ? { href, className: 'no-underline hover:underline underline-offset-2' } : {})}>{card.name}</Title>
        </h3>
        <p className="mt-0.5 truncate text-sm text-ink-soft">
          {card.place ?? (card.mode === 'virtual' ? 'Online' : 'Location to be announced')}
          {card.placeCoarse ? <CoarsePlaceNote visibility={card.visibility} audienceName={audienceName} /> : null}
          {hostName ? <span> · {hostName}</span> : null}
        </p>
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
          <StatusBadge status={card.status} />
          <VisibilityBadge level={card.visibility} audienceName={audienceName} />
          <SourceBadge platform={card.platform} />
          {provenance ? <ProvenanceBadge level={provenance} /> : null}
          {card.priceText ? <span className="badge">{card.priceText}</span> : null}
          {card.category ? <span className="badge">{card.category}</span> : null}
        </div>
        {showMissing && card.missing.length > 0 ? (
          <p className="mt-1.5 text-xs text-ink-faint">
            Missing: {card.missing.filter((m) => m !== 'end' && m !== 'description').map(missingText).join(', ') || 'nothing important'}
          </p>
        ) : null}
        {action ? <div className="mt-2">{action}</div> : null}
      </div>
    </article>
  )
}

function missingText(m: EventCardModel['missing'][number]): string {
  return { image: 'image (your logo will be used)', place: 'location', timezone: 'timezone (guessed)', description: 'description', end: 'end time' }[m]
}

/** A quiet placeholder built from the title so cards never render blank. */
export function Placeholder({ name }: { name: string }) {
  const letter = name.trim().charAt(0).toUpperCase() || '·'
  return (
    <div className="flex h-full w-full items-end bg-gradient-to-br from-slate-soft to-pine-soft p-2" aria-hidden="true">
      <span className="font-serif text-2xl leading-none text-pine">{letter}</span>
    </div>
  )
}

/**
 * `placeCoarse` has two quite different causes and they must not share one sentence.
 *
 * On a gated event we withhold the street on purpose, and saying so is the point: the
 * reader learns there is an address and how to earn it. On a public event the flag means
 * only that geocoding got as far as the city centroid, so the same sentence would claim a
 * secret that does not exist — a public university colloquium telling a neighbour the
 * address is for confirmed guests. That is the opposite of "access control, not secrecy",
 * and it is simply untrue.
 */
const GATES_LOCATION = new Set<Visibility>(['gated', 'members', 'invite'])

function CoarsePlaceNote({ visibility, audienceName }: { visibility: Visibility; audienceName?: string | null }) {
  if (GATES_LOCATION.has(visibility)) {
    return <span className="text-ink-faint"> · exact location shared with {audienceName || 'confirmed guests'}</span>
  }
  return <span className="text-ink-faint"> · approximate location</span>
}
