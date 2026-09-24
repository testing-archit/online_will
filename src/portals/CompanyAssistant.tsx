'use client'

import { Loader2, Mic, MessageCircle, PhoneOff, Send, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { askAboutOctaraa, createCompanyLiveSessionFromApi } from '../lib/backendClient'
import { LEGAL_KNOWLEDGE_BASE, retrieveLegalSources } from '../lib/legalKnowledge'
import { isLiveSupported, startLiveConversation, type LiveHandle, type LiveState } from '../lib/liveVoice'
import { VoiceOrb, type OrbLevels } from '../components/VoiceOrb'

/** Matches server/live.mjs's LEGAL_LOOKUP_TOOL and END_CALL_TOOL -- kept as literals (not imported) since that
 * module pulls in Node-only pieces the browser bundle shouldn't carry. */
const LEGAL_LOOKUP_TOOL = 'search_legal_information'
const END_CALL_TOOL = 'end_call'
/** If she calls end_call but, for whatever reason, playback never settles back out of 'speaking', hang up anyway
 * after this long rather than leave the call open forever. */
const END_CALL_FALLBACK_MS = 6_000

/**
 * Answers the legal-lookup tool call entirely in the browser: the same curated shared/legal-knowledge.json already
 * bundled for the text widget's offline fallback, so there is no server round trip on top of the Live tool-call
 * round trip -- the whole point of moving this out of the system prompt was to make the common case (no legal
 * question at all) faster, not to make the rare legal one slower.
 */
function lookupLegalInformation(query: string) {
  const matches = retrieveLegalSources(query)
  if (matches.length === 0) return { ok: false, note: 'Not covered by the approved legal knowledge base -- say so plainly and suggest the consultation form, do not guess.' }
  return {
    ok: true,
    sources: matches.map((match) => ({ title: match.title, citation: match.citation, content: LEGAL_KNOWLEDGE_BASE.find((item) => item.id === match.id)?.content ?? '' })),
  }
}

interface Exchange {
  id: number
  /** Undefined for a turn where nothing recognizable was transcribed from the person (e.g. her own opening line,
   * sent before they've said anything) -- rendered as a standalone reply, not a fake "they asked this" bubble. */
  question?: string
  answer?: string
  error?: string
}

const SUGGESTIONS = ['How does this work?', 'Do I need a lawyer?', 'Can I talk in Hindi?', 'Is starting free?']

const GREETING = "Hi, I'm here to answer questions about Octaraa — how it works, the legal review, languages, anything before you start. I don't give personalized legal or financial advice."

/** She opens the voice chat herself, the same way she opens the interview call. */
const VOICE_OPENING = '[Screen update] The person has just started a voice chat about Octaraa on the landing page, before starting a Will. Greet them in one short, warm sentence, then ask what they would like to know.'

type CallPhase = LiveState | 'off'

/**
 * "Ask about Octaraa" — a small Q&A widget, by typing or by voice, for a visitor who has not started a Will yet
 * (no session, so this never touches anything they've entered). Grounded only in Octaraa's approved knowledge base
 * on the server (answerCompanyQuestion / buildCompanyLiveSetup): it says plainly when something (pricing beyond
 * starting for free, the founders, company history) is not covered yet, rather than guess. This is a separate,
 * lighter thing from Samaira's interview voice -- this widget only talks, it never writes to a form, and the call
 * is capped short (server/live.mjs COMPANY_SESSION_MINUTES) since it's a quick FAQ, not a 13-step conversation.
 */
export function CompanyAssistant() {
  const [open, setOpen] = useState(false)
  const [question, setQuestion] = useState('')
  const [exchanges, setExchanges] = useState<Exchange[]>([])
  const [pending, setPending] = useState(false)
  const [callPhase, setCallPhase] = useState<CallPhase>('off')
  const [callNotice, setCallNotice] = useState('')
  // What's being said right now, growing word by word, before the turn is finalized into `exchanges` below.
  const [liveUser, setLiveUser] = useState('')
  const [liveSamaira, setLiveSamaira] = useState('')
  const nextId = useRef(0)
  const scrollRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const call = useRef<LiveHandle | null>(null)
  const callStarting = useRef(false)
  const callLevels = useRef<OrbLevels>({ mic: 0, out: 0 })
  // Mirrors callPhase synchronously for onToolCall's closure, the same reason callLevels is a ref: React state
  // set inside a long-running callback is stale until the next render, and the end-call decision needs the truth now.
  const phaseRef = useRef<CallPhase>('off')
  // Set when she has called end_call: the call is hung up once her goodbye finishes playing (phase leaves
  // 'speaking'), not the instant the tool call arrives -- otherwise the goodbye itself could be cut off mid-word.
  const pendingEndCall = useRef(false)
  const endCallFallback = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const inCall = callPhase !== 'off'

  useEffect(() => {
    if (open && !inCall) inputRef.current?.focus()
    // Only on open/call-end, not on every keystroke -- inCall is read, not depended on, deliberately.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, inCall])

  useEffect(() => {
    // scrollTo isn't implemented in every test/embedding environment (jsdom included); the chat still works without it.
    scrollRef.current?.scrollTo?.({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [exchanges, pending, liveUser, liveSamaira])

  useEffect(
    () => () => {
      call.current?.stop()
      call.current = null
      clearTimeout(endCallFallback.current)
    },
    [],
  )

  async function ask(text: string) {
    const trimmed = text.trim()
    if (!trimmed || pending) return
    const id = nextId.current++
    setExchanges((previous) => [...previous, { id, question: trimmed }])
    setQuestion('')
    setPending(true)
    const result = await askAboutOctaraa(trimmed)
    setPending(false)
    setExchanges((previous) => previous.map((item) => (item.id === id ? { ...item, answer: result.answer, error: result.ok ? undefined : result.error || 'Could not reach the assistant. Please try again.' } : item)))
  }

  async function startCall() {
    if (call.current || callStarting.current) return
    callStarting.current = true
    setCallNotice('')
    setLiveUser('')
    setLiveSamaira('')
    pendingEndCall.current = false
    clearTimeout(endCallFallback.current)
    phaseRef.current = 'connecting'
    setCallPhase('connecting')
    const created = await createCompanyLiveSessionFromApi()
    if (!created.ok || !created.session) {
      callStarting.current = false
      setCallPhase('off')
      setCallNotice(created.error ? `Voice chat is not available right now (${created.error}). You can still type a question.` : 'Voice chat is not available right now. You can still type a question.')
      return
    }
    try {
      const handle = await startLiveConversation(
        created.session,
        {
          onState: (next) => {
            phaseRef.current = next === 'ended' ? 'off' : next
            if (next === 'ended') {
              call.current = null
              callStarting.current = false
              pendingEndCall.current = false
              clearTimeout(endCallFallback.current)
              setCallPhase('off')
              setLiveUser('')
              setLiveSamaira('')
              return
            }
            setCallPhase(next)
            // Her goodbye has now finished playing (phase settled back out of 'speaking') -- hang up for real.
            if (pendingEndCall.current && next !== 'speaking') {
              pendingEndCall.current = false
              clearTimeout(endCallFallback.current)
              call.current?.stop()
            }
          },
          onLevel: (level) => {
            callLevels.current.mic = level
          },
          onOutputLevel: (level) => {
            callLevels.current.out = level
          },
          // Showing what was heard from THEM, live, word by word, is the clearest proof the microphone is working --
          // that's the direct answer to "is my voice even going through", not just a spinner.
          onCaption: (turn) => {
            setLiveUser(turn.user)
            setLiveSamaira(turn.samaira)
          },
          onTurn: (turn) => {
            setLiveUser('')
            setLiveSamaira('')
            if (!turn.user && !turn.samaira) return
            // Her own opening line has no question behind it (nothing was said yet) -- shown as a standalone
            // reply, never as a fabricated "they asked this" bubble.
            setExchanges((previous) => [...previous, { id: nextId.current++, question: turn.user || undefined, answer: turn.samaira || undefined }])
          },
          onToolCall: (name, args) => {
            if (name === LEGAL_LOOKUP_TOOL) return lookupLegalInformation(typeof args.query === 'string' ? args.query : '')
            if (name === END_CALL_TOOL) {
              if (phaseRef.current !== 'speaking') {
                // Her goodbye (if any) has already finished playing -- nothing left to wait for.
                call.current?.stop()
              } else {
                pendingEndCall.current = true
                clearTimeout(endCallFallback.current)
                endCallFallback.current = setTimeout(() => {
                  if (pendingEndCall.current) {
                    pendingEndCall.current = false
                    call.current?.stop()
                  }
                }, END_CALL_FALLBACK_MS)
              }
              return { ok: true }
            }
            return { ok: false, error: 'Unknown tool.' }
          },
          onError: (message) => setCallNotice(message),
        },
        {
          greeting: VOICE_OPENING,
          remint: async (resumeHandle) => {
            const minted = await createCompanyLiveSessionFromApi('auto', resumeHandle)
            return minted.ok && minted.session ? minted.session : null
          },
        },
      )
      call.current = handle
    } catch (error) {
      call.current = null
      callStarting.current = false
      setCallPhase('off')
      const denied = error instanceof DOMException && (error.name === 'NotAllowedError' || error.name === 'SecurityError')
      setCallNotice(denied ? 'Microphone access was denied. Allow it in your browser to talk instead of typing.' : 'Could not start the voice chat. Please try again.')
    }
  }

  function endCall() {
    call.current?.stop()
  }

  // "Thinking…" is grounded in a real signal (their words were actually transcribed this turn), not a timer --
  // that gap between them finishing and her voice starting is exactly what read as "did it hear me?" before.
  const phaseLabel =
    callPhase === 'connecting' ? 'Connecting…' : callPhase === 'speaking' ? 'Speaking…' : callPhase === 'listening' ? (liveUser ? 'Thinking…' : 'Listening…') : ''

  return (
    <div className="fixed right-4 bottom-4 z-40 sm:right-6 sm:bottom-6">
      {open && (
        <section
          aria-label="Ask about Octaraa"
          className="mb-3 flex h-[28rem] w-[calc(100vw-2rem)] max-w-sm flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl shadow-black/20"
        >
          <header className="flex items-center justify-between bg-brand-primary px-4 py-3">
            <p className="text-sm font-semibold text-white">Ask about Octaraa</p>
            <button type="button" onClick={() => setOpen(false)} aria-label="Close" className="rounded-full p-1 text-white/80 transition hover:bg-white/15 hover:text-white">
              <X className="h-4 w-4" />
            </button>
          </header>

          <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto px-4 py-3" aria-live="polite">
            <p className="rounded-xl bg-slate-50 px-3 py-2 text-sm leading-relaxed text-slate-600">{GREETING}</p>
            {exchanges.map((exchange) => (
              <div key={exchange.id} className="space-y-1.5">
                {exchange.question && <p className="ml-auto max-w-[85%] rounded-xl rounded-br-sm bg-brand-primary px-3 py-2 text-sm break-words text-white">{exchange.question}</p>}
                {exchange.error ? (
                  <p className="max-w-[85%] rounded-xl rounded-bl-sm bg-rose-50 px-3 py-2 text-sm text-rose-700">{exchange.error}</p>
                ) : exchange.answer ? (
                  <p className="max-w-[85%] rounded-xl rounded-bl-sm bg-slate-50 px-3 py-2 text-sm leading-relaxed whitespace-pre-line text-slate-700">{exchange.answer}</p>
                ) : (
                  <p className="flex max-w-[85%] items-center gap-1.5 rounded-xl rounded-bl-sm bg-slate-50 px-3 py-2 text-sm text-slate-400">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" /> Thinking…
                  </p>
                )}
              </div>
            ))}
            {inCall && (liveUser || liveSamaira) && (
              // Growing in place as the words arrive, wrapping fully (never truncated) -- this IS the answer while
              // it's still being said, not a preview of it.
              <div className="space-y-1.5" aria-live="polite">
                {liveUser && <p className="ml-auto max-w-[85%] rounded-xl rounded-br-sm bg-brand-primary/70 px-3 py-2 text-sm break-words text-white">{liveUser}</p>}
                {liveSamaira && <p className="max-w-[85%] rounded-xl rounded-bl-sm bg-slate-50 px-3 py-2 text-sm leading-relaxed break-words whitespace-pre-line text-slate-700">{liveSamaira}</p>}
              </div>
            )}
            {exchanges.length === 0 && !inCall && (
              <div className="flex flex-wrap gap-1.5 pt-1">
                {SUGGESTIONS.map((suggestion) => (
                  <button
                    key={suggestion}
                    type="button"
                    onClick={() => void ask(suggestion)}
                    className="rounded-full border border-slate-200 px-2.5 py-1 text-xs font-medium text-slate-600 transition hover:border-brand-secondary hover:text-brand-primary"
                  >
                    {suggestion}
                  </button>
                ))}
              </div>
            )}
            {inCall && !liveUser && !liveSamaira && (
              <div className="flex items-center gap-3 rounded-xl bg-slate-50 px-3 py-2.5">
                <VoiceOrb phase={callPhase} levels={callLevels} muted={false} size="sm" />
                <div className="min-w-0 flex-1">
                  <p className="text-[10px] font-semibold tracking-wide text-brand-secondary-ink uppercase">{phaseLabel}</p>
                  <p className="text-sm text-slate-500">Just start talking…</p>
                </div>
              </div>
            )}
          </div>

          {inCall ? (
            // Fixed, never scrolls away -- the orb and phase stay visible the whole call, whatever the transcript is doing.
            <div className="flex items-center justify-between gap-2 border-t border-slate-200 p-3" data-testid="voice-call">
              <div className="flex min-w-0 items-center gap-2">
                <VoiceOrb phase={callPhase} levels={callLevels} muted={false} size="sm" />
                <p className="truncate text-xs font-medium text-slate-500">{phaseLabel || 'On a call with Samaira'}</p>
              </div>
              <button type="button" onClick={endCall} className="flex h-9 shrink-0 items-center gap-1.5 rounded-full bg-rose-500 px-3 text-sm font-semibold text-white transition hover:bg-rose-600">
                <PhoneOff className="h-3.5 w-3.5" /> End
              </button>
            </div>
          ) : (
            <form
              onSubmit={(event) => {
                event.preventDefault()
                void ask(question)
              }}
              className="flex items-center gap-2 border-t border-slate-200 p-3"
            >
              {isLiveSupported() && (
                // The moment a call starts, callPhase leaves 'off' and this whole form (this button included) is
                // replaced by the in-call bar below -- so this button itself never needs a "connecting" state; that
                // shows in the call bar instead, which renders as soon as inCall flips true.
                <button
                  type="button"
                  onClick={() => void startCall()}
                  aria-label="Talk instead of typing"
                  title="Talk instead of typing"
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-slate-200 text-slate-500 transition hover:border-brand-secondary hover:text-brand-primary"
                >
                  <Mic className="h-4 w-4" />
                </button>
              )}
              <input
                ref={inputRef}
                value={question}
                onChange={(event) => setQuestion(event.target.value)}
                placeholder="Ask a question…"
                maxLength={500}
                aria-label="Your question about Octaraa"
                className="min-w-0 flex-1 rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-800 outline-none focus:border-brand-secondary"
              />
              <button
                type="submit"
                disabled={!question.trim() || pending}
                aria-label="Ask"
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-brand-primary text-white transition hover:bg-brand-primary-hover disabled:opacity-40"
              >
                <Send className="h-4 w-4" />
              </button>
            </form>
          )}
          {callNotice && !inCall && (
            <p className="border-t border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800" role="status">
              {callNotice}
            </p>
          )}
        </section>
      )}

      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-label={open ? 'Close the Octaraa assistant' : 'Ask about Octaraa'}
        className="ml-auto flex h-14 w-14 items-center justify-center rounded-full bg-brand-secondary text-white shadow-lg shadow-black/20 transition hover:bg-brand-secondary-hover"
      >
        {open ? <X className="h-6 w-6" /> : <MessageCircle className="h-6 w-6" />}
      </button>
    </div>
  )
}
