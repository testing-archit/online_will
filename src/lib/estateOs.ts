import { newId } from './id'
import { buildNominationAlignment, listAssets, mapAssetsToBeneficiaries } from './assetMapping'
import { detectEstateIssues } from './estateIssues'
import { buildEstateProfile } from './estateProfile'
import { jurisdictionChecklistItems, jurisdictionSummary } from './jurisdictionRules'
import { formatInr } from './money'
import type { Beneficiary, ExecutionChecklistItem, PostDeathWorkflowStatus, WillData } from './types'

const has = (text: string, pattern: RegExp) => pattern.test(text)

/** The relationship word (if any) a question is about: "my daughter", "son", "wife". */
function relationshipFocus(question: string): Beneficiary['relationship'] | null {
  if (has(question, /\b(daughters?|sons?|child|children|kids?)\b/)) return 'child'
  if (has(question, /\b(wife|husband|spouse)\b/)) return 'spouse'
  if (has(question, /\b(mother|father|parents?)\b/)) return 'parent'
  return null
}

function beneficiaryFocus(data: WillData, question: string): Beneficiary[] {
  const named = data.distribution.beneficiaries.filter((beneficiary) => beneficiary.name.trim())
  const byName = named.filter((beneficiary) => has(question, new RegExp(`\\b${escapeRegExp(beneficiary.name.trim().toLowerCase())}\\b`)))
  if (byName.length) return byName
  const relationship = relationshipFocus(question)
  if (!relationship) return []
  const genderWord = question.match(/\b(daughters?|sons?)\b/)?.[1]
  return named.filter((beneficiary) => {
    if (beneficiary.relationship !== relationship) return false
    // "daughter"/"son" narrows within children when the recorded name says which.
    return genderWord ? !/\b(son|daughter)\b/i.test(beneficiary.name) || new RegExp(genderWord.replace(/s$/, ''), 'i').test(beneficiary.name) : true
  })
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Deterministic Q&A over recorded data. It only reads what the user entered
 * (never invents facts) and says so when something is not recorded.
 */
export function answerEstateQuestion(data: WillData, question: string) {
  const q = question.toLowerCase()
  const profile = buildEstateProfile(data)
  const mappings = mapAssetsToBeneficiaries(data)

  const focus = beneficiaryFocus(data, q)
  if (focus.length && has(q, /\b(assign|assigned|get|gets|receive|receives|inherit|inherits|give|given|left|leave|share|allocat\w*)\b|what.*\b(has|have)\b/)) {
    return focus
      .map((beneficiary) => {
        const assets = mappings
          .filter(({ targets }) => targets.some((target) => target.beneficiaryId === beneficiary.id && target.basis !== 'share'))
          .map(({ asset }) => asset.title)
        const parts = [assets.length ? `assets: ${assets.join(', ')}` : '', beneficiary.share ? `share/description: ${beneficiary.share}` : ''].filter(Boolean)
        return `${beneficiary.name}: ${parts.join(' · ') || 'no specific allocation recorded yet'}`
      })
      .join('\n')
  }
  if (relationshipFocus(q) && !focus.length && has(q, /\b(assign|assigned|get|gets|receive|inherit|share)\b/)) {
    return 'No matching beneficiary is recorded yet.'
  }

  if (has(q, /\b(alternate|alternative|backup|cannot act|unable|unwilling|fallback)\b/) && has(q, /\bexecutors?\b/)) {
    const alternate = data.executorsGuardians.executors.filter((executor) => executor.isAlternate && executor.fullName.trim())
    return alternate.length
      ? `If the primary executor cannot act, the recorded alternate executor is ${alternate.map((executor) => executor.fullName).join(', ')}.`
      : 'No alternate executor is recorded.'
  }

  if (has(q, /\bexecutors?\b/)) {
    const primary = data.executorsGuardians.executors.filter((executor) => !executor.isAlternate && executor.fullName.trim())
    const alternate = data.executorsGuardians.executors.filter((executor) => executor.isAlternate && executor.fullName.trim())
    return `Primary executor(s): ${primary.map((executor) => executor.fullName).join(', ') || 'not recorded'}.\nAlternate executor(s): ${alternate.map((executor) => executor.fullName).join(', ') || 'not recorded'}.`
  }

  if (has(q, /\bguardians?\b/)) {
    if (!data.executorsGuardians.hasMinorChildren) return 'No minor children are recorded, so no guardian is needed in the current answers.'
    return profile.guardians.length
      ? profile.guardians.map((guardian) => `${guardian.title} — ${guardian.subtitle}`).join('\n')
      : 'Minor children are recorded but no guardian is named yet.'
  }

  if (has(q, /\b(nominee|nominees|nomination|nominations)\b/)) {
    const rows = buildNominationAlignment(data)
    return rows.length
      ? rows.map((row) => `${row.assetTitle}: nominee ${row.nominee || 'not recorded'}; intended beneficiary ${row.intendedBeneficiaries.join(', ') || 'not recorded'} — ${row.status.replace(/-/g, ' ')}`).join('\n')
      : 'No nominations are recorded yet.'
  }

  if (has(q, /\b(insurance|polic(y|ies))\b/)) {
    return profile.insurance.length ? profile.insurance.map((policy) => `${policy.title} (${policy.subtitle}) — ${policy.meta}`).join('\n') : 'No insurance policies are recorded.'
  }

  if (has(q, /\b(document|documents|upload|uploaded|vault|deed)\b/)) {
    return profile.documents.length ? profile.documents.map((document) => `${document.title} — ${document.meta ?? document.subtitle ?? ''}`).join('\n') : 'No documents are in the vault yet.'
  }

  if (has(q, /\b(worth|value|valuation|how much|estate size)\b/)) {
    const assets = listAssets(data)
    const valued = assets.filter((asset) => asset.value !== null)
    if (!valued.length) return 'No asset values are recorded yet.'
    const total = valued.reduce((sum, asset) => sum + (asset.value ?? 0), 0)
    return `Recorded value across ${valued.length} of ${assets.length} asset(s): ${formatInr(total)}. Assets without a recorded value are excluded.`
  }

  if (has(q, /\b(witness|witnesses)\b/)) {
    const named = data.execution.witnesses.filter((witness) => witness.fullName.trim())
    return named.length ? `Recorded witnesses: ${named.map((witness) => witness.fullName).join(', ')}.` : 'No witnesses are recorded yet.'
  }

  if (has(q, /\b(register|registration|registered|uttarakhand|stamp)\b/)) {
    const rule = jurisdictionSummary(data)
    return `${rule.state}: registration is ${rule.registration}. ${rule.registrationNote}`
  }

  if (has(q, /\b(assets?|property|properties|own)\b/)) {
    return profile.assets.length ? profile.assets.map((asset) => `${asset.title}${asset.subtitle ? ` (${asset.subtitle})` : ''}`).join('\n') : 'No assets are recorded yet.'
  }

  if (has(q, /\b(beneficiar\w*|inherit\w*|heirs?)\b/)) {
    return profile.beneficiaries.length ? profile.beneficiaries.map((item) => `${item.title} — ${item.subtitle}. ${item.meta ?? ''}`).join('\n') : 'No beneficiaries are recorded yet.'
  }

  if (has(q, /\b(missing|open|incomplete|left|pending|gaps?|issues?)\b/)) {
    return profile.missingInformation.length ? profile.missingInformation.map((item) => item.title).join('\n') : 'No open mandatory information is currently detected.'
  }

  return `Estate readiness is ${profile.completion.overall}%. Ask about assets, beneficiaries, executor fallback, nominees, documents or missing information for a more specific answer.`
}

/**
 * Scenario simulation built only from the instructions the user recorded
 * (substitute beneficiaries, alternate executors/guardians, residuary clause).
 */
export function simulateScenario(data: WillData, scenario: string) {
  const s = scenario.toLowerCase()
  const residuary = data.distribution.residuaryBeneficiary.trim()
  const named = data.distribution.beneficiaries.filter((beneficiary) => beneficiary.name.trim())

  if (has(s, /\bexecutors?\b/)) {
    const alternate = data.executorsGuardians.executors.find((executor) => executor.isAlternate && executor.fullName.trim())
    return alternate
      ? `If the primary executor cannot act, ${alternate.fullName} is recorded as alternate executor.`
      : 'No alternate executor is recorded — the court would need to appoint an administrator. Consider naming an alternate.'
  }

  if (has(s, /\bguardians?\b/)) {
    const alternate = data.executorsGuardians.guardians.find((guardian) => guardian.isAlternate && guardian.fullName.trim())
    return alternate ? `If the primary guardian cannot act, ${alternate.fullName} is recorded as alternate guardian.` : 'No alternate guardian is recorded.'
  }

  if (has(s, /\b(simultaneous|together|same time|accident)\b/)) {
    return data.distribution.wantsSimultaneousDeathClause
      ? 'You included a simultaneous-death clause: a beneficiary who dies together with you, or where the order is unclear, is treated as having predeceased you, so their substitute (or the residuary beneficiary) takes.'
      : 'No simultaneous-death clause is included. Whether survivorship is presumed would then depend on the law rather than your instructions — a lawyer should review this.'
  }

  if (has(s, /\b(predeceas\w*|dies before|die before|passes away before|not alive|dead|dies|death)\b/) || has(s, /\bwhat if\b.*\b(wife|husband|spouse|son|daughter|child)\b/)) {
    const targets = beneficiaryFocus(data, s)
    const selected = targets.length ? targets : has(s, /\b(wife|husband|spouse)\b/) ? named.filter((beneficiary) => beneficiary.relationship === 'spouse') : named
    if (!selected.length) return 'No matching beneficiary is recorded yet.'
    return selected
      .map((beneficiary) => {
        if (beneficiary.substituteBeneficiary.trim()) {
          return `If ${beneficiary.name} predeceases you, the recorded substitute is ${beneficiary.substituteBeneficiary}.`
        }
        return residuary
          ? `No substitute is recorded for ${beneficiary.name}. Their share would fall to the residuary beneficiary you named (${residuary}) if the gift lapses — please confirm with your lawyer.`
          : `No substitute is recorded for ${beneficiary.name} and no residuary beneficiary is named, so the gift could lapse into intestate succession. Consider adding one.`
      })
      .join('\n')
  }

  if (has(s, /\b(sell|sold|sale)\b/) && has(s, /\b(property|house|flat|plot)\b/)) {
    const assigned = mapAssetsToBeneficiaries(data).filter(({ asset, targets }) => asset.kind === 'immovable' && targets.length)
    return assigned.length
      ? `${assigned.map(({ asset, targets }) => `${asset.title} is currently earmarked for ${targets.map((target) => target.name).join(', ')}`).join('; ')}. A specific gift of an asset you no longer own at death generally cannot be given effect — review the instruction with your lawyer.`
      : 'No property is currently earmarked for a specific beneficiary.'
  }

  return 'No recorded instruction matches this scenario yet. Try: "What if my wife predeceases me?", "What if my executor cannot act?", or "What if my son dies before me?".'
}

const FOLLOW_UP_TEMPLATES = {
  loan: 'For each property, should the beneficiary receive it subject to any outstanding loan?',
  guardian: 'Should guardians receive staggered financial powers for education, healthcare, and maintenance?',
  video: 'Who will store and control access to the execution recording?',
  business: 'You mentioned business or company holdings. Do you want specific succession instructions for them?',
  value: 'What is the approximate value of each property or account you listed?',
} as const

/**
 * Follow-up questions are picked from an approved template set and from the
 * issues detected in recorded data — never free-form model output.
 */
export function generateFollowUpQuestions(data: WillData) {
  const questions: string[] = detectEstateIssues(data)
    .filter((issue) => issue.severity !== 'context')
    .slice(0, 6)
    .map((issue) => issue.title)

  const assets = listAssets(data)
  if (data.assets.immovableAssets.some((asset) => asset.address.trim()) && data.assets.hasEncumberedAssets) questions.push(FOLLOW_UP_TEMPLATES.loan)
  if (data.executorsGuardians.hasChildren && data.executorsGuardians.hasMinorChildren) questions.push(FOLLOW_UP_TEMPLATES.guardian)
  if (data.execution.plansVideoRecording) questions.push(FOLLOW_UP_TEMPLATES.video)
  if (assets.some((asset) => asset.kind !== 'insurance' && asset.value === null)) questions.push(FOLLOW_UP_TEMPLATES.value)
  if (data.assets.investments.some((investment) => /\b(business|company|llp|partnership|shares?)\b/i.test(`${investment.type} ${investment.description}`))) {
    questions.push(FOLLOW_UP_TEMPLATES.business)
  }

  const existing = new Map(data.estateOs.generatedFollowUps.map((item) => [item.question, item]))
  return Array.from(new Set(questions)).map((question) => {
    const previous = existing.get(question)
    // Keep the user's earlier answer/dismissal instead of re-opening it on every refresh.
    return previous ?? { id: newId(), question, status: 'open' as const }
  })
}

export function createAnnualReviewEvent() {
  const dueDate = new Date()
  dueDate.setFullYear(dueDate.getFullYear() + 1)
  return {
    id: newId(),
    trigger: 'Annual estate review',
    dueDate: dueDate.toISOString().slice(0, 10),
    status: 'pending' as const,
  }
}

export function createEventReview(trigger: string) {
  return {
    id: newId(),
    trigger,
    dueDate: new Date().toISOString().slice(0, 10),
    status: 'pending' as const,
  }
}

export const ANNUAL_REVIEW_QUESTIONS = [
  'Has your marital status changed?',
  'Have your children or dependants changed (birth, adoption)?',
  'Have you acquired new property or investments?',
  'Have you taken new insurance or changed nominees?',
  'Do you have new liabilities?',
  'Has your business ownership changed?',
  'Do your executor, guardian or witness choices still hold?',
]

export function reviewReminderEmail(trigger: string, dueDate: string) {
  const list = ANNUAL_REVIEW_QUESTIONS.map((question) => `- ${question}`).join('\n')
  return {
    subject: `Octaraa: time for your estate review (${trigger})`,
    textContent: `This is your reminder for: ${trigger}, due ${dueDate}.\n\nPlease revisit your Will and confirm:\n${list}\n\nThis is a workflow reminder, not legal advice.`,
    htmlContent: `<h2>Time for your estate review</h2><p>Reminder for <strong>${escapeHtml(trigger)}</strong>, due ${escapeHtml(dueDate)}.</p><p>Please revisit your Will and confirm:</p><ul>${ANNUAL_REVIEW_QUESTIONS.map((question) => `<li>${escapeHtml(question)}</li>`).join('')}</ul><p style="color:#64748b;font-size:12px">This is a workflow reminder, not legal advice.</p>`,
  }
}

function escapeHtml(value: string) {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

// ----------------------------------------------------- execution checklist

/**
 * Checklist items that can be verified from recorded data are derived, so the
 * "live" checklist reflects reality; the rest remain manual confirmations.
 */
export function deriveChecklistState(data: WillData): (ExecutionChecklistItem & { auto: boolean; hint?: string })[] {
  const docs = data.documentVault.documents
  const hasConfirmed = (...categories: string[]) => docs.some((document) => categories.includes(document.category) && document.status === 'confirmed')
  const witnesses = data.execution.witnesses

  const derived: Record<string, { done: boolean; hint: string }> = {
    'testator-id': { done: hasConfirmed('id', 'pan'), hint: 'Confirmed ID/PAN document in the vault' },
    pan: { done: hasConfirmed('pan'), hint: 'Confirmed PAN document in the vault' },
    'witness-1': { done: Boolean(witnesses[0]?.fullName.trim() && witnesses[0]?.idNumber.trim()), hint: 'Witness name and ID recorded' },
    'witness-2': { done: Boolean(witnesses[1]?.fullName.trim() && witnesses[1]?.idNumber.trim()), hint: 'Witness name and ID recorded' },
  }

  return data.estateOs.executionChecklist.map((item) => {
    const auto = derived[item.id]
    // Items that cannot be verified from recorded data (medical certificate, registration...) stay manual.
    if (auto) return { ...item, completed: item.completed || auto.done, auto: auto.done, hint: auto.hint }
    return { ...item, auto: false }
  })
}

/** The live checklist: stored items (with values derived from recorded data) plus jurisdiction-specific steps, e.g. mandatory registration in Uttarakhand. */
export function fullExecutionChecklist(data: WillData) {
  const extra = jurisdictionChecklistItems(data).map((item) => ({ ...item, auto: false as const, hint: undefined }))
  return [...deriveChecklistState(data), ...extra]
}

// ------------------------------------------------------------ legacy vault

const SECRET_PATTERNS = [
  // "password: Hunter2!" — a password-like word assigned a token that contains a digit or symbol.
  /\b(pass(word|code|phrase)?|pwd|passwd)\b\s*(is|=|:|-)\s*(?=\S*[\d!@#$%^&*])\S{4,}/i,
  // "PIN 4821", "OTP: 123456", "CVV = 123"
  /\b(pin|otp|cvv|cvc)\b\s*(is|=|:|-)?\s*\d{3,8}\b/i,
  // A spelled-out recovery phrase: "seed phrase: word word word ..." (12+ words)
  /\b(seed|recovery|mnemonic)\s*(phrase|words?)\b\s*(is|=|:|-)\s*([a-z]+\s+){11}/i,
  // Bitcoin WIF private key and 0x-prefixed 32-byte hex keys
  /\b[5KL][1-9A-HJ-NP-Za-km-z]{50,51}\b/,
  /\b0x[a-fA-F0-9]{64}\b/,
]

/**
 * Digital-asset notes describe WHERE things are and who should act — never the
 * credentials themselves. This blocks the most common ways a password, PIN,
 * seed phrase or private key would be typed into the record.
 */
export function looksLikeSecret(text: string) {
  return SECRET_PATTERNS.some((pattern) => pattern.test(text))
}

export const EVENT_REVIEW_PRESETS = [
  'Marriage',
  'Birth or adoption of a child',
  'Divorce or separation',
  'New property acquired',
  'Major asset acquired or sold',
  'New insurance policy',
  'Business ownership changed',
  'Death of a beneficiary',
  'Executor no longer available',
] as const

/** Reminders go out at 09:00 local time on the due date (never in the past). */
export function reviewRunAt(dueDate: string) {
  const target = new Date(`${dueDate}T09:00:00`)
  return (Number.isNaN(target.getTime()) || target.getTime() < Date.now() ? new Date() : target).toISOString()
}

/** True when there is no pending review and the last completed one is 12+ months old (or none exists). */
export function annualReviewDue(data: WillData, now = new Date()) {
  const reviews = data.estateOs.reviewEvents
  if (reviews.some((review) => review.status === 'pending' && review.trigger === 'Annual estate review')) return false
  const completed = reviews.filter((review) => review.status === 'completed').map((review) => Date.parse(review.dueDate)).filter(Number.isFinite)
  if (completed.length === 0) return false
  const last = Math.max(...completed)
  return now.getTime() - last > 365 * 24 * 3600 * 1000
}

// ------------------------------------------------------------ post-death

const POST_DEATH_ORDER: PostDeathWorkflowStatus[] = [
  'not_started',
  'death_reported',
  'executor_authenticated',
  'inventory_review',
  'distribution_tracking',
]

export function postDeathSteps() {
  return POST_DEATH_ORDER
}

/** Steps must be taken in order; the only allowed jumps are the next step or back to a previous one. */
export function canAdvanceTo(current: PostDeathWorkflowStatus, target: PostDeathWorkflowStatus) {
  const from = POST_DEATH_ORDER.indexOf(current)
  const to = POST_DEATH_ORDER.indexOf(target)
  return to <= from || to === from + 1
}

