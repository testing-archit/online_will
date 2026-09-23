import crypto from 'node:crypto'
import http from 'node:http'
import { pipeline } from 'node:stream/promises'
import { authenticate, authRequired, createSessionToken, httpError, requireRole, ROLES } from './auth.mjs'
import {
  isValidEmail,
  notificationJobToEmail,
  resolveAudienceRecipients,
  sendBrevoEmail,
  sendBrevoSms,
  validateAttachment,
} from './brevo.mjs'
import { classifyDocumentWithFallback } from './documents.mjs'
import { reportError } from './errors.mjs'
import {
  changeStaffPassword,
  createStaffAccount,
  findStaffByEmail,
  listStaffAccounts,
  setStaffStatus,
  verifyPassword,
} from './staffAuth.mjs'
import { createCompanyLiveSession, createLiveSession, isLiveConfigured } from './live.mjs'
import {
  answerEstateQuestionWithGemini,
  extractEstateIntentWithGemini,
  MAX_INLINE_BYTES,
  respondToEstateInterviewWithGemini,
  reviewWillForAdminWithGemini,
  transcribeAudioWithGemini,
} from './gemini.mjs'
import { analyzeExecutionVideo, answerCompanyQuestion, answerLegalQuestion, getKnowledgeBaseVersion, searchVaultDocuments } from './rag.mjs'
import { runScheduledJobs } from './scheduler.mjs'
import {
  canRead,
  canWrite,
  getAuthorizedRecord,
  getRecord,
  isStaff,
  listRecords,
  listVersions,
  upsertRecord,
} from './store.mjs'
import {
  createSignedUpload,
  normalizeMimeType,
  openUploadStream,
  readUploadedFile,
  receiveUpload,
  removeUpload,
} from './uploads.mjs'

const JSON_BODY_LIMIT = 5 * 1024 * 1024
const FILE_BODY_LIMIT = Number.parseInt(process.env.MAX_BODY_BYTES || String(40 * 1024 * 1024), 10)
const AI_ROUTES = [
  '/api/assistant/',
  '/api/interview/',
  '/api/copilot/',
  '/api/speech/',
  '/api/live/',
  '/api/documents/analyze',
  '/api/documents/search',
  '/api/legal/',
  '/api/execution/',
  '/api/admin/ai/',
]
const AI_RATE_LIMIT = { limit: 30, windowMs: 60_000 }
const LOGIN_RATE_LIMIT = { limit: 8, windowMs: 5 * 60_000 }
const COMPANY_LIVE_RATE_LIMIT = { limit: 5, windowMs: 10 * 60_000 }
// A hash that never matches any real password, used when the email doesn't exist -- verifyPassword still runs the
// same scrypt cost against it, so a login attempt takes the same time whether or not the account exists.
const DUMMY_PASSWORD_HASH = `scrypt:${'0'.repeat(32)}:${'0'.repeat(128)}`
const NOTIFICATION_AUDIENCES = ['client', 'advisor', 'lawyer', 'operations']
const MAX_JOBS_PER_REQUEST = 20

const rateBuckets = new Map()
const RATE_BUCKET_MAX_AGE_MS = Math.max(AI_RATE_LIMIT.windowMs, LOGIN_RATE_LIMIT.windowMs)
let lastRateSweep = 0

function enforceRateLimit(key, { limit, windowMs }) {
  const now = Date.now()
  // Keys are per user and per attempted login email, so they would otherwise pile up for as long as the server runs.
  if (now - lastRateSweep > RATE_BUCKET_MAX_AGE_MS) {
    lastRateSweep = now
    for (const [bucketKey, times] of rateBuckets) if (now - times[times.length - 1] >= RATE_BUCKET_MAX_AGE_MS) rateBuckets.delete(bucketKey)
  }
  const recent = (rateBuckets.get(key) ?? []).filter((time) => now - time < windowMs)
  if (recent.length >= limit) throw httpError(429, 'Too many requests — please slow down')
  recent.push(now)
  rateBuckets.set(key, recent)
}

function allowedOrigins() {
  const configured = (process.env.CORS_ORIGIN || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)
  const local = ['5173', '4173'].flatMap((port) => [`http://127.0.0.1:${port}`, `http://localhost:${port}`])
  return new Set([...configured, ...local])
}

