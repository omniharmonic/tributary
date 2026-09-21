/**
 * Extraction (architecture §12): one structured-output schema for flyers, PDFs, free
 * text and unstructured pages. Rules the prompt and the post-processor enforce: a date
 * without a year resolves to the next future occurrence and is flagged; the timezone
 * defaults to the host's region, never UTC; recurrence is never published without the
 * host seeing the next three dates. Everything here lands in the confirmation queue;
 * nothing extracted publishes without a person (F10).
 */
import Anthropic from '@anthropic-ai/sdk'
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod'
import { DateTime } from 'luxon'
import rrulePkg from 'rrule'
import { z } from 'zod'
import type { RawEvent } from '@tributary/event-model'
import { config } from '../config.js'
import { httpClient } from './http-client.js'
import { ApiError } from '../http/context.js'
import { describeError, log } from './logging.js'

// rrule ships CommonJS; the default import is the module object.
const { RRule } = rrulePkg
type RRuleT = InstanceType<typeof RRule>

const Field = z.object({ value: z.string().nullable(), confidence: z.number().min(0).max(1), evidence: z.string().nullable() })

const Extraction = z.object({
  events: z.array(
    z.object({
      name: Field,
      dateText: Field,
      startIso: Field,
      endIso: Field,
      timezone: Field,
      recurrenceText: Field,
      rrule: Field,
      venue: Field,
      address: Field,
      price: Field,
      url: Field,
      description: Field,
      organizer: Field,
      yearWasMissing: z.boolean(),
    }),
  ),
  notes: z.array(z.string()),
})

export type ExtractionResult = z.infer<typeof Extraction>

export interface ExtractedEvent {
  raw: RawEvent
  confidence: Record<string, number>
  evidence: Record<string, string>
  flags: string[]
  nextDates?: string[]
}

export interface ExtractInput {
  kind: 'text' | 'flyer' | 'page' | 'email'
  text?: string
  url?: string
  file?: { name: string; mime: string; bytes: Buffer }
}

function systemPrompt(tz: string, now: string): string {
  return `You extract community event listings into a fixed JSON shape. Today is ${now} in ${tz}.
Rules:
- One entry per distinct event. Do not invent events that are not in the material.
- startIso/endIso: ISO 8601 with the local offset for ${tz}. If the year is missing, use the next future occurrence and set yearWasMissing true.
- timezone: an IANA zone; default to ${tz} when the material does not say. Never UTC unless stated.
- recurrenceText: the recurrence exactly as written ("first Saturdays 10-1"); rrule: an RFC 5545 RRULE string for it (e.g. FREQ=MONTHLY;BYDAY=1SA) or null.
- venue and address separately; url for RSVP/tickets; price as written or "Free".
- Every field carries a confidence 0..1 and the exact evidence text it came from (or null).
- Never include attendee names, personal phone numbers or personal emails in any field.`
}

async function inputBlocks(input: ExtractInput): Promise<Anthropic.MessageParam['content']> {
  const blocks: Anthropic.ContentBlockParam[] = []
  if (input.file) {
    const mime = input.file.mime.toLowerCase()
    if (mime === 'application/pdf') {
      blocks.push({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: input.file.bytes.toString('base64') } })
    } else if (['image/jpeg', 'image/png', 'image/gif', 'image/webp'].includes(mime)) {
      blocks.push({ type: 'image', source: { type: 'base64', media_type: mime as 'image/jpeg', data: input.file.bytes.toString('base64') } })
    } else {
      throw new ApiError(400, 'InvalidInput', 'Please upload an image or a PDF.')
    }
  }
  let text = input.text ?? ''
  if (input.url && !text) {
    const res = await httpClient().getPage(input.url)
    // Readability-lite: strip tags and scripts, keep the visible text.
    text = res
      .text()
      .replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/\s+/g, ' ')
      .slice(0, 40_000)
  }
  if (text.trim()) blocks.push({ type: 'text', text: `Material:\n\n${text.slice(0, 60_000)}` })
  else if (blocks.length === 0) throw new ApiError(400, 'InvalidInput', 'Nothing to extract from.')
  blocks.push({ type: 'text', text: 'Extract every event in the material.' })
  return blocks
}

