import { Loader2, Mic, PhoneOff, Volume2 } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { getBackendHealth, listenToAudio, storeFileOnBackend, transcribeSpeechWithBackend } from '../../lib/backendClient'
import { detectLanguage } from '../../lib/language'
import {
  cancelSpeech,
  isDictationSupported,
  isRecordingSupported,
  isSpeechSynthesisSupported,
  recordUtterance,
  speakReply,
  startDictation,
  startRecording,
  toWavFile,
  type DictationHandle,
  type RecordingHandle,
  type UtteranceHandle,
} from '../../lib/voice'
import { SelectInput } from '../fields'
import { DICTATION_LOCALE, LANGUAGE_LABEL, type InterviewLanguage, type LanguageChoice, type SendResult } from './useInterview'

type Phase = 'off' | 'speaking' | 'listening' | 'thinking' | 'paused'

const STOP_COMMAND = /^\s*(stop|exit|bye|goodbye|that'?s all|that is all|end (the )?(call|conversation)|bas|bas karo|ruko|band karo|rukiye|alvida|बस|रुको|रुकिए|बंद करो|अलविदा)(\s|$|[.!,])/i
const MAX_SILENT_TURNS = 2

const PHASE_LABEL: Record<Phase, string> = {
  off: '',
  speaking: 'Samaira is speaking…',
  listening: 'Listening — go ahead',
  thinking: 'Thinking…',
  paused: 'Paused',
}

const SPOKEN_NAME: Record<InterviewLanguage, string> = { en: 'English', hi: 'Hindi', hinglish: 'Hinglish' }

const GOODBYE: Record<InterviewLanguage, string> = {
  en: 'Okay, talk soon. Everything I noted is on your screen for review.',
  hi: 'ठीक है, फिर बात करेंगे। जो कुछ मैंने नोट किया है वह आपकी स्क्रीन पर है।',
  hinglish: 'Theek hai, phir baat karte hain. Jo kuch maine note kiya hai woh aapki screen par hai.',
}
const PAUSE_NOTICE: Record<InterviewLanguage, string> = {
  en: "I didn't catch anything, so I'll pause here. Tap Resume whenever you're ready.",
  hi: 'मुझे कुछ सुनाई नहीं दिया, इसलिए मैं यहाँ रुक रही हूँ। जब तैयार हों तो Resume दबाइए।',
  hinglish: 'Mujhe kuch sunai nahi diya, isliye main yahin ruk rahi hoon. Jab ready ho, Resume dabaiye.',
}

/**
 * Hands-free conversation with Samaira. She speaks, listens, replies, and listens again —
 * in whatever language you speak (English, Hindi or Hinglish) unless you pin one.
 *
 * Ears: server speech recognition (Deepgram) with automatic end-of-speech detection when
 * available, otherwise the browser's recognition, otherwise record-and-tap.
 * Voice: server voice for English, the best browser voice for Hindi/Hinglish.
 * Anything she understands lands on screen as a proposal — confirmation is never spoken.
 */
export function ConversationMode({
  send,
  isThinking,
  lastSamairaMessage,
  language,
  onLanguageChange,
}: {
  language: LanguageChoice
  onLanguageChange: (language: LanguageChoice) => void
  send: (text: string, options: { language: LanguageChoice; source: 'voice' }) => Promise<SendResult | null>
  isThinking: boolean
  lastSamairaMessage: string
}) {
  const [phase, setPhase] = useState<Phase>('off')
  const [caption, setCaption] = useState('')
  const [heard, setHeard] = useState('')
  const [notice, setNotice] = useState('')
  const [recordingTurn, setRecordingTurn] = useState(false)
  const [level, setLevel] = useState(0)
  const [detected, setDetected] = useState<InterviewLanguage | null>(null)
  const [serverSpeech, setServerSpeech] = useState(false)
  const [hindiSpeech, setHindiSpeech] = useState(false)

  const active = useRef(false)
  const dictation = useRef<DictationHandle | null>(null)
  const recording = useRef<RecordingHandle | null>(null)
  const utterance = useRef<UtteranceHandle | null>(null)
  const finishRecording = useRef<(() => void) | null>(null)
  // Always use the latest props/callbacks inside the long-running loop.
  const sendRef = useRef(send)
  const languageRef = useRef(language)
  const serverSpeechRef = useRef(false)
  const hindiSpeechRef = useRef(false)
  useEffect(() => {
    sendRef.current = send
    languageRef.current = language
    serverSpeechRef.current = serverSpeech
    hindiSpeechRef.current = hindiSpeech
  }, [send, language, serverSpeech, hindiSpeech])

  useEffect(() => {
    let cancelled = false
    void getBackendHealth().then((health) => {
      if (cancelled) return
      setServerSpeech(Boolean(health?.speechConfigured))
      setHindiSpeech(Boolean(health?.hindiSpeechConfigured))
    })
    return () => {
      cancelled = true
    }
  }, [])

  const canRecord = isRecordingSupported()
  const canListen = isDictationSupported() || canRecord
  const canSpeak = isSpeechSynthesisSupported() || serverSpeech || hindiSpeech

  function teardown() {
    active.current = false
    dictation.current?.stop()
    dictation.current = null
    recording.current?.cancel()
    recording.current = null
    utterance.current?.cancel()
    utterance.current = null
    finishRecording.current = null
    setRecordingTurn(false)
    setLevel(0)
    cancelSpeech()
  }
  useEffect(() => teardown, [])

  /** Best ears available: server recognition with automatic end-of-speech, else browser recognition, else record-and-tap. */
  function listenOnce(): Promise<string> {
    if (serverSpeechRef.current && canRecord) return listenWithServer()
    if (isDictationSupported()) return listenWithBrowser()
    return listenWithTap()
  }

  async function listenWithServer(): Promise<string> {
    try {
      const handle = await recordUtterance({ onLevel: setLevel })
      utterance.current = handle
      const audio = await handle.result
      utterance.current = null
      if (!audio || !active.current) return ''
      setPhase('thinking')
      const result = await listenToAudio(audio, languageRef.current)
      if (!result) setNotice('Could not reach the speech service — check your connection.')
      return (result?.transcript ?? '').trim()
    } catch {
      setNotice('Microphone access was denied or is unavailable.')
      return ''
    }
  }

  function listenWithBrowser(): Promise<string> {
    return new Promise((resolve) => {
      let latest = ''
      const handle = startDictation({
        lang: DICTATION_LOCALE[languageRef.current],
        continuous: false,
        onText: (text) => {
          latest = text
          setHeard(text)
        },
        onEnd: () => {
          dictation.current = null
          resolve(latest.trim())
        },
        onError: (message) => {
          if (!/no speech/i.test(message)) setNotice(message)
        },
      })
      if (!handle) return resolve('')
      dictation.current = handle
    })
  }

  /** Last resort: record until the user taps "I'm done", convert to WAV, transcribe on the server. */
  async function listenWithTap(): Promise<string> {
    try {
      const handle = await startRecording()
      recording.current = handle
      setRecordingTurn(true)
      await new Promise<void>((resolve) => {
        finishRecording.current = resolve
      })
      setRecordingTurn(false)
      recording.current = null
      if (!active.current) {
        handle.cancel()
        return ''
      }
      setPhase('thinking')
      const wav = await toWavFile(await handle.stop())
      const uploadId = await storeFileOnBackend(wav, 'audio')
      if (!uploadId) {
        setNotice('Could not reach the server to transcribe your voice.')
        return ''
      }
      const hint = languageRef.current === 'hi' ? 'hi-IN' : languageRef.current === 'hinglish' ? 'Hinglish' : languageRef.current === 'en' ? 'en-IN' : 'auto'
      const result = await transcribeSpeechWithBackend({ uploadId }, hint)
      return (result?.transcript ?? result?.normalizedEnglishSummary ?? '').trim()
    } catch {
      setNotice('Microphone access was denied or is unavailable.')
      return ''
    }
  }

  async function say(text: string, spokenLanguage: InterviewLanguage) {
    setCaption(text)
    setPhase('speaking')
    await speakReply(text, { language: spokenLanguage, useServerVoice: serverSpeechRef.current, useServerHindiVoice: hindiSpeechRef.current })
  }

  async function start() {
    if (active.current) return
    active.current = true
    setNotice('')
    setHeard('')
    setDetected(null)

    const forced = languageRef.current === 'auto' ? null : languageRef.current
    await say(lastSamairaMessage || "Hi, I'm Samaira from Octaraa. Tell me who should inherit your assets, and I'll note it down.", forced ?? detectLanguage(lastSamairaMessage))
    let silentTurns = 0
    let lastLanguage: InterviewLanguage = forced ?? 'en'

    while (active.current) {
      setPhase('listening')
      setHeard('')
      const said = await listenOnce()
      if (!active.current) break

      if (!said) {
        silentTurns += 1
        if (silentTurns >= MAX_SILENT_TURNS) {
          await say(PAUSE_NOTICE[lastLanguage], lastLanguage)
          if (active.current) setPhase('paused')
          active.current = false
          return
        }
        continue
      }
      silentTurns = 0
      setHeard(said)

      const spokenLanguage: InterviewLanguage = languageRef.current === 'auto' ? detectLanguage(said) : languageRef.current
      lastLanguage = spokenLanguage
      setDetected(spokenLanguage)

      if (STOP_COMMAND.test(said)) {
        await say(GOODBYE[spokenLanguage], spokenLanguage)
        break
      }

      setPhase('thinking')
      const result = await sendRef.current(said, { language: languageRef.current, source: 'voice' })
      if (!active.current) break
      if (result) {
        lastLanguage = result.language
        await say(result.reply, result.language)
      }
    }
    end()
  }

  function end() {
    teardown()
    setPhase('off')
    setCaption('')
    setHeard('')
  }

  const running = phase !== 'off' && phase !== 'paused'

  if (!canListen) {
    return (
      <p className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
        Voice conversation needs a browser with speech recognition (Chrome, Edge or Safari) or microphone access. You can still type below.
      </p>
    )
  }

  return (
    <section className="rounded-xl border border-brand-primary/15 bg-brand-primary/5 p-3.5" aria-label="Talk to Samaira">
      <div>
        <h3 className="text-sm font-semibold text-brand-primary">Talk to Samaira</h3>
        <p className="text-xs leading-relaxed text-slate-500">
          English, Hindi or Hinglish; she answers in the language you speak. Say "stop" any time.
          {!canSpeak && ' This browser cannot speak aloud, so her replies appear as text.'}
        </p>
      </div>
      <div className="mt-3 flex items-center gap-2">
        <div className="min-w-0 flex-1">
          <SelectInput value={language} onChange={(event) => onLanguageChange(event.target.value as LanguageChoice)} disabled={running} aria-label="Conversation language">
            {(Object.keys(LANGUAGE_LABEL) as LanguageChoice[]).map((key) => (
              <option key={key} value={key}>
                {LANGUAGE_LABEL[key]}
              </option>
            ))}
          </SelectInput>
        </div>
        {running ? (
          <button type="button" onClick={end} className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-rose-600 px-4 py-2.5 text-sm font-semibold text-white">
            <PhoneOff className="h-4 w-4" /> End
          </button>
        ) : (
          <button type="button" onClick={() => void start()} className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-brand-primary px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-brand-primary-hover">
            <Mic className="h-4 w-4" /> {phase === 'paused' ? 'Resume' : 'Start talking'}
          </button>
        )}
      </div>

      {(running || phase === 'paused') && (
        <div className="mt-4 space-y-2" aria-live="polite">
          <div className="flex flex-wrap items-center gap-3">
            <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-brand-primary">
              {phase === 'speaking' ? (
                <Volume2 className="h-4 w-4" />
              ) : phase === 'thinking' || isThinking ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <span className="flex h-4 items-end gap-0.5" aria-hidden>
                  {[0.35, 0.7, 1, 0.7, 0.35].map((weight, index) => (
                    <span key={index} className="w-1 rounded-full bg-rose-500 transition-[height] duration-75" style={{ height: `${Math.max(4, Math.round(4 + level * weight * 12))}px` }} />
                  ))}
                </span>
              )}
              {PHASE_LABEL[phase]}
            </p>
            {detected && (
              <span className="rounded-full bg-white px-2 py-0.5 text-[11px] font-semibold text-brand-primary" title="Samaira replies in the language you spoke">
                {language === 'auto' ? 'Detected' : 'Language'}: {SPOKEN_NAME[detected]}
              </span>
            )}
          </div>
          {caption && (
            <p className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700">
              <span className="mr-1 text-[11px] font-semibold uppercase text-slate-400">Samaira</span>
              {caption}
            </p>
          )}
          {heard && (
            <p className="rounded-xl bg-brand-primary px-3 py-2 text-sm text-white">
              <span className="mr-1 text-[11px] font-semibold uppercase opacity-70">You</span>
              {heard}
            </p>
          )}
          {recordingTurn && (
            <button type="button" onClick={() => finishRecording.current?.()} className="rounded-full border border-rose-300 bg-rose-50 px-4 py-1.5 text-xs font-semibold text-rose-700">
              I'm done speaking
            </button>
          )}
        </div>
      )}
      {notice && (
        <p className="mt-2 text-xs text-amber-700" role="status">
          {notice}
        </p>
      )}
    </section>
  )
}
