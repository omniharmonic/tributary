import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from './api'
import { ApiError } from './errors'
import { setActingHost, useActingHostId } from './acting'
import type { ManagedHost, Me, PublicConfig } from './types'

const FALLBACK_CONFIG: PublicConfig = { region: { slug: 'boulder', name: 'Boulder', tz: 'America/Denver' }, handleDomain: 'boulderevents.directory', brand: 'Boulder Events Directory', adapterName: 'Tributary' }

export function useConfig(): PublicConfig {
  const q = useQuery({ queryKey: ['config'], queryFn: () => api.publicConfig(), staleTime: Infinity, retry: 1 })
  return q.data ?? FALLBACK_CONFIG
}

/** The session. `null` means signed out; `undefined` means still resolving. */
export function useMe(): { me: Me | null | undefined; isPending: boolean; refetch: () => void } {
  const q = useQuery<Me | null>({
    queryKey: ['me'],
    queryFn: async () => {
      try {
        return await api.me()
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) return null
        throw err
      }
    },
    staleTime: 60_000,
    retry: false,
  })
  return { me: q.isPending ? undefined : (q.data ?? null), isPending: q.isPending, refetch: () => void q.refetch() }
}

export function useLogout() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => api.logout(),
    onSuccess: () => {
      setActingHost(null)
      qc.setQueryData(['me'], null)
      void qc.invalidateQueries()
    },
  })
}

/** Hosts (other than my own) where my DID holds a role. Empty for most people. */
export function useManaged(): ManagedHost[] {
  const { me } = useMe()
  const q = useQuery({ queryKey: ['managed'], queryFn: () => api.managed(), enabled: !!me, staleTime: 60_000, retry: false })
  return q.data?.hosts ?? []
}

/**
 * The host I am currently acting as, if any. Switching invalidates every query: the
 * dashboard, ledger, settings and confirmations all change meaning with the header.
 */
export function useActing(): { actingId: string | null; acting: ManagedHost | null; role: 'owner' | 'editor' | 'viewer'; readOnly: boolean; setActing: (id: string | null) => void } {
  const qc = useQueryClient()
  const actingId = useActingHostId()
  const managed = useManaged()
  const acting = actingId ? (managed.find((h) => h.id === actingId) ?? null) : null
  const role = acting?.role ?? 'owner'
  return {
    actingId,
    acting,
    role,
    readOnly: role === 'viewer',
    setActing: (id) => {
      setActingHost(id)
      void qc.invalidateQueries({ predicate: (q) => q.queryKey[0] !== 'me' && q.queryKey[0] !== 'config' && q.queryKey[0] !== 'managed' })
    },
  }
}

export const keys = {
  sources: ['sources'] as const,
  source: (id: string) => ['sources', id] as const,
  events: (params: Record<string, string | undefined>) => ['events', params] as const,
  confirmations: ['confirmations'] as const,
  publicEvents: (params: Record<string, string | undefined>) => ['public-events', params] as const,
  publicEventCounts: (params: Record<string, string | undefined>) => ['public-event-counts', params] as const,
}
