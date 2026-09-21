# @tributary/connectors — the connector SDK

MIT. One interface, one runtime contract. A connector says what it can do and turns a source into `RawEvent[]`; the runtime (apps/tributary) does everything else: scheduling, politeness, conditional GET, normalising, image recovery, geocoding, visibility, reconciliation and publishing. If you can read a calendar, you can write a connector in an afternoon.

## The interface

```ts
import type { Connector } from '@tributary/connectors'

export const myConnector: Connector<MyConfig, MyCursor> = {
  type: 'my-source',            // add it to SourceType in @tributary/event-model
  platform: 'my-platform',      // the human label on the card ("via My Platform")
  capabilities: {
    live: 'poll',               // poll | push | none
    delta: false,               // supports cursors / sync tokens
    explicitDeletes: false,     // the source tells us about deletions
    images: 'native',           // native | via-page | none
    requiresAuth: 'none',       // none | apiKey | oauth
  },
  defaultInterval: 60 * 60_000, // ms between polls at the default cadence
  detect?(input, ctx),          // cheap: is this pasted thing mine? → DetectMatch | null
  configure(input, ctx),        // resolve a match (or manual config) into durable config
  fetch(cfg, cursor, ctx),      // → { events: RawEvent[], cursor, complete, window?, etag?, lastModified?, notModified?, meta? }
  handlePush?(req, cfg, ctx),   // webhooks, email, bots
  fingerprint(cfg),             // canonical id of the source: claims, conflicts, duplicates
  label(cfg),                   // "Luma calendar OpenCivics"
}
```

`ctx.http` is the only way to the network: an SSRF-safe client with DNS pinning, private-range refusal, per-host politeness, size and time caps, conditional GET and robots.txt for page fetches. Do not import `undici`, `http`, `https` or use global `fetch` in a connector. `ctx.secrets` carries the source's own credentials (encrypted at rest by the runtime). `ctx.window` is the rolling window the runtime wants (90 days ahead, one day back).

## RawEvent

The loosest useful shape (`@tributary/event-model`): `externalId` (stable per source), `name`, `start` (ISO, with an offset when the source gives one, else wall-clock in `tz`), optional `end`, `tz`, `allDay`, `status`, `mode`, `location` (free text) or `locations` (structured), `geo`, `url` (the RSVP target), `imageUrl`, `organizerName`, `priceText`/`isFree`, `tags`, `seriesKey`/`occurrence` for expanded recurrences, `sourcePrivacy` when the source flags an event private, unlisted or members-only.

Rules the runtime relies on:

- **Identity** is `externalId` (+ `occurrence` for recurrences). Keep it stable across fetches; if a source regenerates ids, the runtime detects it and switches to a content hash.
- **`complete: true`** means "this is the full current set inside `window`". Missing-detection (cancel after a grace period, delete after seven days) only happens inside the window you report. If you paged and gave up, say `complete: false`.
- **Never** emit attendee data, personal emails or phone numbers. The normaliser redacts them anyway, but do not read them in the first place.
- **Privacy signals** go in `sourcePrivacy`; the classify stage turns them into a ceiling the host cannot lift by accident.
- **Errors** are `ConnectorError(message, code, retryable)` with a code from `NotFound | Gone | Forbidden | RateLimited | Unparseable | Unsupported | Network | TooLarge | Other`; the console maps codes to plain language.

## Testing

Every connector has tests with a scripted `ctx.http` (see `test/helpers.ts` and `test/mock-http.ts`), and feed-based connectors are pinned by the golden corpus in `fixtures/ics`. `pnpm --filter @tributary/connectors test`.

## Registering

Add the connector to `CONNECTORS` in `src/index.ts`, its `SourceType` to `packages/event-model/src/types.ts`, and (when it is recognisable from a URL) a known-host rule to `packages/detect/src/index.ts` with a fixture in `fixtures/detect/inputs.json`. Add a `describeMatch` label there too.

## Examples to copy

- Feed: `src/ics`, `src/luma`, `src/meetup`
- JSON API, paged: `src/localist`, `src/mobilize`, `src/tribe`
- Token-authenticated API: `src/eventbrite`
- Page scrape with structured data: `src/jsonld-page`
- Spreadsheet: `src/sheet` (uses `src/csv.ts`)
