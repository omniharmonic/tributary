/**
 * The Boulder County gazetteer (architecture §11). Venue names in feeds vary wildly
 * ("eTown", "eTown Hall", "etown hall boulder"), and most community feeds give a venue
 * name with no coordinates at all. Matching against a curated table fixes the common
 * variation and puts the event on the map without a geocoder round trip. It is also the
 * natural seed for ATGeo place records.
 *
 * HAND-MAINTAINED. To add an entry:
 *   - `name` is how the venue should be displayed once matched.
 *   - `aliases` are lowercase forms people actually type: short names, the bare building
 *     name, common misspellings, and the "the X" form. Never add an alias so generic it
 *     could appear in an unrelated sentence ("post", "hall", "center").
 *   - Coordinates are WGS84 to four decimals, which is about ten metres. If you are not
 *     sure of the building's own corner, give the block's coordinate and set
 *     `precision: 'block'`; for parks, trailheads and districts use `'area'`. Do not
 *     invent precision — a wrong pin is worse than a coarse one.
 *   - Everything here is inside the Front Range bounding box `inFrontRange` enforces.
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
  /**
   * How exact the coordinate is. Omitted means the building or its entrance; `block`
   * means the right block of the right street; `area` means a park, campus or district
   * centroid. Callers that care (map pins, "share neighbourhood only") should read it.
   */
  precision?: 'exact' | 'block' | 'area'
}

const CO = { region: 'CO', country: 'US' } as const

