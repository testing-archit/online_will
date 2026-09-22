import { AnimatePresence, motion } from 'framer-motion'
import { MessageCircle, Mic, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useFormContext } from 'react-hook-form'
import { buildAssistantContext, buildLiveContext, contextGreeting, nextStepAfter, openingLine } from '../../lib/assistantContext'
import { getBackendHealth } from '../../lib/backendClient'
import { isLiveSupported } from '../../lib/liveVoice'
import { detectLanguage } from '../../lib/language'
import type { WillData } from '../../lib/types'
import { useWizardNavigation } from '../navigation'
import { STEPS } from '../stepConfig'
import { ConversationMode } from './ConversationMode'
import { LiveVoiceDock } from './LiveVoiceDock'
import { InterviewComposer, ProposalList } from './InterviewComposer'
import { useInterview, type LanguageChoice } from './useInterview'

/**
 * Samaira, available on every step. A launcher sits bottom-right; it opens a side panel that leaves the form
 * usable beside it. The panel is mounted at the shell, so the conversation and any entries waiting for
 * confirmation survive moving between steps. Closing it ends a live voice conversation (the microphone is
 * released when ConversationMode unmounts).
 */
export function AssistantDock({ stepId }: { stepId: string }) {
  const [isOpen, setOpen] = useState(false)
  const [language, setLanguage] = useState<LanguageChoice>('auto')
  // The context is rebuilt from the live form on every send, so Samaira always knows the current step and what is filled in.
  const { goToStep } = useWizardNavigation()
  const { data, isThinking, aiProblem, pendingProposals, confirmedProposals, send, addSamairaMessage, recordLiveTurn, applyFromLive, undoLiveChange, liveChanges, confirm, dismiss } = useInterview({
    getContext: (current) => buildAssistantContext(current, STEPS, stepId),
  })
  const messages = data.assistantIntake.interviewMessages
  const context = useMemo(() => buildAssistantContext(data, STEPS, stepId), [data, stepId])
  const stepTitle = context.currentStep.title
  const overall = context.overallCompletionPercent
  const open = context.openQuestions
  // Continue from the last thing she said if it is in the language they want; otherwise open on where they are now, in that language.
  const opening = openingLine(context, [...messages].reverse().find((item) => item.role === 'samaira')?.content, language)

  const nextStep = open.length === 0 ? nextStepAfter(context) : null
  // The language she speaks and writes her own questions in: the one they picked, or (on auto) the one they last used.
  const lastUserText = [...messages].reverse().find((item) => item.role === 'user')?.content
  const ownLanguage = language !== 'auto' ? language : lastUserText ? detectLanguage(lastUserText) : 'en'

  // Live voice (real time, any language) is a call of its own: a dock at the bottom, opened with one tap on "Talk".
  const [liveAvailable, setLiveAvailable] = useState(false)
  const [liveOpen, setLiveOpen] = useState(false)
  useEffect(() => {
    let cancelled = false
    void getBackendHealth().then((health) => {
      if (!cancelled) setLiveAvailable(Boolean(health?.liveConfigured) && isLiveSupported())
    })
    return () => {
      cancelled = true
    }
  }, [])
  // Read straight from the form, so a change made a moment ago (by voice) is already in what Samaira sees next.
  const { getValues } = useFormContext<WillData>()

  const panelRef = useRef<HTMLElement>(null)
  const launcherRef = useRef<HTMLButtonElement>(null)
  const endRef = useRef<HTMLDivElement>(null)
  const wasOpen = useRef(false)

  useEffect(() => {
    if (isOpen) panelRef.current?.focus()
    else if (wasOpen.current) launcherRef.current?.focus()
    wasOpen.current = isOpen
  }, [isOpen])

  useEffect(() => {
    if (!isOpen) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [isOpen])

  // Samaira leads: the first time the panel opens she asks the first open question herself.
  useEffect(() => {
    if (isOpen) addSamairaMessage(contextGreeting(context, ownLanguage))
    // Only when the panel opens; later changes are handled below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen])

  // …and when they move to another step mid-conversation she picks up there.
  const hasSpoken = messages.some((item) => item.role === 'user')
  const lastStepRef = useRef(stepId)
  useEffect(() => {
    if (lastStepRef.current === stepId) return
    lastStepRef.current = stepId
    if (isOpen) addSamairaMessage(contextGreeting(context, ownLanguage, { returning: hasSpoken }))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stepId])

  useEffect(() => {
    if (isOpen) endRef.current?.scrollIntoView({ block: 'nearest' })
  }, [isOpen, messages.length, isThinking, pendingProposals.length])

  const waiting = pendingProposals.length

  return (
    <>
      {!isOpen && !liveOpen && (
        <div className="fixed right-4 bottom-4 z-50 flex items-center gap-2 sm:right-6 sm:bottom-6">
          {liveAvailable && (
            <button
              type="button"
              onClick={() => setLiveOpen(true)}
              className="group relative inline-flex items-center gap-2.5 rounded-full bg-brand-secondary py-3 pr-5 pl-3.5 text-sm font-semibold text-brand-primary shadow-[0_16px_32px_-12px_rgba(254,127,0,0.75)] transition hover:bg-brand-secondary-hover"
              aria-label="Talk to Samaira: a hands-free voice conversation that fills in your Will for you"
            >
              <span className="relative flex h-7 w-7 items-center justify-center rounded-full bg-brand-primary text-white">
                <span className="orb-breathe absolute inset-0 rounded-full bg-brand-primary/40" aria-hidden />
                <Mic className="relative h-3.5 w-3.5" />
              </span>
              Talk to Samaira
            </button>
          )}
          <button
            ref={launcherRef}
            type="button"
            onClick={() => setOpen(true)}
            className={`inline-flex items-center gap-2 rounded-full bg-brand-primary text-sm font-semibold text-white shadow-[0_16px_32px_-14px_rgba(5,12,108,0.6)] transition hover:bg-brand-primary-hover ${liveAvailable ? 'py-3 pr-4 pl-3.5' : 'py-3 pr-5 pl-4'}`}
            aria-label={waiting ? `Ask Samaira — ${waiting} ${waiting === 1 ? 'entry is' : 'entries are'} waiting for your confirmation` : 'Ask Samaira, the AI assistant'}
          >
            {liveAvailable ? <MessageCircle className="h-4 w-4 text-brand-secondary" /> : <Mic className="h-4 w-4 text-brand-secondary" />} {liveAvailable ? 'Chat' : 'Ask Samaira'}
            {waiting > 0 && (
              <span className="ml-0.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-brand-secondary px-1.5 text-xs font-bold text-brand-primary" aria-hidden>
                {waiting}
              </span>
            )}
          </button>
        </div>
      )}

      {liveOpen && (
        <LiveVoiceDock
          autoStart
          panelOpen={isOpen}
          getData={getValues}
          getContextFor={(id) => buildLiveContext(getValues(), STEPS, id)}
          currentStepId={stepId}
          pendingCount={pendingProposals.length}
          liveChanges={liveChanges}
          onNavigate={goToStep}
          onTurn={recordLiveTurn}
          onApply={applyFromLive}
          onUndo={undoLiveChange}
          onClose={() => setLiveOpen(false)}
        />
      )}

      <AnimatePresence>
        {isOpen && (
          <motion.aside
            ref={panelRef}
            tabIndex={-1}
            aria-label="Samaira, AI assistant"
            initial={{ x: 32, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: 32, opacity: 0 }}
            transition={{ duration: 0.2, ease: 'easeOut' }}
            className="fixed inset-y-0 right-0 z-50 flex w-full flex-col border-l border-slate-200 bg-white shadow-[-24px_0_48px_-32px_rgba(5,12,108,0.35)] outline-none sm:w-[440px]"
          >
            <header className="flex items-start justify-between gap-4 border-b border-slate-100 px-5 py-4">
              <div>
                <h2 className="text-lg font-semibold text-brand-primary">Samaira</h2>
                <p className="mt-1 max-w-sm text-sm leading-relaxed text-slate-500">
                  Tell her in English, Hindi or Hinglish. She turns it into entries, and nothing joins your Will until you confirm it.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="-mt-1 -mr-2 rounded-lg p-2 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
                aria-label="Close Samaira"
              >
                <X className="h-5 w-5" />
              </button>
            </header>

            <div className="max-h-[52vh] shrink-0 space-y-2.5 overflow-y-auto border-b border-slate-100 bg-slate-50/70 px-5 py-3.5">
              <p className="text-xs leading-relaxed text-slate-500" aria-live="polite">
                <span className="font-semibold text-slate-700">{stepTitle}</span>
                {open.length > 0 ? ` · ${open.length} required ${open.length === 1 ? 'question' : 'questions'} open` : ''} · Will {overall}% complete
              </p>
              <ConversationMode send={send} isThinking={isThinking} lastSamairaMessage={opening} language={language} onLanguageChange={setLanguage} />
            </div>

            <div className="flex-1 space-y-5 overflow-y-auto px-5 py-5">
              <section className="space-y-3" aria-live="polite" aria-label="Conversation">
                {messages.map((item) => (
                  <div key={item.id} className={`flex ${item.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                    <div
                      className={`max-w-[88%] rounded-xl px-3.5 py-2.5 text-sm leading-relaxed ${
                        item.role === 'user' ? 'bg-brand-primary text-white' : 'border border-slate-200 bg-slate-50 text-slate-700'
                      }`}
                    >
                      <p className={`mb-0.5 text-xs font-semibold ${item.role === 'user' ? 'text-white/70' : 'text-slate-400'}`}>{item.role === 'user' ? 'You' : 'Samaira'}</p>
                      {item.content}
                    </div>
                  </div>
                ))}
                {isThinking && <p className="inline-flex rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2 text-sm text-slate-500">Samaira is working on that…</p>}
                {aiProblem && (
                  <p className="rounded-lg border border-amber-200 bg-amber-50 px-3.5 py-2.5 text-xs leading-relaxed text-amber-900" role="status">
                    Samaira could not reach the AI service: {aiProblem}. Replies are limited until it is back. If you run the app yourself, check the API server's terminal.
                  </p>
                )}
                {!hasSpoken && open.length > 0 && (
                  <ul className="flex flex-wrap gap-2" aria-label="Questions to start with">
                    {open.slice(0, 4).map((label) => (
                      <li key={label}>
                        <button
                          type="button"
                          disabled={isThinking}
                          onClick={() => void send(`Help me with: ${label}`, { language, source: 'typed' })}
                          className="rounded-full border border-slate-200 px-3 py-1.5 text-left text-xs font-medium text-slate-700 transition hover:border-brand-primary hover:text-brand-primary disabled:opacity-50"
                        >
                          {label}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
                {nextStep && (
                  <button
                    type="button"
                    onClick={() => goToStep(nextStep.id)}
                    className="rounded-lg border border-brand-primary px-4 py-2 text-sm font-semibold text-brand-primary transition hover:bg-brand-primary/5"
                  >
                    This step is done. Continue to {nextStep.title}
                  </button>
                )}
              </section>

              <ProposalList pending={pendingProposals} confirmed={confirmedProposals} onConfirm={confirm} onDismiss={dismiss} currentData={data} />
              <div ref={endRef} />
            </div>

            <footer className="max-h-[34vh] shrink-0 overflow-y-auto border-t border-slate-100 bg-white px-5 py-4">
              <InterviewComposer onSend={send} isThinking={isThinking} language={language} onLanguageChange={setLanguage} rows={2} showLanguage={false} />
            </footer>
          </motion.aside>
        )}
      </AnimatePresence>
    </>
  )
}
