/**
 * Index settings, applied idempotently at boot.
 *
 * Ranking: relevance first, then the soonest event, so "yoga" returns the most
 * relevant yoga classes with the nearest date breaking ties. A query-less browse
 * passes `sort: ['startsAtUnix:asc']`, which the `sort` rule honours ahead of the
 * trailing date rule.
 */

export const INDEX_UID = 'tb_events'
export const PRIMARY_KEY = 'id'

/**
 * How people in Boulder actually type. Meilisearch synonyms are one-directional, so
 * every pair is listed both ways; multi-word keys are allowed.
 */
export const SYNONYMS: Record<string, string[]> = {
  kids: ['family', 'children', 'youth', 'kid'],
  family: ['kids', 'children', 'youth'],
  children: ['kids', 'family', 'youth'],
  youth: ['kids', 'teen', 'teens'],

  talk: ['lecture', 'panel', 'discussion', 'speaker'],
  lecture: ['talk', 'panel', 'discussion'],
  panel: ['talk', 'lecture', 'discussion'],
  discussion: ['talk', 'panel', 'conversation'],

  gig: ['concert', 'show', 'live music'],
  concert: ['gig', 'show', 'live music'],
  show: ['concert', 'gig', 'performance'],
  'live music': ['concert', 'gig', 'show'],
  performance: ['show', 'concert'],

  volunteer: ['service', 'workday', 'work day', 'stewardship'],
  workday: ['volunteer', 'service', 'work day'],
  'work day': ['volunteer', 'workday'],
  service: ['volunteer', 'stewardship'],

  'farmers market': ['market', 'farmer market', 'farmers'],
  market: ['farmers market', 'marketplace'],
  'farmer market': ['farmers market', 'market'],

  class: ['workshop', 'course', 'training', 'lesson'],
  workshop: ['class', 'course', 'training'],
  course: ['class', 'workshop', 'training'],
  training: ['class', 'workshop', 'course'],

  meetup: ['meet-up', 'meet up', 'gathering', 'social'],
  'meet-up': ['meetup', 'meet up', 'gathering'],
  'meet up': ['meetup', 'meet-up'],
  gathering: ['meetup', 'social', 'circle'],

  hike: ['walk', 'trail', 'hiking'],
  walk: ['hike', 'stroll'],
  potluck: ['dinner', 'meal', 'supper'],
  repair: ['fix', 'repair cafe', 'mend'],
  yoga: ['movement', 'stretch'],
  free: ['no cost', 'donation'],
}

/** Words that carry no signal in an event title and only cost typo budget. */
export const STOP_WORDS = ['the', 'a', 'an', 'and', 'of', 'at', 'in', 'on', 'for', 'to', 'with', 'by', 'from']

/**
 * Searchable order is the relevance order Meilisearch's `attribute` rule uses:
 * a hit in the name outranks a hit in the description.
 */
export const SEARCHABLE_ATTRIBUTES = ['name', 'tags', 'category', 'place', 'locality', 'hostName', 'hostHandle', 'description']

export const FILTERABLE_ATTRIBUTES = ['region', 'category', 'tags', 'platform', 'visibility', 'state', 'startsAtUnix', 'hostHandle', '_geo']

export const SORTABLE_ATTRIBUTES = ['startsAtUnix', '_geo']

export const RANKING_RULES = ['words', 'typo', 'proximity', 'attribute', 'sort', 'exactness', 'startsAtUnix:asc']

export function indexSettings(): Record<string, unknown> {
  return {
    searchableAttributes: SEARCHABLE_ATTRIBUTES,
    filterableAttributes: FILTERABLE_ATTRIBUTES,
    sortableAttributes: SORTABLE_ATTRIBUTES,
    rankingRules: RANKING_RULES,
    stopWords: STOP_WORDS,
    synonyms: SYNONYMS,
    typoTolerance: { enabled: true, minWordSizeForTypos: { oneTypo: 4, twoTypos: 8 } },
    // The card is rehydrated from Postgres; the index only has to return ids.
    displayedAttributes: ['id', 'name', 'startsAtUnix'],
    pagination: { maxTotalHits: 5000 },
  }
}