/**
 * Vite moves to the next free port when 5173 is taken (5174, 5183…), so during development any http origin on
 * localhost / 127.0.0.1 is allowed, whatever its port. In production only the configured origins are.
 */
function isLocalDevOrigin(origin) {
  if (process.env.NODE_ENV === 'production') return false
  try {
    const { protocol, hostname } = new URL(origin)
    return protocol === 'http:' && (hostname === 'localhost' || hostname === '127.0.0.1')
  } catch {
    return false
  }
}

export function createApiServer() {
  return http.createServer(async (request, response) => {
    try {
      await route(request, response)
    } catch (error) {
      const status = error.status || 500
      if (status >= 500 && !error.status) void reportError(error)
      // Failing mid-response (a file download whose stream broke) can't be turned into a JSON error any more.
      if (response.headersSent) response.destroy()
      else sendJson(request, response, status, { error: status === 500 ? 'Internal server error' : error.message })
    }
  })
}

async function route(request, response) {
  const url = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`)
  const { pathname } = url
  const method = request.method ?? 'GET'
  const segments = pathname.split('/').filter(Boolean) // ['api', 'wills', ':id', ...]

  if (method === 'OPTIONS') return sendJson(request, response, 204, {})

  if (method === 'GET' && pathname === '/api/health') {
    return sendJson(request, response, 200, {
      ok: true,
      authRequired: authRequired(),
      schedulerEnabled: process.env.SCHEDULER_ENABLED === 'true',
      aiConfigured: Boolean(process.env.GEMINI_API_KEY),
      emailConfigured: Boolean(process.env.BREVO_API_KEY && process.env.BREVO_SENDER_EMAIL),
      liveConfigured: isLiveConfigured(),
      legalKnowledgeBaseVersion: getKnowledgeBaseVersion(),
    })
  }

  if (method === 'POST' && pathname === '/api/auth/dev-login') {
    if (process.env.NODE_ENV === 'production' || process.env.ALLOW_DEV_LOGIN === 'false') {
      throw httpError(403, 'Dev login is disabled')
    }
    const body = await readJson(request)
    const role = body.role ?? 'client'
    if (!ROLES.includes(role)) throw httpError(400, `role must be one of ${ROLES.join(', ')}`)
    const userId = /^[A-Za-z0-9_-]{6,64}$/.test(body.userId ?? '') ? body.userId : `dev-${crypto.randomUUID().slice(0, 12)}`
    const email = isValidEmail(body.email) ? body.email : `${userId}@octaraa.local`
    return sendJson(request, response, 200, {
      token: createSessionToken({ userId, email, role }),
      user: { sub: userId, email, role },
    })
  }

  if (method === 'POST' && pathname === '/api/auth/login') {
    const body = await readJson(request)
    requireString(body.email, 'email', 254)
    requireString(body.password, 'password', 200)
    // Keyed by email, not the caller's identity (there isn't one yet) -- this is the brute-force guard for staff sign-in.
    enforceRateLimit(`login:${String(body.email).trim().toLowerCase()}`, LOGIN_RATE_LIMIT)
    const account = await findStaffByEmail(body.email)
    // Always runs the same scrypt cost, whether or not the account exists, so response time can't be used to enumerate emails.
    const passwordOk = await verifyPassword(body.password, account?.passwordHash ?? DUMMY_PASSWORD_HASH)
    if (!account || account.status !== 'active' || !passwordOk) throw httpError(401, 'Incorrect email or password')
    return sendJson(request, response, 200, {
      token: createSessionToken({ userId: account.id, email: account.email, role: account.role }),
      user: { sub: account.id, email: account.email, role: account.role },
      mustChangePassword: Boolean(account.mustChangePassword),
    })
  }

  // Public, unauthenticated: gated only by knowing the unguessable token (24 random bytes), never by login.
  // Deliberately returns willData only -- no ownerId, assignedTo, or other account metadata.
  if (method === 'GET' && pathname.startsWith('/api/share/')) {
    const token = pathname.slice('/api/share/'.length)
    if (!/^[\w-]{16,64}$/.test(token)) throw httpError(404, 'Not found')
    const [will] = await listRecords('wills', (candidate) => Boolean(candidate.shareToken) && candidate.shareToken === token)
    if (!will) throw httpError(404, 'Not found')
    return sendJson(request, response, 200, { willData: will.willData, updatedAt: will.updatedAt })
  }

  // Public, unauthenticated: the landing page's "Ask about Octaraa" widget, for a visitor who has not started a
  // Will yet and has no session. Grounded-only (see answerCompanyQuestion) and rate limited per caller address,
  // same spirit as the share-link route above.
  if (method === 'POST' && pathname === '/api/company/answer') {
    const body = await readJson(request)
    requireString(body.question, 'question', 500)
    return sendJson(request, response, 200, await answerCompanyQuestion(body, request.socket.remoteAddress))
  }

  // Public, unauthenticated: the same widget's voice mode. A live connection can run real audio-minute cost off
  // one token even if the text endpoint above would not, so this is rate limited more tightly than a question is.
  if (method === 'POST' && pathname === '/api/company/live-session') {
    enforceRateLimit(`company-live:${request.socket.remoteAddress}`, COMPANY_LIVE_RATE_LIMIT)
    const body = await readJson(request)
    return sendJson(request, response, 200, { session: await createCompanyLiveSession(body) })
  }

  const user = authenticate(request)
  // Checked before any route runs, so every AI-backed endpoint (including the admin review below) is covered.
  if (AI_ROUTES.some((prefix) => pathname.startsWith(prefix))) enforceRateLimit(`ai:${user.sub}`, AI_RATE_LIMIT)

  if (method === 'GET' && pathname === '/api/session') return sendJson(request, response, 200, { user })

  if (method === 'POST' && pathname === '/api/auth/change-password') {
    // Same brute-force guard as sign-in: a stolen session must not be able to guess the current password freely.
    enforceRateLimit(`password:${user.sub}`, LOGIN_RATE_LIMIT)
    const body = await readJson(request)
    const account = await findStaffByEmail(user.email)
    if (!account || account.id !== user.sub) throw httpError(403, 'Only a staff account can change its own password')
    requireString(body.currentPassword, 'currentPassword', 200)
    if (!(await verifyPassword(body.currentPassword, account.passwordHash))) throw httpError(401, 'Current password is incorrect')
    requireString(body.newPassword, 'newPassword', 200)
    return sendJson(request, response, 200, { user: await changeStaffPassword(account.id, body.newPassword, user) })
  }

  if (pathname === '/api/admin/staff') {
    requireRole(user, ['admin'])
    if (method === 'GET') return sendJson(request, response, 200, { staff: await listStaffAccounts() })
    if (method === 'POST') {
      const body = await readJson(request)
      requireString(body.email, 'email', 254)
      requireString(body.password, 'password', 200)
      requireString(body.fullName, 'fullName', 200)
      return sendJson(request, response, 200, { staff: await createStaffAccount(body, user) })
    }
  }

  if (pathname.startsWith('/api/admin/staff/') && method === 'PATCH') {
    requireRole(user, ['admin'])
    const body = await readJson(request)
    return sendJson(request, response, 200, { staff: await setStaffStatus(pathname.slice('/api/admin/staff/'.length), body.status, user) })
  }

  if (method === 'POST' && pathname === '/api/admin/ai/review') {
    requireRole(user, ['admin'])
    const body = await readJson(request)
    requireString(body.willId, 'willId', 64)
    // Confirms the will exists and is readable by this admin (always true for admin, but keeps the same
    // ownership-check code path as every other will-scoped route, and turns a bad id into 404 rather than a crash).
    await getAuthorizedRecord('wills', body.willId, user)
    const staffNotes = (await listRecords('comments', (comment) => comment.willId === body.willId)).map((comment) => ({ role: comment.senderRole, message: comment.message, status: comment.status }))
    // The deterministic flags/issues are computed client-side (same lib the wizard and PDF reports already use) and
    // sent as untrusted data, same as estateSnapshot -- the server never recomputes or trusts them as fact, only
    // as material for the model to synthesise and cite back to.
    const estateSnapshot = body.estateSnapshot && typeof body.estateSnapshot === 'object' && !Array.isArray(body.estateSnapshot) && JSON.stringify(body.estateSnapshot).length <= 60_000 ? body.estateSnapshot : {}
    const legalFlags = Array.isArray(body.legalFlags) ? body.legalFlags.slice(0, 100) : []
    const completenessIssues = Array.isArray(body.completenessIssues) ? body.completenessIssues.slice(0, 100) : []
    const question = typeof body.question === 'string' ? body.question.trim().slice(0, 1_000) : undefined
    const review = await reviewWillForAdminWithGemini({ estateSnapshot, legalFlags, completenessIssues, staffNotes, question })
    return sendJson(request, response, 200, { review })
  }

  // ------------------------------------------------------------------ wills
  if (segments[1] === 'wills') return handleWills(request, response, segments, user, method)
  if (segments[1] === 'comments') return handleComments(request, response, segments, user, method)

  // Despite the path name, this is the shared case list for every assignable staff role: canRead already scopes
  // it correctly per caller (a lawyer/advisor sees only what they're assigned, admin/operations see everything).
  if (method === 'GET' && pathname === '/api/lawyer/cases') {
    requireRole(user, ['lawyer', 'advisor', 'admin', 'operations'])
    const [wills, openThreads] = await Promise.all([listRecords('wills', (will) => canRead(will, user)), openThreadCounts()])
    return sendJson(request, response, 200, {
      cases: wills.map((will) => summarizeWill(will, openThreads)),
    })
  }

  // ---------------------------------------------------------------- uploads
  if (method === 'POST' && pathname === '/api/uploads/sign') {
    const upload = await createSignedUpload(await readJson(request), user)
    return sendJson(request, response, 200, { upload })
  }

  if (segments[1] === 'uploads' && segments[2]) {
    if (method === 'PUT') {
      const upload = await receiveUpload(segments[2], request, user)
      return sendJson(request, response, 200, { upload })
    }
    if (method === 'GET') {
      const { record, stream } = await openUploadStream(segments[2], user, { extraAccess: (upload) => lawyerCaseReferencesUpload(user, upload.id) })
      response.writeHead(200, {
        ...baseHeaders(request),
        'content-type': record.mimeType,
        'content-length': record.storedBytes,
        'content-disposition': `attachment; filename="${record.fileName.replace(/"/g, '')}"`,
      })
      // A read error mid-download (file removed, disk fault) tears the response down instead of crashing the process.
      await pipeline(stream, response).catch(() => response.destroy())
      return
    }
    if (method === 'DELETE') {
      const upload = await removeUpload(segments[2], user)
      return sendJson(request, response, 200, { upload })
    }
  }

  // ------------------------------------------------------------ AI features
  if (method === 'POST' && pathname === '/api/documents/analyze') {
    const document = await classifyDocumentWithFallback(await readJson(request, FILE_BODY_LIMIT), user)
    return sendJson(request, response, 200, { document })
  }

  if (method === 'POST' && pathname === '/api/assistant/extract') {
    const body = await readJson(request)
    requireString(body.statement, 'statement', 2_000)
    return sendJson(request, response, 200, { extraction: await extractEstateIntentWithGemini(body) })
  }

  if (method === 'POST' && pathname === '/api/interview/respond') {
    const body = await readJson(request)
    requireString(body.message, 'message', 2_000)
    const replyLanguage = ['en', 'hi', 'hinglish'].includes(body.replyLanguage) ? body.replyLanguage : undefined
    // Where the person is in the questionnaire (step, section progress, open questions). Untrusted input: it must be a small plain object.
    const sessionContext = body.sessionContext && typeof body.sessionContext === 'object' && !Array.isArray(body.sessionContext) && JSON.stringify(body.sessionContext).length <= 6_000 ? body.sessionContext : undefined
    return sendJson(request, response, 200, { interview: await respondToEstateInterviewWithGemini({ ...body, sessionContext, replyLanguage }) })
  }

  if (method === 'POST' && pathname === '/api/live/session') {
    const body = await readJson(request)
    return sendJson(request, response, 200, { session: await createLiveSession(body) })
  }

  if (method === 'POST' && pathname === '/api/copilot/answer') {
    const body = await readJson(request)
    requireString(body.question, 'question', 1_000)
    return sendJson(request, response, 200, { answer: await answerEstateQuestionWithGemini(body) })
  }

  // Dictation's "Record" fallback (VoiceControls): audio in, transcript out for a text field. Nothing is stored.
  if (method === 'POST' && pathname === '/api/speech/transcribe') {
    const body = await readJson(request, FILE_BODY_LIMIT)
    let { mimeType, base64Data } = body
    if (body.uploadId) {
      const { record, buffer } = await readUploadedFile(body.uploadId, user, { maxBytes: MAX_INLINE_BYTES })
      if (!buffer) throw httpError(413, 'Audio is too large for transcription')
      mimeType = record.mimeType
      base64Data = buffer.toString('base64')
    }
    const transcription = await transcribeAudioWithGemini({ mimeType: normalizeMimeType(mimeType), base64Data, languageHint: body.languageHint })
    return sendJson(request, response, 200, { transcription })
  }

  if (method === 'POST' && pathname === '/api/documents/search') {
    return sendJson(request, response, 200, await searchVaultDocuments(await readJson(request), user))
  }

  if (method === 'POST' && pathname === '/api/legal/answer') {
    return sendJson(request, response, 200, await answerLegalQuestion(await readJson(request), user))
  }

  if (method === 'POST' && pathname === '/api/execution/analyze') {
    return sendJson(request, response, 200, await analyzeExecutionVideo(await readJson(request, FILE_BODY_LIMIT), user))
  }

  // ---------------------------------------------------------- notifications
  if (method === 'POST' && pathname === '/api/notifications/send') {
    return sendJson(request, response, 200, await sendNotificationJobs(await readJson(request, FILE_BODY_LIMIT), user))
  }

  if (method === 'POST' && pathname === '/api/notifications/sms') {
    requireRole(user, ['admin', 'operations'])
    return sendJson(request, response, 200, { result: await sendBrevoSms(await readJson(request)) })
  }

  if (method === 'POST' && pathname === '/api/notifications/schedule') {
    const job = await scheduleNotification(await readJson(request), user)
    return sendJson(request, response, 200, { job })
  }

  if (method === 'POST' && pathname === '/api/scheduler/run') {
    requireRole(user, ['admin', 'operations'])
    return sendJson(request, response, 200, { ok: true, summary: await runScheduledJobs() })
  }

  // ---------------------------------------------------------- consultations
  if (method === 'POST' && pathname === '/api/consultations') {
    const body = await readJson(request)
    requireString(body.contactName, 'contactName', 200)
    if (!body.contactPhone && !body.contactEmail) throw httpError(400, 'A phone number or email is required')
    if (body.contactEmail && !isValidEmail(body.contactEmail)) throw httpError(400, 'contactEmail is not a valid email address')
    const consultation = await upsertRecord(
      'consultations',
      {
        id: body.id,
        willId: typeof body.willId === 'string' ? body.willId : undefined,
        contactName: String(body.contactName).slice(0, 200),
        contactPhone: String(body.contactPhone ?? '').slice(0, 30),
        contactEmail: String(body.contactEmail ?? '').slice(0, 254),
        preferredMode: ['video', 'phone', 'in-person', ''].includes(body.preferredMode) ? body.preferredMode : '',
        preferredWindow: String(body.preferredWindow ?? '').slice(0, 200),
        notes: String(body.notes ?? '').slice(0, 2_000),
        flagsSnapshot: Array.isArray(body.flagsSnapshot) ? body.flagsSnapshot.slice(0, 50) : [],
        status: 'requested',
      },
      user,
    )
    return sendJson(request, response, 200, { consultation })
  }

  if (method === 'GET' && pathname === '/api/consultations') {
    requireRole(user, ['admin', 'operations'])
    return sendJson(request, response, 200, { consultations: await listRecords('consultations') })
  }

  if (method === 'GET' && pathname === '/api/audit-log') {
    requireRole(user, ['admin', 'operations'])
    const limit = Math.min(1000, Number.parseInt(url.searchParams.get('limit') ?? '200', 10) || 200)
    const auditLog = (await listRecords('auditLog')).slice(-limit).reverse()
    return sendJson(request, response, 200, { auditLog })
  }

  throw httpError(404, 'Not found')
}

