import { Link, useRouterState } from '@tanstack/react-router'
import type { ReactNode } from 'react'
import { useActing, useConfig, useLogout, useManaged, useMe } from '../lib/queries'
import { TabBar } from './TabBar'

export function Flatirons({ className = '' }: { className?: string }) {
  return (
    <img src="/brand/boulder-events-mark.png" width="64" height="40" className={`flatirons-mark ${className}`} alt="" aria-hidden="true" />
  )
}

/**
 * Organisation roles (F29): a person with a role on another host can act as it for the
 * length of this tab. Only rendered when there is something to switch to.
 */
export function AccountSwitcher() {
  const { me } = useMe()
  const managed = useManaged()
  const { actingId, setActing } = useActing()
  if (!me || managed.length === 0) return null
  return (
    <label className="inline-flex items-center gap-1 text-sm">
      <span className="sr-only">Account</span>
      <select className="input py-1 text-sm" value={actingId ?? ''} onChange={(e) => setActing(e.target.value || null)} aria-label="Act as">
        <option value="">Your account · {me.host.displayName}</option>
        {managed.map((h) => (
          <option key={h.id} value={h.id}>
            {h.displayName} · {h.role}
          </option>
        ))}
      </select>
    </label>
  )
}

export function ActingBanner() {
  const { acting, setActing } = useActing()
  if (!acting) return null
  return (
    <div className="border-b border-rule bg-surface-2" role="status">
      <div className="mx-auto flex max-w-[1200px] flex-wrap items-center justify-between gap-2 px-4 py-1.5 text-sm">
        <span>
          Managing <strong>{acting.displayName}</strong> as {acting.role}
          {acting.role === 'viewer' ? ' (read only)' : ''}
        </span>
        <button type="button" className="btn btn-quiet btn-sm" onClick={() => setActing(null)}>
          Back to your account
        </button>
      </div>
    </div>
  )
}

export function Header() {
  const cfg = useConfig()
  const { me } = useMe()
  const logout = useLogout()
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  const managing = pathname.startsWith('/dashboard') || pathname === '/settings' || pathname === '/steward'
  return (
    <header className="site-header">
      <div className="header-inner">
        <Link to="/" className="brand" aria-label={cfg.brand}>
          <span className="brand-mark"><Flatirons /></span>
          <span><strong>{cfg.region.name} Events</strong><span className="brand-subtitle">A community calendar</span></span>
        </Link>
        <nav aria-label="Site" className="site-nav">
          <Link to="/" className="nav-link hidden sm:inline-flex" aria-current={pathname === '/' ? 'page' : undefined}>Explore</Link>
          {me ? <Link to="/dashboard" className="nav-link" aria-current={managing ? 'page' : undefined}>Your sources</Link> : <Link to="/login" className="nav-link">Sign in</Link>}
          {me ? <button type="button" className="nav-link hidden sm:inline-flex" disabled={logout.isPending} onClick={() => logout.mutate()}>{logout.isPending ? 'Signing out…' : 'Sign out'}</button> : null}
          <Link to="/add" className="btn btn-primary header-add"><span className="hidden sm:inline">Add your events</span><span className="sm:hidden">Add events</span></Link>
        </nav>
      </div>
      {logout.error ? <p className="notice notice-warn" role="alert">Sign out failed. Please try again.</p> : null}
      {managing ? <div className="account-bar"><AccountSwitcher /><button type="button" className="btn btn-quiet btn-sm sm:hidden" onClick={() => logout.mutate()} disabled={logout.isPending}>Sign out</button></div> : null}
      <ActingBanner />
      <TabBar />
    </header>
  )
}

export function Page({ title, lede, children, wide }: { title?: ReactNode; lede?: ReactNode; children: ReactNode; wide?: boolean }) {
  return (
    <main id="main" className={`page ${wide ? 'page-wide' : ''}`}>
      {title ? (
        <div className="page-heading">
          <h1>{title}</h1>
          {lede ? <p className="max-w-[60ch] text-ink-soft">{lede}</p> : null}
        </div>
      ) : null}
      {children}
    </main>
  )
}

export function Footer() {
  const cfg = useConfig()
  const { me } = useMe()
  return (
    <footer className="mt-12 border-t border-rule">
      <div className="mx-auto flex max-w-[1200px] flex-wrap gap-x-5 gap-y-1 px-4 py-6 text-sm text-ink-soft">
        <span>
          {cfg.brand}, run by neighbours. Events stay with the people who host them.
        </span>
        <Link to="/about/publishing">How publishing works</Link>
        <Link to="/about/crawler">About our crawler</Link>
        <Link to="/legal/terms">Terms</Link>
        <Link to="/legal/privacy">Privacy</Link>
        <Link to="/about/bookmarklet">Bookmarklet</Link>
        {me ? <Link to="/steward">Steward</Link> : null}
      </div>
    </footer>
  )
}
