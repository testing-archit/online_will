import { AlertTriangle, Check, ClipboardList, Download, Loader2, Video } from 'lucide-react'
import { useState } from 'react'
import { useFormContext } from 'react-hook-form'
import { analyzeExecutionVideoWithBackend, downloadStoredFile, storeFileOnBackend } from '../../lib/backendClient'
import { generateDraftText } from '../../lib/draftText'
import { fullExecutionChecklist } from '../../lib/estateOs'
import { fingerprint, newId } from '../../lib/id'
import type { ExecutionVideoAnalysis, WillData } from '../../lib/types'
import { Field, TextArea } from '../fields'
import { OsPanel } from './OsUi'

const MAX_RECORDING_BYTES = 200 * 1024 * 1024

export function ExecutionPanel() {
  const { watch, setValue, getValues } = useFormContext<WillData>()
  const data = watch()
  const [status, setStatus] = useState<{ tone: 'info' | 'error'; text: string } | null>(null)
  const [busy, setBusy] = useState(false)

  const checklist = fullExecutionChecklist(data)
  const currentVersion = fingerprint(generateDraftText(data))

  function toggle(id: string, currentlyCompleted: boolean, auto: boolean) {
    if (auto) return // verified from recorded data; nothing to toggle
    const stored = getValues().estateOs.executionChecklist
    const exists = stored.some((item) => item.id === id)
    const label = checklist.find((item) => item.id === id)?.label ?? id
    setValue(
      'estateOs.executionChecklist',
      exists ? stored.map((item) => (item.id === id ? { ...item, completed: !currentlyCompleted } : item)) : [...stored, { id, label, completed: true }],
      { shouldDirty: true },
    )
  }

  /**
   * Store the recording securely, tie it to the Will text it was made for, and
   * (when possible) get AI review assistance. The AI reports observable events
   * only; a human reviewer must mark the analysis reviewed.
   */
  async function attachRecording(file: File) {
    setBusy(true)
    setStatus(null)
    try {
      if (file.size > MAX_RECORDING_BYTES) return setStatus({ tone: 'error', text: `Recordings can be up to ${MAX_RECORDING_BYTES / 1024 / 1024}MB.` })
      const willVersion = fingerprint(generateDraftText(getValues()))
      const uploadId = await storeFileOnBackend(file, 'execution-recording')
      if (!uploadId) return setStatus({ tone: 'error', text: 'The server is unreachable, so the recording was not stored. Try again when you are online.' })

      const result = await analyzeExecutionVideoWithBackend({
        fileName: file.name,
        mimeType: file.type || 'video/mp4',
        uploadId,
        recordingMetadata: getValues().estateOs.executionRecordingMetadata,
        willVersion,
      })
      const analysis: ExecutionVideoAnalysis =
        result?.analysis ?? {
          id: newId(),
          fileName: file.name,
          uploadId,
          willVersion,
          createdAt: new Date().toISOString(),
          signingDetected: null,
          witnessesPresent: null,
          willReadingDetected: null,
          participantNotes: '',
          timelineNotes: '',
          rawSummary: 'The recording is stored securely. AI analysis was unavailable — it needs manual review.',
          status: 'pending_review',
        }
      setValue('estateOs.executionVideoAnalyses', [{ ...analysis, uploadId, willVersion }, ...getValues().estateOs.executionVideoAnalyses], { shouldDirty: true })
      setStatus({ tone: 'info', text: 'Recording stored and linked to this version of your Will.' })
    } finally {
      setBusy(false)
    }
  }

  function markReviewed(id: string) {
    setValue(
      'estateOs.executionVideoAnalyses',
      getValues().estateOs.executionVideoAnalyses.map((item) => (item.id === id ? { ...item, status: 'reviewed' as const } : item)),
      { shouldDirty: true },
    )
  }

  return (
    <OsPanel icon={ClipboardList} title="Execution checklist, room, and recording management">
      <div className="grid gap-2 sm:grid-cols-2">
        {checklist.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => toggle(item.id, item.completed, item.auto)}
            aria-pressed={item.completed}
            className={`flex items-center gap-2 rounded-xl border px-3 py-2 text-left text-sm ${item.completed ? 'border-emerald-200 bg-emerald-50 text-emerald-900' : 'border-slate-200 bg-white text-slate-700'}`}
          >
            <Check className={`h-4 w-4 shrink-0 ${item.completed ? '' : 'opacity-20'}`} />
            <span className="flex-1">
              {item.label}
              {item.auto && <span className="block text-[11px] font-normal text-emerald-700">Verified from your answers · {item.hint}</span>}
            </span>
          </button>
        ))}
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <Field label="Execution room notes">
          <TextArea value={data.estateOs.executionRoomNotes} onChange={(event) => setValue('estateOs.executionRoomNotes', event.target.value, { shouldDirty: true })} />
        </Field>
        <Field label="Execution recording metadata" hint="Date, venue, who was present.">
          <TextArea value={data.estateOs.executionRecordingMetadata} onChange={(event) => setValue('estateOs.executionRecordingMetadata', event.target.value, { shouldDirty: true })} />
        </Field>
      </div>

      <div className="mt-4 rounded-xl border border-slate-100 bg-slate-50 p-3">
        <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-slate-700">
          <Video className="h-4 w-4" /> Execution recording
        </div>
        <p className="mb-2 text-xs text-slate-500">
          The recording is stored securely and linked to the version of the Will it was made for. AI review assistance lists observable events (signing, witnesses,
          reading aloud) with timestamps for a human reviewer — it does not establish capacity, absence of undue influence, or validity.
        </p>
        <label className={`inline-flex cursor-pointer items-center gap-1.5 rounded-full border border-brand-secondary px-3 py-1 text-xs font-semibold text-brand-secondary-ink ${busy ? 'pointer-events-none opacity-50' : ''}`}>
          {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          {busy ? 'Uploading and analysing…' : 'Upload recording'}
          <input
            type="file"
            accept="video/*"
            className="sr-only"
            disabled={busy}
            onChange={(event) => {
              const file = event.target.files?.[0]
              event.target.value = ''
              if (file) void attachRecording(file)
            }}
          />
        </label>
        {status && (
          <p className={`mt-2 text-xs ${status.tone === 'error' ? 'text-rose-600' : 'text-emerald-700'}`} role="status">
            {status.text}
          </p>
        )}
        <div className="mt-3 space-y-2">
          {data.estateOs.executionVideoAnalyses.slice(0, 5).map((analysis) => {
            const stale = analysis.willVersion && analysis.willVersion !== currentVersion
            return (
              <div key={analysis.id} className="rounded-xl border border-slate-200 bg-white px-3 py-2">
                <p className="text-sm font-semibold text-slate-800">{analysis.fileName}</p>
                <p className="text-[11px] text-slate-400">
                  {new Date(analysis.createdAt).toLocaleString()} {analysis.willVersion ? `· Will version ${analysis.willVersion.slice(0, 8)}` : ''}
                  {analysis.uploadId ? ' · stored' : ' · not stored'}
                </p>
                {stale && (
                  <p className="mt-1 flex items-center gap-1 text-xs text-amber-700">
                    <AlertTriangle className="h-3.5 w-3.5" /> The Will text has changed since this recording was made.
                  </p>
                )}
                <p className="mt-1 text-xs text-slate-600">
                  Signing: {observation(analysis.signingDetected)} · Witnesses: {observation(analysis.witnessesPresent)} · Reading: {observation(analysis.willReadingDetected)}
                </p>
                {analysis.timelineNotes && <p className="mt-1 whitespace-pre-line text-xs text-slate-500">{analysis.timelineNotes}</p>}
                {analysis.participantNotes && <p className="mt-1 text-xs text-slate-500">{analysis.participantNotes}</p>}
                {analysis.rawSummary && <p className="mt-1 text-xs text-slate-500">{analysis.rawSummary}</p>}
                <div className="mt-2 flex flex-wrap gap-2">
                  <button type="button" onClick={() => markReviewed(analysis.id)} disabled={analysis.status === 'reviewed'} className="rounded-full border border-slate-200 px-3 py-1 text-xs font-semibold text-slate-500 disabled:border-emerald-200 disabled:text-emerald-700">
                    {analysis.status === 'reviewed' ? 'Reviewed by human reviewer' : 'Mark as reviewed'}
                  </button>
                  {analysis.uploadId && (
                    <button type="button" onClick={() => void downloadStoredFile(analysis.uploadId!, analysis.fileName)} className="inline-flex items-center gap-1 rounded-full border border-slate-200 px-3 py-1 text-xs font-semibold text-slate-600">
                      <Download className="h-3.5 w-3.5" /> Download recording
                    </button>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </OsPanel>
  )
}

function observation(value: boolean | null) {
  if (value === true) return 'detected'
  if (value === false) return 'not detected'
  return 'not observable'
}
