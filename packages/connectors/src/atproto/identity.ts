/**
 * AT Protocol identity resolution, over `ctx.http` only.
 *
 * Handle → DID follows the spec's HTTPS half: `https://<handle>/.well-known/atproto-did`.
 * The DNS half (`_atproto.<handle>` TXT) is not reachable from a connector, which may
 * only speak HTTP, so a handle that publishes *only* a DNS record falls back to a public
 * resolver. That fallback is a convenience and named as one: `RESOLVER_URL` can point it
 * anywhere, and nothing else in this package depends on Bluesky's infrastructure.
 *
 * DID → PDS reads the DID document, which is the authoritative answer in both
 * directions. Everything goes through the SSRF-safe client because both the handle and
 * the service endpoint in a DID document are strings a stranger chose.
 */
import { ConnectorError, type FetchCtx } from '../sdk.js'

export const RESOLVER_URL = 'https://public.api.bsky.app'
export const PLC_URL = 'https://plc.directory'

type Http = Pick<FetchCtx, 'http'>['http']

/** `alice.example.com`, `@alice.example.com`, `at://alice.example.com` → `alice.example.com`. */
export function cleanHandle(raw: string): string | null {
  const h = raw
    .trim()
    .replace(/^at:\/\//, '')
    .replace(/^@/, '')
    .replace(/\/.*$/, '')
    .toLowerCase()
  // A handle is a domain name: at least one dot, no scheme, no spaces.
  if (!/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/.test(h)) return null
  return h
}

export function isDid(raw: string): boolean {
  return /^did:(plc:[a-z2-7]{24}|web:[a-z0-9.:%-]+)$/i.test(raw.trim())
}

export async function resolveHandle(handle: string, http: Http, resolverUrl = RESOLVER_URL): Promise<string> {
  try {
    const res = await http.get(`https://${handle}/.well-known/atproto-did`, { headers: { accept: 'text/plain' }, maxBytes: 4096 })
    if (res.status === 200) {
      const did = res.text().trim()
      if (isDid(did)) return did
    }
  } catch {
    // The handle's own domain may not serve well-known at all. Try the resolver.
  }
  const res = await http.get(`${resolverUrl.replace(/\/$/, '')}/xrpc/com.atproto.identity.resolveHandle?handle=${encodeURIComponent(handle)}`, { headers: { accept: 'application/json' }, maxBytes: 8192 })
  if (res.status !== 200) throw new ConnectorError(`we could not find an account for @${handle}`, 'NotFound', false)
  let did: unknown
  try {
    did = (JSON.parse(res.text()) as { did?: unknown }).did
  } catch {
    throw new ConnectorError('the handle resolver sent something we could not read', 'Unparseable')
  }
  if (typeof did !== 'string' || !isDid(did)) throw new ConnectorError(`we could not find an account for @${handle}`, 'NotFound', false)
  return did
}

export interface DidDocument {
  alsoKnownAs?: string[]
  service?: Array<{ id?: string; type?: string; serviceEndpoint?: string }>
}

export async function fetchDidDocument(did: string, http: Http, plcUrl = PLC_URL): Promise<DidDocument> {
  const url = did.startsWith('did:web:') ? `https://${did.slice('did:web:'.length).replace(/:/g, '/')}/.well-known/did.json` : `${plcUrl.replace(/\/$/, '')}/${encodeURIComponent(did)}`
  const res = await http.get(url, { headers: { accept: 'application/json' }, maxBytes: 64 * 1024 })
  if (res.status === 404) throw new ConnectorError('that account no longer exists', 'Gone', false)
  if (res.status !== 200) throw new ConnectorError(`the directory answered ${res.status} for that account`, 'Other')
  try {
    return JSON.parse(res.text()) as DidDocument
  } catch {
    throw new ConnectorError('that account’s identity document could not be read', 'Unparseable')
  }
}

/** The repo's home server, from its DID document. */
export function pdsFromDocument(doc: DidDocument): string | null {
  const svc = doc.service?.find((s) => s.id === '#atproto_pds' || s.id?.endsWith('#atproto_pds') || s.type === 'AtprotoPersonalDataServer')
  const endpoint = svc?.serviceEndpoint
  if (typeof endpoint !== 'string' || !/^https?:\/\//.test(endpoint)) return null
  return endpoint.replace(/\/$/, '')
}

/** The handle the DID claims, for a label. Unverified on its own, so only ever cosmetic. */
export function handleFromDocument(doc: DidDocument): string | undefined {
  const aka = doc.alsoKnownAs?.find((a) => a.startsWith('at://'))
  return aka?.slice('at://'.length) || undefined
}

export interface ResolvedRepo {
  did: string
  handle?: string
  pdsUrl: string
}

/** A handle or a DID in, a repo you can read out. */
export async function resolveRepo(input: string, http: Http, opts: { resolverUrl?: string; plcUrl?: string } = {}): Promise<ResolvedRepo> {
  const trimmed = input.trim()
  const did = isDid(trimmed) ? trimmed : await resolveHandle(cleanHandle(trimmed) ?? '', http, opts.resolverUrl)
  const doc = await fetchDidDocument(did, http, opts.plcUrl)
  const pdsUrl = pdsFromDocument(doc)
  if (!pdsUrl) throw new ConnectorError('that account has no personal data server we can read', 'Unsupported', false)
  return { did, handle: handleFromDocument(doc) ?? (isDid(trimmed) ? undefined : (cleanHandle(trimmed) ?? undefined)), pdsUrl }
}
