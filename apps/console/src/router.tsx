import { createRootRouteWithContext, createRoute, createRouter, lazyRouteComponent, Outlet, redirect } from '@tanstack/react-router'
import type { QueryClient } from '@tanstack/react-query'
import { api } from './lib/api'
import { ApiError } from './lib/errors'
import type { Me } from './lib/types'
import { Header } from './components/Shell'
import { HomeRoute } from './routes/Home'
import { NotFoundRoute } from './routes/Misc'

const EventRoute = lazyRouteComponent(() => import('./routes/EventPage'), 'EventRoute')
const HostRoute = lazyRouteComponent(() => import('./routes/HostPage'), 'HostRoute')
const AddRoute = lazyRouteComponent(() => import('./routes/Add'), 'AddRoute')
const PreviewRoute = lazyRouteComponent(() => import('./routes/Preview'), 'PreviewRoute')
const ConnectRoute = lazyRouteComponent(() => import('./routes/Connect'), 'ConnectRoute')
const VerifyRoute = lazyRouteComponent(() => import('./routes/Auth'), 'VerifyRoute')
const LoginRoute = lazyRouteComponent(() => import('./routes/Auth'), 'LoginRoute')
const DashboardRoute = lazyRouteComponent(() => import('./routes/Dashboard'), 'DashboardRoute')
const SourceDetailRoute = lazyRouteComponent(() => import('./routes/SourceDetail'), 'SourceDetailRoute')
const EventsLedgerRoute = lazyRouteComponent(() => import('./routes/EventsLedger'), 'EventsLedgerRoute')
const ConfirmationsRoute = lazyRouteComponent(() => import('./routes/Confirmations'), 'ConfirmationsRoute')
const ConfirmDeepLinkRoute = lazyRouteComponent(() => import('./routes/Confirmations'), 'ConfirmDeepLinkRoute')
const AudienceRoute = lazyRouteComponent(() => import('./routes/Audience'), 'AudienceRoute')
const SettingsRoute = lazyRouteComponent(() => import('./routes/Settings'), 'SettingsRoute')
const JoinRoute = lazyRouteComponent(() => import('./routes/Join'), 'JoinRoute')
const CrawlerRoute = lazyRouteComponent(() => import('./routes/Misc'), 'CrawlerRoute')
const BookmarkletRoute = lazyRouteComponent(() => import('./routes/Misc'), 'BookmarkletRoute')
const StewardRoute = lazyRouteComponent(() => import('./routes/Steward'), 'StewardRoute')
const PublishingRoute = lazyRouteComponent(() => import('./routes/Misc'), 'PublishingRoute')
const TermsRoute = lazyRouteComponent(() => import('./routes/Misc'), 'TermsRoute')
const PrivacyRoute = lazyRouteComponent(() => import('./routes/Misc'), 'PrivacyRoute')

export interface RouterContext {
  queryClient: QueryClient
}

export interface HomeSearch {
  q?: string
  category?: string
  when?: 'tonight' | 'weekend' | 'week' | 'later'
}
export interface ConnectSearch {
  previewId?: string
  visibility?: string
  error?: string
  handle?: string
  next?: string
}
export interface LedgerSearch {
  sourceId?: string
  state?: string
}

/** Keep only string values; drop the rest so optional search params stay optional. */
function opt<T extends Record<string, unknown>>(o: T): { [K in keyof T]?: string } {
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(o)) if (typeof v === 'string' && v !== '') out[k] = v
  return out as { [K in keyof T]?: string }
}

function Shell() {
  return (
    <>
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <Header />
      <Outlet />
    </>
  )
}

const rootRoute = createRootRouteWithContext<RouterContext>()({ component: Shell, notFoundComponent: NotFoundRoute })

/** Signed-out visitors never see host screens: resolve the session once, then redirect. */
async function requireSession({ context, location }: { context: RouterContext; location: { href: string } }): Promise<void> {
  const me = await context.queryClient
    .fetchQuery<Me | null>({
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
    })
    .catch(() => null)
  if (!me) throw redirect({ to: '/login', search: { next: location.href } })
}