export async function extractEvents(input: ExtractInput): Promise<{ events: ExtractedEvent[]; notes: string[] }> {
  const c = config()
  if (!c.EXTRACT_MODEL_API_KEY) {
    throw new ApiError(400, 'SourceUnsupported', 'Reading flyers and free text is not switched on for this directory yet. Paste a calendar link, or add the event with the form.')
  }
  const client = new Anthropic({ apiKey: c.EXTRACT_MODEL_API_KEY })
  const now = DateTime.now().setZone(c.REGION_TZ)
  let parsed: ExtractionResult | null = null
  try {
    const response = await client.messages.parse({
      model: c.EXTRACT_MODEL,
      max_tokens: 8000,
      system: systemPrompt(c.REGION_TZ, now.toFormat('cccc, LLLL d, yyyy')),
      messages: [{ role: 'user', content: await inputBlocks(input) }],
      output_config: { format: zodOutputFormat(Extraction) },
    })
    parsed = response.parsed_output
  } catch (err) {
    if (err instanceof ApiError) throw err
    log.warn('extraction failed', { detail: describeError(err) })
    throw new ApiError(502, 'Internal', 'We could not read that right now. Try again, or add the event with the form.')
  }
  if (!parsed) throw new ApiError(502, 'Internal', 'We could not make sense of that. Try the form instead.')

  const events: ExtractedEvent[] = []
  for (const [i, e] of parsed.events.entries()) {
    const name = e.name.value?.trim()
    if (!name) continue
    const tz = e.timezone.value && DateTime.local().setZone(e.timezone.value).isValid ? e.timezone.value : c.REGION_TZ
    const flags: string[] = []
    if (e.yearWasMissing) flags.push('year')
    if (!e.timezone.value) flags.push('timezone')
    let start = e.startIso.value ? DateTime.fromISO(e.startIso.value, { setZone: true }) : null
    if (!start?.isValid) {
      flags.push('date')
      start = null
    }
    let nextDates: string[] | undefined
    let rrule: RRuleT | undefined
    if (e.rrule.value) {
      try {
        rrule = RRule.fromString(e.rrule.value.replace(/^RRULE:/, ''))
        flags.push('recurrence')
        const from = start ? start.toJSDate() : now.toJSDate()
        const dates: string[] = rrule.between(from, new Date(from.getTime() + 180 * 86_400_000), true).slice(0, 3).map((d: Date) => d.toISOString())
        nextDates = dates
        if (!start && dates[0]) start = DateTime.fromISO(dates[0], { zone: tz })
      } catch {
        flags.push('recurrence-unparsed')
      }
    }
    if (!start) start = now.plus({ days: 7 }).set({ hour: 18, minute: 0, second: 0, millisecond: 0 })
    const end = e.endIso.value ? DateTime.fromISO(e.endIso.value, { setZone: true }) : null
    const confidence: Record<string, number> = {}
    const evidence: Record<string, string> = {}
    for (const [k, f] of Object.entries(e)) {
      if (typeof f === 'object' && f && 'confidence' in f) {
        confidence[k] = (f as { confidence: number }).confidence
        const ev = (f as { evidence: string | null }).evidence
        if (ev) evidence[k] = ev
      }
    }
    const raw: RawEvent = {
      externalId: `x_${Date.now().toString(36)}_${i}`,
      name,
      description: e.description.value ?? undefined,
      start: start.toISO()!,
      end: end?.isValid ? end.toISO()! : undefined,
      tz,
      location: [e.venue.value, e.address.value].filter(Boolean).join(', ') || undefined,
      url: e.url.value ?? undefined,
      organizerName: e.organizer.value ?? undefined,
      priceText: e.price.value ?? undefined,
      extra: { recurrenceText: e.recurrenceText.value, rrule: e.rrule.value, dateText: e.dateText.value },
    }
    events.push({ raw, confidence, evidence, flags, nextDates })
  }
  return { events, notes: parsed.notes }
}

/** Expand a confirmed recurring extraction into occurrences for the next 90 days. */
export function expandConfirmed(raw: RawEvent, until = new Date(Date.now() + 90 * 86_400_000)): RawEvent[] {
  const rule = raw.extra?.rrule
  if (typeof rule !== 'string' || !rule) return [raw]
  try {
    const r = RRule.fromString(rule.replace(/^RRULE:/, ''))
    const start = new Date(raw.start)
    const dur = raw.end ? new Date(raw.end).getTime() - start.getTime() : 0
    const dates = r.between(new Date(start.getTime() - 1), until, true).slice(0, 60)
    const tz = raw.tz ?? config().REGION_TZ
    return dates.map((d: Date) => {
      const s = DateTime.fromJSDate(d).setZone(tz).set({ hour: DateTime.fromJSDate(start).setZone(tz).hour, minute: DateTime.fromJSDate(start).setZone(tz).minute })
      return { ...raw, occurrence: s.toUTC().toISO()!, start: s.toISO()!, end: dur ? s.plus({ milliseconds: dur }).toISO()! : undefined, seriesKey: raw.externalId }
    })
  } catch {
    return [raw]
  }
}
