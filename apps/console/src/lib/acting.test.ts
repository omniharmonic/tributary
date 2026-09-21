import { afterEach, describe, expect, it, vi } from 'vitest'

describe('acting host', () => {
  afterEach(() => {
    sessionStorage.clear()
    vi.unstubAllGlobals()
    vi.resetModules()
  })

  it('remembers the acting host in the tab and clears it', async () => {
    const { actingHostId, setActingHost } = await import('./acting')
    expect(actingHostId()).toBeNull()
    setActingHost('h2')
    expect(actingHostId()).toBe('h2')
    setActingHost(null)
    expect(actingHostId()).toBeNull()
  })

  it('sends X-Acting-Host on every request while acting, and never otherwise', async () => {
    const json = () => new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } })
    const fetchMock = vi.fn().mockImplementation(async () => json())
    vi.stubGlobal('fetch', fetchMock)
    const { setActingHost } = await import('./acting')
    const { call } = await import('./api')
    await call('GET', '/api/sources')
    expect(((fetchMock.mock.calls[0]?.[1] as RequestInit).headers as Record<string, string>)['x-acting-host']).toBeUndefined()
    setActingHost('h2')
    await call('POST', '/api/sources/s1/sync', {})
    expect(((fetchMock.mock.calls[1]?.[1] as RequestInit).headers as Record<string, string>)['x-acting-host']).toBe('h2')
  })
})
