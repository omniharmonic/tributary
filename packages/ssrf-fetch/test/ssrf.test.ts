import { createServer } from 'node:http'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { isPublicAddress, normalizeUrl, parseRobots, safeFetch, UnsafeUrlError } from '../src/index.js'

describe('address policy', () => {
  it('refuses private, loopback, link-local and metadata ranges', () => {
    for (const a of ['127.0.0.1', '10.1.2.3', '192.168.0.1', '172.16.5.5', '169.254.169.254', '::1', 'fd00::1', '::ffff:10.0.0.1', '0.0.0.0', '100.64.0.1']) {
      expect(isPublicAddress(a), a).toBe(false)
    }
    for (const a of ['8.8.8.8', '167.233.100.123', '2606:4700::1111']) expect(isPublicAddress(a), a).toBe(true)
  })
  it('normalizes and rejects bad schemes/hosts', () => {
    expect(normalizeUrl('webcal://x.example/a.ics').protocol).toBe('https:')
    expect(() => normalizeUrl('ftp://x.example')).toThrow(UnsafeUrlError)
    expect(() => normalizeUrl('http://user:pw@x.example')).toThrow(UnsafeUrlError)
    expect(() => normalizeUrl('http://localhost:3000')).toThrow(UnsafeUrlError)
    expect(() => normalizeUrl('not a url')).toThrow(UnsafeUrlError)
  })
  it('refuses to fetch a loopback address unless explicitly allowed', async () => {
    await expect(safeFetch('http://127.0.0.1:1/')).rejects.toThrow(UnsafeUrlError)
  })
})

describe('robots', () => {
  it('prefers our own group and longest match', () => {
    const rules = parseRobots(`User-agent: *\nDisallow: /private\nAllow: /private/ok\n\nUser-agent: TributaryBot\nDisallow: /events\n`)
    expect(rules).toEqual([{ allow: false, path: '/events' }])
    const generic = parseRobots(`User-agent: *\nDisallow: /private\nAllow: /private/ok\n`)
    expect(generic).toHaveLength(2)
  })
})

describe('fetch against a local server (allowPrivate)', () => {
  let base = ''
  const server = createServer((req, res) => {
    if (req.url === '/redirect') {
      res.writeHead(302, { location: '/ok' })
      res.end()
    } else if (req.url === '/big') {
      res.writeHead(200, { 'content-type': 'text/plain' })
      res.end('x'.repeat(5000))
    } else if (req.url === '/etag') {
      if (req.headers['if-none-match'] === '"v1"') {
        res.writeHead(304)
        res.end()
      } else {
        res.writeHead(200, { etag: '"v1"', 'content-type': 'text/calendar' })
        res.end('BEGIN:VCALENDAR\nEND:VCALENDAR')
      }
    } else {
      res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' })
      res.end(`ok ${req.headers['user-agent']}`)
    }
  })
  beforeAll(async () => {
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()))
    const addr = server.address()
    base = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`
  })
  afterAll(() => server.close())

  it('follows redirects and sends the identifying user agent', async () => {
    const res = await safeFetch(`${base}/redirect`, { allowPrivate: true })
    expect(res.status).toBe(200)
    expect(res.text()).toContain('TributaryBot')
    expect(res.url).toBe(`${base}/ok`)
  })
  it('caps body size', async () => {
    await expect(safeFetch(`${base}/big`, { allowPrivate: true, maxBytes: 1000 })).rejects.toThrow(/too large/)
  })
  it('supports conditional GET', async () => {
    const first = await safeFetch(`${base}/etag`, { allowPrivate: true })
    expect(first.etag).toBe('"v1"')
    const second = await safeFetch(`${base}/etag`, { allowPrivate: true, etag: first.etag })
    expect(second.notModified).toBe(true)
  })
})
