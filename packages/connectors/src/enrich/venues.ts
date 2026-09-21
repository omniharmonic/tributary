/**
 * A per-region venue table (architecture §11). Venue names in feeds vary ("eTown",
 * "eTown Hall", "etown hall boulder"); matching against a small curated table fixes
 * the most common variation before geocoding. The natural seed for ATGeo places.
 */
export interface Venue {
  name: string
  aliases: string[]
  street: string
  locality: string
  region: string
  postalCode: string
  country: string
  lat: number
  lon: number
}

export const BOULDER_VENUES: Venue[] = [
  { name: 'eTown Hall', aliases: ['etown'], street: '1535 Spruce St', locality: 'Boulder', region: 'CO', postalCode: '80302', country: 'US', lat: 40.0195, lon: -105.2774 },
  { name: 'Dairy Arts Center', aliases: ['the dairy', 'dairy center'], street: '2590 Walnut St', locality: 'Boulder', region: 'CO', postalCode: '80302', country: 'US', lat: 40.0206, lon: -105.2599 },
  { name: 'Boulder Public Library, Main', aliases: ['boulder public library', 'main library', 'boulder library', 'canyon theater'], street: '1001 Arapahoe Ave', locality: 'Boulder', region: 'CO', postalCode: '80302', country: 'US', lat: 40.0139, lon: -105.2816 },
  { name: 'Boulder Public Library, George Reynolds Branch', aliases: ['reynolds branch', 'george reynolds'], street: '3595 Table Mesa Dr', locality: 'Boulder', region: 'CO', postalCode: '80305', country: 'US', lat: 39.9835, lon: -105.2467 },
  { name: 'Boulder Public Library, Meadows Branch', aliases: ['meadows branch'], street: '4800 Baseline Rd', locality: 'Boulder', region: 'CO', postalCode: '80303', country: 'US', lat: 39.9998, lon: -105.2243 },
  { name: 'Boulder Public Library, NoBo Corner', aliases: ['nobo corner library', 'north boulder library'], street: '4600 Broadway', locality: 'Boulder', region: 'CO', postalCode: '80304', country: 'US', lat: 40.0498, lon: -105.2827 },
  { name: 'BMoCA', aliases: ['boulder museum of contemporary art'], street: '1750 13th St', locality: 'Boulder', region: 'CO', postalCode: '80302', country: 'US', lat: 40.0155, lon: -105.2777 },
  { name: 'Chautauqua Auditorium', aliases: ['chautauqua', 'colorado chautauqua'], street: '900 Baseline Rd', locality: 'Boulder', region: 'CO', postalCode: '80302', country: 'US', lat: 39.9989, lon: -105.2813 },
  { name: 'Boulder Theater', aliases: [], street: '2032 14th St', locality: 'Boulder', region: 'CO', postalCode: '80302', country: 'US', lat: 40.0187, lon: -105.2765 },
  { name: 'Fox Theatre', aliases: ['the fox', 'fox theater'], street: '1135 13th St', locality: 'Boulder', region: 'CO', postalCode: '80302', country: 'US', lat: 40.0079, lon: -105.2757 },
  { name: 'Trident Booksellers & Cafe', aliases: ['trident', 'trident cafe', 'trident booksellers'], street: '940 Pearl St', locality: 'Boulder', region: 'CO', postalCode: '80302', country: 'US', lat: 40.0173, lon: -105.2846 },
  { name: 'Junkyard Social Club', aliases: ['junkyard'], street: '2525 Frontier Ave', locality: 'Boulder', region: 'CO', postalCode: '80301', country: 'US', lat: 40.0222, lon: -105.2506 },
  { name: 'Rayback Collective', aliases: ['the rayback', 'rayback'], street: '2775 Valmont Rd', locality: 'Boulder', region: 'CO', postalCode: '80304', country: 'US', lat: 40.0301, lon: -105.2582 },
  { name: 'Boulder Bookstore', aliases: ['boulder book store'], street: '1107 Pearl St', locality: 'Boulder', region: 'CO', postalCode: '80302', country: 'US', lat: 40.0181, lon: -105.2809 },
  { name: 'Museum of Boulder', aliases: ['boulder museum', 'museum of boulder at tebo center'], street: '2205 Broadway', locality: 'Boulder', region: 'CO', postalCode: '80302', country: 'US', lat: 40.0205, lon: -105.2789 },
  { name: 'CU Boulder University Memorial Center', aliases: ['umc', 'cu umc', 'university memorial center'], street: '1669 Euclid Ave', locality: 'Boulder', region: 'CO', postalCode: '80309', country: 'US', lat: 40.0066, lon: -105.2718 },
  { name: 'Boulder Farmers Market', aliases: ['farmers market', "boulder county farmers market", '13th street market'], street: '13th St between Canyon Blvd and Arapahoe Ave', locality: 'Boulder', region: 'CO', postalCode: '80302', country: 'US', lat: 40.0148, lon: -105.2776 },
  { name: 'Growing Gardens', aliases: ['growing gardens boulder'], street: '1630 Hawthorn Ave', locality: 'Boulder', region: 'CO', postalCode: '80304', country: 'US', lat: 40.0286, lon: -105.2737 },
  { name: 'Boulder JCC', aliases: ['boulder jewish community center', 'jcc boulder'], street: '6007 Oreg Ave', locality: 'Boulder', region: 'CO', postalCode: '80303', country: 'US', lat: 40.0085, lon: -105.2033 },
  { name: 'Nomad Playhouse', aliases: ['nomad theatre', 'the nomad'], street: '1410 Quince Ave', locality: 'Boulder', region: 'CO', postalCode: '80304', country: 'US', lat: 40.0339, lon: -105.2764 },
  { name: 'Longmont Museum', aliases: ['longmont museum & cultural center', 'stewart auditorium'], street: '400 Quail Rd', locality: 'Longmont', region: 'CO', postalCode: '80501', country: 'US', lat: 40.1512, lon: -105.1037 },
  { name: 'Firehouse Art Center', aliases: ['firehouse longmont'], street: '667 4th Ave', locality: 'Longmont', region: 'CO', postalCode: '80501', country: 'US', lat: 40.1677, lon: -105.1006 },
  { name: 'Macky Auditorium', aliases: ['macky'], street: '1595 Pleasant St', locality: 'Boulder', region: 'CO', postalCode: '80309', country: 'US', lat: 40.0090, lon: -105.2753 },
  { name: 'Boulder Dinner Theatre', aliases: ['bdt stage', 'bdt'], street: '5501 Arapahoe Ave', locality: 'Boulder', region: 'CO', postalCode: '80303', country: 'US', lat: 40.0155, lon: -105.2170 },
  { name: 'Boulder Public Library, Canyon Gallery', aliases: ['canyon gallery'], street: '1001 Arapahoe Ave', locality: 'Boulder', region: 'CO', postalCode: '80302', country: 'US', lat: 40.0139, lon: -105.2816 },
  { name: 'Boulder Creek Path', aliases: ['creek path'], street: 'Boulder Creek Path', locality: 'Boulder', region: 'CO', postalCode: '80302', country: 'US', lat: 40.0150, lon: -105.2780 },
  { name: 'Pearl Street Mall', aliases: ['pearl street', 'downtown boulder'], street: 'Pearl St', locality: 'Boulder', region: 'CO', postalCode: '80302', country: 'US', lat: 40.0177, lon: -105.2793 },
  { name: 'Naropa University', aliases: ['naropa'], street: '2130 Arapahoe Ave', locality: 'Boulder', region: 'CO', postalCode: '80302', country: 'US', lat: 40.0155, lon: -105.2645 },
  { name: 'Boulder County Courthouse', aliases: ['courthouse lawn', 'boulder courthouse'], street: '1325 Pearl St', locality: 'Boulder', region: 'CO', postalCode: '80302', country: 'US', lat: 40.0187, lon: -105.2778 },
  { name: 'Roots Music Project', aliases: ['roots music'], street: '4747 Pearl St Suite V3A', locality: 'Boulder', region: 'CO', postalCode: '80301', country: 'US', lat: 40.0257, lon: -105.2372 },
  { name: 'Velvet Elk Lounge', aliases: ['velvet elk'], street: '2037 13th St', locality: 'Boulder', region: 'CO', postalCode: '80302', country: 'US', lat: 40.0188, lon: -105.2776 },
  { name: 'Boulder Shambhala Center', aliases: ['shambhala center'], street: '1345 Spruce St', locality: 'Boulder', region: 'CO', postalCode: '80302', country: 'US', lat: 40.0197, lon: -105.2793 },
  { name: 'Impact Hub Boulder', aliases: ['impact hub'], street: '1877 Broadway Suite 100', locality: 'Boulder', region: 'CO', postalCode: '80302', country: 'US', lat: 40.0178, lon: -105.2793 },
  { name: 'Wild Bear Nature Center', aliases: ['wild bear'], street: '20 Lakeview Dr', locality: 'Nederland', region: 'CO', postalCode: '80466', country: 'US', lat: 39.9614, lon: -105.5089 },
  { name: 'Louisville Public Library', aliases: ['louisville library'], street: '951 Spruce St', locality: 'Louisville', region: 'CO', postalCode: '80027', country: 'US', lat: 39.9770, lon: -105.1318 },
  { name: 'Lafayette Public Library', aliases: ['lafayette library'], street: '775 W Baseline Rd', locality: 'Lafayette', region: 'CO', postalCode: '80026', country: 'US', lat: 39.9930, lon: -105.1005 },
]

function norm(s: string): string {
  return s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').trim()
}

interface Indexed {
  venue: Venue
  keys: string[]
}

let index: Indexed[] | undefined

function buildIndex(venues: Venue[]): Indexed[] {
  return venues
    .map((venue) => ({ venue, keys: [venue.name, ...venue.aliases].map(norm).filter((k) => k.length >= 3) }))
    .sort((a, b) => Math.max(...b.keys.map((k) => k.length)) - Math.max(...a.keys.map((k) => k.length)))
}

/**
 * The venue whose name or alias appears in `text` (word-bounded, normalized). Longest
 * key wins so "Boulder Public Library, Main" beats "Boulder Public Library".
 */
export function matchVenue(text: string, venues: Venue[] = BOULDER_VENUES): Venue | undefined {
  if (!text) return undefined
  const hay = ` ${norm(text)} `
  const idx = venues === BOULDER_VENUES ? (index ??= buildIndex(BOULDER_VENUES)) : buildIndex(venues)
  let best: { venue: Venue; len: number } | undefined
  for (const { venue, keys } of idx) {
    for (const k of keys) {
      if (hay.includes(` ${k} `) && (!best || k.length > best.len)) best = { venue, len: k.length }
    }
  }
  return best?.venue
}
