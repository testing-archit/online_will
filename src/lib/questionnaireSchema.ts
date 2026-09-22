import { computeAge } from './age'
import { COMPENSATION_LABEL, DEBT_SETTLEMENT_LABEL, DISTRIBUTION_SCHEME_LABEL, RELIGION_LABEL } from './labels'
import type { WillData } from './types'

export type QuestionKind =
  | 'text'
  | 'date'
  | 'select'
  | 'yes-no'
  | 'checkbox'
  | 'textarea'
  | 'repeater'
  | 'derived-review'

export type ConditionOperator = 'equals' | 'notEquals' | 'isTruthy' | 'notEmpty' | 'arrayMinLength'

export interface QuestionCondition {
  path: string
  operator: ConditionOperator
  value?: unknown
  min?: number
}

export type CompletionRule =
  | 'not-empty'
  | 'boolean-answered'
  | 'confirm-true'
  | 'array-min-one'
  | 'array-min-one-complete'
  | 'adult-date'
  | 'optional'

export interface QuestionnaireQuestion {
  id: string
  sectionId: string
  path: string
  label: string
  kind: QuestionKind
  required: boolean
  completionRule: CompletionRule
  dependsOn?: QuestionCondition[]
  /** Shown instead of the generic "is required" text when the answer is present but invalid. */
  validationMessage?: string
  entity:
    | 'user'
    | 'family'
    | 'family_member'
    | 'asset'
    | 'liability'
    | 'insurance_policy'
    | 'beneficiary'
    | 'executor'
    | 'guardian'
    | 'distribution_instruction'
    | 'execution_event'
    | 'document'
    | 'will'
    | 'questionnaire_answer'
}

export interface QuestionnaireSection {
  id: string
  title: string
  questionIds: string[]
}

export const QUESTIONNAIRE_SECTIONS: QuestionnaireSection[] = [
  {
    id: 'personal',
    title: 'About you',
    questionIds: [
      'personal.fullLegalName',
      'personal.dateOfBirth',
      'personal.addressLine',
      'personal.pincode',
      'personal.city',
      'personal.state',
      'personal.religion',
      'personal.religionOther',
    ],
  },
  {
    id: 'revocation',
    title: 'Capacity & revocation',
    questionIds: [
      'revocation.hasPriorWills',
      'revocation.revokesAllPrior',
      'revocation.soundMindDeclaration',
      'revocation.hasMedicalCertificate',
    ],
  },
  {
    id: 'executors',
    title: 'Executors & guardians',
    questionIds: [
      'executorsGuardians.executors',
      'executorsGuardians.compensation',
      'executorsGuardians.hasChildren',
      'executorsGuardians.children',
      'executorsGuardians.hasMinorChildren',
      'executorsGuardians.guardians',
    ],
  },
  {
    id: 'assets',
    title: 'Assets & liabilities',
    questionIds: [
      'assets.immovableAssets',
      'assets.bankAccounts',
      'assets.investments',
      'assets.valuables',
      'assets.hasEncumberedAssets',
      'assets.encumbranceDetails',
      'assets.debtSettlementMethod',
    ],
  },
  {
    id: 'insurance',
    title: 'Life insurance',
    questionIds: ['insurance.hasPolicies', 'insurance.policies'],
  },
  {
    id: 'distribution',
    title: 'Distribution',
    questionIds: [
      'distribution.scheme',
      'distribution.beneficiaries',
      'distribution.hasFutureAssets',
      'distribution.futureAssetInstructions',
      'distribution.wantsSimultaneousDeathClause',
      'distribution.residuaryBeneficiary',
    ],
  },
  {
    id: 'funeral',
    title: 'Funeral & expenses',
    questionIds: ['funeral.funeralWishes', 'funeral.payExpensesFromEstate'],
  },
  {
    id: 'execution',
    title: 'Execution & witnesses',
    questionIds: [
      'execution.witnesses',
      'execution.plansVideoRecording',
      'execution.isUttarakhandExecution',
      'execution.acknowledgesCodicilProcess',
    ],
  },
  {
    id: 'review',
    title: 'Review',
    questionIds: ['review.answers'],
  },
]

