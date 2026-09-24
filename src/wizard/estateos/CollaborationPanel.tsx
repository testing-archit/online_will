import { Check, Download, Paperclip, RefreshCw, Shield } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { useFormContext } from 'react-hook-form'
import {
  currentServerWillId,
  devLogin,
  downloadStoredFile,
  fetchWill,
  getSession,
  listComments,
  listLawyerCases,
  postComment,
  setCommentStatus,
  signOut,
  storeFileOnBackend,
  type CaseSummary,
  type ServerComment,
  type SessionUser,
} from '../../lib/backendClient'
import { detectEstateIssues } from '../../lib/estateIssues'
import { newId } from '../../lib/id'
import type { CollaborationThread, WillData } from '../../lib/types'
import { OsPanel } from './OsUi'

const KIND_LABEL: Record<NonNullable<CollaborationThread['kind']>, string> = {
  comment: 'Comment',
  question: 'Question',
  document_request: 'Document request',
  approval: 'Approval',
  correction: 'Suggested correction',
}
const CLIENT_KINDS: NonNullable<CollaborationThread['kind']>[] = ['comment', 'question']
const LAWYER_KINDS: NonNullable<CollaborationThread['kind']>[] = ['comment', 'question', 'document_request', 'correction', 'approval']
const STAFF_ROLES = new Set(['lawyer', 'operations', 'admin'])

/**
 * Client ↔ lawyer collaboration (Tasks 25/26). The sender's role is decided by
 * the signed-in session on the server, so a client can never post as a lawyer.
 * Lawyers get their assigned cases, the client's documents and open issues.
 */
export function CollaborationPanel() {
  const [session, setSession] = useState<SessionUser | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [sessionKey, setSessionKey] = useState(0)

  useEffect(() => {
    let cancelled = false
    void getSession().then((result) => {
      if (cancelled) return
      setSession(result)
      setLoaded(true)
    })
    return () => {
      cancelled = true
    }
  }, [sessionKey])
  const refreshSession = useCallback(async () => setSessionKey((key) => key + 1), [])

  const isStaff = session ? STAFF_ROLES.has(session.role) : false

  return (
    <OsPanel icon={Shield} title="Lawyer workspace and client collaboration">
      {!loaded ? (
        <p className="text-sm text-slate-400">Connecting…</p>
      ) : session === null ? (
        <LocalNotes reason="The collaboration server is not reachable, so notes to your lawyer are kept on this device until it is." />
      ) : isStaff ? (
        <LawyerWorkspace session={session} />
      ) : (
        <ClientThread />
      )}
      {process.env.NODE_ENV === 'development' && <DevRoleSwitch session={session} onChange={refreshSession} />}
    </OsPanel>
  )
}

function DevRoleSwitch({ session, onChange }: { session: SessionUser | null; onChange: () => Promise<void> }) {
  return (
    <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-dashed border-slate-200 pt-3 text-[11px] text-slate-400">
      <span>Dev only — signed in as {session ? `${session.role} (${session.sub})` : 'nobody'}. Switch role to try the other side:</span>
      {(['client', 'lawyer', 'admin'] as const).map((role) => (
        <button
          key={role}
          type="button"
          onClick={async () => {
            signOut()
            await devLogin(role)
            await onChange()
          }}
          className="rounded-full border border-slate-200 px-2 py-0.5 font-semibold text-slate-500 hover:border-brand-secondary"
        >
          {role}
        </button>
      ))}
    </div>
  )
}

/** Offline fallback: notes stay in the draft, always attributed to the client. */
function LocalNotes({ reason }: { reason: string }) {
  const { watch, setValue, getValues } = useFormContext<WillData>()
  const notes = watch('estateOs.lawyerComments')
  const [message, setMessage] = useState('')

  function add() {
    if (!message.trim()) return
    setValue(
      'estateOs.lawyerComments',
      [{ id: newId(), senderRole: 'client' as const, kind: 'comment' as const, message: message.trim(), status: 'open' as const, createdAt: new Date().toISOString() }, ...getValues().estateOs.lawyerComments],
      { shouldDirty: true },
    )
    setMessage('')
  }

  return (
    <div>
      <p className="mb-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">{reason}</p>
      <ThreadComposer kinds={['comment']} message={message} onMessage={setMessage} onSend={add} sendLabel="Save note" />
      <ThreadList comments={notes} />
    </div>
  )
}