// ------------------------------------------------------------------- wills

async function handleWills(request, response, segments, user, method) {
  const [, , willId, sub] = segments

  if (!willId) {
    if (method === 'GET') {
      const [wills, openThreads] = await Promise.all([listRecords('wills', (will) => canRead(will, user)), openThreadCounts()])
      return sendJson(request, response, 200, { wills: wills.map((will) => summarizeWill(will, openThreads)) })
    }
    if (method === 'POST') {
      const body = await readJson(request)
      if (!body.willData || typeof body.willData !== 'object') throw httpError(400, 'willData is required')
      const will = await upsertRecord(
        'wills',
        { id: body.id, willData: body.willData },
        user,
        { keepHistory: true, baseVersion: Number.isInteger(body.baseVersion) ? body.baseVersion : undefined },
      )
      return sendJson(request, response, 200, { will: { id: will.id, version: will.version, updatedAt: will.updatedAt } })
    }
  }

  if (willId && !sub && method === 'GET') {
    const will = await getAuthorizedRecord('wills', willId, user)
    return sendJson(request, response, 200, { will })
  }

  if (willId && sub === 'versions' && method === 'GET') {
    await getAuthorizedRecord('wills', willId, user)
    return sendJson(request, response, 200, { versions: await listVersions('wills', willId) })
  }

  if (willId && sub === 'assign' && method === 'POST') {
    requireRole(user, ['admin', 'operations'])
    const body = await readJson(request)
    requireString(body.lawyerId, 'lawyerId', 64)
    const will = await getAuthorizedRecord('wills', willId, user)
    const assignedTo = Array.from(new Set([...(will.assignedTo ?? []), body.lawyerId]))
    const updated = await upsertRecord('wills', { id: willId, assignedTo }, user)
    return sendJson(request, response, 200, { will: summarizeWill(updated, new Map()) })
  }

  if (willId && sub === 'share' && (method === 'POST' || method === 'DELETE')) {
    const will = await getAuthorizedRecord('wills', willId, user)
    if (!canWrite(will, user)) throw httpError(403, 'Only the owner or staff can manage this will\'s share link')
    const shareToken = method === 'POST' ? crypto.randomBytes(24).toString('base64url') : ''
    const updated = await upsertRecord('wills', { id: willId, shareToken }, user, { skipOwnerCheck: true })
    return sendJson(request, response, 200, { shareToken: updated.shareToken || null })
  }

  if (willId && sub === 'comments') {
    const will = await getAuthorizedRecord('wills', willId, user)
    if (method === 'GET') {
      const comments = await listRecords('comments', (comment) => comment.willId === will.id)
      comments.sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      return sendJson(request, response, 200, { comments })
    }
    if (method === 'POST') {
      const body = await readJson(request)
      requireString(body.message, 'message', 2_000)
      const kinds = ['comment', 'document_request', 'question', 'approval', 'correction']
      // An attachment (e.g. a lawyer's final draft) must be the sender's own completed upload; it is then shared with the case parties.
      let attachment
      if (body.attachmentUploadId) {
        const upload = await getRecord('uploads', body.attachmentUploadId)
        if (!upload || upload.status !== 'uploaded' || upload.ownerId !== user.sub) throw httpError(400, 'attachmentUploadId must be one of your completed uploads')
        const sharedWith = Array.from(new Set([...(upload.sharedWith ?? []), will.ownerId, ...(will.assignedTo ?? [])]))
        await upsertRecord('uploads', { id: upload.id, sharedWith }, user)
        attachment = { uploadId: upload.id, fileName: upload.fileName }
      }
      // The sender role always comes from the authenticated session, never from the request body.
      const comment = await upsertRecord(
        'comments',
        {
          willId: will.id,
          senderId: user.sub,
          senderRole: user.role === 'admin' ? 'operations' : user.role,
          kind: kinds.includes(body.kind) ? body.kind : 'comment',
          message: String(body.message).trim().slice(0, 2_000),
          ...(attachment ? { attachment } : {}),
          status: 'open',
        },
        user,
      )
      return sendJson(request, response, 200, { comment })
    }
  }

  throw httpError(404, 'Not found')
}