const home = createRoute({ getParentRoute: () => rootRoute, path: '/', component: HomeRoute, validateSearch: (s: Record<string, unknown>): HomeSearch => opt({ q: s.q, category: s.category, when: s.when }) as HomeSearch })
const event = createRoute({ getParentRoute: () => rootRoute, path: '/e/$did/$rkey', component: EventRoute })
const host = createRoute({ getParentRoute: () => rootRoute, path: '/h/$handle', component: HostRoute })
const add = createRoute({ getParentRoute: () => rootRoute, path: '/add', component: AddRoute, validateSearch: (s: Record<string, unknown>): { input?: string } => opt({ input: s.input }) })
const preview = createRoute({ getParentRoute: () => rootRoute, path: '/preview/$previewId', component: PreviewRoute })
const connect = createRoute({
  getParentRoute: () => rootRoute,
  path: '/connect',
  component: ConnectRoute,
  validateSearch: (s: Record<string, unknown>): ConnectSearch => opt({ previewId: s.previewId, visibility: s.visibility, error: s.error, handle: s.handle, next: s.next }) as ConnectSearch,
})
const verify = createRoute({ getParentRoute: () => rootRoute, path: '/auth/verify', component: VerifyRoute, validateSearch: (s: Record<string, unknown>): { token?: string } => opt({ token: s.token }) })
const login = createRoute({ getParentRoute: () => rootRoute, path: '/login', component: LoginRoute, validateSearch: (s: Record<string, unknown>): { next?: string } => opt({ next: s.next }) })

const dashboard = createRoute({ getParentRoute: () => rootRoute, path: '/dashboard', beforeLoad: requireSession, component: DashboardRoute, validateSearch: (s: Record<string, unknown>): { welcome?: string } => opt({ welcome: s.welcome }) })
const sourceDetail = createRoute({ getParentRoute: () => rootRoute, path: '/dashboard/sources/$id', beforeLoad: requireSession, component: SourceDetailRoute })
const ledger = createRoute({ getParentRoute: () => rootRoute, path: '/dashboard/events', beforeLoad: requireSession, component: EventsLedgerRoute, validateSearch: (s: Record<string, unknown>): LedgerSearch => opt({ sourceId: s.sourceId, state: s.state }) })
const confirmations = createRoute({ getParentRoute: () => rootRoute, path: '/dashboard/confirmations', beforeLoad: requireSession, component: ConfirmationsRoute })
const audience = createRoute({ getParentRoute: () => rootRoute, path: '/dashboard/audience/$eventId', beforeLoad: requireSession, component: AudienceRoute })
const settings = createRoute({ getParentRoute: () => rootRoute, path: '/settings', beforeLoad: requireSession, component: SettingsRoute })
const steward = createRoute({ getParentRoute: () => rootRoute, path: '/steward', beforeLoad: requireSession, component: StewardRoute })
const join = createRoute({ getParentRoute: () => rootRoute, path: '/join/$token', component: JoinRoute, validateSearch: (s: Record<string, unknown>): { e?: string } => opt({ e: s.e }) })
const confirmDeepLink = createRoute({ getParentRoute: () => rootRoute, path: '/confirm/$id', component: ConfirmDeepLinkRoute })

const crawler = createRoute({ getParentRoute: () => rootRoute, path: '/about/crawler', component: CrawlerRoute })
const bookmarklet = createRoute({ getParentRoute: () => rootRoute, path: '/about/bookmarklet', component: BookmarkletRoute })
const publishing = createRoute({ getParentRoute: () => rootRoute, path: '/about/publishing', component: PublishingRoute })
const terms = createRoute({ getParentRoute: () => rootRoute, path: '/legal/terms', component: TermsRoute })
const privacy = createRoute({ getParentRoute: () => rootRoute, path: '/legal/privacy', component: PrivacyRoute })

const routeTree = rootRoute.addChildren([home, event, host, add, preview, connect, verify, login, dashboard, sourceDetail, ledger, confirmations, audience, settings, steward, join, confirmDeepLink, crawler, bookmarklet, publishing, terms, privacy])

export function makeRouter(queryClient: QueryClient) {
  return createRouter({ routeTree, context: { queryClient }, defaultPreload: 'intent', scrollRestoration: true })
}

declare module '@tanstack/react-router' {
  interface Register {
    router: ReturnType<typeof makeRouter>
  }
}
