/**
 * Take this calendar with you.
 *
 * Every calendar app subscribes to the same `.ics` URL; what differs is only how you
 * hand it over. Google wants the URL as a query parameter on an "add by URL" page,
 * Outlook the same, and Apple Calendar reads `webcal://`, which is the identical URL
 * under a scheme macOS and iOS route to the Calendar app.
 *
 * The URL carries whatever the visitor has filtered to, so "subscribe" means "keep
 * sending me this, the way I have it now" rather than "send me everything".
 */
import { useState } from 'react'
import { Sheet } from './Sheet'
import { Icon } from './Icon'

export interface SubscribeProps {
  /** The feed path, e.g. `/api/public/regions/boulder/calendar.ics?category=music`. */
  path: string
  /** What the subscription is, in the reader's words: "music in Boulder". */
  what: string
}

function absolute(path: string): string {
  return typeof window === 'undefined' ? path : new URL(path, window.location.origin).toString()
}

export function SubscribeMenu({ path, what }: SubscribeProps) {
  const [open, setOpen] = useState(false)
  const [copied, setCopied] = useState(false)
  const [copyFailed, setCopyFailed] = useState(false)
  const url = absolute(path)
  const webcal = url.replace(/^https?:/, 'webcal:')

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
      setCopyFailed(false)
      window.setTimeout(() => setCopied(false), 2000)
    } catch {
      // Clipboard access can be refused; the link below is still selectable by hand.
      setCopied(false)
      setCopyFailed(true)
    }
  }

  return (
    <div className="relative">
      <button type="button" className="btn" aria-expanded={open} aria-haspopup="dialog" onClick={() => setOpen((o) => !o)}>
        <Icon name="calendar" />Subscribe to calendar
      </button>
      <Sheet open={open} onClose={() => setOpen(false)} title="Add to your calendar">
            <p className="text-ink-soft">
              Your calendar app will check back for {what} a few times a day. Nothing is sent to us when it does.
            </p>
            <div className="mt-3 grid gap-2">
              <a className="btn justify-start" href={webcal}>
                Apple Calendar
              </a>
              <a className="btn justify-start" href={`https://calendar.google.com/calendar/r?cid=${encodeURIComponent(webcal)}`} target="_blank" rel="noreferrer noopener">
                Google Calendar
              </a>
              <a className="btn justify-start" href={`https://outlook.live.com/calendar/0/addfromweb?url=${encodeURIComponent(url)}&name=${encodeURIComponent(what)}`} target="_blank" rel="noreferrer noopener">
                Outlook
              </a>
              <button type="button" className="btn justify-start" onClick={() => void copy()}>
                {copied ? 'Link copied' : 'Copy the link'}
              </button>
            </div>
            <p className="mt-3 text-xs text-ink-faint">
              Anything else that reads iCalendar works too: paste{' '}
              <a className="underline underline-offset-2" href={url}>
                this link
              </a>
              .
            </p>
        <p role="status" className="hint">{copied ? 'Calendar link copied.' : copyFailed ? 'Copying is unavailable. Select and copy the address below.' : ''}</p>
        <label className="field"><span>Calendar subscription address</span><input className="input text-sm" value={url} readOnly onFocus={(e) => e.target.select()} /></label>
      </Sheet>

    </div>
  )
}
