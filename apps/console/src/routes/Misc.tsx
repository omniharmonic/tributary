import { Link } from '@tanstack/react-router'
import { useState } from 'react'
import { useConfig } from '../lib/queries'
import { Footer, Page } from '../components/Shell'

/** Deliberately vague: the same page for not-found and not-permitted. */
export function NotFoundRoute() {
  return (
    <>
      <Page title="Nothing is here">
        <p className="max-w-[50ch] text-ink-soft">The link may be old, mistyped, or for something that is not shown here.</p>
        <Link to="/" className="btn mt-4">
          Back to this week
        </Link>
      </Page>
      <Footer />
    </>
  )
}

export function CrawlerRoute() {
  const cfg = useConfig()
  return (
    <>
      <Page title="About our crawler">
        <div className="prose grid gap-3">
          <p>
            {cfg.adapterName} fetches public calendar feeds and event pages that a host has asked us to mirror onto {cfg.brand}. It identifies itself as <code>TributaryBot</code> with a link to this page.
          </p>
          <p>It makes conditional requests, keeps at least a second between requests to the same site, respects <code>robots.txt</code> for page fetches, and never logs in anywhere. Feeds are published interfaces and are read as such.</p>
          <p>
            To stop us fetching a site, block <code>TributaryBot</code> in <code>robots.txt</code> or write to <a href="mailto:hello@freeskool.xyz">hello@freeskool.xyz</a>. Removal requests are honoured within one business day.
          </p>
        </div>
      </Page>
      <Footer />
    </>
  )
}

export function PublishingRoute() {
  const cfg = useConfig()
  return (
    <>
      <Page title="How publishing works">
        <div className="prose grid gap-3">
          <p>When you publish through {cfg.adapterName}, your events become records on the AT Protocol network, in an account that belongs to you. Any app that reads the network can show them. That is the point: one paste, everywhere.</p>
          <p>It also means publishing is public and permanent in a specific way. When you delete an event, the deletion propagates and every well-behaved app removes it. But other people and other services may have made copies, and copies cannot be recalled.</p>
          <p>For anything you would not put on a poster, choose Unlisted, Held, or one of the guest-only levels before you publish.</p>
          <p>Your account is real: you can set a password and take full control, use it in other apps, or move it to another server at any time. Nothing here locks you in.</p>
        </div>
      </Page>
      <Footer />
    </>
  )
}

export function TermsRoute() {
  return (
    <>
      <Page title="Terms of service" lede="Draft. Counsel review pending.">
        <div className="prose grid gap-3">
          <p>By connecting a source you confirm that you are entitled to publish the events it contains, and that you understand publishing is public and permanent.</p>
          <p>We mirror; we do not edit. The source stays the truth. We remove listings on request from anyone who can show they control the source, within one business day.</p>
          <p>We never import attendee lists, guest names, or anything that names a person who did not publish it.</p>
        </div>
      </Page>
      <Footer />
    </>
  )
}

export function PrivacyRoute() {
  return (
    <>
      <Page title="Privacy" lede="Draft. Counsel review pending.">
        <div className="prose grid gap-3">
          <p>We keep your email address to send you sign-in links and notices about your sources. We do not sell it or share it.</p>
          <p>Our logs carry identifiers, not addresses or event text. Extracted events are shown to you for confirmation before anything is published.</p>
          <p>Guest-only events are access-controlled, not encrypted. The people who run this directory can read them; the servers hosting guests&rsquo; accounts can read what those guests write.</p>
        </div>
      </Page>
      <Footer />
    </>
  )
}

/** "Send this page to the directory": a bookmarklet that opens /add with the current page's URL (P8). */
export function bookmarkletCode(origin: string): string {
  return `javascript:(function(){window.open(${JSON.stringify(origin)}+'/add?input='+encodeURIComponent(location.href),'_blank')})();`
}

export function BookmarkletRoute() {
  const cfg = useConfig()
  const origin = typeof window === 'undefined' ? '' : window.location.origin
  const code = bookmarkletCode(origin)
  const [copied, setCopied] = useState(false)
  return (
    <>
      <Page title="Send this page to the directory" lede="A bookmark that opens whatever event page you are looking at in the add box, so a Luma, Meetup or venue page is one click from listed.">
        <div className="grid gap-5">
          <section className="panel grid gap-3 p-4">
            <h2>On a computer</h2>
            <p className="text-ink-soft">Drag this link to your bookmarks bar. Then, on any event or calendar page, click it.</p>
            <p>
              <a href={code} className="btn btn-primary" draggable onClick={(e) => e.preventDefault()} title="Drag me to your bookmarks bar">
                Send to {cfg.brand}
              </a>
            </p>
            <details>
              <summary className="cursor-pointer text-sm text-ink-soft">Or copy the code and make a bookmark by hand</summary>
              <pre className="mt-2 overflow-x-auto rounded bg-surface-2 p-3 text-xs">{code}</pre>
              <button
                type="button"
                className="btn btn-sm mt-2"
                onClick={() => {
                  void navigator.clipboard?.writeText(code).then(() => setCopied(true))
                }}
              >
                {copied ? 'Copied' : 'Copy code'}
              </button>
            </details>
          </section>
          <section className="panel grid gap-2 p-4">
            <h2>On a phone</h2>
            <p className="text-ink-soft">Bookmarklets are awkward on phones. Instead: open the share sheet on the event page, choose Copy link, then paste it on the add page.</p>
            <p>
              <Link to="/add" className="btn">
                Open the add page
              </Link>
            </p>
          </section>
        </div>
      </Page>
      <Footer />
    </>
  )
}
