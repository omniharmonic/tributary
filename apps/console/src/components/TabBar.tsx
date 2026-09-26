import { Link, useRouterState } from '@tanstack/react-router'
import { useMe } from '../lib/queries'

/** The host's navigation once signed in. Public visitors get the header only. */
export function TabBar() {
  const { me } = useMe()
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  if (!me || !(pathname.startsWith('/dashboard') || pathname === '/settings' || pathname === '/steward')) return null
  const tabs = [
    { to: '/dashboard', label: 'Sources', match: (p: string) => p === '/dashboard' || p.startsWith('/dashboard/sources') },
    { to: '/dashboard/events', label: 'Events', match: (p: string) => p.startsWith('/dashboard/events') || p.startsWith('/dashboard/audience') },
    { to: '/dashboard/confirmations', label: 'To confirm', match: (p: string) => p.startsWith('/dashboard/confirmations') },
    { to: '/settings', label: 'Settings', match: (p: string) => p.startsWith('/settings') },
  ]
  return (
    <nav aria-label="Your events" className="host-tabs">
      <ul className="mx-auto flex max-w-[1200px] gap-1 px-4">
        {tabs.map((t) => {
          const active = t.match(pathname)
          return (
            <li key={t.to}>
              <Link to={t.to} className={`block px-3 py-3 text-sm no-underline sm:rounded-[var(--r-sm)] sm:py-1.5 ${active ? 'font-semibold text-ink sm:bg-surface-2' : 'text-ink-soft'}`} aria-current={active ? 'page' : undefined}>
                {t.label}
              </Link>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