async function handleComments(request, response, segments, user, method) {
  const commentId = segments[2]
  if (method === 'PATCH' && commentId) {
    const comment = await getRecord('comments', commentId)
    const will = comment ? await getRecord('wills', comment.willId) : null
    if (!comment || !will || !canRead(will, user)) throw httpError(404, 'Not found')
    const body = await readJson(request)
    if (!['open', 'resolved'].includes(body.status)) throw httpError(400, 'status must be "open" or "resolved"')
    // Anyone with access to the case (verified above) may resolve a thread; record who did.
    const updated = await upsertRecord(
      'comments',
      { id: commentId, status: body.status, resolvedBy: body.status === 'resolved' ? user.sub : '' },
      user,
      { skipOwnerCheck: true },
    )
    return sendJson(request, response, 200, { comment: updated })
  }
  throw httpError(404, 'Not found')
}

/** An assigned lawyer may open a file that is referenced by one of their cases (documents or execution recordings). */
async function lawyerCaseReferencesUpload(user, uploadId) {
  if (user.role !== 'lawyer') return false
  const wills = await listRecords('wills', (will) => canRead(will, user))
  return wills.some((will) => {
    const data = will.willData ?? {}
    const documents = data.documentVault?.documents ?? []
    const recordings = data.estateOs?.executionVideoAnalyses ?? []
    return [...documents, ...recordings].some((item) => item?.uploadId === uploadId)
  })
}