function ClientThread() {
  const { watch } = useFormContext<WillData>()
  const localNotes = watch('estateOs.lawyerComments')
  const willId = currentServerWillId()
  const [comments, setComments] = useState<ServerComment[] | null>(null)
  const [message, setMessage] = useState('')
  const [kind, setKind] = useState<NonNullable<CollaborationThread['kind']>>('comment')
  const [error, setError] = useState('')

  const [reloadKey, setReloadKey] = useState(0)
  const load = useCallback(async () => setReloadKey((key) => key + 1), [])
  useEffect(() => {
    if (!willId) return
    let cancelled = false
    void listComments(willId).then((result) => {
      if (!cancelled) setComments(result)
    })
    return () => {
      cancelled = true
    }
  }, [willId, reloadKey])

  if (!willId) {
    return <LocalNotes reason="Your Will has not been saved to the server yet — keep answering questions and it will sync automatically. Until then, notes stay on this device." />
  }

  async function send() {
    if (!willId || !message.trim()) return
    const posted = await postComment(willId, message.trim(), kind)
    if (!posted) return setError('Could not send — please try again.')
    setError('')
    setMessage('')
    await load()
  }

  return (
    <div>
      <p className="mb-3 text-xs text-slate-500">Everything about your case stays here instead of email chains: your lawyer's requests, your answers, and uploads.</p>
      <ThreadComposer kinds={CLIENT_KINDS} kind={kind} onKind={setKind} message={message} onMessage={setMessage} onSend={() => void send()} sendLabel="Send to lawyer" />
      {error && <p className="mt-1 text-xs text-rose-600">{error}</p>}
      {comments === null ? <p className="mt-3 text-sm text-slate-400">Could not load the conversation.</p> : <ThreadList comments={comments} onToggle={async (comment) => { await setCommentStatus(comment.id, comment.status === 'open' ? 'resolved' : 'open'); await load() }} />}
      {comments !== null && localNotes.length > 0 && <p className="mt-2 text-[11px] text-slate-400">{localNotes.length} older note(s) saved offline on this device.</p>}
    </div>
  )
}

function LawyerWorkspace({ session }: { session: SessionUser }) {
  const [cases, setCases] = useState<CaseSummary[] | null>(null)
  const [active, setActive] = useState<CaseSummary | null>(null)

  const [casesKey, setCasesKey] = useState(0)
  const loadCases = useCallback(async () => setCasesKey((key) => key + 1), [])
  useEffect(() => {
    let cancelled = false
    void listLawyerCases().then((result) => {
      if (!cancelled) setCases(result)
    })
    return () => {
      cancelled = true
    }
  }, [casesKey])

  return (
    <div>
      <p className="mb-3 text-xs text-slate-500">
        Signed in as <strong>{session.role}</strong>. You see only the cases assigned to you.
      </p>
      {cases === null ? (
        <p className="text-sm text-slate-400">Loading cases…</p>
      ) : cases.length === 0 ? (
        <p className="rounded-xl border border-dashed border-slate-200 px-3 py-4 text-sm text-slate-400">No cases are assigned to you yet.</p>
      ) : (
        <div className="grid gap-2 sm:grid-cols-2">
          {cases.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setActive(item)}
              className={`rounded-xl border px-3 py-2 text-left text-sm ${active?.id === item.id ? 'border-brand-primary bg-brand-primary/5' : 'border-slate-200 bg-white hover:border-brand-secondary'}`}
            >
              <span className="block font-semibold text-slate-800">{item.clientName}</span>
              <span className="block text-xs text-slate-500">
                {item.state || 'State not set'} · v{item.version} · {item.openThreads} open thread(s)
              </span>
            </button>
          ))}
        </div>
      )}
      {active && <CaseView key={active.id} summary={active} onChanged={loadCases} />}
    </div>
  )
}

