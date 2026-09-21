/**
 * The detect match that produced a preview, kept in memory so a Google Sheet column
 * change can re-run the preview with a corrected mapping. Sibling of pending-file.ts:
 * files carry the bytes, matches carry the hint. Lost on reload by design.
 */
import type { DetectMatch } from './types'

const matches = new Map<string, DetectMatch>()

export function keepPendingMatch(previewId: string, match: DetectMatch | undefined): void {
  if (match) matches.set(previewId, match)
}

export function pendingMatch(previewId: string): DetectMatch | undefined {
  return matches.get(previewId)
}

/** A re-run gets a new preview id; carry the match across so the next change still works. */
export function movePendingMatch(from: string, to: string, next?: DetectMatch): void {
  const m = next ?? matches.get(from)
  if (m) matches.set(to, m)
}
