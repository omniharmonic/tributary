#!/usr/bin/env node
/**
 * The Tributary MCP server (B3): a thin client of the HTTP API so any agent can
 * publish events for its owner. Authenticated by a per-host API key.
 *
 *   TRIBUTARY_URL=https://tributary.freeskool.directory TRIBUTARY_API_KEY=tb_… tributary-mcp
 *
 * Tools: add_source, publish_event, list_my_events, update_event, cancel_event, list_sources.
 * Every tool honours the narrowing rule: a `visibility` more open than the current one
 * waits for the host's confirmation in the console.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'

const BASE = (process.env.TRIBUTARY_URL ?? 'http://localhost:4100').replace(/\/$/, '')
const KEY = process.env.TRIBUTARY_API_KEY ?? ''

async function api(method: string, path: string, body?: unknown): Promise<unknown> {
  if (!KEY) throw new Error('TRIBUTARY_API_KEY is not set. Create a key in the console under Settings → API keys.')
  const res = await fetch(`${BASE}/api${path}`, { method, headers: { authorization: `Bearer ${KEY}`, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined })
  const text = await res.text()
  let json: unknown
  try {
    json = JSON.parse(text)
  } catch {
    json = { raw: text }
  }
  if (!res.ok) {
    const e = json as { error?: string; message?: string }
    throw new Error(`${e.error ?? res.status}: ${e.message ?? text.slice(0, 200)}`)
  }
  return json
}

const Visibility = z.enum(['public', 'unlisted', 'gated', 'members', 'invite', 'held'])

const EventInput = {
  externalId: z.string().describe('Your stable id for this event; the same id updates it.'),
  name: z.string(),
  start: z.string().describe('ISO 8601 start, with offset or as local wall-clock time in tz'),
  end: z.string().optional(),
  tz: z.string().optional().describe('IANA zone, e.g. America/Denver'),
  allDay: z.boolean().optional(),
  description: z.string().optional().describe('Markdown or plain text'),
  location: z.string().optional().describe('Venue and address as one line'),
  url: z.string().optional().describe('Where people RSVP or read more'),
  imageUrl: z.string().optional(),
  organizerName: z.string().optional(),
  priceText: z.string().optional(),
  tags: z.array(z.string()).optional(),
  category: z.string().optional(),
  visibility: Visibility.optional().describe('Defaults to public. More-open changes wait for the host to confirm.'),
  audience: z.object({ group: z.string().optional(), minRole: z.number().optional(), inviteListId: z.string().optional(), approval: z.enum(['open', 'approval']).optional() }).optional(),
  gatedFields: z.array(z.enum(['exactLocation', 'joinUrl', 'attendeeNotes', 'contacts'])).optional(),
}

const server = new McpServer({ name: 'tributary', version: '0.1.0' })

server.registerTool('publish_event', { description: 'Publish (or update, by externalId) one event to the host\'s AT Protocol repo through Tributary. Structured input publishes at once; the source stays the truth.', inputSchema: EventInput }, async (input) => {
  const r = await api('POST', '/v1/events', input)
  return { content: [{ type: 'text', text: JSON.stringify(r, null, 2) }] }
})

server.registerTool('update_event', { description: 'Update an event by externalId (same fields as publish_event).', inputSchema: EventInput }, async (input) => {
  const r = await api('PUT', `/v1/events/${encodeURIComponent(input.externalId)}`, input)
  return { content: [{ type: 'text', text: JSON.stringify(r, null, 2) }] }
})

server.registerTool('cancel_event', { description: 'Cancel an event by externalId. It shows as cancelled now and is removed after the grace period.', inputSchema: { externalId: z.string(), hard: z.boolean().optional().describe('Delete immediately instead of the grace period') } }, async ({ externalId, hard }) => {
  const r = await api('DELETE', `/v1/events/${encodeURIComponent(externalId)}${hard ? '?hard=1' : ''}`)
  return { content: [{ type: 'text', text: JSON.stringify(r, null, 2) }] }
})

server.registerTool('list_my_events', { description: 'List the host\'s published events (the ledger): state, visibility, card, record URI.', inputSchema: {} }, async () => {
  const r = await api('GET', '/v1/events')
  return { content: [{ type: 'text', text: JSON.stringify(r, null, 2) }] }
})

server.registerTool('add_source', { description: 'Connect a calendar the host already publishes (Google Calendar, Luma, Meetup, an .ics link, a WordPress or Squarespace events page). Tributary detects the kind of source and keeps it in sync.', inputSchema: { input: z.string().describe('A URL'), defaultVisibility: Visibility.optional() } }, async ({ input, defaultVisibility }) => {
  const r = await api('POST', '/v1/sources', { input, defaultVisibility })
  return { content: [{ type: 'text', text: JSON.stringify(r, null, 2) }] }
})

server.registerTool('list_sources', { description: 'List connected sources with their sync status.', inputSchema: {} }, async () => {
  const r = await api('GET', '/sources')
  return { content: [{ type: 'text', text: JSON.stringify(r, null, 2) }] }
})

const transport = new StdioServerTransport()
await server.connect(transport)