function CaseView({ summary, onChanged }: { summary: CaseSummary; onChanged: () => Promise<void> }) {
  const [will, setWill] = useState<WillData | null>(null)
  const [comments, setComments] = useState<ServerComment[] | null>(null)
  const [message, setMessage] = useState('')
  const [kind, setKind] = useState<NonNullable<CollaborationThread['kind']>>('comment')
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState('')

  const [reloadKey, setReloadKey] = useState(0)
  const load = useCallback(async () => setReloadKey((key) => key + 1), [])
  useEffect(() => {
    let cancelled = false
    void Promise.all([fetchWill(summary.id), listComments(summary.id)]).then(([fetchedWill, fetchedComments]) => {
      if (cancelled) return
      setWill(fetchedWill)
      setComments(fetchedComments)
    })
    return () => {
      cancelled = true
    }
  }, [summary.id, reloadKey])

  async function send(attachmentFile?: File) {
    if (!message.trim() && !attachmentFile) return
    setBusy(true)
    setStatus('')
    try {
      let attachmentUploadId: string | undefined
      if (attachmentFile) {
        attachmentUploadId = (await storeFileOnBackend(attachmentFile, 'final-draft')) ?? undefined
        if (!attachmentUploadId) return setStatus('Could not upload the file.')
      }
      const posted = await postComment(summary.id, message.trim() || `Attached: ${attachmentFile?.name}`, attachmentFile ? 'approval' : kind, attachmentUploadId)
      if (!posted) return setStatus('Could not send.')
      setMessage('')
      await load()
      await onChanged()
    } finally {
      setBusy(false)
    }
  }

  const issues = will ? detectEstateIssues(will) : []
  const documents = will?.documentVault.documents ?? []

  return (
    <div className="mt-4 space-y-4 rounded-xl border border-slate-200 bg-slate-50 p-3">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-semibold text-slate-900">{summary.clientName}</h4>
        <button type="button" onClick={() => void load()} className="inline-flex items-center gap-1 text-xs font-semibold text-slate-500"><RefreshCw className="h-3 w-3" /> Refresh</button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Open issues ({issues.length})</p>
          <ul className="mt-1 max-h-40 space-y-1 overflow-auto">
            {issues.length === 0 && <li className="text-xs text-slate-400">None detected</li>}
            {issues.map((issue) => (
              <li key={issue.id} className="rounded-lg bg-white px-2 py-1 text-xs text-slate-700">
                <span className="font-semibold">{issue.title}</span>
                <span className="ml-1 text-slate-400">· {issue.severity}</span>
              </li>
            ))}
          </ul>
        </div>
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Client documents ({documents.length})</p>
          <ul className="mt-1 max-h-40 space-y-1 overflow-auto">
            {documents.length === 0 && <li className="text-xs text-slate-400">None uploaded</li>}
            {documents.map((document) => (
              <li key={document.id} className="flex items-center justify-between gap-2 rounded-lg bg-white px-2 py-1 text-xs text-slate-700">
                <span>{document.fileName} <span className="text-slate-400">· {document.category} · {document.status.replace('_', ' ')}</span></span>
                {document.uploadId && (
                  <button type="button" onClick={() => void downloadStoredFile(document.uploadId!, document.fileName)} aria-label={`Download ${document.fileName}`}><Download className="h-3.5 w-3.5 text-slate-500" /></button>
                )}
              </li>
            ))}
          </ul>
        </div>
      </div>

      <ThreadComposer kinds={LAWYER_KINDS} kind={kind} onKind={setKind} message={message} onMessage={setMessage} onSend={() => void send()} sendLabel="Send" busy={busy} />
      <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-semibold text-slate-600">
        <Paperclip className="h-3.5 w-3.5" /> Upload final draft
        <input
          type="file"
          accept="application/pdf,.doc,.docx"
          className="sr-only"
          onChange={(event) => {
            const file = event.target.files?.[0]
            event.target.value = ''
            if (file) void send(file)
          }}
        />
      </label>
      {status && <p className="text-xs text-rose-600">{status}</p>}
      {comments === null ? (
        <p className="text-sm text-slate-400">Loading conversation…</p>
      ) : (
        <ThreadList comments={comments} onToggle={async (comment) => { await setCommentStatus(comment.id, comment.status === 'open' ? 'resolved' : 'open'); await load(); await onChanged() }} />
      )}
    </div>
  )
}

