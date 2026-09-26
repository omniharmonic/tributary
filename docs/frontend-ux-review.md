# Frontend UX review and polish

Date: September 26, 2026

## Scope and design direction

The console serves two audiences: neighbors finding events, and hosts connecting and managing existing calendars. The API, publishing pipeline, ownership model, and visibility rules remain the foundation. This pass focuses on the React console and its interactions.

The visual direction is a Boulder field guide. The week remains useful content rather than decorative artwork; dates, places, and host actions carry the hierarchy. The initial idea of adding more decorative mountain artwork was dropped in favor of giving the actual week and map more room.

- Glacier ground `#f3f7f9`, white surfaces `#ffffff`, lake ink `#203e4b`, blue actions `#245a73`, evergreen locations `#347465`, pale rules `#d6e3e9`.
- Avenir Next/Avenir with system fallbacks for interface text; Iowan/Palatino for the discovery headline and dates. No additional font requests or dependencies.
- Desktop: left-aligned introduction and week side by side; search and filters in one coherent area; dates alongside event cards. The map and place browser share one workspace.
- Phone: compact introduction and week; horizontally scrollable filters; stacked map and place browser; native dialogs become bottom sheets.
- Explicit selected states, visible focus, meaningful empty/error states, and reduced-motion-aware map movement. Existing dark-mode tokens have matching blue surfaces and actions.

## Findings and changes

| Flow | Finding | Change |
| --- | --- | --- |
| Public navigation | Signed-in account controls truncated the brand and crowded discovery. | Separate public navigation from management tabs; account switcher stays in management views. |
| Discovery | Search, dates, categories, and view controls competed with one another. | Clear search area, icon-labeled view switcher, calmer category rail, result heading/count, stronger date/card hierarchy. |
| Search / browser history | The text input could retain a cleared or previous URL query. | Synchronize input with URL search and clear it with filters. |
| Empty results | An empty search primarily invited visitors to publish events. | Offer a direct way to clear filters and explore again. |
| Calendar day selection | Selecting a day queried only that day, erasing the rest of the month; an empty result hid the calendar entirely. | Query the full visible grid, keep navigation visible, show selected-day results separately. |
| Calendar navigation | Time chips could appear selected while the calendar ignored them; week counts could inherit the displayed month's range. | Make date-range/view transitions explicit, align week selection to its month, fetch week counts separately from calendar counts. |
| Small-screen calendar | Event names disappeared without a clear numeric replacement. | Visible day totals, accessible full labels, current-month shortcut. |
| Near me | Geolocation failures were silent and the radius was fixed. | Actionable permission/unavailable messages and a distance selector. |
| Map pins | Pins navigated away immediately; overlapping events could trigger a place-name search or remain trapped in a cluster. | Group exact coordinates into selectable places and show every event at that place beside the map. |
| Map state | A changing callback could reframe the map on unrelated rerenders; initial loading could clear a venue selection. | Stable data-driven framing, explicit reset, latest React selection state, selection preserved through map loading. |
| Map accessibility | The canvas was the only way to interact with locations. | Equivalent keyboard-operable place list, focused detail headings, explicit links to event pages. |
| Map completeness / failure | Events without coordinates were only counted; a failed basemap blocked browsing. | Browse unplaced events directly; keep place/event results usable during failure; retry the map without reloading the page. |
| Map gestures | Page scrolling and map movement competed. | Cooperative gestures, zoom buttons, clear map legend, responsive resize handling. |
| Result pagination | Map and calendar had no way to fetch the next page. | Expose load-more in every view and indicate when more results exist. |
| Publishing | The add → preview → publish sequence lacked orientation; Enter submitted descriptions unexpectedly. | Shared progress indicator, explicit preview action, multiline input, Ctrl/Cmd+Enter shortcut. |
| After publishing | Cached management lists could omit a newly connected source. | Invalidate sources and confirmations before returning to management. |
| Subscription | Popup lacked native dialog focus handling; host subscriptions only offered a webcal link. | Shared native dialog for directory and hosts, Apple/Google/Outlook choices, selectable URL, clipboard feedback/fallback. |
| Event and host details | Network failures were presented as missing pages. | Reserve not-found for 404; expose retry for other failures. Add event-page return navigation. |
| Host page on phones | Event cards could force their grid beyond the viewport. | Allow nested grid items/cards to shrink; wrap long handles. |
| Sign-in | Missing verification tokens spun forever; sign-in welcome copy incorrectly claimed events were publishing. | Recovery link for missing tokens and accurate welcome copy. |
| Account creation | Handle/domain layout squeezed the editable name on phones. | Wrapping handle layout and clearer form spacing. |
| Source management | Sync action had little immediate feedback. | Pending label and queued confirmation; consistent source panels and error presentation. |
| Viewer accounts | Some management screens offered edits that the viewer role cannot perform. | Disable source settings, event overrides, guest mutations, and confirmation actions for read-only accounts. |
| Guest links | Raw policy code occupied the main flow; copy and some failures were silent; number minimums were not enforced by button submission. | Plain-language summary, copy feedback, request/revocation errors, pending guards, positive-integer validation. |
| Settings | Key/revocation/rotation failures were not surfaced. | Visible errors, pending states, rotation success feedback. |
| Shared dialogs | Dialogs lacked associated titles and dependable responsive positioning. | Native labeled dialogs with centered desktop and bottom-sheet phone presentation. |

## Verification

Browser checks used `VITE_MOCK_API=1`, so host mutations affected only in-memory fixtures. Public maps used the existing backend basemap handler running alone locally, fetching actual provider tiles. The production proxy initially failed with a TLS error; replacing that preview dependency with the local handler verified the actual map without changing production.

Verified interactively:

- Desktop discovery and phone layouts; search → empty results → clear filters.
- List/calendar/map switching; selecting an empty calendar day preserves the other days and month navigation.
- Basemap loading, direct pin selection, shared-address event preview, reset, and unplaced events.
- Phone map selection and scrollable event details; selection survives initial map loading.
- Directory subscription dialog, calendar choices, Escape dismissal, host subscription entry.
- Source link → detection → preview → demo publication → dashboard.
- Source sync feedback, pause/resume, rules/history view, and viewer-role disabled controls.
- Event ledger → override dialog, responsive bottom sheet, guest management view.
- Confirmation queue, account settings, account form/handle layout, steward review, expired invitation recovery.
- Event details → report dialog → host profile; missing-token recovery; demo email sign-in → verification → dashboard.
- Horizontal-overflow checks on discovery, host profiles, source management, guest management, settings, account creation, and steward views at phone width.

Automated coverage includes existing console tests plus regressions for full-month calendar queries, empty-day navigation, URL/search synchronization, unavailable geolocation, shared map coordinates, invalid coordinates, multiline input, selection during map loading, and avoiding refits on unrelated rerenders.

Commands: `pnpm --filter @tributary/console test`, `pnpm --filter @tributary/console typecheck`, `pnpm --filter @tributary/console build`, and `pnpm hygiene`.

## Boundaries and follow-up validation

Live OAuth, real email delivery, production publishing/unpublishing, guest invitation delivery, API key changes, destructive account actions, and external calendar-app installation were not executed. CSV/upload paths and legal/informational pages were reviewed in source; file selection is covered by the existing OneBox test. No production deployment was performed.

The build still reports the existing large MapLibre chunk and mixed static/dynamic imports of `Misc.tsx`. MapLibre remains lazy-loaded. Dark-mode styling is included, but OS-level dark-mode switching was not part of browser verification.