/** Open comment threads per will, counted in one pass instead of re-scanning every comment for every will. */
async function openThreadCounts() {
  const counts = new Map()
  for (const comment of await listRecords('comments', (item) => item.status === 'open')) counts.set(comment.willId, (counts.get(comment.willId) ?? 0) + 1)
  return counts
}

function summarizeWill(will, openThreads) {
  const data = will.willData ?? {}
  return {
    id: will.id,
    ownerId: will.ownerId,
    clientName: data.personal?.fullLegalName || 'Unnamed client',
    state: data.personal?.state ?? '',
    version: will.version,
    updatedAt: will.updatedAt,
    assignedTo: will.assignedTo ?? [],
    openThreads: openThreads.get(will.id) ?? 0,
  }
}

// ----------------------------------------------------------- notifications

function requireString(value, name, max) {
  if (typeof value !== 'string' || !value.trim()) throw httpError(400, `${name} is required`)
  if (value.length > max) throw httpError(413, `${name} is too long`)
}

function validateJob(job) {
  if (!job || typeof job !== 'object') throw httpError(400, 'Invalid notification job')
  requireString(job.id, 'job.id', 100)
  requireString(job.subject, 'job.subject', 300)
  requireString(job.preview, 'job.preview', 2_000)
  requireString(job.templateId, 'job.templateId', 100)
  requireString(job.event, 'job.event', 100)
  validateAttachment(job.attachment)
  if (!NOTIFICATION_AUDIENCES.includes(job.audience)) throw httpError(400, `job.audience must be one of ${NOTIFICATION_AUDIENCES.join(', ')}`)
}