function ThreadComposer({
  kinds,
  kind,
  onKind,
  message,
  onMessage,
  onSend,
  sendLabel,
  busy = false,
}: {
  kinds: NonNullable<CollaborationThread['kind']>[]
  kind?: NonNullable<CollaborationThread['kind']>
  onKind?: (kind: NonNullable<CollaborationThread['kind']>) => void
  message: string
  onMessage: (value: string) => void
  onSend: () => void
  sendLabel: string
  busy?: boolean
}) {
  return (
    <div className="grid gap-2 sm:grid-cols-[150px_1fr_auto]">
      {onKind && kinds.length > 1 ? (
        <select value={kind} onChange={(event) => onKind(event.target.value as NonNullable<CollaborationThread['kind']>)} className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm" aria-label="Message type">
          {kinds.map((item) => (
            <option key={item} value={item}>{KIND_LABEL[item]}</option>
          ))}
        </select>
      ) : (
        <span />
      )}
      <input
        value={message}
        onChange={(event) => onMessage(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault()
            onSend()
          }
        }}
        placeholder="Write a message…"
        aria-label="Message"
        className="rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-sm"
      />
      <button type="button" onClick={onSend} disabled={busy || !message.trim()} className="rounded-xl bg-brand-primary px-4 py-2 text-sm font-semibold text-white disabled:opacity-40">
        {sendLabel}
      </button>
    </div>
  )
}

function ThreadList({ comments, onToggle }: { comments: (CollaborationThread & { attachment?: { uploadId: string; fileName: string } })[]; onToggle?: (comment: ServerComment) => Promise<void> }) {
  if (comments.length === 0) return <p className="mt-3 rounded-xl border border-dashed border-slate-200 px-3 py-4 text-sm text-slate-400">No messages yet.</p>
  return (
    <ul className="mt-3 space-y-2">
      {comments.map((comment) => (
        <li key={comment.id} className={`rounded-xl border px-3 py-2 ${comment.senderRole === 'client' ? 'border-slate-100 bg-white' : 'border-sky-100 bg-sky-50'}`}>
          <div className="flex items-start justify-between gap-2">
            <p className="text-xs font-semibold text-slate-700">
              {comment.senderRole}
              <span className="ml-1 font-normal text-slate-400">
                · {KIND_LABEL[comment.kind ?? 'comment']} · {new Date(comment.createdAt).toLocaleString()}
              </span>
            </p>
            {onToggle ? (
              <button type="button" onClick={() => void onToggle(comment as ServerComment)} className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold ${comment.status === 'resolved' ? 'border-emerald-200 text-emerald-700' : 'border-slate-200 text-slate-500'}`}>
                <Check className="h-3 w-3" /> {comment.status === 'resolved' ? 'Resolved' : 'Mark resolved'}
              </button>
            ) : (
              <span className="text-[11px] text-slate-400">{comment.status}</span>
            )}
          </div>
          <p className="mt-1 whitespace-pre-line text-sm text-slate-700">{comment.message}</p>
          {comment.attachment && (
            <button type="button" onClick={() => void downloadStoredFile(comment.attachment!.uploadId, comment.attachment!.fileName)} className="mt-1 inline-flex items-center gap-1 text-xs font-semibold text-brand-primary underline-offset-2 hover:underline">
              <Download className="h-3.5 w-3.5" /> {comment.attachment.fileName}
            </button>
          )}
        </li>
      ))}
    </ul>
  )
}