export const BOULDER_VENUES: Venue[] = [
  /* ── Downtown Boulder ─────────────────────────────────────────────────────── */
  { name: 'eTown Hall', aliases: ['etown'], street: '1535 Spruce St', locality: 'Boulder', postalCode: '80302', lat: 40.0195, lon: -105.2774, ...CO },
  { name: 'Boulder Theater', aliases: ['the boulder theater', 'boulder theatre'], street: '2032 14th St', locality: 'Boulder', postalCode: '80302', lat: 40.0187, lon: -105.2765, ...CO },
  { name: 'Boulder County Courthouse', aliases: ['courthouse lawn', 'boulder courthouse', 'courthouse plaza'], street: '1325 Pearl St', locality: 'Boulder', postalCode: '80302', lat: 40.0187, lon: -105.2778, ...CO },
  { name: 'Boulder Bookstore', aliases: ['boulder book store'], street: '1107 Pearl St', locality: 'Boulder', postalCode: '80302', lat: 40.0181, lon: -105.2809, ...CO },
  { name: 'Trident Booksellers & Cafe', aliases: ['trident', 'trident cafe', 'trident booksellers'], street: '940 Pearl St', locality: 'Boulder', postalCode: '80302', lat: 40.0173, lon: -105.2846, ...CO },
  { name: 'Pearl Street Mall', aliases: ['pearl street', 'downtown boulder', 'pearl st mall'], street: 'Pearl St', locality: 'Boulder', postalCode: '80302', lat: 40.0177, lon: -105.2793, precision: 'area', ...CO },
  { name: 'BMoCA', aliases: ['boulder museum of contemporary art', 'bmoca boulder'], street: '1750 13th St', locality: 'Boulder', postalCode: '80302', lat: 40.0155, lon: -105.2777, ...CO },
  { name: 'Museum of Boulder', aliases: ['boulder museum', 'museum of boulder at tebo center', 'tebo center'], street: '2205 Broadway', locality: 'Boulder', postalCode: '80302', lat: 40.0205, lon: -105.2789, ...CO },
  { name: 'Boulder Public Library, Main', aliases: ['boulder public library', 'main library', 'boulder library', 'canyon theater', 'canyon theatre', 'bpl main'], street: '1001 Arapahoe Ave', locality: 'Boulder', postalCode: '80302', lat: 40.0139, lon: -105.2816, ...CO },
  { name: 'Boulder Public Library, Canyon Gallery', aliases: ['canyon gallery'], street: '1001 Arapahoe Ave', locality: 'Boulder', postalCode: '80302', lat: 40.0139, lon: -105.2816, ...CO },
  { name: 'Velvet Elk Lounge', aliases: ['velvet elk'], street: '2037 13th St', locality: 'Boulder', postalCode: '80302', lat: 40.0188, lon: -105.2776, ...CO },
  { name: 'Boulder Shambhala Center', aliases: ['shambhala center', 'boulder shambhala'], street: '1345 Spruce St', locality: 'Boulder', postalCode: '80302', lat: 40.0197, lon: -105.2793, ...CO },
  { name: 'Impact Hub Boulder', aliases: ['impact hub'], street: '1877 Broadway', locality: 'Boulder', postalCode: '80302', lat: 40.0178, lon: -105.2793, ...CO },
  { name: 'Boulder Municipal Building', aliases: ['boulder city council chambers', 'city of boulder municipal building', 'council chambers'], street: '1777 Broadway', locality: 'Boulder', postalCode: '80302', lat: 40.0166, lon: -105.2790, ...CO },
  { name: 'Hotel Boulderado', aliases: ['boulderado', 'license no 1', 'the corner bar'], street: '2115 13th St', locality: 'Boulder', postalCode: '80302', lat: 40.0192, lon: -105.2777, ...CO },
  { name: 'St Julien Hotel & Spa', aliases: ['st julien', 'saint julien hotel'], street: '900 Walnut St', locality: 'Boulder', postalCode: '80302', lat: 40.0170, lon: -105.2843, ...CO },
  { name: 'Boulder Bandshell', aliases: ['central park bandshell', 'glen huntington bandshell', 'the bandshell'], street: '1212 Canyon Blvd', locality: 'Boulder', postalCode: '80302', lat: 40.0159, lon: -105.2800, ...CO },
  { name: 'Central Park, Boulder', aliases: ['central park boulder'], street: '1236 Canyon Blvd', locality: 'Boulder', postalCode: '80302', lat: 40.0157, lon: -105.2795, precision: 'area', ...CO },
  { name: 'The Riverside', aliases: ['riverside boulder'], street: '1724 Broadway', locality: 'Boulder', postalCode: '80302', lat: 40.0163, lon: -105.2789, ...CO },
  { name: 'Dushanbe Teahouse', aliases: ['boulder dushanbe teahouse', 'the teahouse'], street: '1770 13th St', locality: 'Boulder', postalCode: '80302', lat: 40.0153, lon: -105.2778, ...CO },
  { name: 'Bohemian Biergarten', aliases: ['bohemian bier garten'], street: '2017 13th St', locality: 'Boulder', postalCode: '80302', lat: 40.0187, lon: -105.2779, ...CO },
  { name: 'The Laughing Goat', aliases: ['laughing goat', 'laughing goat coffeehouse'], street: '1709 Pearl St', locality: 'Boulder', postalCode: '80302', lat: 40.0186, lon: -105.2723, ...CO },
  { name: 'Ozo Coffee, Pearl Street', aliases: ['ozo coffee pearl', 'ozo pearl'], street: '1015 Pearl St', locality: 'Boulder', postalCode: '80302', lat: 40.0178, lon: -105.2823, ...CO },
  { name: 'Atlas Purveyors', aliases: ['atlas purveyors boulder'], street: '1201 Pearl St', locality: 'Boulder', postalCode: '80302', lat: 40.0180, lon: -105.2801, precision: 'block', ...CO },
  { name: 'Boxcar Coffee Roasters', aliases: ['boxcar coffee', 'boxcar roasters'], street: '1825 Pearl St', locality: 'Boulder', postalCode: '80302', lat: 40.0186, lon: -105.2709, ...CO },
  { name: 'Shine Restaurant & Gathering Place', aliases: ['shine boulder', 'shine gathering place'], street: '2027 13th St', locality: 'Boulder', postalCode: '80302', lat: 40.0189, lon: -105.2777, ...CO },
  { name: 'Galvanize Boulder', aliases: ['galvanize'], street: '1035 Pearl St', locality: 'Boulder', postalCode: '80302', lat: 40.0180, lon: -105.2816, precision: 'block', ...CO },
  { name: 'Alfalfa’s Market', aliases: ['alfalfas', 'alfalfas market'], street: '1651 Broadway', locality: 'Boulder', postalCode: '80302', lat: 40.0166, lon: -105.2800, ...CO },
  { name: 'First Congregational Church of Boulder', aliases: ['first congregational church boulder', 'first congregational boulder'], street: '1128 Pine St', locality: 'Boulder', postalCode: '80302', lat: 40.0201, lon: -105.2808, ...CO },
  { name: 'First United Methodist Church, Boulder', aliases: ['first united methodist boulder'], street: '1421 Spruce St', locality: 'Boulder', postalCode: '80302', lat: 40.0196, lon: -105.2786, ...CO },
  { name: 'Sacred Heart of Jesus Parish', aliases: ['sacred heart of jesus boulder'], street: '2312 14th St', locality: 'Boulder', postalCode: '80304', lat: 40.0210, lon: -105.2765, ...CO },
  { name: 'Studio Arts Boulder', aliases: ['studio arts', 'boulder pottery lab', 'the pottery lab'], street: '1010 Aurora Ave', locality: 'Boulder', postalCode: '80302', lat: 40.0043, lon: -105.2792, ...CO },
  { name: 'Boulder Chamber', aliases: ['boulder chamber of commerce'], street: '2440 Pearl St', locality: 'Boulder', postalCode: '80302', lat: 40.0189, lon: -105.2638, precision: 'block', ...CO },
  { name: 'The Kitchen, Boulder', aliases: ['the kitchen boulder', 'the kitchen bistro'], street: '1039 Pearl St', locality: 'Boulder', postalCode: '80302', lat: 40.0179, lon: -105.2819, ...CO },
  { name: 'Rembrandt Yard', aliases: ['rembrandt yard gallery'], street: '1301 Spruce St', locality: 'Boulder', postalCode: '80302', lat: 40.0197, lon: -105.2800, ...CO },

  /* ── University Hill and CU Boulder ───────────────────────────────────────── */
  { name: 'Fox Theatre', aliases: ['the fox', 'fox theater', 'fox theatre boulder'], street: '1135 13th St', locality: 'Boulder', postalCode: '80302', lat: 40.0079, lon: -105.2757, ...CO },
  { name: 'University Hill', aliases: ['the hill boulder', 'university hill boulder'], street: '13th St & College Ave', locality: 'Boulder', postalCode: '80302', lat: 40.0083, lon: -105.2782, precision: 'area', ...CO },
  { name: 'Innisfree Poetry Bookstore & Cafe', aliases: ['innisfree', 'innisfree poetry'], street: '1203 13th St', locality: 'Boulder', postalCode: '80302', lat: 40.0084, lon: -105.2783, ...CO },
  { name: 'CU Boulder University Memorial Center', aliases: ['umc', 'cu umc', 'university memorial center', 'umc boulder'], street: '1669 Euclid Ave', locality: 'Boulder', postalCode: '80309', lat: 40.0066, lon: -105.2718, ...CO },
  { name: 'Macky Auditorium', aliases: ['macky', 'macky auditorium concert hall'], street: '1595 Pleasant St', locality: 'Boulder', postalCode: '80309', lat: 40.0090, lon: -105.2753, ...CO },
  { name: 'Fiske Planetarium', aliases: ['fiske', 'fiske planetarium cu'], street: '2414 Regent Dr', locality: 'Boulder', postalCode: '80309', lat: 40.0034, lon: -105.2626, ...CO },
  { name: 'CU Museum of Natural History', aliases: ['cu natural history museum', 'henderson building', 'cu museum'], street: '1030 Broadway', locality: 'Boulder', postalCode: '80309', lat: 40.0072, lon: -105.2748, ...CO },
  { name: 'Norlin Library', aliases: ['norlin', 'cu norlin library'], street: '1720 Pleasant St', locality: 'Boulder', postalCode: '80309', lat: 40.0077, lon: -105.2705, ...CO },
  { name: 'Folsom Field', aliases: ['folsom stadium', 'folsom field cu'], street: '2400 Colorado Ave', locality: 'Boulder', postalCode: '80309', lat: 40.0096, lon: -105.2669, precision: 'area', ...CO },
  { name: 'CU Events Center', aliases: ['coors events center', 'cu events center boulder'], street: '950 Regent Dr', locality: 'Boulder', postalCode: '80309', lat: 40.0049, lon: -105.2661, ...CO },
  { name: 'ATLAS Institute', aliases: ['atlas institute cu', 'roser atlas center', 'atlas black box'], street: '1125 18th St', locality: 'Boulder', postalCode: '80309', lat: 40.0074, lon: -105.2687, ...CO },
  { name: 'CASE Building', aliases: ['case building cu', 'center for academic success and engagement'], street: '1725 Euclid Ave', locality: 'Boulder', postalCode: '80309', lat: 40.0064, lon: -105.2701, ...CO },
  { name: 'Benson Earth Sciences', aliases: ['benson earth sciences building'], street: '2200 Colorado Ave', locality: 'Boulder', postalCode: '80309', lat: 40.0027, lon: -105.2670, ...CO },
  { name: 'Hale Science Building', aliases: ['hale science', 'hale building cu'], street: '1350 Pleasant St', locality: 'Boulder', postalCode: '80309', lat: 40.0080, lon: -105.2740, ...CO },
  { name: 'Duane Physics', aliases: ['duane physics building', 'duane building'], street: '2000 Colorado Ave', locality: 'Boulder', postalCode: '80309', lat: 40.0073, lon: -105.2645, ...CO },
  { name: 'Wolf Law Building', aliases: ['wolf law', 'cu law school', 'wittemyer courtroom'], street: '2450 Kittredge Loop Dr', locality: 'Boulder', postalCode: '80309', lat: 40.0002, lon: -105.2620, ...CO },
  { name: 'Old Main Chapel', aliases: ['old main cu', 'old main chapel boulder'], street: '1600 Pleasant St', locality: 'Boulder', postalCode: '80309', lat: 40.0079, lon: -105.2725, ...CO },
  { name: 'Imig Music Building', aliases: ['imig music', 'grusin music hall', 'cu college of music'], street: '1020 18th St', locality: 'Boulder', postalCode: '80309', lat: 40.0090, lon: -105.2690, ...CO },
  { name: 'University Theatre, CU Boulder', aliases: ['cu university theatre', 'loft theatre cu'], street: '261 UCB', locality: 'Boulder', postalCode: '80309', lat: 40.0083, lon: -105.2727, ...CO },
  { name: 'SEEC Building', aliases: ['sustainability energy and environment complex', 'seec cu boulder'], street: '4001 Discovery Dr', locality: 'Boulder', postalCode: '80303', lat: 40.0075, lon: -105.2440, ...CO },
  { name: 'JILA', aliases: ['jila cu boulder'], street: '440 UCB', locality: 'Boulder', postalCode: '80309', lat: 40.0079, lon: -105.2610, precision: 'block', ...CO },
  { name: 'Naropa University, Arapahoe Campus', aliases: ['naropa', 'naropa university', 'naropa arapahoe'], street: '2130 Arapahoe Ave', locality: 'Boulder', postalCode: '80302', lat: 40.0155, lon: -105.2645, ...CO },
  { name: 'Naropa University, Nalanda Campus', aliases: ['nalanda campus', 'naropa nalanda'], street: '6287 Arapahoe Ave', locality: 'Boulder', postalCode: '80303', lat: 40.0148, lon: -105.2040, ...CO },
  { name: 'Naropa University, Paramita Campus', aliases: ['paramita campus', 'naropa paramita'], street: '3285 30th St', locality: 'Boulder', postalCode: '80301', lat: 40.0295, lon: -105.2555, ...CO },
  { name: 'CU Boulder Recreation Center', aliases: ['cu rec center', 'cu boulder rec'], street: '1855 Pleasant St', locality: 'Boulder', postalCode: '80309', lat: 40.0072, lon: -105.2680, ...CO },
  { name: 'Koenig Alumni Center', aliases: ['koenig alumni', 'cu alumni center'], street: '1202 University Ave', locality: 'Boulder', postalCode: '80302', lat: 40.0078, lon: -105.2760, ...CO },
  { name: 'Visual Arts Complex, CU Boulder', aliases: ['cu visual arts complex', 'vac cu boulder'], street: '1085 18th St', locality: 'Boulder', postalCode: '80309', lat: 40.0090, lon: -105.2678, ...CO },

  /* ── Chautauqua, the mountain parks and trailheads ────────────────────────── */
  { name: 'Chautauqua Auditorium', aliases: ['chautauqua', 'colorado chautauqua', 'chautauqua aud'], street: '900 Baseline Rd', locality: 'Boulder', postalCode: '80302', lat: 39.9989, lon: -105.2813, ...CO },
  { name: 'Chautauqua Dining Hall', aliases: ['chautauqua dining'], street: '900 Baseline Rd', locality: 'Boulder', postalCode: '80302', lat: 39.9985, lon: -105.2810, ...CO },
  { name: 'Chautauqua Community House', aliases: ['community house chautauqua'], street: '301 Morning Glory Dr', locality: 'Boulder', postalCode: '80302', lat: 39.9994, lon: -105.2805, ...CO },
  { name: 'Chautauqua Park', aliases: ['chautauqua trailhead', 'chautauqua meadow'], street: '900 Baseline Rd', locality: 'Boulder', postalCode: '80302', lat: 39.9995, lon: -105.2822, precision: 'area', ...CO },
  { name: 'NCAR Mesa Laboratory', aliases: ['ncar', 'ncar mesa lab', 'national center for atmospheric research'], street: '1850 Table Mesa Dr', locality: 'Boulder', postalCode: '80305', lat: 39.9784, lon: -105.2755, ...CO },
  { name: 'Mount Sanitas Trailhead', aliases: ['mount sanitas', 'mt sanitas', 'sanitas trailhead', 'centennial trailhead'], street: '800 Mapleton Ave', locality: 'Boulder', postalCode: '80304', lat: 40.0233, lon: -105.2952, precision: 'area', ...CO },
  { name: 'Betasso Preserve', aliases: ['betasso', 'betasso preserve boulder county'], street: 'Betasso Rd', locality: 'Boulder', postalCode: '80302', lat: 40.0157, lon: -105.3468, precision: 'area', ...CO },
  { name: 'Eldorado Canyon State Park', aliases: ['eldorado canyon', 'eldo'], street: '9 Kneale Rd', locality: 'Eldorado Springs', postalCode: '80025', lat: 39.9312, lon: -105.2830, precision: 'area', ...CO },
  { name: 'Settlers Park', aliases: ['settlers park boulder', 'red rocks trailhead boulder'], street: '600 Canyon Blvd', locality: 'Boulder', postalCode: '80302', lat: 40.0157, lon: -105.2933, precision: 'area', ...CO },
  { name: 'Flagstaff Amphitheater', aliases: ['flagstaff amphitheatre', 'flagstaff mountain amphitheater'], street: 'Flagstaff Rd', locality: 'Boulder', postalCode: '80302', lat: 39.9958, lon: -105.2988, precision: 'area', ...CO },
  { name: 'Boulder Creek Path', aliases: ['creek path', 'boulder creek trail'], street: 'Boulder Creek Path', locality: 'Boulder', postalCode: '80302', lat: 40.0150, lon: -105.2780, precision: 'area', ...CO },

  /* ── North Boulder ────────────────────────────────────────────────────────── */
  { name: 'Rayback Collective', aliases: ['the rayback', 'rayback'], street: '2775 Valmont Rd', locality: 'Boulder', postalCode: '80304', lat: 40.0301, lon: -105.2582, ...CO },
  { name: 'Growing Gardens', aliases: ['growing gardens boulder'], street: '1630 Hawthorn Ave', locality: 'Boulder', postalCode: '80304', lat: 40.0286, lon: -105.2737, ...CO },
  { name: 'Nomad Playhouse', aliases: ['nomad theatre', 'the nomad', 'nomad playhouse boulder'], street: '1410 Quince Ave', locality: 'Boulder', postalCode: '80304', lat: 40.0339, lon: -105.2764, ...CO },
  { name: 'Boulder Public Library, NoBo Corner', aliases: ['nobo corner library', 'north boulder library', 'nobo library'], street: '4600 Broadway', locality: 'Boulder', postalCode: '80304', lat: 40.0498, lon: -105.2827, ...CO },
  { name: 'North Boulder Recreation Center', aliases: ['north boulder rec', 'nobo rec center'], street: '3170 Broadway', locality: 'Boulder', postalCode: '80304', lat: 40.0325, lon: -105.2815, ...CO },
  { name: 'Unity of Boulder', aliases: ['unity boulder', 'unity spiritual center boulder'], street: '2855 Folsom St', locality: 'Boulder', postalCode: '80304', lat: 40.0272, lon: -105.2637, ...CO },
  { name: 'Boulder Friends Meeting', aliases: ['quaker meeting house boulder', 'boulder friends meetinghouse'], street: '1825 Upland Ave', locality: 'Boulder', postalCode: '80304', lat: 40.0280, lon: -105.2740, ...CO },
  { name: 'Boulder Rock Club', aliases: ['boulder rock club brc'], street: '2829 Mapleton Ave', locality: 'Boulder', postalCode: '80301', lat: 40.0225, lon: -105.2600, ...CO },
  { name: 'Lucky’s Market, Boulder', aliases: ['luckys market boulder'], street: '3960 Broadway', locality: 'Boulder', postalCode: '80304', lat: 40.0415, lon: -105.2820, ...CO },
  { name: 'Boulder Elks Lodge', aliases: ['elks lodge boulder'], street: '3975 28th St', locality: 'Boulder', postalCode: '80301', lat: 40.0345, lon: -105.2590, ...CO },
  { name: 'Boulder Circus Center', aliases: ['boulder circus'], street: '4747 26th St', locality: 'Boulder', postalCode: '80301', lat: 40.0405, lon: -105.2610, precision: 'block', ...CO },
  { name: 'A-Lodge Boulder', aliases: ['a lodge boulder', 'boulder adventure lodge'], street: '91 Four Mile Canyon Dr', locality: 'Boulder', postalCode: '80302', lat: 40.0180, lon: -105.3040, ...CO },
  { name: 'Gunbarrel Commons Park', aliases: ['gunbarrel commons', 'gunbarrel park'], street: '6500 Lookout Rd', locality: 'Boulder', postalCode: '80301', lat: 40.0680, lon: -105.2050, precision: 'area', ...CO },

  /* ── Breweries, taprooms and cafes that host events ───────────────────────── */
  { name: 'Avery Brewing Company', aliases: ['avery brewing', 'avery taproom', 'avery brewery'], street: '4910 Nautilus Ct N', locality: 'Boulder', postalCode: '80301', lat: 40.0555, lon: -105.2210, ...CO },
  { name: 'Upslope Brewing, Lee Hill', aliases: ['upslope brewing', 'upslope lee hill', 'upslope brewery'], street: '1501 Lee Hill Dr', locality: 'Boulder', postalCode: '80304', lat: 40.0417, lon: -105.2717, ...CO },
  { name: 'Upslope Brewing, Flatiron Park', aliases: ['upslope flatiron', 'upslope flatiron park'], street: '1898 S Flatiron Ct', locality: 'Boulder', postalCode: '80301', lat: 40.0195, lon: -105.2270, ...CO },
  { name: 'Sanitas Brewing Company', aliases: ['sanitas brewing', 'sanitas brewery', 'sanitas taproom'], street: '3550 Frontier Ave', locality: 'Boulder', postalCode: '80301', lat: 40.0290, lon: -105.2475, ...CO },
  { name: 'Twisted Pine Brewing', aliases: ['twisted pine', 'twisted pine brewery'], street: '3201 Walnut St', locality: 'Boulder', postalCode: '80301', lat: 40.0213, lon: -105.2530, ...CO },
  { name: 'Vision Quest Brewery', aliases: ['vision quest brewing', 'vision quest taproom'], street: '2510 47th St', locality: 'Boulder', postalCode: '80301', lat: 40.0245, lon: -105.2370, ...CO },
  { name: 'Wild Provisions Beer Project', aliases: ['wild provisions', 'wild provisions beer'], street: '3600 Walnut St', locality: 'Boulder', postalCode: '80301', lat: 40.0215, lon: -105.2460, ...CO },
  { name: 'Cellar West Artisan Ales', aliases: ['cellar west'], street: '1001 Lee Hill Dr', locality: 'Boulder', postalCode: '80304', lat: 40.0425, lon: -105.2820, precision: 'block', ...CO },
  { name: 'Finkel & Garf Brewing', aliases: ['finkel and garf', 'finkel garf'], street: '5455 Spine Rd', locality: 'Boulder', postalCode: '80301', lat: 40.0522, lon: -105.2196, ...CO },
  { name: 'Bru Handbuilt Ales & Eats', aliases: ['bru handbuilt ales', 'bru boulder'], street: '5290 Arapahoe Ave', locality: 'Boulder', postalCode: '80303', lat: 40.0157, lon: -105.2200, ...CO },
  { name: 'The Post Brewing, Boulder', aliases: ['the post brewing boulder', 'post brewing boulder'], street: '2200 Pearl St', locality: 'Boulder', postalCode: '80302', lat: 40.0190, lon: -105.2680, ...CO },
  { name: 'Ozo Coffee, Arapahoe', aliases: ['ozo arapahoe', 'ozo coffee arapahoe'], street: '5340 Arapahoe Ave', locality: 'Boulder', postalCode: '80303', lat: 40.0157, lon: -105.2195, ...CO },
  { name: 'Gold Hill Inn', aliases: ['gold hill inn colorado'], street: '401 Main St', locality: 'Gold Hill', postalCode: '80302', lat: 40.0603, lon: -105.4070, ...CO },
  { name: 'Whole Foods Market, Pearl Street', aliases: ['whole foods pearl'], street: '2905 Pearl St', locality: 'Boulder', postalCode: '80301', lat: 40.0195, lon: -105.2585, ...CO },

  /* ── East Boulder, Gunbarrel and the Reservoir ───────────────────────────── */
  { name: 'Dairy Arts Center', aliases: ['the dairy', 'dairy center', 'dairy center for the arts', 'gordon gamm theater'], street: '2590 Walnut St', locality: 'Boulder', postalCode: '80302', lat: 40.0206, lon: -105.2599, ...CO },
  { name: 'Junkyard Social Club', aliases: ['junkyard', 'junkyard social'], street: '2525 Frontier Ave', locality: 'Boulder', postalCode: '80301', lat: 40.0222, lon: -105.2506, ...CO },
  { name: 'Roots Music Project', aliases: ['roots music', 'roots music project boulder'], street: '4747 Pearl St', locality: 'Boulder', postalCode: '80301', lat: 40.0257, lon: -105.2372, ...CO },
  { name: 'Boulder JCC', aliases: ['boulder jewish community center', 'jcc boulder'], street: '6007 Oreg Ave', locality: 'Boulder', postalCode: '80303', lat: 40.0085, lon: -105.2033, ...CO },
  { name: 'BDT Stage', aliases: ['boulder dinner theatre', 'boulder dinner theater', 'bdt'], street: '5501 Arapahoe Ave', locality: 'Boulder', postalCode: '80303', lat: 40.0155, lon: -105.2170, ...CO },
  { name: 'East Boulder Community Center', aliases: ['east boulder rec center', 'ebcc boulder'], street: '5660 Sioux Dr', locality: 'Boulder', postalCode: '80303', lat: 40.0187, lon: -105.2145, ...CO },
  { name: 'Valmont Bike Park', aliases: ['valmont bike park boulder'], street: '3160 Airport Rd', locality: 'Boulder', postalCode: '80301', lat: 40.0287, lon: -105.2380, precision: 'area', ...CO },
  { name: 'Scott Carpenter Park', aliases: ['scott carpenter', 'scott carpenter pool'], street: '1505 30th St', locality: 'Boulder', postalCode: '80303', lat: 40.0125, lon: -105.2555, precision: 'area', ...CO },
  { name: 'Boulder Reservoir', aliases: ['the res boulder', 'boulder rez'], street: '5565 N 51st St', locality: 'Boulder', postalCode: '80301', lat: 40.0704, lon: -105.2158, precision: 'area', ...CO },
  { name: 'Twenty Ninth Street', aliases: ['29th street mall', 'twenty ninth street mall'], street: '1710 29th St', locality: 'Boulder', postalCode: '80301', lat: 40.0192, lon: -105.2570, precision: 'area', ...CO },
  { name: 'The Spot Bouldering Gym', aliases: ['the spot gym', 'spot bouldering'], street: '3240 Prairie Ave', locality: 'Boulder', postalCode: '80301', lat: 40.0280, lon: -105.2560, ...CO },
  { name: 'Movement Boulder', aliases: ['movement climbing boulder'], street: '2845 Valmont Rd', locality: 'Boulder', postalCode: '80301', lat: 40.0300, lon: -105.2570, ...CO },
  { name: 'Boulder Valley School District Education Center', aliases: ['bvsd education center', 'boulder valley school district'], street: '6500 Arapahoe Rd', locality: 'Boulder', postalCode: '80303', lat: 40.0148, lon: -105.1985, ...CO },
  { name: 'Boulder Farmers Market', aliases: ['farmers market boulder', 'boulder county farmers market', '13th street market'], street: '13th St between Canyon Blvd and Arapahoe Ave', locality: 'Boulder', postalCode: '80302', lat: 40.0148, lon: -105.2776, precision: 'area', ...CO },

  /* ── South Boulder and Table Mesa ─────────────────────────────────────────── */
  { name: 'Boulder Public Library, George Reynolds Branch', aliases: ['reynolds branch', 'george reynolds', 'reynolds library'], street: '3595 Table Mesa Dr', locality: 'Boulder', postalCode: '80305', lat: 39.9835, lon: -105.2467, ...CO },
  { name: 'Boulder Public Library, Meadows Branch', aliases: ['meadows branch', 'meadows library'], street: '4800 Baseline Rd', locality: 'Boulder', postalCode: '80303', lat: 39.9998, lon: -105.2243, ...CO },
  { name: 'South Boulder Recreation Center', aliases: ['south boulder rec', 'south boulder rec center'], street: '1360 Gillaspie Dr', locality: 'Boulder', postalCode: '80305', lat: 39.9860, lon: -105.2410, ...CO },
  { name: 'Harlow Platts Community Park', aliases: ['harlow platts park', 'viele lake'], street: '1360 Gillaspie Dr', locality: 'Boulder', postalCode: '80305', lat: 39.9855, lon: -105.2405, precision: 'area', ...CO },
  { name: 'Table Mesa Shopping Center', aliases: ['table mesa center'], street: '655 S Broadway', locality: 'Boulder', postalCode: '80305', lat: 39.9835, lon: -105.2510, precision: 'area', ...CO },
  { name: 'Boulder Mennonite Church', aliases: ['boulder mennonite'], street: '3910 Table Mesa Dr', locality: 'Boulder', postalCode: '80305', lat: 39.9825, lon: -105.2420, ...CO },

  /* ── Louisville ───────────────────────────────────────────────────────────── */
  { name: 'Louisville Public Library', aliases: ['louisville library'], street: '951 Spruce St', locality: 'Louisville', postalCode: '80027', lat: 39.9770, lon: -105.1318, ...CO },
  { name: 'Louisville Center for the Arts', aliases: ['louisville arts center', 'louisville center for arts'], street: '801 Grant Ave', locality: 'Louisville', postalCode: '80027', lat: 39.9782, lon: -105.1323, ...CO },
  { name: 'Louisville Recreation & Senior Center', aliases: ['louisville rec center', 'louisville senior center'], street: '900 Via Appia Way', locality: 'Louisville', postalCode: '80027', lat: 39.9690, lon: -105.1350, ...CO },
  { name: 'Steinbaugh Pavilion', aliases: ['steinbaugh pavilion louisville'], street: '824 Front St', locality: 'Louisville', postalCode: '80027', lat: 39.9780, lon: -105.1310, ...CO },
  { name: 'Downtown Louisville', aliases: ['louisville main street', 'main street louisville'], street: 'Main St', locality: 'Louisville', postalCode: '80027', lat: 39.9779, lon: -105.1318, precision: 'area', ...CO },
  { name: 'Community Food Share', aliases: ['community food share louisville'], street: '650 S Taylor Ave', locality: 'Louisville', postalCode: '80027', lat: 39.9758, lon: -105.1355, ...CO },

  /* ── Lafayette ────────────────────────────────────────────────────────────── */
  { name: 'Lafayette Public Library', aliases: ['lafayette library'], street: '775 W Baseline Rd', locality: 'Lafayette', postalCode: '80026', lat: 39.9930, lon: -105.1005, ...CO },
  { name: 'Bob L. Burger Recreation Center', aliases: ['bob burger rec center', 'lafayette rec center'], street: '111 W Baseline Rd', locality: 'Lafayette', postalCode: '80026', lat: 39.9945, lon: -105.0925, ...CO },
  { name: 'Nissi’s', aliases: ['nissis lafayette', 'nissis'], street: '1455 Coal Creek Dr', locality: 'Lafayette', postalCode: '80026', lat: 39.9920, lon: -105.0880, ...CO },
  { name: 'Festival Plaza, Lafayette', aliases: ['lafayette festival plaza'], street: '311 S Public Rd', locality: 'Lafayette', postalCode: '80026', lat: 39.9930, lon: -105.0890, precision: 'area', ...CO },
  { name: 'The Collective Community Arts Center', aliases: ['the collective lafayette', 'collective community arts center'], street: '201 N Public Rd', locality: 'Lafayette', postalCode: '80026', lat: 39.9965, lon: -105.0895, ...CO },
  { name: 'Flatirons Community Church', aliases: ['flatirons church', 'flatirons community church lafayette'], street: '355 W South Boulder Rd', locality: 'Lafayette', postalCode: '80026', lat: 39.9905, lon: -105.1065, ...CO },
  { name: 'Boulder Valley Unitarian Universalist Fellowship', aliases: ['bvuuf', 'boulder valley uu fellowship'], street: '1241 Ceres Dr', locality: 'Lafayette', postalCode: '80026', lat: 39.9960, lon: -105.1090, ...CO },

  /* ── Longmont ─────────────────────────────────────────────────────────────── */
  { name: 'Longmont Museum', aliases: ['longmont museum & cultural center', 'stewart auditorium', 'longmont museum and cultural center'], street: '400 Quail Rd', locality: 'Longmont', postalCode: '80501', lat: 40.1512, lon: -105.1037, ...CO },
  { name: 'Firehouse Art Center', aliases: ['firehouse longmont', 'firehouse art center longmont'], street: '667 4th Ave', locality: 'Longmont', postalCode: '80501', lat: 40.1677, lon: -105.1006, ...CO },
  { name: 'Dickens Opera House', aliases: ['dickens tavern', 'dickens opera house longmont'], street: '300 Main St', locality: 'Longmont', postalCode: '80501', lat: 40.1673, lon: -105.1019, ...CO },
  { name: 'Longmont Public Library', aliases: ['longmont library'], street: '409 4th Ave', locality: 'Longmont', postalCode: '80501', lat: 40.1663, lon: -105.1035, ...CO },
  { name: 'Longmont Senior Center', aliases: ['longmont senior services'], street: '910 Longs Peak Ave', locality: 'Longmont', postalCode: '80501', lat: 40.1730, lon: -105.1030, ...CO },
  { name: 'Roosevelt Park, Longmont', aliases: ['roosevelt park longmont'], street: '700 Longs Peak Ave', locality: 'Longmont', postalCode: '80501', lat: 40.1718, lon: -105.1015, precision: 'area', ...CO },
  { name: 'Bootstrap Brewing', aliases: ['bootstrap brewing longmont', 'bootstrap brewery'], street: '142 Pratt St', locality: 'Longmont', postalCode: '80501', lat: 40.1720, lon: -105.1085, ...CO },
  { name: 'Left Hand Brewing', aliases: ['left hand brewery', 'left hand taproom'], street: '1265 Boston Ave', locality: 'Longmont', postalCode: '80501', lat: 40.1596, lon: -105.1042, ...CO },
  { name: 'Boulder County Fairgrounds', aliases: ['boulder county fairgrounds longmont', 'longmont farmers market'], street: '9595 Nelson Rd', locality: 'Longmont', postalCode: '80501', lat: 40.1690, lon: -105.1330, precision: 'area', ...CO },
  { name: 'Longmont Theatre Company', aliases: ['longmont theatre', 'longmont theater company'], street: '513 Main St', locality: 'Longmont', postalCode: '80501', lat: 40.1680, lon: -105.1019, ...CO },
  { name: 'Jester’s Dinner Theatre', aliases: ['jesters dinner theatre', 'jesters dinner theater'], street: '224 Main St', locality: 'Longmont', postalCode: '80501', lat: 40.1668, lon: -105.1019, ...CO },
  { name: 'Longmont Recreation Center', aliases: ['longmont rec center'], street: '310 Quail Rd', locality: 'Longmont', postalCode: '80501', lat: 40.1512, lon: -105.1050, ...CO },
  { name: 'Boulder County Parks & Open Space', aliases: ['boulder county parks and open space', 'bcpos'], street: '5201 St Vrain Rd', locality: 'Longmont', postalCode: '80503', lat: 40.1330, lon: -105.1480, ...CO },

  /* ── Lyons, Niwot, Nederland and the mountain towns ──────────────────────── */
  { name: 'Planet Bluegrass', aliases: ['planet bluegrass ranch', 'wildflower pavilion', 'lyons farmette stage'], street: '500 W Main St', locality: 'Lyons', postalCode: '80540', lat: 40.2230, lon: -105.2760, precision: 'area', ...CO },
  { name: 'Sandstone Park', aliases: ['lyons sandstone park', 'sandstone park lyons'], street: '4th Ave & Broadway', locality: 'Lyons', postalCode: '80540', lat: 40.2245, lon: -105.2700, precision: 'area', ...CO },
  { name: 'Oskar Blues Grill & Brew', aliases: ['oskar blues lyons', 'oskar blues grill and brew'], street: '303 Main St', locality: 'Lyons', postalCode: '80540', lat: 40.2247, lon: -105.2710, ...CO },
  { name: 'Lyons Regional Library', aliases: ['lyons library'], street: '451 4th Ave', locality: 'Lyons', postalCode: '80540', lat: 40.2240, lon: -105.2695, ...CO },
  { name: 'Nederland Community Center', aliases: ['nederland community center ncc'], street: '750 Highway 72', locality: 'Nederland', postalCode: '80466', lat: 39.9635, lon: -105.5100, ...CO },
  { name: 'The Caribou Room', aliases: ['caribou room', 'caribou room nederland'], street: '55 Indian Peaks Dr', locality: 'Nederland', postalCode: '80466', lat: 39.9662, lon: -105.5075, ...CO },
  { name: 'Nederland Community Library', aliases: ['nederland library'], street: '200 Highway 72 N', locality: 'Nederland', postalCode: '80466', lat: 39.9640, lon: -105.5090, ...CO },
  { name: 'Wild Bear Nature Center', aliases: ['wild bear', 'wild bear nature'], street: '20 Lakeview Dr', locality: 'Nederland', postalCode: '80466', lat: 39.9614, lon: -105.5089, ...CO },
  { name: 'Niwot Library', aliases: ['niwot branch library'], street: '7400 Lookout Rd', locality: 'Niwot', postalCode: '80503', lat: 40.0910, lon: -105.1580, ...CO },
  { name: 'Left Hand Grange Park', aliases: ['left hand grange', 'niwot grange park'], street: '195 2nd Ave', locality: 'Niwot', postalCode: '80544', lat: 40.1030, lon: -105.1710, precision: 'area', ...CO },

  /* ── Superior, Erie and the eastern county ───────────────────────────────── */
  { name: 'Superior Community Center', aliases: ['superior community center colorado'], street: '1500 Coalton Rd', locality: 'Superior', postalCode: '80027', lat: 39.9345, lon: -105.1620, ...CO },
  { name: 'Erie Community Library', aliases: ['erie library'], street: '400 Powers St', locality: 'Erie', postalCode: '80516', lat: 40.0505, lon: -105.0490, ...CO },
  { name: 'Erie Community Center', aliases: ['erie rec center'], street: '450 Powers St', locality: 'Erie', postalCode: '80516', lat: 40.0500, lon: -105.0485, ...CO },
]

