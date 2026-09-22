import { getFillableFields, type FillableField } from './fieldProposals'
import { listsOnStep } from './liveEdits'
import { getMissingRequiredQuestions, getOverallCompletion, getSectionCompletion, hasRequiredQuestions } from './questionnaireSchema'
import type { WillData } from './types'

/** Steps that collect no required answers of their own, so "open questions" would be meaningless there. */
const NON_QUESTION_STEPS = new Set(['review', 'consultation'])
const MAX_OPEN_QUESTIONS = 8

export interface AssistantContext {
  currentStep: { id: string; title: string }
  overallCompletionPercent: number
  /** completionPercent is null for sections that have no required questions (optional or read-only). */
  sections: { id: string; title: string; completionPercent: number | null }[]
  /** Labels of the required questions still open on the current step — question text only, never answers. */
  openQuestions: string[]
  /** The answer fields on this step Samaira may propose values for (never their current values). */
  fillableFields: FillableField[]
}

/**
 * A live picture of where the person is in the questionnaire, recomputed from the form on every turn.
 * It carries no answers: what has been filled in travels separately as the redacted estate snapshot.
 */
export function buildAssistantContext(data: WillData, steps: { id: string; title: string }[], currentStepId: string): AssistantContext {
  const current = steps.find((step) => step.id === currentStepId) ?? steps[0]
  return {
    currentStep: { id: current.id, title: current.title },
    overallCompletionPercent: getOverallCompletion(data),
    sections: steps.map((step) => ({
      id: step.id,
      title: step.title,
      completionPercent: hasRequiredQuestions(data, step.id) ? getSectionCompletion(data, step.id) : null,
    })),
    openQuestions: NON_QUESTION_STEPS.has(current.id)
      ? []
      : getMissingRequiredQuestions(data, current.id)
          .slice(0, MAX_OPEN_QUESTIONS)
          .map((question) => question.label),
    fillableFields: NON_QUESTION_STEPS.has(current.id) ? [] : getFillableFields(data, current.id),
  }
}

/** What Live voice sees: the standard context plus what each step is for, so she can explain and choose where to go next. */
export type SectionStatus = 'complete' | 'in-progress' | 'not-started' | 'optional'

export interface LiveContext extends Omit<AssistantContext, 'currentStep' | 'sections'> {
  currentStep: { id: string; title: string; purpose: string }
  sections: { id: string; title: string; purpose: string; completionPercent: number | null; status: SectionStatus }[]
  /** Where to go when this step is done: the next one that still needs answers (else the earliest that does, else review). */
  nextStepId: string | null
  /** The question highlighted on screen: the first one still open, with the field behind it when it can be answered by voice. */
  focus: { label: string; path?: string; kind?: FillableField['kind']; options?: FillableField['options'] } | null
  /** The repeating lists on this step (executors, assets…): what is already in each and whether it is unlocked. */
  lists: ReturnType<typeof listsOnStep>
}

function statusOf(completionPercent: number | null): SectionStatus {
  if (completionPercent === null) return 'optional'
  if (completionPercent >= 100) return 'complete'
  return completionPercent > 0 ? 'in-progress' : 'not-started'
}

export function buildLiveContext(data: WillData, steps: { id: string; title: string; subtitle?: string }[], currentStepId: string): LiveContext {
  const base = buildAssistantContext(data, steps, currentStepId)
  const purpose = (id: string) => steps.find((step) => step.id === id)?.subtitle ?? ''
  const sections = base.sections.map((section) => ({ ...section, purpose: purpose(section.id), status: statusOf(section.completionPercent) }))
  const needsWork = (section: (typeof sections)[number]) => section.status === 'in-progress' || section.status === 'not-started'
  const at = sections.findIndex((section) => section.id === base.currentStep.id)
  const nextStepId =
    sections.slice(at + 1).find((section) => needsWork(section) && section.id !== 'review')?.id ??
    sections.slice(0, Math.max(0, at)).find((section) => needsWork(section) && section.id !== 'review')?.id ??
    (sections.some((section) => section.id === 'review') && base.currentStep.id !== 'review' ? 'review' : null)
  const firstOpen = base.openQuestions[0]
  const field = firstOpen ? base.fillableFields.find((item) => item.label === firstOpen && item.visible && !item.answered) : undefined
  return {
    ...base,
    currentStep: { ...base.currentStep, purpose: purpose(base.currentStep.id) },
    sections,
    nextStepId,
    focus: firstOpen ? { label: firstOpen, ...(field ? { path: field.path, kind: field.kind, ...(field.options ? { options: field.options } : {}) } : {}) } : null,
    lists: listsOnStep(data, base.currentStep.id),
  }
}

/** Changes whenever something Samaira should react to changes on screen: the step, its open questions, or which fields are answered. */
export function screenSignature(context: Pick<LiveContext, 'currentStep' | 'openQuestions' | 'fillableFields' | 'lists'>): string {
  return JSON.stringify([
    context.currentStep.id,
    context.openQuestions,
    context.fillableFields.map((field) => [field.path, field.answered, field.visible]),
    context.lists.map((list) => [list.list, list.available, list.entries]),
  ])
}

