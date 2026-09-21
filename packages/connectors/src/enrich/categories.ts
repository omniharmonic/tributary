/**
 * A fixed shared vocabulary of ~20 categories, assigned by keyword rules from source
 * categories and the title/description. Always host-overridable (architecture §11).
 */
export const CATEGORIES = [
  'music', 'arts', 'food', 'community', 'education', 'outdoors', 'family', 'civic', 'tech', 'wellness',
  'spirituality', 'markets', 'volunteering', 'sports', 'film', 'literary', 'business', 'sustainability', 'nightlife', 'other',
] as const

export type Category = (typeof CATEGORIES)[number]

/** Rules run in order; source tags are checked first (exact word), then title, then description. */
const RULES: Array<[Category, RegExp]> = [
  ['volunteering', /\b(volunteer(?:s|ing)?|work ?day|clean-?up|mutual aid|service day)\b/i],
  ['markets', /\b(farmers'? ?market|market|swap|flea|bazaar|craft fair|maker'?s? ?fair)\b/i],
  ['sustainability', /\b(sustainab\w*|climate|zero waste|compost\w*|permaculture|regenerat\w*|solar|recycl\w*|garden(?:ing)?|seed)\b/i],
  ['civic', /\b(city council|town hall|civic|election|ballot|policy|public hearing|neighborhood meeting|advocacy|democracy|organiz(?:e|ing) meeting)\b/i],
  ['film', /\b(film|movie|screening|cinema|documentary)\b/i],
  ['literary', /\b(book|poetry|poem|author|reading|writers?|storytelling|zine)\b/i],
  ['music', /\b(concert|live music|band|dj|jazz|bluegrass|folk|choir|singer|songwriter|orchestra|symphony|open mic|jam|drum)\b/i],
  ['arts', /\b(art|gallery|exhibit\w*|theater|theatre|dance|paint\w*|sculpt\w*|craft|improv|comedy|opening reception|studio)\b/i],
  ['food', /\b(potluck|dinner|brunch|lunch|cook\w*|tasting|food|bake|beer|wine|coffee|tea|cider|chef)\b/i],
  ['tech', /\b(tech|software|coding|hackathon|developers?|startup|ai\b|open source|web3|crypto|data|python|javascript|maker ?space)\b/i],
  ['business', /\b(networking|entrepreneur\w*|business|founders?|pitch|workshop for professionals|career|job fair)\b/i],
  ['education', /\b(class|course|lecture|workshop|seminar|talk|lesson|training|tutorial|learn\w*|study group|panel)\b/i],
  ['wellness', /\b(yoga|meditat\w*|mindful\w*|breathwork|sound bath|wellness|health|healing|therapy|fitness|pilates|tai chi|qigong)\b/i],
  ['spirituality', /\b(dharma|sangha|church|temple|prayer|ceremony|ritual|spiritual|buddhist|sabbath|shabbat|mass|worship|kirtan)\b/i],
  ['outdoors', /\b(hike|hiking|trail|camping|bike ride|cycling|climb\w*|paddle|river|mountain|nature walk|bird\w*|outdoor)\b/i],
  ['sports', /\b(race|5k|10k|marathon|tournament|league|soccer|basketball|pickleball|volleyball|run club|skate)\b/i],
  ['family', /\b(kids?|children|family|toddler|story ?time|teen|youth|all ages)\b/i],
  ['nightlife', /\b(party|dance party|late night|karaoke|trivia night|bar crawl|club night)\b/i],
  ['community', /\b(community|meetup|gathering|social|neighbors?|potluck|celebration|festival|block party|circle|assembly)\b/i],
]

const TAG_MAP: Record<string, Category> = {
  music: 'music', concert: 'music', arts: 'arts', art: 'arts', theater: 'arts', theatre: 'arts', dance: 'arts', food: 'food', dining: 'food',
  community: 'community', education: 'education', class: 'education', workshop: 'education', outdoors: 'outdoors', hiking: 'outdoors',
  family: 'family', kids: 'family', civic: 'civic', government: 'civic', politics: 'civic', tech: 'tech', technology: 'tech',
  wellness: 'wellness', health: 'wellness', yoga: 'wellness', spirituality: 'spirituality', religion: 'spirituality', markets: 'markets',
  market: 'markets', volunteering: 'volunteering', volunteer: 'volunteering', sports: 'sports', fitness: 'sports', film: 'film', movies: 'film',
  literary: 'literary', books: 'literary', business: 'business', networking: 'business', sustainability: 'sustainability',
  environment: 'sustainability', nightlife: 'nightlife', party: 'nightlife',
}

export function categorize(name: string, description?: string, sourceTags: string[] = []): Category | undefined {
  for (const t of sourceTags) {
    const key = t.trim().toLowerCase()
    const hit = TAG_MAP[key]
    if (hit) return hit
  }
  for (const [cat, re] of RULES) if (re.test(name)) return cat
  for (const t of sourceTags) for (const [cat, re] of RULES) if (re.test(t)) return cat
  if (description) {
    const head = description.slice(0, 600)
    for (const [cat, re] of RULES) if (re.test(head)) return cat
  }
  return undefined
}