async function sendNotificationJobs(body, user) {
  const jobs = Array.isArray(body.jobs) ? body.jobs : []
  if (jobs.length === 0) throw httpError(400, 'jobs is required')
  if (jobs.length > MAX_JOBS_PER_REQUEST) throw httpError(413, `At most ${MAX_JOBS_PER_REQUEST} jobs per request`)
  jobs.forEach(validateJob)

  // The client's own address is optional: without it, client-audience mail is skipped but staff are still notified.
  const clientEmail = body.recipientEmail ? body.recipientEmail : null
  if (clientEmail !== null && !isValidEmail(clientEmail)) throw httpError(400, 'recipientEmail is not a valid email address')
  // With real auth on, a client may only email themselves.
  if (clientEmail && authRequired() && user.role === 'client' && user.email?.toLowerCase() !== clientEmail.toLowerCase()) {
    throw httpError(403, 'You can only send notifications to your own email address')
  }

  const submissionId = typeof body.submissionId === 'string' ? body.submissionId : crypto.randomUUID()
  const results = []
  for (const job of jobs) {
    const recipients = resolveAudienceRecipients(job.audience, clientEmail)
    if (recipients.length === 0) {
      results.push({ jobId: job.id, audience: job.audience, status: 'skipped', reason: `No ${job.audience} recipient configured` })
      continue
    }

    // Idempotency: the same job for the same submission is only ever sent once.
    const logId = crypto.createHash('sha256').update(`${user.sub}:${submissionId}:${job.id}`).digest('hex').slice(0, 40)
    const previous = await getRecord('notificationJobs', logId)
    if (previous?.status === 'sent') {
      results.push({ jobId: job.id, audience: job.audience, status: 'skipped', reason: 'Already sent for this submission' })
      continue
    }

    try {
      await sendBrevoEmail(notificationJobToEmail(job, recipients))
      await upsertRecord(
        'notificationJobs',
        { id: logId, channel: 'email', jobId: job.id, audience: job.audience, status: 'sent', sentAt: new Date().toISOString() },
        user,
      )
      results.push({ jobId: job.id, audience: job.audience, status: 'sent' })
    } catch (error) {
      results.push({ jobId: job.id, audience: job.audience, status: 'failed', reason: error.message })
    }
  }

  return {
    submissionId,
    sent: results.filter((result) => result.status === 'sent').length,
    results,
  }
}

