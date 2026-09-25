/**
 * The Hono app: `/api/*` per docs/api.md, the OAuth documents at the root, and (in
 * production) the built console with an SPA fallback.
 */
import { Hono } from 'hono'
import { serveStatic } from '@hono/node-server/serve-static'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { ConnectorError } from '@tributary/connectors'
import { UnsafeUrlError, FetchLimitError, RobotsDisallowedError } from '@tributary/ssrf-fetch'
import { config } from '../config.js'
import { describeError, log } from '../lib/logging.js'
import { ApiError, authenticate, type Vars } from './context.js'
import { authRoutes, oauthRoot } from './routes/auth.js'
import { basemapRoutes } from './routes/basemap.js'
import { confirmationRoutes } from './routes/confirmations.js'
import { eventRoutes, joinRoutes } from './routes/events.js'
import { meRoutes } from './routes/me.js'
import { reportRoutes, stewardRoutes } from './routes/moderation.js'
import { telegramInbound, telegramMeRoutes } from './routes/telegram.js'
import { oneBoxRoutes, publicRoutes } from './routes/public.js'
import { sourceRoutes } from './routes/sources.js'
import { internalRoutes } from './routes/internal.js'
import { inboundEmailRoutes, v1Routes, webhookRoutes } from './routes/v1.js'

/**
 * The console's content security policy.
 *
 * `default-src 'self'` and nothing else: the page talks to this origin and no one else.
 * The map's basemap used to need an exception here, which was a bad trade — the tile
 * provider spread across six hostnames, so naming one of them blocked the rest, and any
 * host named here is a host that learns the IP of every visitor who opens the map. The
 * basemap is proxied through `/api/public/basemap` instead, so there is nothing to name.
 *
 * `worker-src blob:` stays: MapLibre builds its tile decoder as a blob worker, and under
 * a bare `default-src` the worker is refused with nothing in the network log to explain
 * it.
 */
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self'",
  "connect-src 'self'",
  "worker-src 'self' blob:",
  // Safari still reads workers out of child-src.
  "child-src 'self' blob:",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join('; ')

export function createApp(): Hono<{ Variables: Vars }> {
  const app = new Hono<{ Variables: Vars }>()
  const c = config()

  app.use('*', async (ctx, next) => {
    ctx.header('X-Content-Type-Options', 'nosniff')
    ctx.header('Referrer-Policy', 'no-referrer')
    await next()
  })

  app.onError((err, ctx) => {
    if (err instanceof ApiError) return ctx.json({ error: err.code, message: err.message }, err.status as 400)
    // A source we could not read is the host's problem to fix, said plainly (never a 500).
    if (err instanceof ConnectorError) {
      const plain: Record<string, string> = {
        NotFound: 'We could not find a calendar at that address. Check that the link is public and try again.',
        Gone: 'That calendar has been removed at the source.',
        Forbidden: 'That calendar is not public. Make it public at the source, or upload an .ics file.',
        RateLimited: 'The source asked us to slow down. Try again in a few minutes.',
        Unparseable: 'We could not read what that address sent back.',
        Unsupported: 'That kind of source is not supported yet.',
        Network: 'We could not reach that address.',
        TooLarge: 'That feed is too large to read.',
        Other: 'Something went wrong reading that source.',
      }
      return ctx.json({ error: err.code === 'Unsupported' ? 'SourceUnsupported' : 'SourceUnreachable', message: plain[err.code] ?? plain.Other }, 400)
    }
    if (err instanceof UnsafeUrlError || err instanceof RobotsDisallowedError || err instanceof FetchLimitError) {
      return ctx.json({ error: 'SourceUnreachable', message: err instanceof RobotsDisallowedError ? 'That site asks crawlers not to read that page. Try the feed link, an .ics upload, or the form.' : 'We could not fetch that address.' }, 400)
    }
    const e = err as { status?: number; code?: string }
    if (typeof e.status === 'number' && e.status < 500 && typeof e.code === 'string') return ctx.json({ error: e.code, message: err.message }, e.status as 400)
    log.error('unhandled error', { path: new URL(ctx.req.url).pathname, detail: describeError(err) })
    return ctx.json({ error: 'Internal', message: 'Something went wrong on our side.' }, 500)
  })

  const api = new Hono<{ Variables: Vars }>()
  api.use('*', authenticate)
  api.route('/public', publicRoutes)
  api.get('/health', (ctx) => ctx.redirect('/api/public/health'))
  api.route('/', oneBoxRoutes)
  api.route('/auth', authRoutes)
  api.route('/me', meRoutes)
  api.route('/sources', sourceRoutes)
  api.route('/events', eventRoutes)
  api.route('/confirmations', confirmationRoutes)
  api.route('/v1', v1Routes)
  api.route('/webhook', webhookRoutes)
  api.route('/inbound/email', inboundEmailRoutes)
  api.route('/inbound/telegram', telegramInbound)
  api.route('/me/telegram', telegramMeRoutes)
  api.route('/join', joinRoutes)
  api.route('/public/report', reportRoutes)
  api.route('/public/basemap', basemapRoutes)
  api.route('/steward', stewardRoutes)
  api.notFound((ctx) => ctx.json({ error: 'NotFound', message: 'Not found.' }, 404))
  app.route('/api', api)
  app.route('/', oauthRoot)
  // Container-local only: Caddy's on-demand TLS ask. Never routed from a public host.
  app.route('/internal', internalRoutes)

  if (c.CONSOLE_DIST && existsSync(c.CONSOLE_DIST)) {
    const root = path.relative(process.cwd(), c.CONSOLE_DIST) || '.'
    const index = readFileSync(path.join(c.CONSOLE_DIST, 'index.html'), 'utf8')
    // Set on the way out, for every console response. Setting it only on the SPA
    // fallback left the home page with no policy at all: `serveStatic` answers `/` with
    // index.html and returns, so the catch-all below never ran for it. The result was a
    // policy that applied to deep links and not to the front door — the worst of both,
    // since the map then worked or failed depending on which URL you arrived at.
    app.use('/*', async (ctx, next) => {
      await next()
      if (!ctx.req.path.startsWith('/api/')) ctx.header('Content-Security-Policy', CSP)
    })
    app.use('/assets/*', async (ctx, next) => {
      ctx.header('Cache-Control', 'public, max-age=31536000, immutable')
      await next()
    })
    app.use('/*', serveStatic({ root }))
    // A build asset that is missing is a broken deploy, and must say so. Letting it fall
    // through to the SPA shell hands the browser HTML where it asked for JavaScript:
    // MapLibre's worker died on exactly that and reported only "Worker failed to load",
    // with a 200 in the network tab to argue it was fine.
    app.get('/assets/*', (ctx) => ctx.text('Not found.', 404))
    app.get('*', (ctx) => {
      ctx.header('Cache-Control', 'no-cache')
      return ctx.html(index)
    })
  }
  return app
}
