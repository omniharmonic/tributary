import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApiError, plainError } from './errors'

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

describe('api client', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('sends the CSRF header on writes and maps error bodies to ApiError', async () => {
    const fetchMock = vi.fn().mockResolvedValue(json(409, { error: 'Conflict', message: 'Already connected by another host.' }))
    vi.stubGlobal('fetch', fetchMock)
    const { call } = await import('./api')
    await expect(call('POST', '/api/sources', { x: 1 })).rejects.toMatchObject({ code: 'Conflict', status: 409, message: 'Already connected by another host.' })
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit
    expect((init.headers as Record<string, string>)['x-requested-with']).toBe('tributary')
    expect(init.credentials).toBe('same-origin')
  })

  it('does not send the CSRF header on reads and parses JSON', async () => {
    const fetchMock = vi.fn().mockResolvedValue(json(200, { host: { id: 'h' } }))
    vi.stubGlobal('fetch', fetchMock)
    const { call } = await import('./api')
    await expect(call('GET', '/api/me')).resolves.toEqual({ host: { id: 'h' } })
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit
    expect((init.headers as Record<string, string>)['x-requested-with']).toBeUndefined()
  })

  it('maps a bare 401 and a network failure to codes', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 401 })))
    const { call } = await import('./api')
    await expect(call('GET', '/api/me')).rejects.toMatchObject({ code: 'Unauthorized', status: 401 })
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')))
    await expect(call('GET', '/api/me')).rejects.toMatchObject({ code: 'Network' })
  })

  it('renders plain language for known codes and keeps specific server messages', () => {
    expect(plainError(new ApiError('SourceUnsupported', 'SourceUnsupported', 400))).toMatch(/not supported yet/)
    expect(plainError(new ApiError('InvalidInput', 'That does not look like an email address.', 400))).toBe('That does not look like an email address.')
    expect(plainError(new Error('boom'))).toBe('boom')
  })
})
