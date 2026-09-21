/**
 * PRD 8.4, at the point of choice. Access control, not secrecy. Never the words
 * encrypted, secret or anonymous.
 */
export function HonestTermsNotice() {
  return (
    <div className="notice" role="note" data-testid="honest-terms">
      <p className="font-medium">What this does, and what it does not</p>
      <p className="mt-1">
        This controls who is shown the event. It is not a locked box. The people who run this directory can always read it, the servers that host guests&rsquo; accounts can read what those guests write, and removing someone can take up to two hours to take full effect everywhere.
      </p>
    </div>
  )
}

export function PublishingNotice() {
  return (
    <p className="text-sm text-ink-soft" data-testid="publishing-notice">
      Publishing is public and permanent: deletes propagate, but copies others made cannot be recalled.{' '}
      <a href="/about/publishing" className="underline underline-offset-2">
        How that works
      </a>
    </p>
  )
}
