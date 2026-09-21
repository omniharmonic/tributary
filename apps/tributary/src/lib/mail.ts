/**
 * SMTP via nodemailer, with a FILE transport when `SMTP_URL` is unset so local
 * development never silently drops a magic link. The dev sink is truncated at boot.
 * Bodies are plain text; no tracking pixels.
 */
import { appendFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import nodemailer, { type Transporter } from 'nodemailer'
import { config } from '../config.js'
import { describeError, log } from './logging.js'

export interface Mail {
  to: string
  subject: string
  text: string
  html?: string
  ics?: { filename: string; content: string }
}

let transport: Transporter | undefined

function devSink(): string {
  return config().DEV_MAIL_LOG || path.resolve(process.cwd(), '.dev-mail.log')
}

export async function resetDevMailSink(): Promise<void> {
  if (config().SMTP_URL) return
  try {
    await writeFile(devSink(), '')
  } catch (err) {
    log.warn('could not reset the dev mail sink', { detail: describeError(err) })
  }
}

export async function sendMail(mail: Mail): Promise<void> {
  const c = config()
  if (!c.SMTP_URL) {
    await appendFile(devSink(), JSON.stringify({ at: new Date().toISOString(), ...mail }) + '\n')
    log.info('mail written to dev sink', { subject: mail.subject })
    return
  }
  transport ??= nodemailer.createTransport(c.SMTP_URL)
  await transport.sendMail({
    from: c.MAIL_FROM,
    to: mail.to,
    subject: mail.subject,
    text: mail.text,
    html: mail.html,
    attachments: mail.ics ? [{ filename: mail.ics.filename, content: mail.ics.content, contentType: 'text/calendar; method=REQUEST' }] : undefined,
  })
}

/** Read the last dev mail (tests and the smoke script). */
export async function lastDevMail(): Promise<(Mail & { at: string }) | null> {
  const { readFile } = await import('node:fs/promises')
  try {
    const lines = (await readFile(devSink(), 'utf8')).trim().split('\n').filter(Boolean)
    const last = lines[lines.length - 1]
    return last ? (JSON.parse(last) as Mail & { at: string }) : null
  } catch {
    return null
  }
}
