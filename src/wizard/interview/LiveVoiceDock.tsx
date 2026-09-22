import { Loader2, Mic, MicOff, PhoneOff, Undo2, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { createLiveSessionFromApi } from '../../lib/backendClient'
import { toAiSnapshot } from '../../lib/aiSnapshot'
import { newlyAnswered, screenSignature, screenUpdateMessage, type LiveContext, type SectionStatus, type SentScreen } from '../../lib/assistantContext'
import type { ListEdit } from '../../lib/liveEdits'
import { clearFocus, flashPaths, focusQuestion } from '../../lib/liveHighlight'
import { startLiveConversation, type LiveHandle, type LiveState } from '../../lib/liveVoice'
import type { WillData } from '../../lib/types'
import type { LiveApplyResult, LiveChange } from './useInterview'

/** Languages she can be pinned to (Gemini Live speaks all of them); "auto" follows whoever is talking. */
const LIVE_LANGUAGE_CHOICES = [
  { id: 'auto', label: 'Auto-detect (any language)' },
  { id: 'en', label: 'English' },
  { id: 'hi', label: 'हिन्दी (Hindi)' },
  { id: 'hinglish', label: 'Hinglish' },
  { id: 'mr', label: 'मराठी (Marathi)' },
  { id: 'gu', label: 'ગુજરાતી (Gujarati)' },
  { id: 'bn', label: 'বাংলা (Bengali)' },
  { id: 'ta', label: 'தமிழ் (Tamil)' },
  { id: 'te', label: 'తెలుగు (Telugu)' },
  { id: 'kn', label: 'ಕನ್ನಡ (Kannada)' },
  { id: 'ml', label: 'മലയാളം (Malayalam)' },
  { id: 'pa', label: 'ਪੰਜਾਬੀ (Punjabi)' },
] as const

/** She opens the conversation herself, in the language they pinned (English until they speak, on auto). */
const opening = (language: string) =>
  `[Screen update] The person has just started the live conversation${language === 'auto' ? '' : ` and chose ${LIVE_LANGUAGE_CHOICES.find((item) => item.id === language)?.label ?? language}`}. Open like a real person picking up, not a script: a quick, warm "Hi, I'm Samaira from Octaraa" said in your own words, then their first name if you know it, all in one natural breath with a smile in your voice. Then ask the first open question on the screen.`

const LANGUAGE_KEY = 'octaraa-live-language'

/** The language they pinned last time, so speech recognition is not left guessing on every call. */
function rememberedLanguage() {
  try {
    const saved = window.localStorage.getItem(LANGUAGE_KEY)
    return LIVE_LANGUAGE_CHOICES.some((choice) => choice.id === saved) ? (saved as string) : 'auto'
  } catch {
    return 'auto'
  }
}

const STATUS_LABEL: Record<SectionStatus, string> = { complete: 'Done', 'in-progress': 'In progress', 'not-started': 'Not started', optional: 'Optional' }

type ApplyDetails = { beneficiaries?: unknown; fieldUpdates?: unknown; listEdits?: ListEdit[] }
type Phase = LiveState | 'off'

/** What comes back to Samaira after a change: what was done, what was refused and why, and what is still open. */
function editReply(result: LiveApplyResult, screen: LiveContext) {
  return {
    ok: result.applied > 0,
    ...(result.applied ? { applied: result.applied, changes: result.changes, note: 'It is already in their form, and lit up on their screen. They can say "undo that".' } : {}),
    ...(result.problems.length ? { problems: result.problems } : {}),
    stillOpen: screen.openQuestions,
    lists: screen.lists,
    nextStepId: screen.nextStepId,
  }
}

const PHASE_LABEL: Record<Phase, string> = { off: 'Ready', connecting: 'Connecting', listening: 'Listening', speaking: 'Samaira is speaking', ended: '' }

/**
 * The voice. A living orb that moves with whoever is talking (your microphone when you speak, her voice when she
 * does), so it is obvious at a glance who has the floor and that she can hear you.
 */
function VoiceOrb({ phase, level, outputLevel, muted }: { phase: Phase; level: number; outputLevel: number; muted: boolean }) {
  const speaking = phase === 'speaking'
  const energy = phase === 'connecting' ? 0 : speaking ? outputLevel : muted ? 0 : level
  const core = muted
    ? 'bg-[radial-gradient(circle_at_30%_30%,#cbd5e1,#64748b_60%,#334155)]'
    : speaking
      ? 'bg-[radial-gradient(circle_at_30%_30%,#ffffff,#a5b4fc_50%,#5b6cff)]'
      : 'bg-[radial-gradient(circle_at_30%_30%,#ffc48a,#fe7f00_55%,#c25f00)]'
  return (
    <div className="relative flex h-[76px] w-[76px] shrink-0 items-center justify-center sm:h-[92px] sm:w-[92px]" aria-hidden>
      {/* Halos start at the size of the orb and grow with the voice, but never past this box, so nothing is clipped. */}
      {[1.42, 1.2].map((reach, index) => (
        <span
          key={reach}
          className={`absolute h-[52px] w-[52px] rounded-full transition-transform duration-100 ease-out motion-reduce:transition-none sm:h-[62px] sm:w-[62px] ${speaking ? 'bg-indigo-300' : 'bg-brand-secondary'}`}
          style={{ transform: `scale(${1 + energy * (reach - 1)})`, opacity: (index === 0 ? 0.18 : 0.3) * (0.3 + energy) }}
        />
      ))}
      <span
        className={`orb-core relative h-[52px] w-[52px] rounded-full shadow-[0_0_28px_rgba(254,127,0,0.45)] transition-transform duration-100 ease-out motion-reduce:transition-none sm:h-[62px] sm:w-[62px] ${core} ${phase === 'connecting' ? 'orb-connecting' : phase === 'listening' && energy < 0.06 ? 'orb-breathe' : ''}`}
        style={{ transform: `scale(${1 + energy * 0.12})` }}
      />
      {phase === 'connecting' && <Loader2 className="absolute h-6 w-6 animate-spin text-white/90" />}
    </div>
  )
}

/**
 * Talk to Samaira, hands-free. Opened with one tap, it is a call: an orb that moves with the voices, live subtitles of
 * what is being said, the question she is on (tappable if you would rather tap), a step-by-step progress bar and a
 * feed of everything she has filled in, undoable by voice ("undo that") or with a tap. The form stays fully visible
 * above it: what she fills in lights up, and the question she is asking is outlined and scrolled into view.
 */
export function LiveVoiceDock({
  getData,
  getContextFor,
  currentStepId,
  pendingCount,
  liveChanges,
  autoStart = false,
  panelOpen = false,
  onNavigate,
  onTurn,
  onApply,
  onUndo,
  onClose,
}: {
  getData: () => WillData
  /** The screen for a given step, built from the form as it is right now. */
  getContextFor: (stepId: string) => LiveContext
  currentStepId: string
  pendingCount: number
  liveChanges: LiveChange[]
  /** Start the call as soon as the dock opens (it was opened by tapping "Talk"). */
  autoStart?: boolean
  /** The chat panel is open on the right: keep clear of it. */
  panelOpen?: boolean
  onNavigate: (stepId: string) => void
  onTurn: (turn: { user: string; samaira: string }) => void
  onApply: (statement: string, details: ApplyDetails) => LiveApplyResult
  onUndo: () => string | null
  /** The call ended (or the person closed the dock). */
  onClose: () => void
}) {
  const [phase, setPhase] = useState<Phase>('off')
  const [level, setLevel] = useState(0)
  const [outputLevel, setOutputLevel] = useState(0)
  const [muted, setMuted] = useState(false)
  const [notice, setNotice] = useState('')
  const [caption, setCaption] = useState({ user: '', samaira: '' })
  const [lastSamaira, setLastSamaira] = useState('')
  const [lastUser, setLastUser] = useState('')
  const [language, setLanguage] = useState(rememberedLanguage)

  const handle = useRef<LiveHandle | null>(null)
  const starting = useRef(false)
  // Set when the call ended because of an error, so the dock stays open to say why instead of vanishing.
  const phaseNoticeRef = useRef(false)
  const sendText = useRef<((text: string) => void) | null>(null)
  const interruptWith = useRef<((text: string) => void) | null>(null)
  const phaseRef = useRef<Phase>('off')
  const sentSignature = useRef('')
  const sentScreen = useRef<SentScreen | undefined>(undefined)
  // Always the latest props, for the long-running session callbacks.
  const latest = useRef({ getData, getContextFor, currentStepId, pendingCount, onNavigate, onTurn, onApply, onUndo, onClose })
  useEffect(() => {
    latest.current = { getData, getContextFor, currentStepId, pendingCount, onNavigate, onTurn, onApply, onUndo, onClose }
  })
  useEffect(() => {
    phaseRef.current = phase
  }, [phase])

  /** The screen plus every value recorded, so changing an already-answered field by hand counts as a change she must hear about. */
  function fullSignature(screen: LiveContext) {
    return `${screenSignature(screen)}|${JSON.stringify(toAiSnapshot(latest.current.getData()))}`
  }

  /** Remember what she was last told (signature to detect changes, questions to say what got answered). */
  function markSent(screen: LiveContext) {
    sentSignature.current = fullSignature(screen)
    sentScreen.current = { stepId: screen.currentStep.id, openQuestions: screen.openQuestions }
  }

  const context = getContextFor(currentStepId)
  const signature = fullSignature(context)
  const running = phase !== 'off'

  // The screen mirrors the conversation: the question being asked is outlined and in view.
  const focusKey = running ? `${context.currentStep.id}|${context.focus?.path ?? ''}|${context.focus?.label ?? ''}` : ''
  useEffect(() => {
    if (!focusKey) {
      clearFocus()
      return
    }
    focusQuestion(latest.current.getContextFor(latest.current.currentStepId).focus)
    return clearFocus
  }, [focusKey])

  const staleWhileSpeaking =
    phase === 'speaking' && (newlyAnswered(context, sentScreen.current).length > 0 || (sentScreen.current !== undefined && sentScreen.current.stepId !== context.currentStep.id))

  // The person tapped, edited a field or moved to another step: tell her what is on screen now. Normally that waits until she
  // is not mid-sentence, but if what she is saying is now stale (the question she is asking got answered, or they moved to
  // another step) she is cut off, so she never finishes asking something that is already done.
  useEffect(() => {
    if ((phase !== 'listening' && phase !== 'speaking') || !sendText.current || signature === sentSignature.current) return
    if (phase === 'speaking' && !staleWhileSpeaking) return
    const timer = window.setTimeout(() => {
      const now = phaseRef.current
      if ((now !== 'listening' && now !== 'speaking') || !sendText.current) return
      const current = latest.current
      const fresh = current.getContextFor(current.currentStepId)
      const previous = sentScreen.current
      markSent(fresh)
      const message = screenUpdateMessage(fresh, current.pendingCount, previous, toAiSnapshot(current.getData()))
      if (now === 'speaking' && interruptWith.current) interruptWith.current(message)
      else sendText.current(message)
    }, phase === 'speaking' ? 600 : 1200)
    return () => window.clearTimeout(timer)
  }, [signature, phase, staleWhileSpeaking])

  useEffect(
    () => () => {
      handle.current?.stop()
      handle.current = null
    },
    [],
  )

  /** Apply something and keep the screen honest: light up what changed, and don't echo it back to her as a screen update. */
  function apply(statement: string, details: ApplyDetails): LiveApplyResult & { screen: LiveContext } {
    const now = latest.current
    const result = now.onApply(statement, details)
    if (result.focus.length) flashPaths(result.focus)
    const screen = now.getContextFor(now.currentStepId)
    markSent(screen)
    return { ...result, screen }
  }

  async function start() {
    if (handle.current || starting.current) return
    starting.current = true
    phaseNoticeRef.current = false
    setNotice('')
    setCaption({ user: '', samaira: '' })
    setLastSamaira('')
    setLastUser('')
    setMuted(false)
    setPhase('connecting')
    const current = latest.current
    const startContext = current.getContextFor(current.currentStepId)
    const created = await createLiveSessionFromApi(current.getData(), startContext as never, language)
    if (!created.ok || !created.session) {
      starting.current = false
      setPhase('off')
      setNotice(created.error ? `Live voice is not available right now (${created.error}). The standard voice still works.` : 'Live voice is not available right now.')
      return
    }
    markSent(startContext)
    try {
      const started = await startLiveConversation(
        created.session,
        {
          onState: (next) => {
            if (next === 'ended') {
              const wasStarted = Boolean(handle.current)
              handle.current = null
              sendText.current = null
              interruptWith.current = null
              starting.current = false
              setLevel(0)
              setOutputLevel(0)
              setPhase('off')
              // A call that ended normally closes the dock; one that failed stays open with the reason.
              if (wasStarted && !phaseNoticeRef.current) latest.current.onClose()
            } else setPhase(next)
          },
          onLevel: setLevel,
          onOutputLevel: setOutputLevel,
          onCaption: setCaption,
          onTurn: (turn) => {
            if (turn.user) setLastUser(turn.user)
            if (turn.samaira) setLastSamaira(turn.samaira)
            latest.current.onTurn(turn)
          },
          onToolCall: (name, args, heard) => {
            const now = latest.current
            if (name === 'go_to_step') {
              const stepId = typeof args.stepId === 'string' ? args.stepId : ''
              const target = now.getContextFor(stepId)
              if (!stepId || target.currentStep.id !== stepId) return { ok: false, error: 'That step does not exist.' }
              now.onNavigate(stepId)
              // The screen she asked for is what she now sees; don't also send it as an update once React catches up.
              markSent(target)
              return { ok: true, screen: target }
            }
            if (name === 'record_estate_details') {
              const { screen, ...result } = apply(heard, { beneficiaries: args.beneficiaries, fieldUpdates: args.fieldUpdates })
              return editReply(result, screen)
            }
            if (name === 'edit_list') {
              const { screen, ...result } = apply(heard, { listEdits: [{ list: args.list, action: args.action, match: args.match, values: args.values }] })
              return editReply(result, screen)
            }
            if (name === 'undo_last_change') {
              const undone = now.onUndo()
              markSent(now.getContextFor(now.currentStepId))
              return undone ? { ok: true, undone } : { ok: false, error: 'There is nothing to undo.' }
            }
            return { ok: false, error: 'Unknown tool.' }
          },
          onError: (message) => {
            phaseNoticeRef.current = true
            setNotice(message)
          },
        },
        {
          greeting: opening(language),
          // Called on a dropped connection (network hiccup, or Google's own 15-minute cutoff), never on a person-initiated stop.
          remint: async (resumeHandle) => {
            const now = latest.current
            const ctx = now.getContextFor(now.currentStepId)
            const minted = await createLiveSessionFromApi(now.getData(), ctx as never, language, resumeHandle)
            return minted.ok && minted.session ? minted.session : null
          },
        },
      )
      handle.current = started
      sendText.current = (text) => started.sendText(text)
      interruptWith.current = (text) => (started.interrupt ? started.interrupt(text) : started.sendText(text))
    } catch (error) {
      handle.current = null
      starting.current = false
      setPhase('off')
      const denied = error instanceof DOMException && (error.name === 'NotAllowedError' || error.name === 'SecurityError')
      setNotice(denied ? 'Microphone access was denied. Allow it in your browser to talk to Samaira.' : 'Could not start the live conversation. Please try again.')
    }
  }
  const started = useRef(false)
  useEffect(() => {
    if (autoStart && !started.current) {
      started.current = true
      void start()
    }
    // Once, when the dock opens by a tap on "Talk".
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function end() {
    if (handle.current) handle.current.stop()
    else onClose()
  }

  function toggleMute() {
    const next = !muted
    setMuted(next)
    handle.current?.setMuted(next)
  }

  /** The person answers by tapping instead of speaking: same path as her own changes. */
  function tapAnswer(path: string, value: string) {
    const result = apply('tapped an answer', { fieldUpdates: [{ path, value }] })
    if (!result.applied && result.problems[0]) setNotice(result.problems[0])
  }

  // The page keeps clear of the dock: it reserves the dock's height at the bottom, so nothing is ever stuck behind it.
  const dockRef = useRef<HTMLElement>(null)
  useEffect(() => {
    const element = dockRef.current
    if (!element || typeof ResizeObserver === 'undefined') return
    const publish = () => document.documentElement.style.setProperty('--live-dock-h', `${element.offsetHeight + 28}px`)
    publish()
    const observer = new ResizeObserver(publish)
    observer.observe(element)
    return () => {
      observer.disconnect()
      document.documentElement.style.removeProperty('--live-dock-h')
    }
  }, [])

  const focus = context.focus
  const latestChange = liveChanges.find((change) => !change.undone)
  const bigIsPerson = !caption.samaira && Boolean(caption.user)
  const big = caption.samaira || caption.user || lastSamaira
  const small = bigIsPerson ? lastSamaira : lastUser
  const stepNumber = context.sections.findIndex((section) => section.id === context.currentStep.id) + 1
  const chip = 'rounded-full border border-white/25 bg-white/10 px-3 py-1 text-xs font-semibold text-white transition hover:bg-white/25 focus-visible:outline-2 focus-visible:outline-brand-secondary'

  return (
    <div className={`pointer-events-none fixed inset-x-0 bottom-3 z-50 flex justify-center px-3 sm:bottom-5 sm:px-4 ${panelOpen ? 'sm:pr-[456px]' : ''}`}>
      <section
        ref={dockRef}
        className="pointer-events-auto w-full max-w-3xl overflow-hidden rounded-3xl border border-white/10 bg-[#050c6c] text-white shadow-[0_24px_60px_-12px_rgba(5,12,108,0.65)]"
        aria-label="Live conversation with Samaira"
      >
        {running && (
          <div className="px-4 pt-3 sm:px-5">
            <ol className="flex gap-1" aria-label="Progress">
              {context.sections.map((section) => {
                const here = section.id === context.currentStep.id
                return (
                  <li key={section.id} className="flex-1">
                    <button
                      type="button"
                      onClick={() => latest.current.onNavigate(section.id)}
                      title={`${section.title} — ${STATUS_LABEL[section.status]}${section.completionPercent !== null ? ` (${section.completionPercent}%)` : ''}`}
                      aria-label={`${section.title}: ${STATUS_LABEL[section.status]}`}
                      aria-current={here ? 'step' : undefined}
                      className={`block h-1.5 w-full rounded-full transition-colors ${here ? 'bg-brand-secondary' : section.status === 'complete' ? 'bg-emerald-400' : section.status === 'in-progress' ? 'bg-white/55' : 'bg-white/20 hover:bg-white/35'}`}
                    />
                  </li>
                )
              })}
            </ol>
            <p className="mt-1.5 text-[11px] font-medium tracking-wide text-white/60">
              Step {stepNumber} of {context.sections.length} · {context.currentStep.title}
            </p>
          </div>
        )}

        <div className="flex items-center gap-3 px-4 py-3 sm:gap-4 sm:px-5 sm:py-4">
          <VoiceOrb phase={phase} level={level} outputLevel={outputLevel} muted={muted} />

          <div className="min-w-0 flex-1" aria-live="polite">
            {running ? (
              <>
                <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-brand-secondary">{muted && phase === 'listening' ? 'Muted' : PHASE_LABEL[phase]}</p>
                <p className="mt-0.5 line-clamp-3 text-base leading-snug font-medium sm:text-lg" data-testid="caption">
                  {big ? (
                    <>
                      {bigIsPerson && <span className="mr-1.5 text-xs font-semibold uppercase text-white/50">You</span>}
                      {big}
                    </>
                  ) : (
                    <span className="text-white/60">Just start talking…</span>
                  )}
                </p>
                {small && <p className="mt-1 line-clamp-1 text-xs text-white/55">{bigIsPerson ? `Samaira: ${small}` : `You: ${small}`}</p>}
              </>
            ) : (
              <>
                <p className="text-base font-semibold sm:text-lg">Talk to Samaira</p>
                <p className="mt-0.5 text-xs leading-relaxed text-white/70">She sees your screen, fills in what you say and takes you to the next question. Just talk. Say "undo that" to take anything back. Headphones work best.</p>
              </>
            )}
          </div>

          <div className="flex shrink-0 items-center gap-2">
            {running ? (
              <>
                <button
                  type="button"
                  onClick={toggleMute}
                  aria-pressed={muted}
                  aria-label={muted ? 'Unmute microphone' : 'Mute microphone'}
                  className={`flex h-11 w-11 items-center justify-center rounded-full border transition ${muted ? 'border-white bg-white text-brand-primary' : 'border-white/25 bg-white/10 text-white hover:bg-white/25'}`}
                >
                  {muted ? <MicOff className="h-5 w-5" /> : <Mic className="h-5 w-5" />}
                </button>
                <button type="button" onClick={end} aria-label="End the conversation" className="flex h-11 items-center gap-1.5 rounded-full bg-rose-500 px-4 text-sm font-semibold text-white transition hover:bg-rose-600">
                  <PhoneOff className="h-4 w-4" /> <span className="hidden sm:inline">End</span>
                </button>
              </>
            ) : (
              <>
                <button type="button" onClick={() => void start()} className="flex h-11 items-center gap-1.5 rounded-full bg-brand-secondary px-5 text-sm font-semibold text-brand-primary transition hover:bg-brand-secondary-hover">
                  <Mic className="h-4 w-4" /> Start live
                </button>
                <button type="button" onClick={onClose} aria-label="Close" className="flex h-11 w-11 items-center justify-center rounded-full border border-white/25 text-white/80 transition hover:bg-white/15">
                  <X className="h-5 w-5" />
                </button>
              </>
            )}
          </div>
        </div>

        <div className="space-y-2 border-t border-white/10 bg-black/15 px-4 py-2.5 sm:px-5">
          {!running && (
          <label className="flex items-center gap-2 text-xs text-white/70">
            <span className="shrink-0">Language</span>
            <select
              value={language}
              onChange={(event) => {
                setLanguage(event.target.value)
                try {
                  window.localStorage.setItem(LANGUAGE_KEY, event.target.value)
                } catch {
                  // remembering the choice is a convenience only
                }
              }}
              disabled={running}
              aria-label="Conversation language"
              className="min-w-0 flex-1 rounded-lg border border-white/20 bg-white/10 px-2 py-1 text-xs font-medium text-white disabled:opacity-60 [&>option]:text-slate-900"
            >
              {LIVE_LANGUAGE_CHOICES.map((choice) => (
                <option key={choice.id} value={choice.id}>
                  {choice.label}
                </option>
              ))}
            </select>
          </label>
          )}

          {running && (
            <div data-testid="now-asking" className="flex flex-wrap items-center gap-x-4 gap-y-1.5 rounded-xl bg-white/10 px-3 py-2">
              {focus ? (
                <>
                  <div className="min-w-0 flex-1 basis-48">
                    <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-brand-secondary">Now asking</p>
                    <p className="text-sm leading-snug font-medium">{focus.label}</p>
                  </div>
                  {focus.path && focus.kind === 'yes-no' && (
                    <div className="flex gap-2">
                      {['Yes', 'No'].map((label) => (
                        <button key={label} type="button" onClick={() => tapAnswer(focus.path!, label === 'Yes' ? 'true' : 'false')} className={chip}>
                          {label}
                        </button>
                      ))}
                    </div>
                  )}
                  {focus.path && focus.kind === 'select' && (
                    <div className="flex flex-wrap gap-1.5">
                      {focus.options?.map((option) => (
                        <button key={option.value} type="button" onClick={() => tapAnswer(focus.path!, option.value)} className={chip}>
                          {option.label}
                        </button>
                      ))}
                    </div>
                  )}
                  {(!focus.path || focus.kind === 'text' || focus.kind === 'textarea' || focus.kind === 'date') && <p className="text-xs text-white/55">Just say it.</p>}
                </>
              ) : (
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-brand-secondary">This step</p>
                  <p className="text-sm text-white/80">Nothing left to answer here{context.nextStepId ? ' — she will take you to the next step.' : '.'}</p>
                </div>
              )}
            </div>
          )}

          {liveChanges.length > 0 && (
            <ul className="space-y-1" aria-label="What Samaira filled in">
              {liveChanges.slice(0, 2).map((change) => (
                <li key={change.id} className={`flex items-start justify-between gap-2 rounded-lg px-2.5 py-1.5 text-xs ${change.undone ? 'bg-white/5 text-white/40 line-through' : 'bg-emerald-400/15 text-emerald-100'}`}>
                  <span className="min-w-0 flex-1">
                    <span aria-hidden>{change.undone ? '↺ ' : '✓ '}</span>
                    {change.summary}
                  </span>
                  {latestChange?.id === change.id && (
                    <button type="button" onClick={() => onUndo()} className="inline-flex shrink-0 items-center gap-1 rounded-full border border-emerald-300/50 px-2 py-0.5 font-semibold text-emerald-100 transition hover:bg-emerald-400/25">
                      <Undo2 className="h-3 w-3" /> Undo
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}

          {notice && (
            <p className="rounded-lg bg-amber-400/15 px-2.5 py-1.5 text-xs text-amber-100" role="status">
              {notice}
            </p>
          )}
        </div>
      </section>
    </div>
  )
}
