/**
 * The Hono app: `/api/*` per docs/api.md, the OAuth documents at the root, and (in
 * production) the built console with an SPA fallback.
 */
import { Hono } from 'hono'
import { serveStatic } from '@hono/node-server/serve-static'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { config } from '../config.js'
import { describeError, log } from '../lib/logging.js'
import { ApiError, authenticate, type Vars } from './context.js'
import { authRoutes, oauthRoot } from './routes/auth.js'
import { confirmationRoutes } from './routes/confirmations.js'
import { eventRoutes, joinRoutes } from './routes/events.js'
import { meRoutes } from './routes/me.js'
import { oneBoxRoutes, publicRoutes } from './routes/public.js'
import { sourceRoutes } from './routes/sources.js'
import { inboundEmailRoutes, v1Routes, webhookRoutes } from './routes/v1.js'

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
  api.route('/join', joinRoutes)
  api.notFound((ctx) => ctx.json({ error: 'NotFound', message: 'Not found.' }, 404))
  app.route('/api', api)
  app.route('/', oauthRoot)

  if (c.CONSOLE_DIST && existsSync(c.CONSOLE_DIST)) {
    const root = path.relative(process.cwd(), c.CONSOLE_DIST) || '.'
    const index = readFileSync(path.join(c.CONSOLE_DIST, 'index.html'), 'utf8')
    app.use('/assets/*', async (ctx, next) => {
      ctx.header('Cache-Control', 'public, max-age=31536000, immutable')
      await next()
    })
    app.use('/*', serveStatic({ root }))
    app.get('*', (ctx) => {
      ctx.header('Cache-Control', 'no-cache')
      ctx.header('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; font-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'")
      return ctx.html(index)
    })
  }
  return app
}