export const QUESTIONNAIRE_QUESTIONS: QuestionnaireQuestion[] = [
  question('personal.fullLegalName', 'personal', 'Full legal name', 'text', true, 'not-empty', 'user'),
  withMessage(
    question('personal.dateOfBirth', 'personal', 'Date of birth', 'date', true, 'adult-date', 'user'),
    'Enter a valid date of birth — a person must be at least 18 years old to make a Will.',
  ),
  question('personal.addressLine', 'personal', 'Address line', 'text', true, 'not-empty', 'user'),
  question('personal.pincode', 'personal', 'PIN code', 'text', true, 'not-empty', 'user'),
  question('personal.city', 'personal', 'City', 'text', true, 'not-empty', 'user'),
  question('personal.state', 'personal', 'State', 'text', true, 'not-empty', 'user'),
  question('personal.religion', 'personal', 'Religious affiliation', 'select', true, 'not-empty', 'user'),
  question('personal.religionOther', 'personal', 'Please specify your religion', 'text', true, 'not-empty', 'user', [
    { path: 'personal.religion', operator: 'equals', value: 'other' },
  ]),

  question('revocation.hasPriorWills', 'revocation', 'Have you made any prior Will(s) or Codicil(s)?', 'yes-no', true, 'boolean-answered', 'will'),
  question('revocation.revokesAllPrior', 'revocation', 'Confirm this Will revokes all prior Wills and Codicils', 'yes-no', true, 'confirm-true', 'will', [
    { path: 'revocation.hasPriorWills', operator: 'equals', value: true },
  ]),
  question('revocation.soundMindDeclaration', 'revocation', 'Sound mind, memory & free will declaration', 'yes-no', true, 'confirm-true', 'will'),
  question('revocation.hasMedicalCertificate', 'revocation', 'Medical certificate of mental fitness', 'yes-no', false, 'boolean-answered', 'document'),

  question('executorsGuardians.executors', 'executors', 'Executor details', 'repeater', true, 'array-min-one-complete', 'executor'),
  question('executorsGuardians.compensation', 'executors', 'Executor compensation preference', 'select', true, 'not-empty', 'executor'),
  question('executorsGuardians.hasChildren', 'executors', 'Do you have children?', 'yes-no', true, 'boolean-answered', 'family'),
  question('executorsGuardians.children', 'executors', 'Your children', 'repeater', false, 'optional', 'family_member', [
    { path: 'executorsGuardians.hasChildren', operator: 'equals', value: true },
  ]),
  question('executorsGuardians.hasMinorChildren', 'executors', 'Are any of your children minors?', 'yes-no', true, 'boolean-answered', 'family_member', [
    { path: 'executorsGuardians.hasChildren', operator: 'equals', value: true },
  ]),
  question('executorsGuardians.guardians', 'executors', 'Guardian details for minor children', 'repeater', true, 'array-min-one-complete', 'guardian', [
    { path: 'executorsGuardians.hasChildren', operator: 'equals', value: true },
    { path: 'executorsGuardians.hasMinorChildren', operator: 'equals', value: true },
  ]),

  question('assets.immovableAssets', 'assets', 'Immovable property', 'repeater', false, 'optional', 'asset'),
  question('assets.bankAccounts', 'assets', 'Bank accounts & fixed deposits', 'repeater', false, 'optional', 'asset'),
  question('assets.investments', 'assets', 'Investments', 'repeater', false, 'optional', 'asset'),
  question('assets.valuables', 'assets', 'Valuables', 'repeater', false, 'optional', 'asset'),
  question('assets.hasEncumberedAssets', 'assets', 'Are any assets subject to mortgages, loans, or pledges?', 'yes-no', true, 'boolean-answered', 'liability'),
  question('assets.encumbranceDetails', 'assets', 'Encumbrance details', 'text', true, 'not-empty', 'liability', [
    { path: 'assets.hasEncumberedAssets', operator: 'equals', value: true },
  ]),
  question('assets.debtSettlementMethod', 'assets', 'Liability settlement method', 'select', true, 'not-empty', 'liability', [
    { path: 'assets.hasEncumberedAssets', operator: 'equals', value: true },
  ]),

  question('insurance.hasPolicies', 'insurance', 'Do you hold any life insurance policies?', 'yes-no', true, 'boolean-answered', 'insurance_policy'),
  question('insurance.policies', 'insurance', 'Life insurance policy and nomination details', 'repeater', true, 'array-min-one-complete', 'insurance_policy', [
    { path: 'insurance.hasPolicies', operator: 'equals', value: true },
  ]),

  question('distribution.scheme', 'distribution', 'Distribution scheme', 'select', true, 'not-empty', 'distribution_instruction'),
  question('distribution.beneficiaries', 'distribution', 'Beneficiaries', 'repeater', true, 'array-min-one-complete', 'beneficiary', [
    { path: 'distribution.scheme', operator: 'notEmpty' },
  ]),
  question('distribution.hasFutureAssets', 'distribution', 'Expected future inherited assets', 'yes-no', true, 'boolean-answered', 'asset'),
  question('distribution.futureAssetInstructions', 'distribution', 'Instructions for future inherited assets', 'textarea', true, 'not-empty', 'distribution_instruction', [
    { path: 'distribution.hasFutureAssets', operator: 'equals', value: true },
  ]),
  question('distribution.wantsSimultaneousDeathClause', 'distribution', 'Include a simultaneous-death clause?', 'yes-no', true, 'boolean-answered', 'distribution_instruction'),
  question('distribution.residuaryBeneficiary', 'distribution', 'Ultimate residuary beneficiary', 'text', true, 'not-empty', 'beneficiary'),

  question('funeral.funeralWishes', 'funeral', 'Funeral & final rites wishes', 'textarea', false, 'optional', 'will'),
  question('funeral.payExpensesFromEstate', 'funeral', 'Pay funeral costs and debts from estate before distribution?', 'yes-no', true, 'boolean-answered', 'will'),

  question('execution.witnesses', 'execution', 'Attesting witnesses', 'repeater', true, 'array-min-one-complete', 'execution_event'),
  question('execution.plansVideoRecording', 'execution', 'Videotape signing and reading aloud?', 'yes-no', false, 'boolean-answered', 'execution_event'),
  question('execution.isUttarakhandExecution', 'execution', 'Will you reside in or execute this Will in Uttarakhand?', 'yes-no', true, 'boolean-answered', 'execution_event'),
  question('execution.acknowledgesCodicilProcess', 'execution', 'Acknowledge Codicil process for future changes', 'checkbox', false, 'optional', 'will'),

  question('review.answers', 'review', 'Review answers before submission', 'derived-review', true, 'optional', 'questionnaire_answer'),
]

