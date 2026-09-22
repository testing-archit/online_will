import { toAiSnapshot } from './aiSnapshot'
import type { AssistantContext } from './assistantContext'
import { newId } from './id'
import type { NotificationJob } from './notificationWorkflow'
import { loadServerWillRef, saveServerWillRef } from './storage'
import type {
  AssistantExtraction,
  CollaborationThread,
  ConsultationRequest,
  DocumentSearchResult,
  ExecutionVideoAnalysis,
  InterviewTurnProposal,
  WillData,
} from './types'

// The API lives on the same host as the app unless configured, so raw-IP and
// LAN deployments work without rebuilding. On localhost we use the IPv4 loopback
// the API server binds to.
function defaultApiBase() {
  const { protocol, hostname } = window.location
  const host = hostname === 'localhost' || hostname === '::1' ? '127.0.0.1' : hostname
  return `${protocol === 'https:' ? 'https:' : 'http:'}//${host}:8787`
}

const API_BASE = (import.meta.env.VITE_API_BASE_URL as string | undefined) || defaultApiBase()
const AUTH_TOKEN_KEY = 'octaraa-api-session-token'
const DEV_USER_KEY = 'octaraa-dev-user-id'
const DEFAULT_TIMEOUT_MS = 20_000
const LONG_TIMEOUT_MS = 120_000

export type SessionRole = 'client' | 'lawyer' | 'advisor' | 'operations' | 'executor' | 'admin'
export interface SessionUser {
  sub: string
  email?: string
  role: SessionRole
}

// ---------------------------------------------------------------- session

function readStoredToken(): string | null {
  try {
    const token = localStorage.getItem(AUTH_TOKEN_KEY)
    if (!token) return null
    const payload = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))) as { exp?: number }
    // Treat a token that expires within a minute as already expired.
    return payload.exp && payload.exp * 1000 - Date.now() > 60_000 ? token : null
  } catch {
    return null
  }
}

function storeToken(token: string | null) {
  try {
    if (token) localStorage.setItem(AUTH_TOKEN_KEY, token)
    else localStorage.removeItem(AUTH_TOKEN_KEY)
  } catch {
    // ignore
  }
}

function stableDevUserId() {
  try {
    const existing = localStorage.getItem(DEV_USER_KEY)
    if (existing) return existing
    const created = `dev-${newId().slice(0, 12)}`
    localStorage.setItem(DEV_USER_KEY, created)
    return created
  } catch {
    return `dev-${newId().slice(0, 12)}`
  }
}

let devLoginUnavailable = false
let loginInFlight: Promise<string | null> | null = null

