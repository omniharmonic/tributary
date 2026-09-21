# ICS golden corpus (F5)

Hand-written and sanitized feeds covering the hard cases in architecture §4.2. Each
`<name>.ics` has `expected/<name>.json`: the hand-checked `RawEvent[]` produced by
`parseIcs` for `now = 2026-09-21T00:00:00Z`, window −1 day … +90 days, default zone
`America/Denver`. `packages/connectors/test/ics-corpus.test.ts` compares them and also
asserts the specific rule each fixture exists for, so regenerating the JSON cannot hide a
regression.

| Fixture | Rule under test |
|---|---|
| google-recurring-with-exceptions | RRULE + UNTIL, EXDATE, RECURRENCE-ID moved instance, cancelled instance, DST fall-back offsets, `UID#occurrence` identity |
| google-basic | UTC times + X-WR-TIMEZONE, window filtering (past and far-future dropped), observed window |
| outlook-windows-tz | Windows TZID names and display-name X-WR-TIMEZONE mapped to IANA, per-event TZID wins |
| icloud | VTIMEZONE without X-WR-TIMEZONE, URL;VALUE=URI, open-ended monthly recurrence |
| wordpress-x-alt-desc | X-ALT-DESC html over DESCRIPTION, ATTACH image, ORGANIZER CN, CATEGORIES, GEO |
| tockify-featured-image | X-TKF-FEATURED-IMAGE |
| all-day-multiday | VALUE=DATE single, multi-day, no DTEND, recurring all-day |
| floating-times | floating times with no zone anywhere → `tz` undefined; UTC with no feed zone |
| class-private | CLASS PUBLIC/PRIVATE/CONFIDENTIAL → sourcePrivacy; ATTENDEE never surfaces; conference link not taken as the event URL |
| cancelled-and-sequence | STATUS:CANCELLED, SEQUENCE carried, TENTATIVE ignored |
| luma-calendar | Luma feed shape (UTC, ORGANIZER CN, GEO, short-slug URL from the description) |
| meetup-group | Meetup feed shape (TZID, `event_<id>@meetup.com`, URL) |
| malformed-line | a stray non-content line and a bad DTSTART: only those events drop, `complete` is false |

Regenerate after a deliberate parser change with
`npx tsx .scratch/gen-expected.mts` from `packages/connectors` — then re-read the diff.