export function getVisibleQuestions(data: WillData, sectionId?: string) {
  return QUESTIONNAIRE_QUESTIONS.filter(
    (question) => (!sectionId || question.sectionId === sectionId) && isQuestionVisible(question, data),
  )
}

export function getSectionCompletion(data: WillData, sectionId: string) {
  const visibleRequired = getVisibleQuestions(data, sectionId).filter((question) => question.required)
  if (!visibleRequired.length) return 100

  const answered = visibleRequired.filter((question) => isQuestionAnswered(question, data)).length
  return Math.round((answered / visibleRequired.length) * 100)
}

/** True when the section has at least one required, currently visible question (otherwise "100% complete" is meaningless). */
export function hasRequiredQuestions(data: WillData, sectionId: string) {
  return getVisibleQuestions(data, sectionId).some((question) => question.required && question.kind !== 'derived-review')
}

export function getOverallCompletion(data: WillData) {
  const visibleRequired = getVisibleQuestions(data).filter((question) => question.required)
  if (!visibleRequired.length) return 100

  const answered = visibleRequired.filter((question) => isQuestionAnswered(question, data)).length
  return Math.round((answered / visibleRequired.length) * 100)
}

export function getMissingRequiredQuestions(data: WillData, sectionId: string) {
  return getVisibleQuestions(data, sectionId).filter(
    (question) => question.required && !isQuestionAnswered(question, data),
  )
}

export function getVisibleFieldPaths(data: WillData, sectionId: string) {
  return getVisibleQuestions(data, sectionId).map((question) => question.path)
}

export function isQuestionVisible(question: QuestionnaireQuestion, data: WillData) {
  return (question.dependsOn ?? []).every((condition) => evaluateCondition(condition, data))
}

export function isQuestionAnswered(question: QuestionnaireQuestion, data: WillData) {
  if (question.completionRule === 'optional') return true

  const value = getPathValue(data, question.path)
  switch (question.completionRule) {
    case 'not-empty':
      return typeof value === 'string' ? value.trim().length > 0 : value !== null && value !== undefined
    case 'boolean-answered':
      return value === true || value === false
    case 'confirm-true':
      return value === true
    case 'array-min-one':
      return Array.isArray(value) && value.length > 0
    case 'array-min-one-complete':
      return Array.isArray(value) && value.some(hasMeaningfulEntityDetails)
    case 'adult-date': {
      const age = typeof value === 'string' ? computeAge(value) : null
      return age !== null && age >= 18
    }
    default:
      return false
  }
}

function question(
  id: string,
  sectionId: string,
  label: string,
  kind: QuestionKind,
  required: boolean,
  completionRule: CompletionRule,
  entity: QuestionnaireQuestion['entity'],
  dependsOn?: QuestionCondition[],
): QuestionnaireQuestion {
  return { id, sectionId, path: id, label, kind, required, completionRule, entity, dependsOn }
}

function withMessage(item: QuestionnaireQuestion, validationMessage: string): QuestionnaireQuestion {
  return { ...item, validationMessage }
}

