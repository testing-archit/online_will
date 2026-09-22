import { COMPENSATION_LABEL, DEBT_SETTLEMENT_LABEL, DISTRIBUTION_SCHEME_LABEL, RELIGION_LABEL } from './labels'
import { getPathValue, isQuestionAnswered, isQuestionVisible, QUESTIONNAIRE_QUESTIONS, type QuestionnaireQuestion } from './questionnaireSchema'
import type { FieldUpdate, WillData } from './types'

/**
 * Which answers Samaira may *propose*. Only ordinary single-value answers qualify. Anything that is a legal
 * declaration or consent (the sound-mind, revocation and codicil confirmations) is never on the list: the person
 * has to tick those themselves. Lists of people and assets (executors, beneficiaries, accounts…) go through their
 * own flows and are not fillable here either.
 */
const FILLABLE_KINDS = new Set<QuestionnaireQuestion['kind']>(['text', 'textarea', 'date', 'select', 'yes-no'])

const SELECT_OPTIONS: Record<string, Record<string, string>> = {
  'personal.religion': RELIGION_LABEL,
  'executorsGuardians.compensation': COMPENSATION_LABEL,
  'assets.debtSettlementMethod': DEBT_SETTLEMENT_LABEL,
  'distribution.scheme': DISTRIBUTION_SCHEME_LABEL,
}

const MAX_UPDATES = 10
const MAX_TEXT = 500
const MAX_TEXTAREA = 2000

export type FillableKind = 'text' | 'textarea' | 'date' | 'select' | 'yes-no'

export interface FillableField {
  path: string
  label: string
  kind: FillableKind
  /** Allowed values for a select, so the model can only pick real ones. */
  options?: { value: string; label: string }[]
  /** False when the field only appears after another answer (e.g. "please specify" after choosing "Other"). */
  visible: boolean
  /** Whether it already has an answer. The answer itself is never included. */
  answered: boolean
}

function isFillable(question: QuestionnaireQuestion) {
  if (!FILLABLE_KINDS.has(question.kind)) return false
  if (question.completionRule === 'confirm-true') return false
  if (question.kind === 'select' && !SELECT_OPTIONS[question.path]) return false
  return true
}

/** The fields on a step that Samaira may propose values for. */
export function getFillableFields(data: WillData, stepId: string): FillableField[] {
  return QUESTIONNAIRE_QUESTIONS.filter((question) => question.sectionId === stepId && isFillable(question)).map((question) => ({
    path: question.path,
    label: question.label,
    kind: question.kind as FillableKind,
    ...(question.kind === 'select' ? { options: Object.entries(SELECT_OPTIONS[question.path]).map(([value, label]) => ({ value, label })) } : {}),
    visible: isQuestionVisible(question, data),
    answered: isQuestionAnswered(question, data),
  }))
}

/** Keep tabs and line breaks (a textarea may use them); drop every other control character. */
function stripControlCharacters(text: string) {
  return [...text].filter((char) => char === '\n' || char === '\t' || char === '\r' || char.charCodeAt(0) >= 32).join('')
}

function coerce(question: QuestionnaireQuestion, raw: unknown): string | boolean | null {
  switch (question.kind) {
    case 'yes-no': {
      if (typeof raw === 'boolean') return raw
      const text = typeof raw === 'string' ? raw.trim().toLowerCase() : ''
      if (['yes', 'true', 'haan', 'ha'].includes(text)) return true
      if (['no', 'false', 'nahi', 'nahin'].includes(text)) return false
      return null
    }
    case 'select': {
      const text = typeof raw === 'string' ? raw.trim().toLowerCase() : ''
      const options = SELECT_OPTIONS[question.path] ?? {}
      const match = Object.entries(options).find(([value, label]) => value.toLowerCase() === text || label.toLowerCase() === text)
      return match ? match[0] : null
    }
    case 'date': {
      const text = typeof raw === 'string' ? raw.trim() : ''
      if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return null
      const parsed = new Date(`${text}T00:00:00Z`)
      if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== text) return null
      if (parsed.getUTCFullYear() < 1900 || parsed.getTime() > Date.now()) return null
      return text
    }
    case 'text':
    case 'textarea': {
      const text = typeof raw === 'string' ? stripControlCharacters(raw).trim() : ''
      if (!text) return null
      return text.slice(0, question.kind === 'textarea' ? MAX_TEXTAREA : MAX_TEXT)
    }
    default:
      return null
  }
}

function withValue(data: WillData, path: string, value: unknown): WillData {
  const clone = structuredClone(data) as unknown as Record<string, unknown>
  const keys = path.split('.')
  let node = clone
  for (const key of keys.slice(0, -1)) node = node[key] as Record<string, unknown>
  node[keys[keys.length - 1]] = value
  return clone as unknown as WillData
}

/**
 * Turn the model's raw suggestions into updates that are safe to show. The model output is untrusted: each entry
 * must name a fillable field (on `stepId`, or anywhere when `stepId` is null, as when re-checking at confirm time),
 * carry a value of the right type and, for selects, one of the allowed options. Changes that would not alter the
 * current answer are dropped, and so are fields that would stay hidden once the whole batch is applied.
 */
export function resolveFieldUpdates(data: WillData, stepId: string | null, raw: unknown): FieldUpdate[] {
  if (!Array.isArray(raw)) return []
  const byPath = new Map<string, FieldUpdate>()
  for (const entry of raw.slice(0, MAX_UPDATES)) {
    if (!entry || typeof entry !== 'object') continue
    const { path, value } = entry as { path?: unknown; value?: unknown }
    if (typeof path !== 'string') continue
    const question = QUESTIONNAIRE_QUESTIONS.find((item) => item.path === path)
    if (!question || !isFillable(question) || (stepId !== null && question.sectionId !== stepId)) continue
    const coerced = coerce(question, value)
    if (coerced === null) continue
    byPath.set(path, { path, value: coerced })
  }

  let after = data
  for (const update of byPath.values()) after = withValue(after, update.path, update.value)
  return [...byPath.values()].filter((update) => {
    const question = QUESTIONNAIRE_QUESTIONS.find((item) => item.path === update.path)!
    return isQuestionVisible(question, after) && getPathValue(data, update.path) !== update.value
  })
}

/** How a stored value reads on screen. */
export function describeFieldValue(path: string, value: unknown): string {
  if (value === true) return 'Yes'
  if (value === false) return 'No'
  if (typeof value !== 'string' || !value.trim()) return ''
  return SELECT_OPTIONS[path]?.[value] ?? value
}

export interface FieldChangeRow {
  path: string
  label: string
  before: string
  after: string
}

/** Rows for the confirmation card: the field, what it says now, and what Samaira suggests. */
export function fieldChangeRows(data: WillData | undefined, updates: FieldUpdate[]): FieldChangeRow[] {
  return updates.map((update) => ({
    path: update.path,
    label: QUESTIONNAIRE_QUESTIONS.find((item) => item.path === update.path)?.label ?? update.path,
    before: data ? describeFieldValue(update.path, getPathValue(data, update.path)) : '',
    after: describeFieldValue(update.path, update.value),
  }))
}
