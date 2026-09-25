/**
 * The basemap, served from our own origin.
 *
 * The map used to load its background straight from the tile provider's CDN. That was
 * wrong three times over:
 *
 *  - it spread across six hostnames (`basemaps`, `tiles.basemaps`, and `tiles-a` through
 *    `tiles-d`), so a content security policy naming one of them blocked the rest, and
 *    the map died with "the basemap could not load" for anybody whose page carried the
 *    policy;
 *  - anything that blocks CDNs — a tracker blocker, a filtering resolver, a strict
 *    corporate network — took the map with it, for a reason the visitor could not see;
 *  - it told the provider the IP of every visitor who opened the map and, tile by tile,
 *    which part of town they were looking at. For a directory that promises a reader
 *    never needs an account to look, that is a promise with a hole in it.
 *
 * Proxying fixes all three: the page talks to this origin and nothing else, the CSP
 * needs no exception, and the provider sees one server rather than every reader.
 * Attribution still travels with the style and is rendered by the map.
 *
 * Every upstream host and path here is a constant. The only things a caller controls are
 * the tile coordinates, the font range and the sprite variant, and each is matched
 * against a strict pattern before it is used, so there is no way to steer these fetches
 * somewhere else.
 */
import { Hono } from 'hono'
import { config } from '../../config.js'
import { describeError, log } from '../../lib/logging.js'
import type { Vars } from '../context.js'

export const basemapRoutes = new Hono<{ Variables: Vars }>()

const STYLE_HOST = 'https://basemaps.cartocdn.com'
const ASSET_HOST = 'https://tiles.basemaps.cartocdn.com'
const TILE_HOSTS = ['https://tiles-a.basemaps.cartocdn.com', 'https://tiles-b.basemaps.cartocdn.com', 'https://tiles-c.basemaps.cartocdn.com', 'https://tiles-d.basemaps.cartocdn.com']
const TILE_PATH = '/vectortiles/carto.streets/v1'

const THEMES = { light: 'positron', dark: 'dark-matter' } as const
type Theme = keyof typeof THEMES

/** Tiles and glyphs never change under the same URL. A week is conservative. */
const IMMUTABLE = 'public, max-age=604800, immutable'
const STYLE_CACHE = 'public, max-age=3600'
const TIMEOUT_MS = 12_000

function themeOf(raw: string | undefined): Theme {
  return raw === 'dark' ? 'dark' : 'light'
}

function base(): string {
  return config().WEB_PUBLIC_URL.replace(/\/$/, '')
}

/** One upstream GET. Returns null rather than throwing; the caller answers 502. */
async function upstream(url: string): Promise<{ body: ArrayBuffer; type: string } | null> {
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { accept: '*/*', 'user-agent': `${config().ADAPTER_NAME} basemap proxy (+${base()})` },
    })
    if (!res.ok) return null
    return { body: await res.arrayBuffer(), type: res.headers.get('content-type') ?? 'application/octet-stream' }
  } catch (err) {
    log.warn('basemap upstream failed', { detail: describeError(err) })
    return null
  }
}

/**
 * The style, rewritten so every URL inside it points back here.
 *
 * MapLibre follows whatever the style says, so this one rewrite is what moves the tiles,
 * the fonts and the icons onto our origin. A style we cannot fetch is a 502: the map
 * shows its own failure state, which is honest, rather than half a map.
 */
basemapRoutes.get('/style.json', async (c) => {
  const theme = themeOf(c.req.query('theme'))
  const got = await upstream(`${STYLE_HOST}/gl/${THEMES[theme]}-gl-style/style.json`)
  if (!got) return c.json({ error: 'SourceUnreachable', message: 'The basemap is unavailable.' }, 502)
  let style: Record<string, unknown>
  try {
    style = JSON.parse(Buffer.from(got.body).toString('utf8')) as Record<string, unknown>
  } catch {
    return c.json({ error: 'SourceUnreachable', message: 'The basemap is unavailable.' }, 502)
  }
  const here = `${base()}/api/public/basemap`
  style.glyphs = `${here}/glyphs/{fontstack}/{range}.pbf`
  style.sprite = `${here}/sprite/sprite`
  const sources = (style.sources ?? {}) as Record<string, Record<string, unknown>>
  for (const src of Object.values(sources)) {
    // Replace the TileJSON indirection with the tile template directly: one fewer
    // round trip, and one fewer document whose contents would need rewriting.
    delete src.url
    src.tiles = [`${here}/tile/{z}/{x}/{y}.mvt`]
    src.minzoom ??= 0
    src.maxzoom ??= 14
  }
  c.header('Cache-Control', STYLE_CACHE)
  return c.json(style)
})

/**
 * One vector tile. `z`, `x` and `y` are checked as integers inside the pyramid before
 * they are put in a URL, and the upstream host is chosen from a fixed list by the tile's
 * own coordinates — not round-robin, so the same tile always has the same origin and
 * stays cacheable.
 */
basemapRoutes.get('/tile/:z/:x/:y', async (c) => {
  const z = Number(c.req.param('z'))
  const x = Number(c.req.param('x'))
  const y = Number(c.req.param('y').replace(/\.(mvt|pbf)$/, ''))
  const span = 2 ** z
  if (!Number.isInteger(z) || z < 0 || z > 14 || !Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0 || x >= span || y >= span) {
    return c.text('Not found.', 404)
  }
  const host = TILE_HOSTS[(x + y) % TILE_HOSTS.length]!
  const got = await upstream(`${host}${TILE_PATH}/${z}/${x}/${y}.mvt`)
  // A tile that is missing upstream is normal at the edges of coverage; 204 lets the
  // map carry on drawing instead of treating it as a failure.
  if (!got) return c.body(null, 204)
  c.header('Content-Type', got.type)
  c.header('Cache-Control', IMMUTABLE)
  return c.body(got.body)
})

/** A font range, e.g. `Open Sans Regular/0-255.pbf`. */
basemapRoutes.get('/glyphs/:stack/:range', async (c) => {
  const stack = c.req.param('stack')
  const range = c.req.param('range')
  if (!/^[A-Za-z0-9 ,._-]{1,120}$/.test(stack) || !/^\d{1,5}-\d{1,5}\.pbf$/.test(range)) return c.text('Not found.', 404)
  const got = await upstream(`${ASSET_HOST}/fonts/${encodeURIComponent(stack)}/${range}`)
  if (!got) return c.text('Not found.', 404)
  c.header('Content-Type', got.type)
  c.header('Cache-Control', IMMUTABLE)
  return c.body(got.body)
})

/** The icon sheet: `sprite.json`, `sprite.png`, and their `@2x` variants. */
basemapRoutes.get('/sprite/:name', async (c) => {
  const theme = themeOf(c.req.query('theme'))
  const name = c.req.param('name')
  const m = /^sprite(@[234]x)?\.(json|png)$/.exec(name)
  if (!m) return c.text('Not found.', 404)
  const got = await upstream(`${ASSET_HOST}/gl/${THEMES[theme]}-gl-style/${name}`)
  if (!got) return c.text('Not found.', 404)
  c.header('Content-Type', got.type)
  c.header('Cache-Control', IMMUTABLE)
  return c.body(got.body)
})