async function scheduleNotification(body, user) {
  const channel = body.channel === 'sms' ? 'sms' : 'email'
  const runAt = Date.parse(body.runAt)
  if (!Number.isFinite(runAt)) throw httpError(400, 'runAt must be a valid ISO date')
  if (runAt > Date.now() + 5 * 365 * 24 * 3600 * 1000) throw httpError(400, 'runAt is too far in the future')

  const message = body.message ?? {}
  if (channel === 'email') {
    const recipients = (Array.isArray(message.to) ? message.to : []).map((entry) => (typeof entry === 'string' ? entry : entry?.email))
    if (recipients.length === 0 || recipients.length > 5 || !recipients.every(isValidEmail)) throw httpError(400, 'message.to must contain 1-5 valid emails')
    if (authRequired() && !isStaff(user) && !recipients.every((email) => email.toLowerCase() === user.email?.toLowerCase())) {
      throw httpError(403, 'You can only schedule reminders to your own email address')
    }
    requireString(message.subject, 'message.subject', 300)
  } else if (!isStaff(user)) {
    throw httpError(403, 'Only staff can schedule SMS notifications')
  }

  return upsertRecord(
    'notificationJobs',
    {
      channel,
      runAt: new Date(runAt).toISOString(),
      message: {
        ...message,
        to: channel === 'email' ? message.to.map((entry) => (typeof entry === 'string' ? { email: entry } : entry)) : undefined,
        subject: String(message.subject ?? '').slice(0, 300),
        textContent: String(message.textContent ?? '').slice(0, 5_000),
        htmlContent: String(message.htmlContent ?? '').slice(0, 20_000),
      },
      kind: String(body.kind ?? 'reminder').slice(0, 60),
      status: 'scheduled',
      attempts: 0,
    },
    user,
  )
}

