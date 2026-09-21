/**
 * Telegram bot (P7): a host links the bot to their account with a one-time code, then
 * forwards a message or sends a photo of a flyer; we extract, reply with a card and
 * two buttons, and publish only on Confirm. The bot talks to api.telegram.org (not a
 * user-supplied URL) with global fetch.
 */
import { Hono } from 'hono'
import { eq } from 'drizzle-orm'
import { newToken } from '@tributary/identity'
import { config } from '../../config.js'
import { getDb } from '../../db/index.js'
import { inboundAddress } from '../../db/schema.js'
import { resolveConfirmation } from '../../lib/confirm.js'
import { extractEvents } from '../../lib/extract.js'
import { getHost } from '../../lib/hosts.js'
import { describeError, log } from '../../lib/logging.js'
import { ApiError, requireHost, type Vars } from '../context.js'
import { queueExtraction } from './confirmations.js'

const API = (method: string) => `https://api.telegram.org/bot${config().TELEGRAM_BOT_TOKEN}/${method}`

async function tg(method: string, body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const res = await fetch(API(method), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(15_000) })
  const json = (await res.json().catch(() => ({}))) as { ok?: boolean; result?: Record<string, unknown>; description?: string }
  if (!json.ok) throw new Error(`telegram ${method}: ${json.description ?? res.status}`)
  return json.result ?? {}
}

let botUsername: string | undefined
async function bot(): Promise<string> {
  if (botUsername) return botUsername
  const me = await tg('getMe', {})
  botUsername = String(me.username ?? 'tributary_bot')
  return botUsername
}

/** Register the webhook at boot when a token is configured. */
export async function ensureTelegramWebhook(): Promise<void> {
  const c = config()
  if (!c.TELEGRAM_BOT_TOKEN || !c.TELEGRAM_WEBHOOK_SECRET) return
  try {
    await tg('setWebhook', { url: `${c.WEB_PUBLIC_URL}/api/inbound/telegram`, secret_token: c.TELEGRAM_WEBHOOK_SECRET, allowed_updates: ['message', 'callback_query'], drop_pending_updates: false })
    log.info('telegram webhook set', { bot: await bot() })
  } catch (err) {
    log.warn('telegram webhook not set', { detail: describeError(err) })
  }
}

export const telegramMeRoutes = new Hono<{ Variables: Vars }>()

/** A one-time link code; the host opens t.me/<bot>?start=<code>. */
telegramMeRoutes.post('/link', async (c) => {
  const h = requireHost(c)
  if (!config().TELEGRAM_BOT_TOKEN) throw new ApiError(400, 'SourceUnsupported', 'The Telegram bot is not switched on for this directory yet.')
  const code = newToken(9).replace(/[^A-Za-z0-9]/g, '').slice(0, 12)
  await getDb().insert(inboundAddress).values({ hostId: h.id, emailToken: newToken(12), webhookToken: newToken(16), webhookSecret: newToken(24), telegramLinkCode: code }).onConflictDoUpdate({ target: inboundAddress.hostId, set: { telegramLinkCode: code } })
  const username = await bot()
  return c.json({ code, bot: username, url: `https://t.me/${username}?start=${code}` })
})

telegramMeRoutes.get('/', async (c) => {
  const h = requireHost(c)
  const rows = await getDb().select().from(inboundAddress).where(eq(inboundAddress.hostId, h.id)).limit(1)
  return c.json({ enabled: !!config().TELEGRAM_BOT_TOKEN, linked: !!rows[0]?.telegramChatId, bot: config().TELEGRAM_BOT_TOKEN ? await bot().catch(() => null) : null })
})

telegramMeRoutes.delete('/', async (c) => {
  const h = requireHost(c)
  await getDb().update(inboundAddress).set({ telegramChatId: null, telegramLinkCode: null }).where(eq(inboundAddress.hostId, h.id))
  return c.json({ ok: true })
})

export const telegramInbound = new Hono<{ Variables: Vars }>()

interface Update {
  message?: { message_id: number; chat: { id: number }; text?: string; caption?: string; photo?: Array<{ file_id: string; file_size?: number }>; document?: { file_id: string; mime_type?: string; file_size?: number }; forward_origin?: unknown }
  callback_query?: { id: string; data?: string; message?: { message_id: number; chat: { id: number } }; from: { id: number } }
}

telegramInbound.post('/', async (c) => {
  const k = config()
  if (!k.TELEGRAM_BOT_TOKEN || !k.TELEGRAM_WEBHOOK_SECRET) throw new ApiError(404, 'NotFound', 'Not found.')
  if (c.req.header('x-telegram-bot-api-secret-token') !== k.TELEGRAM_WEBHOOK_SECRET) throw new ApiError(401, 'Unauthorized', 'Bad secret.')
  const u = (await c.req.json().catch(() => ({}))) as Update
  try {
    if (u.callback_query) await onCallback(u.callback_query)
    else if (u.message) await onMessage(u.message)
  } catch (err) {
    log.warn('telegram update failed', { detail: describeError(err) })
  }
  return c.json({ ok: true })
})