/** Development sign-in. Disabled by the server in production, where the host app supplies the token. */
export async function devLogin(role: SessionRole = 'client', email?: string): Promise<string | null> {
  if (loginInFlight) return loginInFlight
  loginInFlight = (async () => {
    try {
      const response = await fetch(`${API_BASE}/api/auth/dev-login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ role, email, userId: role === 'client' ? stableDevUserId() : `dev-${role}-${stableDevUserId().slice(4, 12)}` }),
        signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
      })
      if (response.status === 403) devLoginUnavailable = true
      if (!response.ok) return null
      const payload = (await response.json()) as { token?: string }
      storeToken(payload.token ?? null)
      return payload.token ?? null
    } catch {
      return null
    } finally {
      loginInFlight = null
    }
  })()
  return loginInFlight
}

export function signOut() {
  storeToken(null)
}

function tokenRole(): SessionRole | null {
  try {
    const token = readStoredToken()
    return token ? (JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))) as { role?: SessionRole }).role ?? null : null
  } catch {
    return null
  }
}

async function currentToken(): Promise<string | null> {
  return readStoredToken() ?? (devLoginUnavailable ? null : await devLogin('client'))
}

// ---------------------------------------------------------------- transport

interface RequestOptions {
  method?: string
  body?: unknown
  rawBody?: BodyInit
  timeoutMs?: number
}

export type ApiResult<T> = { ok: true; status: number; data: T } | { ok: false; status: number; error: string }

async function request<T>(path: string, options: RequestOptions = {}, retried = false): Promise<ApiResult<T>> {
  try {
    const token = await currentToken()
    const headers: Record<string, string> = {}
    if (options.body !== undefined) headers['content-type'] = 'application/json'
    if (token) headers.authorization = `Bearer ${token}`

    const response = await fetch(`${API_BASE}${path}`, {
      method: options.method ?? (options.body !== undefined ? 'POST' : 'GET'),
      headers,
      body: options.rawBody ?? (options.body !== undefined ? JSON.stringify(options.body) : undefined),
      signal: AbortSignal.timeout(options.timeoutMs ?? DEFAULT_TIMEOUT_MS),
    })

    if (response.status === 401 && !retried) {
      storeToken(null)
      return request<T>(path, options, true)
    }

    const text = await response.text()
    let payload: unknown = null
    try {
      payload = text ? JSON.parse(text) : null
    } catch {
      // non-JSON body
    }
    if (!response.ok) {
      const message = (payload as { error?: string } | null)?.error ?? `Request failed (${response.status})`
      return { ok: false, status: response.status, error: message }
    }
    return { ok: true, status: response.status, data: payload as T }
  } catch (error) {
    // Network failure, timeout, or CORS — the app keeps working offline with local fallbacks.
    return { ok: false, status: 0, error: error instanceof Error ? error.message : 'Network error' }
  }
}

const dataOrNull = <T>(result: ApiResult<T>): T | null => (result.ok ? result.data : null)

export interface BackendHealth {
  ok: boolean
  speechConfigured: boolean
  hindiSpeechConfigured?: boolean
  liveConfigured?: boolean
  authRequired: boolean
  aiConfigured: boolean
  emailConfigured: boolean
  schedulerEnabled: boolean
}

export async function getBackendHealth(): Promise<BackendHealth | null> {
  try {
    const response = await fetch(`${API_BASE}/api/health`, { signal: AbortSignal.timeout(5_000) })
    return response.ok ? ((await response.json()) as BackendHealth) : null
  } catch {
    return null
  }
}

export async function getSession(): Promise<SessionUser | null> {
  return dataOrNull(await request<{ user: SessionUser }>('/api/session'))?.user ?? null
}

// ------------------------------------------------------------------- AI

export async function extractEstateIntentFromApi(statement: string, data: WillData): Promise<Partial<AssistantExtraction> | null> {
  return dataOrNull(await request<{ extraction: Partial<AssistantExtraction> }>('/api/assistant/extract', { body: { statement, estateSnapshot: toAiSnapshot(data) } }))?.extraction ?? null
}

export async function answerEstateQuestionFromApi(question: string, data: WillData): Promise<string | null> {
  return dataOrNull(await request<{ answer: string }>('/api/copilot/answer', { body: { question, estateSnapshot: toAiSnapshot(data) } }))?.answer ?? null
}

/** The model's reply. `fieldUpdates` is untrusted and is validated by resolveFieldUpdates before anything is shown. */
export type InterviewApiResponse = Partial<Omit<InterviewTurnProposal, 'fieldUpdates'>> & { fieldUpdates?: unknown }

/** Either the model's reply, or why there is none (status 0 = the server could not be reached at all). */
export type InterviewApiResult = { ok: true; interview: InterviewApiResponse | null } | { ok: false; status: number; error: string }

export async function respondToEstateInterviewFromApi(message: string, data: WillData, replyLanguage?: 'en' | 'hi' | 'hinglish', sessionContext?: AssistantContext): Promise<InterviewApiResult> {
  const result = await request<{ interview: InterviewApiResponse }>('/api/interview/respond', {
    body: { message, replyLanguage, interviewHistory: data.assistantIntake.interviewMessages.slice(-12), estateSnapshot: toAiSnapshot(data), sessionContext },
  })
  return result.ok ? { ok: true, interview: result.data?.interview ?? null } : { ok: false, status: result.status, error: result.error }
}

export interface LiveSessionResult {
  ok: boolean
  session?: { token: string; setup: Record<string, unknown>; expiresAt: string }
  error?: string
}

/** A single-use token (and the locked configuration) for one real-time voice conversation with Samaira. */
export async function createLiveSessionFromApi(data: WillData, sessionContext: AssistantContext, language = 'auto'): Promise<LiveSessionResult> {
  const result = await request<{ session: { token: string; setup: Record<string, unknown>; expiresAt: string } }>('/api/live/session', {
    body: { estateSnapshot: toAiSnapshot(data), sessionContext, interviewHistory: data.assistantIntake.interviewMessages.slice(-12), language },
  })
  return result.ok ? { ok: true, session: result.data?.session } : { ok: false, error: result.error }
}

export async function searchDocumentsWithBackend(query: string, data: WillData): Promise<{ answer: string; results: DocumentSearchResult[] } | null> {
  const snapshot = toAiSnapshot(data)
  return dataOrNull(await request<{ answer: string; results: DocumentSearchResult[] }>('/api/documents/search', { body: { query, documents: snapshot.documentVault.documents, estateSnapshot: snapshot } }))
}

export async function answerLegalQuestionWithBackend(
  question: string,
): Promise<{ answer: string; sources: { id: string; title: string; citation: string }[] } | null> {
  // Only the question is sent: the server owns the approved knowledge base.
  return dataOrNull(await request<{ answer: string; sources: { id: string; title: string; citation: string }[] }>('/api/legal/answer', { body: { question } }))
}

// -------------------------------------------------------------- uploads

export interface UploadRecord {
  id: string
  uploadUrl: string
  status: string
}

export async function requestSignedUpload(file: File, documentType = 'unknown'): Promise<UploadRecord | null> {
  return (
    dataOrNull(
      await request<{ upload: UploadRecord }>('/api/uploads/sign', {
        body: { fileName: file.name, fileSize: file.size, mimeType: file.type || 'application/octet-stream', documentType },
      }),
    )?.upload ?? null
  )
}

export async function uploadFileToBackend(file: File, uploadUrl: string): Promise<boolean> {
  const result = await request<{ upload: UploadRecord }>(uploadUrl, { method: 'PUT', rawBody: file, timeoutMs: LONG_TIMEOUT_MS })
  return result.ok
}

/** Sign + upload in one step. Returns the stored upload id, or null when the backend is unavailable. */
export async function storeFileOnBackend(file: File, documentType: string): Promise<string | null> {
  const upload = await requestSignedUpload(file, documentType)
  if (!upload) return null
  return (await uploadFileToBackend(file, upload.uploadUrl)) ? upload.id : null
}

export async function downloadStoredFile(uploadId: string, fileName: string): Promise<boolean> {
  const token = await currentToken()
  try {
    const response = await fetch(`${API_BASE}/api/uploads/${uploadId}`, { headers: token ? { authorization: `Bearer ${token}` } : {} })
    if (!response.ok) return false
    const url = URL.createObjectURL(await response.blob())
    const link = document.createElement('a')
    link.href = url
    link.download = fileName
    document.body.appendChild(link)
    link.click()
    link.remove()
    URL.revokeObjectURL(url)
    return true
  } catch {
    return false
  }
}

export async function deleteStoredFile(uploadId: string): Promise<boolean> {
  return (await request(`/api/uploads/${uploadId}`, { method: 'DELETE' })).ok
}

export async function analyzeDocumentWithBackend(input: { fileName: string; mimeType: string; uploadId?: string | null }, data: WillData): Promise<Record<string, unknown> | null> {
  const result = await request<{ document: Record<string, unknown> }>('/api/documents/analyze', {
    body: { ...input, uploadId: input.uploadId ?? undefined, estateSnapshot: toAiSnapshot(data) },
    timeoutMs: LONG_TIMEOUT_MS,
  })
  return dataOrNull(result)?.document ?? null
}

export interface Transcription {
  transcript: string
  language: string
  normalizedEnglishSummary: string
  followUpQuestions: string[]
}

export async function transcribeSpeechWithBackend(input: { uploadId: string } | { mimeType: string; base64Data: string }, languageHint?: string): Promise<Transcription | null> {
  return dataOrNull(await request<{ transcription: Transcription }>('/api/speech/transcribe', { body: { ...input, languageHint }, timeoutMs: LONG_TIMEOUT_MS }))?.transcription ?? null
}

export async function analyzeExecutionVideoWithBackend(input: {
  fileName: string
  mimeType: string
  uploadId: string
  recordingMetadata: string
  willVersion: string
}): Promise<{ analysis: ExecutionVideoAnalysis } | null> {
  return dataOrNull(await request<{ analysis: ExecutionVideoAnalysis }>('/api/execution/analyze', { body: input, timeoutMs: LONG_TIMEOUT_MS }))
}

// ---------------------------------------------------------------- will sync

export type SaveWillStatus = 'saved' | 'conflict' | 'offline'

/**
 * Mirror the draft to the backend. The server id and version are remembered so
 * each save updates the same record (with optimistic concurrency) instead of
 * creating a new one.
 */
export async function saveWillToBackend(data: WillData): Promise<{ status: SaveWillStatus; id?: string }> {
  // Staff sessions (e.g. the dev role switch) review other people's cases; they never mirror this wizard's draft.
  const role = tokenRole()
  if (role === 'lawyer' || role === 'operations' || role === 'advisor') return { status: 'offline' }
  const ref = loadServerWillRef()
  const result = await request<{ will: { id: string; version: number } }>('/api/wills', {
    body: { id: ref?.id, baseVersion: ref?.version, willData: data },
    timeoutMs: 30_000,
  })
  if (result.ok) {
    saveServerWillRef({ id: result.data.will.id, version: result.data.will.version })
    return { status: 'saved', id: result.data.will.id }
  }
  if (result.status === 409) {
    // Another device saved a newer version. Adopt its version so the next save wins deliberately.
    const latest = ref ? await request<{ will: { version: number } }>(`/api/wills/${ref.id}`) : null
    if (latest?.ok) saveServerWillRef({ id: ref!.id, version: latest.data.will.version })
    return { status: 'conflict', id: ref?.id }
  }
  return { status: 'offline', id: ref?.id }
}

export function currentServerWillId() {
  return loadServerWillRef()?.id ?? null
}

// ------------------------------------------------------- consultation & mail

export async function submitConsultation(consultation: ConsultationRequest, willId: string | null): Promise<boolean> {
  return (await request('/api/consultations', { body: { ...consultation, willId: willId ?? undefined } })).ok
}

export interface NotificationResult {
  jobId: string
  audience: string
  status: 'sent' | 'skipped' | 'failed'
  reason?: string
}

export async function sendNotificationJobs(jobs: NotificationJob[], recipientEmail: string, submissionId: string): Promise<NotificationResult[] | null> {
  if (jobs.length === 0) return []
  const result = await request<{ results: NotificationResult[] }>('/api/notifications/send', {
    body: { jobs, recipientEmail: recipientEmail || undefined, submissionId },
    timeoutMs: LONG_TIMEOUT_MS,
  })
  return dataOrNull(result)?.results ?? null
}

export async function scheduleReminder(input: { runAt: string; to: string; subject: string; textContent: string; htmlContent: string; kind: string }): Promise<boolean> {
  return (
    await request('/api/notifications/schedule', {
      body: { runAt: input.runAt, kind: input.kind, message: { to: [input.to], subject: input.subject, textContent: input.textContent, htmlContent: input.htmlContent } },
    })
  ).ok
}

// ------------------------------------------------- collaboration (lawyer flow)

export interface CaseSummary {
  id: string
  clientName: string
  state: string
  version: number
  updatedAt: string
  openThreads: number
  assignedTo: string[]
}

export interface ServerComment extends CollaborationThread {
  willId: string
  senderId: string
  resolvedBy?: string
  attachment?: { uploadId: string; fileName: string }
}

export async function listLawyerCases(): Promise<CaseSummary[] | null> {
  return dataOrNull(await request<{ cases: CaseSummary[] }>('/api/lawyer/cases'))?.cases ?? null
}

export async function fetchWill(willId: string): Promise<WillData | null> {
  return dataOrNull(await request<{ will: { willData: WillData } }>(`/api/wills/${willId}`))?.will.willData ?? null
}

export async function listComments(willId: string): Promise<ServerComment[] | null> {
  return dataOrNull(await request<{ comments: ServerComment[] }>(`/api/wills/${willId}/comments`))?.comments ?? null
}

export async function postComment(willId: string, message: string, kind: CollaborationThread['kind'] = 'comment', attachmentUploadId?: string): Promise<ServerComment | null> {
  return dataOrNull(await request<{ comment: ServerComment }>(`/api/wills/${willId}/comments`, { body: { message, kind, attachmentUploadId } }))?.comment ?? null
}

export async function setCommentStatus(commentId: string, status: 'open' | 'resolved'): Promise<ServerComment | null> {
  return dataOrNull(await request<{ comment: ServerComment }>(`/api/comments/${commentId}`, { method: 'PATCH', body: { status } }))?.comment ?? null
}

// ------------------------------------------------------------------ speech

/** Speech from the server voice (English: Deepgram Aura, Hindi/Hinglish: Smallest.ai). Returns null when unavailable so callers fall back to the browser voice. */
export async function synthesizeSpeechBlob(text: string, signal?: AbortSignal, language: 'en' | 'hi' | 'hinglish' = 'en'): Promise<Blob | null> {
  try {
    const token = await currentToken()
    const response = await fetch(`${API_BASE}/api/speech/synthesize`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify({ text, language }),
      signal: signal ?? AbortSignal.timeout(30_000),
    })
    return response.ok ? await response.blob() : null
  } catch {
    return null
  }
}

/** One spoken turn: raw audio in, transcript out (nothing is stored on the server). */
export async function listenToAudio(audio: Blob, language: string): Promise<{ transcript: string; language: string } | null> {
  try {
    const token = await currentToken()
    const response = await fetch(`${API_BASE}/api/speech/listen?language=${encodeURIComponent(language)}`, {
      method: 'POST',
      headers: { 'content-type': audio.type || 'audio/webm', ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: audio,
      signal: AbortSignal.timeout(30_000),
    })
    return response.ok ? ((await response.json()) as { transcript: string; language: string }) : null
  } catch {
    return null
  }
}
