import type { ApiErrorBody, ErrorCode } from './types'

export class ApiError extends Error {
  constructor(
    readonly code: ErrorCode | string,
    message: string,
    readonly status: number,
    readonly body?: unknown,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

/** Plain-language text for a code, in the interface's voice. The server's own message wins when it is specific. */
const PLAIN: Record<string, string> = {
  InvalidInput: 'That does not look right. Check the details and try again.',
  NotFound: 'Nothing is here.',
  Unauthorized: 'Sign in to continue.',
  Forbidden: 'This account cannot do that.',
  RateLimited: 'Too many tries in a row. Wait a minute and try again.',
  SourceUnreachable: 'We could not reach that calendar. Check that the link is public.',
  SourceUnsupported: 'That kind of link is not supported yet. Try forwarding an email, dropping a file, or describing the event.',
  NeedsConfirmation: 'Confirm the details before this can be published.',
  Conflict: 'This source is already connected by another host. If it is yours, claim it from the event page.',
  PdsRejected: 'The account server refused that. Try a different handle.',
  Internal: 'Something broke on our side. Try again in a moment.',
  Network: 'You seem to be offline. Try again when you have a connection.',
}

/** Source-level error states (F21), which read differently from request errors. */
export const SOURCE_ERROR_TEXT: Record<string, string> = {
  SourceUnreachable: 'Your calendar is no longer public, or the link changed.',
  NotFound: 'The calendar link no longer exists at the source.',
  Gone: 'The calendar link no longer exists at the source.',
  Forbidden: 'The source is refusing our requests. Check its sharing settings.',
  RateLimited: 'The source is asking us to slow down. We will retry later.',
  Unparseable: 'The feed came back in a form we could not read.',
  TooLarge: 'The feed is too large to read in one go.',
  Network: 'We could not connect to the source.',
  Other: 'The last sync failed. We will keep trying.',
}

export function plainError(err: unknown): string {
  if (err instanceof ApiError) {
    const generic = PLAIN[err.code]
    if (err.message && err.message !== err.code && err.message.length < 200) return err.message
    return generic ?? err.message ?? 'Something went wrong.'
  }
  if (err instanceof Error) return err.message
  return 'Something went wrong.'
}

export function isApiErrorBody(v: unknown): v is ApiErrorBody {
  return !!v && typeof v === 'object' && typeof (v as ApiErrorBody).error === 'string'
}
