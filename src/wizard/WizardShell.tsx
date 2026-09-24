'use client'

import { AnimatePresence, MotionConfig, motion } from 'framer-motion'
import { ArrowLeft, Check, CloudOff, Loader2, RotateCcw } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { FormProvider, useForm, useFormContext, type FieldPath } from 'react-hook-form'
import { appendAuditEntries, diffWillSections } from '../lib/auditTrail'
import { defaultWillData } from '../lib/defaultData'
import { fingerprint } from '../lib/id'
import {
  getMissingRequiredQuestions,
  getOverallCompletion,
  getSectionCompletion,
  getVisibleFieldPaths,
  hasRequiredQuestions,
} from '../lib/questionnaireSchema'
import { saveWillToBackend, type SaveWillStatus } from '../lib/backendClient'
import { clearWillDraft, loadStepIndex, loadWillData, saveStepIndex, saveWillData } from '../lib/storage'
import type { WillData } from '../lib/types'
import { AssistantDock } from './interview/AssistantDock'
import { WizardNavigationContext } from './navigation'
import { STEPS } from './stepConfig'

const PERSIST_DEBOUNCE_MS = 400
const AUDIT_DEBOUNCE_MS = 1500
const SYNC_DEBOUNCE_MS = 3000

type SyncState = 'idle' | 'saving' | SaveWillStatus