// -------------------------------------------------------------------- http

function baseHeaders(request) {
  const origin = request.headers.origin
  const headers = {
    'access-control-allow-methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
    'access-control-allow-headers': 'authorization,content-type',
    'x-content-type-options': 'nosniff',
    'cache-control': 'no-store',
    vary: 'Origin',
  }
  if (origin && (allowedOrigins().has(origin) || isLocalDevOrigin(origin))) headers['access-control-allow-origin'] = origin
  return headers
}

function sendJson(request, response, status, payload) {
  response.writeHead(status, { ...baseHeaders(request), 'content-type': 'application/json' })
  response.end(status === 204 ? undefined : JSON.stringify(payload))
}

async function readJson(request, limit = JSON_BODY_LIMIT) {
  const declared = Number(request.headers['content-length'])
  if (Number.isFinite(declared) && declared > limit) throw httpError(413, 'Request body is too large')

  const chunks = []
  let received = 0
  for await (const chunk of request) {
    received += chunk.length
    if (received > limit) throw httpError(413, 'Request body is too large')
    chunks.push(chunk)
  }
  const raw = Buffer.concat(chunks).toString('utf8')
  if (!raw) return {}
  try {
    const parsed = JSON.parse(raw)
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('not an object')
    return parsed
  } catch {
    throw httpError(400, 'Request body must be a JSON object')
  }
}

