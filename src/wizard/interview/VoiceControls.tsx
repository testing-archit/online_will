import { Loader2, Mic, Square, Upload } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { storeFileOnBackend, transcribeSpeechWithBackend } from '../../lib/backendClient'
import {
  isDictationSupported,
  isRecordingSupported,
  startDictation,
  startRecording,
  toWavFile,
  type DictationHandle,
  type RecordingHandle,
} from '../../lib/voice'

const MAX_AUDIO_BYTES = 18 * 1024 * 1024

type Mode = 'idle' | 'dictating' | 'recording' | 'transcribing'

/**
 * Speech input for a text field. "Dictate" streams speech straight into the
 * field (browser speech recognition); "Record" captures audio and sends it to
 * the backend for transcription, which copes better with Hindi/Hinglish.
 * Either way the text lands in the field for the user to review before sending.
 */
export function VoiceControls({
  value,
  onChange,
  locale,
  languageHint,
}: {
  value: string
  onChange: (next: string) => void
  locale: string
  languageHint: string
}) {
  const [mode, setMode] = useState<Mode>('idle')
  const [message, setMessage] = useState('')
  const dictation = useRef<DictationHandle | null>(null)
  const recording = useRef<RecordingHandle | null>(null)
  const baseText = useRef('')

  useEffect(
    () => () => {
      dictation.current?.stop()
      recording.current?.cancel()
    },
    [],
  )

  function toggleDictation() {
    if (mode === 'dictating') {
      dictation.current?.stop()
      return
    }
    setMessage('')
    baseText.current = value.trim()
    const handle = startDictation({
      lang: locale,
      onText: (text) => onChange([baseText.current, text].filter(Boolean).join(' ')),
      onEnd: () => {
        dictation.current = null
        setMode('idle')
      },
      onError: setMessage,
    })
    if (!handle) {
      setMessage('Speech recognition is not available in this browser — try Record instead.')
      return
    }
    dictation.current = handle
    setMode('dictating')
  }

  async function toggleRecording() {
    if (mode === 'recording') {
      const handle = recording.current
      recording.current = null
      if (!handle) return
      setMode('transcribing')
      try {
        const file = await handle.stop()
        await transcribe(file)
      } catch {
        setMessage('Recording failed.')
      } finally {
        setMode('idle')
      }
      return
    }
    setMessage('')
    try {
      recording.current = await startRecording()
      setMode('recording')
    } catch {
      setMessage('Microphone access was denied or is unavailable.')
    }
  }

  async function transcribe(original: File) {
    const file = await toWavFile(original)
    if (file.size > MAX_AUDIO_BYTES) {
      setMessage('That recording is too long to transcribe — keep it under a few minutes.')
      return
    }
    const uploadId = await storeFileOnBackend(file, 'audio')
    if (!uploadId) {
      setMessage('Could not reach the server to transcribe. Type your answer instead.')
      return
    }
    const result = await transcribeSpeechWithBackend({ uploadId }, languageHint)
    const text = result?.transcript?.trim() || result?.normalizedEnglishSummary?.trim()
    if (!text) {
      setMessage('Transcription is unavailable right now (AI is not configured or the audio was unclear).')
      return
    }
    onChange([value.trim(), text].filter(Boolean).join(' '))
  }

  async function onAudioFile(file: File | undefined) {
    if (!file) return
    setMode('transcribing')
    setMessage('')
    try {
      await transcribe(file)
    } finally {
      setMode('idle')
    }
  }

  const busy = mode === 'transcribing'
  const button = 'inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold transition disabled:opacity-40'

  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap items-center gap-2">
        {isDictationSupported() && (
          <button
            type="button"
            onClick={toggleDictation}
            disabled={busy || mode === 'recording'}
            aria-pressed={mode === 'dictating'}
            className={`${button} ${mode === 'dictating' ? 'border-rose-300 bg-rose-50 text-rose-700' : 'border-slate-200 bg-white text-slate-600 hover:border-brand-secondary'}`}
          >
            {mode === 'dictating' ? <Square className="h-3.5 w-3.5" /> : <Mic className="h-3.5 w-3.5" />}
            {mode === 'dictating' ? 'Stop dictation' : 'Dictate'}
          </button>
        )}
        {isRecordingSupported() && (
          <button
            type="button"
            onClick={() => void toggleRecording()}
            disabled={busy || mode === 'dictating'}
            aria-pressed={mode === 'recording'}
            className={`${button} ${mode === 'recording' ? 'border-rose-300 bg-rose-50 text-rose-700' : 'border-slate-200 bg-white text-slate-600 hover:border-brand-secondary'}`}
          >
            {mode === 'recording' ? <Square className="h-3.5 w-3.5" /> : <Mic className="h-3.5 w-3.5" />}
            {mode === 'recording' ? 'Stop & transcribe' : 'Record'}
          </button>
        )}
        <label className={`${button} cursor-pointer border-slate-200 bg-white text-slate-600 hover:border-brand-secondary ${busy || mode !== 'idle' ? 'pointer-events-none opacity-40' : ''}`}>
          <Upload className="h-3.5 w-3.5" /> Upload audio
          <input
            type="file"
            accept="audio/*"
            className="hidden"
            onChange={(event) => {
              void onAudioFile(event.target.files?.[0])
              event.target.value = ''
            }}
          />
        </label>
        {busy && (
          <span className="inline-flex items-center gap-1 text-xs text-slate-500">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> Transcribing…
          </span>
        )}
        {mode === 'dictating' && <span className="text-xs text-rose-600">Listening…</span>}
        {mode === 'recording' && <span className="text-xs text-rose-600">Recording…</span>}
      </div>
      {message && (
        <p className="text-xs text-amber-700" role="status">
          {message}
        </p>
      )}
    </div>
  )
}