/** What she was last told: the step and its open questions, so the next update can say what the person answered since. */
export interface SentScreen {
  stepId: string
  openQuestions: string[]
}

/** The questions that were open when she was last told and are no longer, on the same step (i.e. the person answered them on screen). */
export function newlyAnswered(context: Pick<LiveContext, 'currentStep' | 'openQuestions'>, previous?: SentScreen): string[] {
  if (!previous || previous.stepId !== context.currentStep.id) return []
  return previous.openQuestions.filter((question) => !context.openQuestions.includes(question))
}

/** The message that tells Samaira what is on screen now. It is not the person speaking. */
export function screenUpdateMessage(context: LiveContext, pendingCount: number, previous?: SentScreen, snapshot?: unknown): string {
  const waiting = pendingCount > 0 ? ` ${pendingCount} suggestion${pendingCount === 1 ? ' is' : 's are'} waiting for the person to tap confirm.` : ''
  const answered = newlyAnswered(context, previous)
  const done = answered.length
    ? ` The person just answered ${answered.map((question) => `"${question}"`).join(', ')} themselves on screen. It is already filled in, so do not ask ${answered.length === 1 ? 'it' : 'them'} again: acknowledge it in a few words and ask the next open question.`
    : ''
  const recorded = snapshot === undefined ? '' : `\nWhat is recorded now (this replaces the earlier estate_snapshot; if a value differs from what you knew, they changed it on screen, so use the new one):\n<user_data name="estate_snapshot">\n${JSON.stringify(snapshot).replaceAll('</user_data>', '')}\n</user_data>`
  return `[Screen update] The screen changed.${done}${waiting} What is on screen now:\n<user_data name="session_context">\n${JSON.stringify(context).replaceAll('</user_data>', '')}\n</user_data>${recorded}`
}

type GreetingLanguage = 'en' | 'hi' | 'hinglish'

/**
 * What Samaira says to open the conversation, or (returning) when the person moves to another step mid-conversation:
 * where they are, and the first question still open, in the language they chose.
 */
export function contextGreeting(context: AssistantContext, language: GreetingLanguage = 'en', options: { returning?: boolean } = {}): string {
  const { title } = context.currentStep
  const open = context.openQuestions.length
  const first = context.openQuestions[0]
  const tracked = context.sections.find((section) => section.id === context.currentStep.id)?.completionPercent != null
  const intro = !options.returning

  if (language === 'hi') {
    const lead = intro ? `नमस्ते, मैं समैरा हूँ, Octaraa से। आप अभी "${title}" पर हैं` : `अब आप "${title}" पर हैं`
    if (open > 0) return `${lead}, और यहाँ ${open === 1 ? 'एक ज़रूरी सवाल बाकी है' : `${open} ज़रूरी सवाल बाकी हैं`}। क्या हम "${first}" से शुरू करें?`
    if (tracked) return `${lead}, और यहाँ सारी ज़रूरी जानकारी भरी जा चुकी है। क्या हम आगे बढ़ें, या कुछ बदलना चाहेंगे?`
    return `${lead}। आप अपनी वसीयत के बारे में कुछ भी पूछ सकते हैं, या बता सकते हैं कि किसे क्या मिलना चाहिए।`
  }
  if (language === 'hinglish') {
    const lead = intro ? `Namaste, main Samaira hoon, Octaraa se. Aap abhi ${title} par hain` : `Ab aap ${title} par hain`
    if (open > 0) return `${lead}, aur yahan ${open === 1 ? 'ek zaroori sawal baaki hai' : `${open} zaroori sawal baaki hain`}. Kya hum "${first}" se shuru karein?`
    if (tracked) return `${lead}, aur yahan sab zaroori jaankari bhari ja chuki hai. Kya hum aage badhein, ya kuch badalna chahenge?`
    return `${lead}. Aap apni will ke baare mein kuch bhi pooch sakte hain, ya bata sakte hain ki kise kya milna chahiye.`
  }
  const lead = intro ? `Hi, I'm Samaira from Octaraa. You're on ${title}` : `You're now on ${title}`
  if (open > 0) return `${lead}, and ${open === 1 ? 'one question is' : `${open} questions are`} still open here. Shall we start with: ${first}?`
  if (tracked) return `${lead}, and everything required here is filled in. Shall we move on, or would you like to change something?`
  return `${lead}. Ask me anything about your Will so far, or tell me who should inherit what.`
}

/** The step to offer once this one is finished: the next one that still needs answers, else simply the next one. */
export function nextStepAfter(context: AssistantContext): { id: string; title: string } | null {
  const index = context.sections.findIndex((section) => section.id === context.currentStep.id)
  const after = context.sections.slice(index + 1)
  return after.find((section) => section.completionPercent !== null && section.completionPercent < 100) ?? after[0] ?? null
}
