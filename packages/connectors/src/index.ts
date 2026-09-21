/**
 * Connector registry. The catalogue order is the build order (architecture §4.1).
 * Each module exports one `Connector`; the runtime looks them up by `type`.
 */
import type { Connector, SourceType } from './sdk.js'
import { icsConnector } from './ics/index.js'
import { gcalPublicConnector } from './gcal-public/index.js'
import { lumaConnector } from './luma/index.js'
import { meetupConnector } from './meetup/index.js'
import { tribeConnector } from './tribe/index.js'
import { squarespaceConnector } from './squarespace/index.js'
import { jsonldPageConnector } from './jsonld-page/index.js'
import { uploadConnector } from './upload/index.js'
import { manualConnector } from './manual/index.js'
import { apiConnector } from './api/index.js'
import { sheetConnector } from './sheet/index.js'
import { eventbriteConnector } from './eventbrite/index.js'

export * from './sdk.js'
export { PUSH_SOURCE_TYPES } from './api/index.js'
export * from './ics/parse.js'
export * from './csv.js'
export { extractJsonLdEvents, extractPageMeta } from './jsonld-page/extract.js'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const CONNECTORS: ReadonlyArray<Connector<any, any>> = [
  icsConnector,
  gcalPublicConnector,
  lumaConnector,
  meetupConnector,
  tribeConnector,
  squarespaceConnector,
  jsonldPageConnector,
  uploadConnector,
  manualConnector,
  apiConnector,
  sheetConnector,
  eventbriteConnector,
]

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function connectorFor(type: SourceType): Connector<any, any> {
  const c = CONNECTORS.find((x) => x.type === type)
  if (!c) throw new Error(`no connector for source type ${type}`)
  return c
}
