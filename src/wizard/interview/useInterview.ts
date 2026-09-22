import { useCallback, useEffect, useRef, useState } from 'react'
import { useFormContext, type FieldPath } from 'react-hook-form'
import type { AssistantContext } from '../../lib/assistantContext'
import { respondToEstateInterviewFromApi } from '../../lib/backendClient'
import {
  applyInterviewProposal,
  createInterviewProposal,
  dismissInterviewProposal,
  normalizeProposal,
} from '../../lib/estateInterview'
import { describeFieldValue, resolveFieldUpdates } from '../../lib/fieldProposals'
import { applyListEdit, type ListEdit } from '../../lib/liveEdits'
import { QUESTIONNAIRE_QUESTIONS } from '../../lib/questionnaireSchema'
import { newId } from '../../lib/id'
import { detectLanguage } from '../../lib/language'
import type { InterviewTurnProposal, WillData } from '../../lib/types'

export type InterviewLanguage = 'en' | 'hi' | 'hinglish'
/** What the user picks: a fixed language, or "auto" to answer in whatever they speak. */
export type LanguageChoice = 'auto' | InterviewLanguage
export type InterviewSource = 'typed' | 'voice'
export interface SendResult {
  reply: string
  /** The language that was detected (or forced) for this turn — the reply is written and spoken in it. */
  language: InterviewLanguage
  proposalCount: number
}

export const LANGUAGE_LABEL: Record<LanguageChoice, string> = {
  auto: 'Auto-detect',
  en: 'English',
  hi: 'हिन्दी (Hindi)',
  hinglish: 'Hinglish',
}

/** Speech-recognition locale for each interview language. */
export const DICTATION_LOCALE: Record<LanguageChoice, string> = { auto: 'en-IN', en: 'en-IN', hi: 'hi-IN', hinglish: 'en-IN' }

/**
 * The single intake pipeline for natural-language input, typed or spoken, in
 * English, Hindi or Hinglish:
 *   statement → structured proposal → (user confirms) → estate data.
 * The original statement is always stored next to its structured
 * interpretation, and nothing changes the Will until the user confirms.
 */
/** What Samaira says when the AI service could not be reached and the message held no beneficiary she could note locally. */
const UNREACHABLE: Record<InterviewLanguage, string> = {
  en: "I couldn't reach my assistant just now, so I didn't understand that. Please try again in a moment.",
  hi: 'अभी मैं अपने सहायक से जुड़ नहीं पाई, इसलिए आपकी बात समझ नहीं सकी। कृपया थोड़ी देर बाद फिर कोशिश करें।',
  hinglish: 'Abhi main apne assistant se connect nahi ho pa rahi, isliye aapki baat samajh nahi saki. Please thodi der baad phir try kijiye.',
}

/** Something Live voice put straight into the Will, kept so the person can see it and take it back. */
export interface LiveChange {
  id: string
  summary: string
  at: string
  undone: boolean
}

export interface LiveApplyResult {
  applied: number
  /** What was done, in words Samaira can say back. */
  changes: string[]
  /** What could not be done and why, so she can correct herself or ask again. */
  problems: string[]
  /** Form paths that changed, for highlighting on screen. */
  focus: string[]
}

const MAX_LIVE_CHANGES = 30