/** The Front Range localities `parseAddressLine` and the matcher recognise by name. */
export const KNOWN_LOCALITIES: readonly string[] = [
  'boulder',
  'longmont',
  'louisville',
  'lafayette',
  'superior',
  'erie',
  'niwot',
  'nederland',
  'lyons',
  'gunbarrel',
  'gold hill',
  'jamestown',
  'ward',
  'eldorado springs',
  'allenspark',
  'hygiene',
  'broomfield',
  'westminster',
  'arvada',
  'golden',
  'denver',
  'loveland',
  'berthoud',
  'frederick',
  'firestone',
  'dacono',
  'mead',
  'estes park',
  'fort collins',
  'thornton',
  'lakewood',
  'wheat ridge',
]

const DIACRITIC = /[̀-ͯ]/g
const NOISE_TOKEN = /^(the|co|colorado|usa|us|united states|\d{5}(?:-\d{4})?)$/

/**
 * The normal form both sides of a venue match are reduced to: lowercase, without
 * diacritics, `&` as `and`, punctuation as spaces, and with the tokens that carry no
 * signal for matching removed ("the", the state, the country, a ZIP).
 */
export function normalizeVenueText(s: string): string {
  return (s ?? '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(DIACRITIC, '')
    .replace(/[‘’ʼ]/g, '')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .split(' ')
    .filter((t) => t && !NOISE_TOKEN.test(t))
    .join(' ')
}

interface Indexed {
  venue: Venue
  keys: string[]
}

let index: Indexed[] | undefined

function buildIndex(venues: Venue[]): Indexed[] {
  return venues.map((venue) => ({
    venue,
    keys: [...new Set([venue.name, ...venue.aliases].map(normalizeVenueText))].filter((k) => k.length >= 3),
  }))
}

/**
 * The venue whose name or alias appears in `text` as a whole-word run. The longest key
 * wins, so "Boulder Public Library, Main" beats "Boulder Public Library" and a branch
 * beats the system. Returns `undefined` rather than a weak guess.
 */
export function matchVenue(text: string, venues: Venue[] = BOULDER_VENUES): Venue | undefined {
  if (!text) return undefined
  const hay = ` ${normalizeVenueText(text)} `
  if (hay.trim().length === 0) return undefined
  const idx = venues === BOULDER_VENUES ? (index ??= buildIndex(BOULDER_VENUES)) : buildIndex(venues)
  let best: { venue: Venue; len: number } | undefined
  for (const { venue, keys } of idx) {
    for (const k of keys) {
      if (k.length > (best?.len ?? 0) && hay.includes(` ${k} `)) best = { venue, len: k.length }
    }
  }
  return best?.venue
}

/** Test seam: drop the memoised index after mutating `BOULDER_VENUES`. */
export function resetVenueIndex(): void {
  index = undefined
}