function evaluateCondition(condition: QuestionCondition, data: WillData) {
  const value = getPathValue(data, condition.path)
  switch (condition.operator) {
    case 'equals':
      return value === condition.value
    case 'notEquals':
      return value !== condition.value
    case 'isTruthy':
      return Boolean(value)
    case 'notEmpty':
      return typeof value === 'string' ? value.trim().length > 0 : value !== null && value !== undefined
    case 'arrayMinLength':
      return Array.isArray(value) && value.length >= (condition.min ?? 1)
    default:
      return false
  }
}

export function getPathValue(data: WillData, path: string): unknown {
  return path.split('.').reduce<unknown>((current, key) => {
    if (current === null || current === undefined || typeof current !== 'object') return undefined
    return (current as Record<string, unknown>)[key]
  }, data)
}

function hasMeaningfulEntityDetails(value: unknown) {
  if (!value || typeof value !== 'object') return false

  const entity = value as Record<string, unknown>
  const requiredSignals = ['fullName', 'name', 'address', 'bankName', 'insurer', 'description']
  return requiredSignals.some((key) => {
    const fieldValue = entity[key]
    return typeof fieldValue === 'string' && fieldValue.trim().length > 0
  })
}

// ------------------------------------------------------- answer review

export interface AnswerReviewRow {
  questionId: string
  path: string
  label: string
  answer: string
  answered: boolean
  required: boolean
}

export interface AnswerReviewSection {
  sectionId: string
  title: string
  completion: number
  rows: AnswerReviewRow[]
}

const SELECT_LABELS: Record<string, Record<string, string>> = {
  'personal.religion': RELIGION_LABEL,
  'executorsGuardians.compensation': COMPENSATION_LABEL,
  'assets.debtSettlementMethod': DEBT_SETTLEMENT_LABEL,
  'distribution.scheme': DISTRIBUTION_SCHEME_LABEL,
}

function textOf(value: unknown) {
  return typeof value === 'string' ? value.trim() : ''
}

function summarizeRepeater(path: string, items: unknown[]): string {
  const rows = items.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object')
  const label = (row: Record<string, unknown>): string => {
    switch (path) {
      case 'executorsGuardians.executors':
      case 'executorsGuardians.guardians':
        return `${textOf(row.fullName)}${row.isAlternate ? ' (alternate)' : ''}`
      case 'executorsGuardians.children':
        return `${textOf(row.fullName)}${textOf(row.age) ? `, ${textOf(row.age)}` : ''}`
      case 'assets.immovableAssets':
        return textOf(row.address)
      case 'assets.bankAccounts':
        return [textOf(row.bankName), textOf(row.branch)].filter(Boolean).join(', ')
      case 'assets.investments':
        return textOf(row.description) || textOf(row.type)
      case 'assets.valuables':
        return textOf(row.description)
      case 'insurance.policies':
        return [textOf(row.insurer), textOf(row.nomineeName) && `nominee ${textOf(row.nomineeName)}`].filter(Boolean).join(' — ')
      case 'distribution.beneficiaries':
        return [textOf(row.name), textOf(row.share)].filter(Boolean).join(': ')
      case 'execution.witnesses':
        return textOf(row.fullName)
      default:
        return textOf(row.fullName) || textOf(row.name)
    }
  }
  const labels = rows.map(label).filter(Boolean)
  return labels.length ? labels.join('; ') : ''
}

export function describeAnswer(item: QuestionnaireQuestion, data: WillData): string {
  const value = getPathValue(data, item.path)
  switch (item.kind) {
    case 'yes-no':
      return value === true ? 'Yes' : value === false ? 'No' : ''
    case 'checkbox':
      return value === true ? 'Confirmed' : ''
    case 'select': {
      const text = textOf(value)
      return SELECT_LABELS[item.path]?.[text] ?? text
    }
    case 'repeater':
      return Array.isArray(value) ? summarizeRepeater(item.path, value) : ''
    default:
      return textOf(value)
  }
}

/** Every visible question with the answer as recorded — the "review answers before submission" view. */
export function getAnswerReview(data: WillData): AnswerReviewSection[] {
  return QUESTIONNAIRE_SECTIONS.filter((section) => section.id !== 'review')
    .map((section) => ({
      sectionId: section.id,
      title: section.title,
      completion: getSectionCompletion(data, section.id),
      rows: getVisibleQuestions(data, section.id).map((item) => ({
        questionId: item.id,
        path: item.path,
        label: item.label,
        answer: describeAnswer(item, data),
        answered: isQuestionAnswered(item, data),
        required: item.required,
      })),
    }))
    .filter((section) => section.rows.length > 0)
}
