import { Link } from '@tanstack/react-router'
import type { ReactNode } from 'react'
import { useConfig, useLogout, useMe } from '../lib/queries'
import { TabBar } from './TabBar'

export function Flatirons({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 28" width="40" height="18" className={className} aria-hidden="true">
      <path d="M0 27 L12 6 L20 18 L30 2 L40 16 L48 9 L64 27 Z" fill="currentColor" />
    </svg>
  )
}

export function Header() {
  const cfg = useConfig()
  const { me } = useMe()
  const logout = useLogout()
  return (
    <header className="border-b border-rule bg-ground">
      <div className="mx-auto flex max-w-3xl items-center justify-between gap-3 px-4 py-3">
        <Link to="/" className="flex items-center gap-2 no-underline">
          <Flatirons className="text-ochre" />
          <span className="font-serif text-xl">{cfg.brand}</span>
        </Link>
        <nav aria-label="Site" className="flex items-center gap-1">
          {me ? (
            <>
              <Link to="/dashboard" className="btn btn-quiet btn-sm hidden sm:inline-flex">
                {me.host.displayName}
              </Link>
              <button type="button" className="btn btn-quiet btn-sm" onClick={() => logout.mutate()}>
                Sign out
              </button>
            </>
          ) : (
            <Link to="/login" className="btn btn-quiet btn-sm">
              Sign in
            </Link>
          )}
          <Link to="/add" className="btn btn-primary btn-sm">
            Add your events
          </Link>
        </nav>
      </div>
      <TabBar />
    </header>
  )
}

export function Page({ title, lede, children, wide }: { title?: ReactNode; lede?: ReactNode; children: ReactNode; wide?: boolean }) {
  return (
    <main id="main" className={`mx-auto w-full px-4 py-6 ${wide ? 'max-w-5xl' : 'max-w-3xl'}`}>
      {title ? (
        <div className="mb-5 grid gap-1">
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
  return (
    <footer className="mt-12 border-t border-rule">
      <div className="mx-auto flex max-w-3xl flex-wrap gap-x-5 gap-y-1 px-4 py-6 text-sm text-ink-soft">
        <span>
          {cfg.brand}, run by neighbours. Events stay with the people who host them.
        </span>
        <Link to="/about/publishing">How publishing works</Link>
        <Link to="/about/crawler">About our crawler</Link>
        <Link to="/legal/terms">Terms</Link>
        <Link to="/legal/privacy">Privacy</Link>
      </div>
    </footer>
  )
}