async function hostForChat(chatId: number) {
  const rows = await getDb().select().from(inboundAddress).where(eq(inboundAddress.telegramChatId, String(chatId))).limit(1)
  return rows[0] ? getHost(rows[0].hostId) : null
}

async function onMessage(m: NonNullable<Update['message']>): Promise<void> {
  const chatId = m.chat.id
  const text = m.text ?? m.caption ?? ''
  const start = /^\/start\s+([A-Za-z0-9]{6,20})$/.exec(text.trim())
  if (start) {
    const rows = await getDb().select().from(inboundAddress).where(eq(inboundAddress.telegramLinkCode, start[1]!)).limit(1)
    if (!rows[0]) {
      await tg('sendMessage', { chat_id: chatId, text: 'That link code is not valid. Get a fresh one from your dashboard under Settings.' })
      return
    }
    await getDb().update(inboundAddress).set({ telegramChatId: String(chatId), telegramLinkCode: null }).where(eq(inboundAddress.hostId, rows[0].hostId))
    await tg('sendMessage', { chat_id: chatId, text: 'Linked. Forward an event announcement or send a photo of a flyer and I will draft the listing for you to confirm. Nothing is published until you press Confirm.' })
    return
  }
  const h = await hostForChat(chatId)
  if (!h) {
    await tg('sendMessage', { chat_id: chatId, text: `This chat is not linked to a ${config().BRAND_NAME} account yet. In your dashboard, choose Settings → Link Telegram.` })
    return
  }
  let file: { name: string; mime: string; bytes: Buffer } | undefined
  const photo = m.photo?.[m.photo.length - 1]
  const doc = m.document && /^(image\/|application\/pdf)/.test(m.document.mime_type ?? '') ? m.document : undefined
  const fileId = photo?.file_id ?? doc?.file_id
  if (fileId) {
    const f = await tg('getFile', { file_id: fileId })
    const path = String(f.file_path ?? '')
    const res = await fetch(`https://api.telegram.org/file/bot${config().TELEGRAM_BOT_TOKEN}/${path}`, { signal: AbortSignal.timeout(30_000) })
    if (res.ok) file = { name: path.split('/').pop() ?? 'file', mime: doc?.mime_type ?? 'image/jpeg', bytes: Buffer.from(await res.arrayBuffer()) }
  }
  if (!file && !text.trim()) {
    await tg('sendMessage', { chat_id: chatId, text: 'Send me some text or a photo of a flyer.' })
    return
  }
  let res
  try {
    res = await extractEvents({ kind: file ? 'flyer' : 'text', text: text || undefined, file })
  } catch (err) {
    await tg('sendMessage', { chat_id: chatId, text: err instanceof ApiError ? err.message : 'I could not read that. Try the form in your dashboard.' })
    return
  }
  if (res.events.length === 0) {
    await tg('sendMessage', { chat_id: chatId, text: 'I could not find an event in that.' })
    return
  }
  const pid = await queueExtraction(h.id, res.events, res.notes, 'telegram')
  const lines = res.events.slice(0, 5).map((e) => `• ${e.raw.name}\n   ${e.raw.start}${e.raw.location ? `\n   ${e.raw.location}` : ''}${e.flags.length ? `\n   (check: ${e.flags.join(', ')})` : ''}`)
  await tg('sendMessage', {
    chat_id: chatId,
    text: `I found ${res.events.length} event${res.events.length === 1 ? '' : 's'}:\n\n${lines.join('\n\n')}\n\nPublish as @${h.handle}? You can edit first in the dashboard: ${config().WEB_PUBLIC_URL}/confirm/${pid}`,
    reply_markup: { inline_keyboard: [[{ text: 'Confirm', callback_data: `pc:${pid}:confirm` }, { text: 'Reject', callback_data: `pc:${pid}:reject` }]] },
  })
}

async function onCallback(q: NonNullable<Update['callback_query']>): Promise<void> {
  const m = /^pc:([A-Za-z0-9_-]+):(confirm|reject)$/.exec(q.data ?? '')
  const chatId = q.message?.chat.id
  if (!m || !chatId) {
    await tg('answerCallbackQuery', { callback_query_id: q.id })
    return
  }
  const h = await hostForChat(chatId)
  if (!h) {
    await tg('answerCallbackQuery', { callback_query_id: q.id, text: 'This chat is not linked.' })
    return
  }
  const out = await resolveConfirmation(h.id, m[1]!, m[2] as 'confirm' | 'reject', {}, h.did)
  const text = out.ok ? (out.resolution === 'confirmed' ? `Published ${out.published ?? ''} event${out.published === 1 ? '' : 's'}. They will appear on the directory in a minute.` : 'Discarded.') : out.reason === 'already-resolved' ? 'Already handled.' : 'Not found.'
  await tg('answerCallbackQuery', { callback_query_id: q.id, text })
  if (q.message) await tg('editMessageReplyMarkup', { chat_id: chatId, message_id: q.message.message_id, reply_markup: { inline_keyboard: [] } }).catch(() => {})
  await tg('sendMessage', { chat_id: chatId, text })
}