export function WizardShell() {
  // Read the saved draft once — useForm's defaultValues expression would otherwise be re-evaluated (and localStorage re-parsed) on every render.
  const [initial] = useState(() => {
    const saved = loadWillData()
    return { data: saved ?? defaultWillData(), isNewDraft: saved === null }
  })
  const methods = useForm<WillData>({ defaultValues: initial.data, mode: 'onBlur' })
  const [stepIndex, setStepIndex] = useState(() => Math.min(loadStepIndex(), STEPS.length - 1))
  const [direction, setDirection] = useState(1)
  const [syncState, setSyncState] = useState<SyncState>('idle')
  // The "required answers" hint only appears after the user tries to continue, not on a blank form.
  const [showRequiredHint, setShowRequiredHint] = useState(false)
  const watched = methods.watch()
  const contentTopRef = useRef<HTMLDivElement>(null)
  const step = STEPS[stepIndex]
  const Component = step.Component
  const missingRequired = getMissingRequiredQuestions(watched, step.id)
  const hasBlockingMissingAnswers = showRequiredHint && missingRequired.length > 0 && step.id !== 'review' && step.id !== 'consultation'

  // Autosave: persisted locally shortly after the last change, and always flushed
  // when the tab is hidden or closed so nothing typed in the last moments is lost.
  const persistTimer = useRef<number>(undefined)
  const auditTimer = useRef<number>(undefined)
  const syncTimer = useRef<number>(undefined)
  const lastAuditedRef = useRef<WillData | null>(initial.isNewDraft ? null : initial.data)
  // Set by "Start over": from then on nothing may write the old answers back (autosave, the save-on-close flush, the server sync).
  const resettingRef = useRef(false)
  const syncInFlight = useRef<Promise<unknown> | null>(null)

  // Fingerprint of the substantive answers (the audit trail is excluded, otherwise logging a change would itself look like a change).
  const contentFingerprint = (data: WillData) => fingerprint(JSON.stringify({ ...data, estateOs: { ...data.estateOs, auditTrail: [] } }))
  const lastSyncedRef = useRef<string>(contentFingerprint(initial.data))

  const syncToBackend = useCallback(async () => {
    if (resettingRef.current) return
    const current = methods.getValues()
    const currentFingerprint = contentFingerprint(current)
    if (currentFingerprint === lastSyncedRef.current) return
    setSyncState('saving')
    const saving = saveWillToBackend(current)
    syncInFlight.current = saving
    const result = await saving
    if (result.status === 'saved') lastSyncedRef.current = currentFingerprint
    setSyncState(result.status)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [methods])

  // Task 38 — compliance audit trail. Changes are diffed against the last audited
  // state once the user pauses (not per keystroke), and logged with before/after snapshots.
  const recordAudit = useCallback(() => {
    const current = methods.getValues()
    const entries = diffWillSections(lastAuditedRef.current, current)
    lastAuditedRef.current = current
    if (entries.length > 0) {
      methods.setValue('estateOs.auditTrail', appendAuditEntries(current, entries), { shouldDirty: false })
    }
  }, [methods])

  useEffect(() => {
    if (resettingRef.current) return
    window.clearTimeout(persistTimer.current)
    persistTimer.current = window.setTimeout(() => saveWillData(methods.getValues()), PERSIST_DEBOUNCE_MS)

    window.clearTimeout(auditTimer.current)
    auditTimer.current = window.setTimeout(recordAudit, AUDIT_DEBOUNCE_MS)

    window.clearTimeout(syncTimer.current)
    syncTimer.current = window.setTimeout(() => void syncToBackend(), SYNC_DEBOUNCE_MS)
    // `watched` is a fresh object on every change; the timers themselves read the latest values.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [watched])

  useEffect(() => {
    const flush = () => {
      if (!resettingRef.current) saveWillData(methods.getValues())
    }
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') flush()
    }
    window.addEventListener('beforeunload', flush)
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      window.removeEventListener('beforeunload', flush)
      document.removeEventListener('visibilitychange', onVisibility)
      window.clearTimeout(persistTimer.current)
      window.clearTimeout(auditTimer.current)
      window.clearTimeout(syncTimer.current)
    }
  }, [methods])

  async function startOver() {
    if (!window.confirm('Start a new Will? This clears every answer you have entered, and the draft saved in this browser. A copy already synced to the server is kept in its history.')) return
    // Stop everything that could write the old answers back: the timers, the save-on-close flush (which runs as the page
    // reloads) and the server sync. A save already on its way is let finish first, so it cannot re-link the old copy afterwards.
    resettingRef.current = true
    window.clearTimeout(persistTimer.current)
    window.clearTimeout(auditTimer.current)
    window.clearTimeout(syncTimer.current)
    await Promise.race([syncInFlight.current?.catch(() => {}), new Promise((resolve) => window.setTimeout(resolve, 3000))])
    clearWillDraft()
    window.location.reload()
  }

  useEffect(() => {
    saveStepIndex(stepIndex)
    contentTopRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [stepIndex])

  function goTo(index: number) {
    setShowRequiredHint(false)
    setDirection(index > stepIndex ? 1 : -1)
    setStepIndex(index)
  }

  function goToStep(stepId: string) {
    const index = STEPS.findIndex((item) => item.id === stepId)
    if (index >= 0) goTo(index)
  }

  async function goNext() {
    const visibleFieldPaths = getVisibleFieldPaths(watched, step.id)
    const fieldsAreValid = await methods.trigger(visibleFieldPaths as FieldPath<WillData>[])
    const missing = getMissingRequiredQuestions(methods.getValues(), step.id)

    if (!fieldsAreValid || missing.length > 0) {
      setShowRequiredHint(true)
      missing.forEach((question) => {
        methods.setError(question.path as FieldPath<WillData>, {
          type: 'required',
          message: question.validationMessage ?? `${question.label} is required before continuing.`,
        })
      })
      contentTopRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      return
    }

    goTo(Math.min(STEPS.length - 1, stepIndex + 1))
  }

  const progress = getOverallCompletion(watched)
  const stepCompletion = getSectionCompletion(watched, step.id)

  return (
    <FormProvider {...methods}>
      <WizardNavigationContext.Provider value={{ goToStep }}>
      <MotionConfig reducedMotion="user">
      <div className="min-h-screen">
        <Masthead progress={progress} syncState={syncState} onStartOver={() => void startOver()} />

        <div className="mx-auto max-w-6xl px-4 pt-8 pb-28 sm:px-6 sm:pt-12">
          <div ref={contentTopRef} className="scroll-mt-24" />

          <label className="mb-5 block lg:hidden">
            <span className="mb-1.5 block text-sm font-medium text-slate-600">Jump to a step</span>
            <select
              value={stepIndex}
              onChange={(event) => goTo(Number(event.target.value))}
              className="w-full rounded-lg border border-slate-300 bg-white px-3.5 py-2.5 text-sm text-slate-800"
            >
              {STEPS.map((item, index) => (
                <option key={item.id} value={index}>
                  {index + 1}. {item.title}
                </option>
              ))}
            </select>
          </label>

          <div className="grid gap-8 lg:grid-cols-[232px_1fr] lg:gap-14">
            <StepRail stepIndex={stepIndex} onSelect={goTo} />

            <main className="card-shadow rounded-2xl border border-slate-200/80 bg-white px-5 py-7 sm:px-10 sm:py-10">
              <header className="mb-8 flex items-start justify-between gap-6 border-b border-slate-100 pb-7">
                <div className="max-w-xl">
                  <p className="text-sm tabular-nums text-slate-500">
                    Step {stepIndex + 1} of {STEPS.length}
                  </p>
                  <h1 className="mt-1.5 text-[1.65rem] leading-[1.2] font-semibold text-brand-primary sm:text-[1.9rem]">{step.title}</h1>
                  <p className="mt-2.5 text-[15px] leading-relaxed text-slate-500">{step.subtitle}</p>
                </div>
                {hasRequiredQuestions(watched, step.id) && (
                  <p className="hidden shrink-0 pt-1 text-right text-sm tabular-nums text-slate-500 sm:block">
                    <span className="font-display text-xl font-medium text-brand-primary">{stepCompletion}%</span>
                    <span className="block">complete</span>
                  </p>
                )}
              </header>

              <form onSubmit={(e) => e.preventDefault()} className="min-h-[320px]">
                {hasBlockingMissingAnswers && (
                  <div className="mb-6 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900" role="alert">
                    <p className="font-semibold">A few required answers are still open in this section.</p>
                    <p className="mt-1 text-xs leading-relaxed">
                      Required visible questions count toward section completion; hidden conditional questions do not.
                    </p>
                  </div>
                )}
                <AnimatePresence mode="wait" custom={direction} initial={false}>
                  <motion.div
                    key={step.id}
                    custom={direction}
                    initial={{ opacity: 0, x: 16 * direction }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: -16 * direction }}
                    transition={{ duration: 0.2, ease: 'easeOut' }}
                  >
                    <Component />
                  </motion.div>
                </AnimatePresence>
              </form>

              <div className="mt-10 flex items-center justify-between border-t border-slate-100 pt-6">
                <button
                  type="button"
                  onClick={() => goTo(Math.max(0, stepIndex - 1))}
                  disabled={stepIndex === 0}
                  className="inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium text-slate-600 transition hover:bg-slate-100 hover:text-slate-900 disabled:pointer-events-none disabled:opacity-30"
                >
                  <ArrowLeft className="h-4 w-4" /> Back
                </button>
                {stepIndex < STEPS.length - 1 && (
                  <button
                    type="button"
                    onClick={goNext}
                    className="rounded-lg bg-brand-primary px-7 py-2.5 text-sm font-semibold text-white transition hover:bg-brand-primary-hover active:translate-y-px"
                  >
                    Continue
                  </button>
                )}
              </div>
            </main>
          </div>
        </div>
      </div>
      <AssistantDock stepId={step.id} />
      </MotionConfig>
      </WizardNavigationContext.Provider>
    </FormProvider>
  )
}

const SYNC_LABEL: Record<SyncState, string> = {
  idle: 'Saved automatically',
  saving: 'Saving…',
  saved: 'Saved and synced',
  offline: 'Saved on this device — server unreachable',
  conflict: 'Saved here — a newer version exists on the server',
}

/** Logo and status on one quiet line; the orange hairline beneath it is the overall progress. */
function Masthead({ progress, syncState, onStartOver }: { progress: number; syncState: SyncState; onStartOver: () => void }) {
  return (
    <div className="relative z-40 border-b border-slate-200 bg-white/95 backdrop-blur lg:sticky lg:top-0">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3.5 sm:px-6">
        <img src="/octaraa-logo.png" alt="Octaraa — Family Wealth Simplified" className="h-9 w-auto" />
        <div className="flex items-center gap-x-5 text-sm text-slate-500">
          <p className="hidden items-center gap-1.5 sm:flex" aria-live="polite">
            {syncState === 'saving' && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            {(syncState === 'offline' || syncState === 'conflict') && <CloudOff className="h-3.5 w-3.5 text-amber-600" />}
            {SYNC_LABEL[syncState]}
          </p>
          <button
            type="button"
            onClick={onStartOver}
            className="hidden items-center gap-1 rounded text-slate-400 transition hover:text-rose-600 sm:inline-flex"
          >
            <RotateCcw className="h-3.5 w-3.5" /> Start over
          </button>
          <p className="tabular-nums" aria-label={`Overall progress ${progress} percent`}>
            <span className="font-display text-xl font-medium text-brand-primary">{progress}%</span> done
          </p>
        </div>
      </div>
      <motion.div
        className="absolute bottom-[-1px] left-0 h-[2px] bg-brand-secondary"
        animate={{ width: `${progress}%` }}
        transition={{ duration: 0.5, ease: 'easeOut' }}
        aria-hidden
      />
    </div>
  )
}

/** The section list, set like a ledger: numerals, an orange rule on the current step, a tick when complete. */
function StepRail({ stepIndex, onSelect }: { stepIndex: number; onSelect: (i: number) => void }) {
  const { watch } = useFormContext<WillData>()
  const data = watch()

  return (
    <nav className="hidden lg:block" aria-label="Will steps">
      <ol className="sticky top-24 border-l border-slate-200">
        {STEPS.map((s, i) => {
          const isActive = i === stepIndex
          const completion = getSectionCompletion(data, s.id)
          const tracked = hasRequiredQuestions(data, s.id)
          const isDone = tracked && completion === 100
          const statusLabel = tracked && !isDone ? `${completion}% complete` : ['documents', 'estate-os'].includes(s.id) ? 'Optional' : ''
          return (
            <li key={s.id}>
              <button
                type="button"
                onClick={() => onSelect(i)}
                aria-current={isActive ? 'step' : undefined}
                className={`group -ml-px flex w-full items-baseline gap-3 border-l-2 py-2 pr-2 pl-4 text-left transition-colors ${
                  isActive ? 'border-brand-secondary' : 'border-transparent hover:border-slate-300'
                }`}
              >
                <span className={`w-5 shrink-0 text-right font-display text-sm tabular-nums ${isActive ? 'text-brand-secondary-ink' : 'text-slate-400'}`}>
                  {i + 1}
                </span>
                <span
                  className={`flex-1 text-sm leading-snug transition-colors ${
                    isActive ? 'font-semibold text-brand-primary' : isDone ? 'text-slate-700' : 'text-slate-500 group-hover:text-slate-800'
                  }`}
                >
                  {s.title}
                  {statusLabel && <span className="mt-0.5 block text-xs font-normal text-slate-400">{statusLabel}</span>}
                </span>
                {isDone && <Check className="h-3.5 w-3.5 shrink-0 self-center text-brand-secondary-ink" strokeWidth={2.5} aria-label="Complete" />}
              </button>
            </li>
          )
        })}
      </ol>
    </nav>
  )
}
