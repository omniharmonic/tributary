# Ecosystem messages (drafts for Benjamin to send)

Plan §6 and §10 name two messages for week 0. Drafts below; facts reflect what is live on 2026-09-21.

## To flo-bit (atmo.rsvp)

Subject: An open events importer that writes atmo-shaped records, and a regional skin of atmo

Hi — I'm Benjamin, from Techne in Boulder. We've built Tributary, an open adapter that publishes community events from wherever they already live (Google Calendar, Luma, Meetup, Eventbrite, WordPress, Squarespace, Localist, Mobilize, feeds, spreadsheets, flyers, email) as `community.lexicon.calendar.event` records in a repo the host owns. The records follow atmo's writer field for field — inline `media` with `role: thumbnail` and `aspect_ratio`, `timezone`, `preferences.showInDiscovery`, `additionalData.externalSource` with `rsvpMode: external_only` — so stock atmo.rsvp renders them completely. Code: https://github.com/omniharmonic/tributary (AGPL for the service, MIT for the event model and connector SDK). It's live for Boulder at https://boulderevents.directory.

Two things we'd like to do with, not around, you:

1. Run a regional skin of atmo rather than another app. We'd send upstream: namespace and branding configurability (your #26), a region filter as configuration, a cancelled state, multiple locations (#45), `rsvpExpected` (#44), an image-URL builder config for a self-hosted proxy, and source-attribution display. Your Luma import bug (#77) goes away if your importer calls our detect/preview API. Tell us plainly what you'd rather we not fork.
2. Permissioned events. We are removing the contrail-0.12 spaces module from our fork (contrail dropped it in 0.13) and replacing it with a client for a small service we run — a Spaces-shaped store with Techne's declarative policies, storage in Postgres for now, real Spaces when the alpha settles. We keep your page states, the vague not-found copy and the invite kinds. We'd offer that client back as an optional backend when you want permissioned events again.

Happy to talk before we open the first PR.

## To the Lexicon Community forum (before the October 1 TSC meeting)

Title: Three optional fields on `community.lexicon.calendar.event` that two apps already write

Two apps (atmo.rsvp and Tributary, an importer that publishes events from existing calendars) already write these undeclared properties on `community.lexicon.calendar.event`, and readers rely on them. We propose declaring them as optional so they stop being conventions:

- `timezone` (string, IANA): `startsAt` carries an offset but not the zone, and "7 pm" on the card needs the zone. Every imported event knows it.
- `media` (array of `{ role, alt?, content: blob, aspect_ratio? }`): a cover image. atmo writes `role: "thumbnail"`; a lexicon-level shape would let readers stop guessing.
- an external-source object (`additionalData.externalSource` today: `platform`, `url`, `rsvpMode`, `externalId`, `method`, `syncedAt`): where an event came from and where RSVP happens. Every importer (discal.dev, OpenMeet, mobilizon-reshare, ours) invents its own version.

Live records showing all three are on `pds.freeskool.directory` (any repo with `createdWith: https://boulderevents.directory`). We'd also like to hear how the community feels about `preferences.showInDiscovery`, which atmo honours and we use for unlisted events.