export function useInterview(options: { getContext?: (data: WillData) => AssistantContext } = {}) {
  const { getValues, setValue, watch } = useFormContext<WillData>()
  // Read at send time, so the context always reflects the step and answers as they are *now*.
  const getContextRef = useRef(options.getContext)
  useEffect(() => {
    getContextRef.current = options.getContext
  })
  const [isThinking, setIsThinking] = useState(false)
  // Set when the last AI call failed, so the screen can say so instead of quietly answering from the offline fallback.
  const [aiProblem, setAiProblem] = useState<string | null>(null)
  const data = watch()
  const [liveChanges, setLiveChanges] = useState<LiveChange[]>([])
  const liveChangesRef = useRef<LiveChange[]>([])
  const liveUndo = useRef(new Map<string, () => void>())
  const commitLiveChanges = useCallback((next: LiveChange[]) => {
    liveChangesRef.current = next
    setLiveChanges(next)
  }, [])

  const pendingProposals = data.assistantIntake.interviewProposals.filter((proposal) => proposal.status === 'pending')
  const confirmedProposals = data.assistantIntake.interviewProposals.filter((proposal) => proposal.status === 'confirmed')

  const send = useCallback(
    async (text: string, options: { language: LanguageChoice; source: InterviewSource }): Promise<SendResult | null> => {
      const statement = text.trim()
      if (!statement) return null
      // Auto: answer in whatever the person just spoke or typed.
      const language: InterviewLanguage = options.language === 'auto' ? detectLanguage(statement) : options.language

      setIsThinking(true)
      try {
        const userMessage = { id: newId(), role: 'user' as const, content: statement, createdAt: new Date().toISOString() }
        const before = getValues()
        const withMessage: WillData = {
          ...before,
          assistantIntake: { ...before.assistantIntake, interviewMessages: [...before.assistantIntake.interviewMessages, userMessage] },
        }

        const localProposal = createInterviewProposal(statement, language)
        const context = getContextRef.current?.(withMessage)
        const ai = await respondToEstateInterviewFromApi(statement, withMessage, language, context)
        if (ai.ok) setAiProblem(null)
        else {
          console.warn(`[Samaira] The AI service did not answer (status ${ai.status}): ${ai.error}`)
          setAiProblem(ai.status === 0 ? 'the server could not be reached' : `the server answered with an error (${ai.status}: ${ai.error})`)
        }
        const aiProposal = ai.ok ? ai.interview : null
        const local = normalizeProposal(statement, localProposal, aiProposal)
        // Without the AI the offline matcher can still note a beneficiary, but for anything else its canned line would be
        // the same wrong answer every time. Say plainly that the assistant was not reached.
        const merged = !ai.ok && local.beneficiaries.length === 0 ? { ...local, assistantReply: UNREACHABLE[language], followUpQuestion: '' } : local
        // Suggested answers are only accepted for the step the person is on, and only if they pass validation.
        const fieldUpdates = context ? resolveFieldUpdates(withMessage, context.currentStep.id, aiProposal?.fieldUpdates) : []
        const proposal = fieldUpdates.length ? { ...merged, fieldUpdates } : merged
        const hasSuggestion = proposal.beneficiaries.length > 0 || fieldUpdates.length > 0
        const reply = { id: newId(), role: 'samaira' as const, content: `${proposal.assistantReply} ${proposal.followUpQuestion}`.trim(), createdAt: new Date().toISOString() }

        // Re-read the form: the user may have edited other fields while the AI was thinking.
        const latest = getValues()
        setValue(
          'assistantIntake',
          {
            ...latest.assistantIntake,
            interviewMessages: [...latest.assistantIntake.interviewMessages, userMessage, reply],
            interviewProposals: hasSuggestion ? [proposal, ...latest.assistantIntake.interviewProposals] : latest.assistantIntake.interviewProposals,
          },
          { shouldDirty: true },
        )

        // Keep the raw statement as a record of what was actually said, in its original language.
        const noteKey = options.source === 'voice' ? 'estateOs.voiceInterviewNotes' : language === 'en' ? null : 'estateOs.hinglishInterviewNotes'
        if (noteKey) {
          const existing = getValues(noteKey)
          setValue(noteKey, [`${LANGUAGE_LABEL[language]}: ${statement}`, ...existing].slice(0, 50), { shouldDirty: true })
        }
        // What Samaira says aloud in conversation mode; confirmation always happens on screen.
        const spoken = `${proposal.assistantReply} ${proposal.followUpQuestion}`.trim()
        const onScreen = { en: "I've put that on your screen — please confirm it there.", hi: 'मैंने इसे आपकी स्क्रीन पर रख दिया है — कृपया वहीं पुष्टि करें।', hinglish: 'Maine ise aapki screen par rakh diya hai — please wahin confirm kijiye.' }[language]
        return { reply: hasSuggestion ? `${spoken} ${onScreen}` : spoken, proposalCount: proposal.beneficiaries.length + fieldUpdates.length, language }
      } finally {
        setIsThinking(false)
      }
    },
    [getValues, setValue],
  )

  /**
   * Say something herself: an opening question, or a change of step. Until the person has spoken, the conversation is
   * just her greeting, so it is replaced (which also clears the old English welcome older drafts were saved with);
   * once they have spoken it is appended.
   */
  const addSamairaMessage = useCallback(
    (content: string) => {
      const current = getValues().assistantIntake
      const spoken = current.interviewMessages.some((item) => item.role === 'user')
      const last = current.interviewMessages[current.interviewMessages.length - 1]
      if (last?.role === 'samaira' && last.content === content) return
      const message = { id: newId(), role: 'samaira' as const, content, createdAt: new Date().toISOString() }
      setValue('assistantIntake', { ...current, interviewMessages: spoken ? [...current.interviewMessages, message] : [message] }, { shouldDirty: true })
    },
    [getValues, setValue],
  )

  /** Live voice: keep what was said on both sides in the conversation log, as it happens. */
  const recordLiveTurn = useCallback(
    (turn: { user: string; samaira: string }) => {
      const now = new Date().toISOString()
      const added = [
        ...(turn.user ? [{ id: newId(), role: 'user' as const, content: turn.user, createdAt: now }] : []),
        ...(turn.samaira ? [{ id: newId(), role: 'samaira' as const, content: turn.samaira, createdAt: now }] : []),
      ]
      if (!added.length) return
      const current = getValues().assistantIntake
      setValue('assistantIntake', { ...current, interviewMessages: [...current.interviewMessages, ...added] }, { shouldDirty: true })
      if (turn.user) {
        const existing = getValues('estateOs.voiceInterviewNotes')
        setValue('estateOs.voiceInterviewNotes', [`${LANGUAGE_LABEL[detectLanguage(turn.user)]}: ${turn.user}`, ...existing].slice(0, 50), { shouldDirty: true })
      }
    },
    [getValues, setValue],
  )

  const confirm = useCallback(
    (proposal: InterviewTurnProposal) => {
      const next = applyInterviewProposal(getValues(), proposal)
      setValue('assistantIntake', next.assistantIntake, { shouldDirty: true })
      setValue('assets', next.assets, { shouldDirty: true })
      setValue('distribution', next.distribution, { shouldDirty: true })
      // Suggested answers are re-checked against the form as it is now, then applied like anything the person typed.
      for (const update of resolveFieldUpdates(getValues(), null, proposal.fieldUpdates)) {
        setValue(update.path as FieldPath<WillData>, update.value as never, { shouldDirty: true, shouldTouch: true, shouldValidate: true })
      }
    },
    [getValues, setValue],
  )

  /**
   * Live voice, zero typing: what Samaira heard goes straight into the Will, through the same checks as anything
   * suggested (unknown fields refused, values coerced, answers limited to the step on screen, lists only once they
   * apply). Each call is one undoable change; the previous state of every section it touched is kept.
   */
  const applyFromLive = useCallback(
    (statement: string, details: { beneficiaries?: unknown; fieldUpdates?: unknown; listEdits?: ListEdit[] }): LiveApplyResult => {
      const before = structuredClone(getValues())
      const context = getContextRef.current?.(before)
      const touched = new Set<string>()
      const changes: string[] = []
      const problems: string[] = []
      const focus: string[] = []

      // 1. Answers to fields on the current step.
      const rawUpdates = Array.isArray(details.fieldUpdates) ? details.fieldUpdates : []
      const updates = context ? resolveFieldUpdates(before, context.currentStep.id, rawUpdates) : []
      for (const entry of rawUpdates as { path?: unknown }[]) {
        const path = typeof entry?.path === 'string' ? entry.path : ''
        if (updates.some((update) => update.path === path)) continue
        const question = QUESTIONNAIRE_QUESTIONS.find((item) => item.path === path)
        if (!question) problems.push(`"${path}" is not a field you can fill.`)
        else if (context && question.sectionId !== context.currentStep.id) problems.push(`"${question.label}" is on another step (${question.sectionId}). Move the screen there first, then record it.`)
        else problems.push(`"${question.label}": that value is not valid, already set, or hidden until another answer is given.`)
      }
      for (const update of updates) {
        setValue(update.path as FieldPath<WillData>, update.value as never, { shouldDirty: true, shouldTouch: true, shouldValidate: true })
        touched.add(update.path.split('.')[0])
        focus.push(update.path)
        const label = QUESTIONNAIRE_QUESTIONS.find((item) => item.path === update.path)?.label ?? update.path
        changes.push(`${label}: ${describeFieldValue(update.path, update.value)}`)
      }

      // 2. Who inherits what.
      const beneficiaries = Array.isArray(details.beneficiaries) ? details.beneficiaries : []
      if (beneficiaries.length) {
        const local = createInterviewProposal(statement || 'Live conversation', 'en')
        const merged = normalizeProposal(statement || 'Live conversation', { ...local, beneficiaries: [] }, { beneficiaries })
        if (merged.beneficiaries.length) {
          const proposal: InterviewTurnProposal = { ...merged, assistantReply: 'Noted during your live conversation.', followUpQuestion: '' }
          const latest = getValues().assistantIntake
          setValue('assistantIntake', { ...latest, interviewProposals: [proposal, ...latest.interviewProposals] }, { shouldDirty: true })
          confirm(proposal)
          for (const key of ['assistantIntake', 'assets', 'distribution']) touched.add(key)
          for (const beneficiary of merged.beneficiaries) changes.push(`Beneficiary ${beneficiary.name}${beneficiary.specificBequest ? ` gets ${beneficiary.specificBequest}` : beneficiary.share ? ` (${beneficiary.share})` : ''}`)
          focus.push('distribution.beneficiaries')
        } else problems.push('No beneficiary had a usable name.')
      }

      // 3. Entries in the repeating lists (executors, assets, witnesses…), one after another so each sees the last.
      for (const edit of details.listEdits ?? []) {
        const result = applyListEdit(getValues(), edit)
        if (!result.ok) {
          problems.push(result.error)
          continue
        }
        for (const key of result.touched) {
          setValue(key as FieldPath<WillData>, result.data[key as keyof WillData] as never, { shouldDirty: true })
          touched.add(key)
        }
        changes.push(result.summary)
        focus.push(result.focus)
      }

      if (changes.length) {
        const id = newId()
        liveUndo.current.set(id, () => {
          for (const key of touched) setValue(key as FieldPath<WillData>, before[key as keyof WillData] as never, { shouldDirty: true, shouldValidate: true })
        })
        commitLiveChanges([{ id, summary: changes.join('; '), at: new Date().toISOString(), undone: false }, ...liveChangesRef.current].slice(0, MAX_LIVE_CHANGES))
      }
      return { applied: changes.length, changes, problems, focus }
    },
    [commitLiveChanges, confirm, getValues, setValue],
  )

  /** Take back the most recent live change (older ones are only reachable after it, so nothing later is overwritten). */
  const undoLiveChange = useCallback((): string | null => {
    const target = liveChangesRef.current.find((item) => !item.undone)
    if (!target) return null
    liveUndo.current.get(target.id)?.()
    liveUndo.current.delete(target.id)
    commitLiveChanges(liveChangesRef.current.map((item) => (item.id === target.id ? { ...item, undone: true } : item)))
    return target.summary
  }, [commitLiveChanges])

  const dismiss = useCallback(
    (proposalId: string) => {
      const next = dismissInterviewProposal(getValues(), proposalId)
      setValue('assistantIntake', next.assistantIntake, { shouldDirty: true })
    },
    [getValues, setValue],
  )

  return { data, isThinking, aiProblem, pendingProposals, confirmedProposals, send, addSamairaMessage, recordLiveTurn, applyFromLive, undoLiveChange, liveChanges, confirm, dismiss }
}
