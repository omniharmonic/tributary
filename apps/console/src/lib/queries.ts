import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from './api'
import { ApiError } from './errors'
import type { Me, PublicConfig } from './types'

const FALLBACK_CONFIG: PublicConfig = { region: { slug: 'boulder', name: 'Boulder', tz: 'America/Denver' }, handleDomain: 'freeskool.directory', brand: 'Boulder Directory', adapterName: 'Tributary' }

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
      qc.setQueryData(['me'], null)
      void qc.invalidateQueries()
    },
  })
}

export const keys = {
  sources: ['sources'] as const,
  source: (id: string) => ['sources', id] as const,
  events: (params: Record<string, string | undefined>) => ['events', params] as const,
  confirmations: ['confirmations'] as const,
  publicEvents: (params: Record<string, string | undefined>) => ['public-events', params] as const,
}
