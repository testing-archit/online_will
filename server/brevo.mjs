import { httpError } from './auth.mjs'

const BREVO_SEND_EMAIL_ENDPOINT = 'https://api.brevo.com/v3/smtp/email'
const BREVO_SEND_SMS_ENDPOINT = 'https://api.brevo.com/v3/transactionalSMS/sms'
const REQUEST_TIMEOUT_MS = 15_000
const EMAIL_PATTERN = /^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/

export function isValidEmail(value) {
  return typeof value === 'string' && value.length <= 254 && EMAIL_PATTERN.test(value)
}

async function brevoPost(endpoint, body, label) {
  const apiKey = process.env.BREVO_API_KEY
  if (!apiKey) throw httpError(503, 'BREVO_API_KEY is not configured')

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { accept: 'application/json', 'api-key': apiKey, 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  })
  if (!response.ok) {
    const detail = await response.text().catch(() => '')
    throw httpError(502, `${label} failed with ${response.status}${detail ? `: ${detail.slice(0, 200)}` : ''}`)
  }
  return response.json()
}

export async function sendBrevoEmail({ to, subject, htmlContent, textContent, attachment }) {
  const senderEmail = process.env.BREVO_SENDER_EMAIL
  if (!senderEmail) throw httpError(503, 'BREVO_SENDER_EMAIL is not configured')
  const recipients = (Array.isArray(to) ? to : [])
    .map((entry) => (typeof entry === 'string' ? { email: entry } : entry))
    .filter((entry) => isValidEmail(entry?.email))
  if (recipients.length === 0) throw httpError(400, 'At least one valid recipient email is required')
  if (!subject) throw httpError(400, 'Email subject is required')

  return brevoPost(
    BREVO_SEND_EMAIL_ENDPOINT,
    {
      sender: { email: senderEmail, name: process.env.BREVO_SENDER_NAME || 'Octaraa' },
      to: recipients,
      subject,
      htmlContent,
      textContent,
      ...(attachment?.length ? { attachment } : {}),
    },
    'Brevo email',
  )
}

export async function sendBrevoSms({ sender, recipient, content, type = 'transactional' }) {
  if (!recipient || !/^\+?[0-9]{8,15}$/.test(String(recipient).replace(/[\s()-]/g, ''))) {
    throw httpError(400, 'A valid SMS recipient is required')
  }
  if (!content) throw httpError(400, 'SMS content is required')

  return brevoPost(
    BREVO_SEND_SMS_ENDPOINT,
    {
      sender: sender || process.env.BREVO_SMS_SENDER || 'Octaraa',
      recipient: String(recipient).replace(/[\s()-]/g, ''),
      content: String(content).slice(0, 612),
      type,
    },
    'Brevo SMS',
  )
}

/**
 * Notification jobs are addressed to an audience, not to an email. Clients
 * receive only client-audience mail; internal audiences resolve to configured
 * staff mailboxes so lawyer briefs and ops tasks never leak to the client.
 */
export function resolveAudienceRecipients(audience, clientEmail) {
  if (audience === 'client') return isValidEmail(clientEmail) ? [clientEmail] : []
  const configured = process.env[`${String(audience).toUpperCase()}_EMAIL`] ?? ''
  return configured
    .split(',')
    .map((value) => value.trim())
    .filter(isValidEmail)
}

function asList(value) {
  return Array.isArray(value) ? value.filter((item) => typeof item === 'string' && item.trim()).slice(0, 25) : []
}

const MAX_ATTACHMENT_BASE64_CHARS = 6 * 1024 * 1024
const ATTACHMENT_NAME = /^[\w .()-]{1,100}\.pdf$/i
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/

/** Only small PDFs with a plain file name are accepted as email attachments. */
export function validateAttachment(attachment) {
  if (attachment === undefined || attachment === null) return null
  if (typeof attachment !== 'object' || !ATTACHMENT_NAME.test(attachment.name ?? '')) throw httpError(400, 'attachment.name must be a .pdf file name')
  const content = attachment.contentBase64
  if (typeof content !== 'string' || content.length === 0 || content.length > MAX_ATTACHMENT_BASE64_CHARS || !BASE64.test(content)) {
    throw httpError(400, 'attachment.contentBase64 must be base64 data under 4MB')
  }
  // A real PDF starts with "%PDF" — base64 "JVBER".
  if (!content.startsWith('JVBER')) throw httpError(400, 'attachment is not a PDF')
  return { name: attachment.name, content }
}

export function notificationJobToEmail(job, recipients) {
  const payload = job.payload && typeof job.payload === 'object' ? job.payload : {}
  const lists = [
    ['Documents requested', asList(payload.documents)],
    ['Items still needed', asList(payload.missingItems)],
  ].filter(([, items]) => items.length > 0)

  const text = [
    job.preview,
    ...lists.flatMap(([title, items]) => ['', `${title}:`, ...items.map((item) => `- ${item}`)]),
    '',
    `Reference: ${job.templateId} · ${job.event}`,
  ].join('\n')

  const html = [
    `<h2>${escapeHtml(job.subject)}</h2>`,
    `<p>${escapeHtml(job.preview)}</p>`,
    ...lists.map(([title, items]) => `<h3>${escapeHtml(title)}</h3><ul>${items.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>`),
    `<p style="color:#64748b;font-size:12px">Reference: ${escapeHtml(job.templateId)} · ${escapeHtml(job.event)}</p>`,
  ].join('')

  const attachment = validateAttachment(job.attachment)
  return {
    to: recipients.map((email) => ({ email })),
    subject: String(job.subject).slice(0, 200),
    textContent: text,
    htmlContent: html,
    ...(attachment ? { attachment: [attachment] } : {}),
  }
}

export function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;')
}
