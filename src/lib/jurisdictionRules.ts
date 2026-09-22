import type { ExecutionChecklistItem, LegalFlag, WillData } from './types'

export interface JurisdictionRule {
  state: string
  aliases: string[]
  registration: 'optional' | 'mandatory'
  witnessesRequired: number
  videoRecording: 'optional' | 'recommended'
  stampDutyNote: string
  registrationNote: string
  additionalChecklist: { id: string; label: string }[]
  effectiveFrom: string
  version: string
}

export const JURISDICTION_RULES_VERSION = 'octaraa-jurisdiction-rules-2026.09'

const DEFAULT_RULE: JurisdictionRule = {
  state: 'General (India)',
  aliases: [],
  registration: 'optional',
  witnessesRequired: 2,
  videoRecording: 'optional',
  stampDutyNote: 'No stamp duty is payable on a Will in most states; registration fees apply only if you choose to register.',
  registrationNote:
    'Under Section 18 of the Registration Act, 1908, registration of a Will is optional. Registration is recommended because it strengthens evidentiary value and protects against tampering or loss.',
  additionalChecklist: [],
  effectiveFrom: '2026-01-01',
  version: JURISDICTION_RULES_VERSION,
}

// Versioned, data-driven rules. When a state law changes, add a new rule
// entry with a later effectiveFrom rather than editing historical behavior —
// legal requirements must be auditable over time.
const RULES: JurisdictionRule[] = [
  {
    ...DEFAULT_RULE,
    state: 'Uttarakhand',
    aliases: ['uttarakhand', 'uttaranchal', 'uk'],
    registration: 'mandatory',
    videoRecording: 'recommended',
    stampDutyNote: 'Registration of the Will is compulsory in Uttarakhand under the Uniform Civil Code framework; prescribed registration fees apply.',
    registrationNote:
      'Under the Uttarakhand Uniform Civil Code framework, registration of the Will is compulsory — unlike most other states where it remains optional.',
    additionalChecklist: [
      { id: 'ucc-registration-booking', label: 'UCC Will registration appointment booked with the Sub-Registrar' },
      { id: 'ucc-registration-fee', label: 'Uttarakhand registration fee paid' },
    ],
    effectiveFrom: '2025-01-27',
  },
  {
    ...DEFAULT_RULE,
    state: 'Goa',
    aliases: ['goa'],
    registration: 'optional',
    stampDutyNote:
      'Goa follows the Goa Civil Code (Portuguese Civil Code lineage) for succession matters; notarial registration practices differ from other states — have a local lawyer confirm execution formalities.',
    registrationNote:
      'Registration is optional, but Goa’s civil-law tradition makes notarial registration of Wills a common and well-evidenced practice.',
    additionalChecklist: [{ id: 'goa-notary-review', label: 'Goa civil code formalities reviewed by local counsel' }],
    effectiveFrom: '2026-01-01',
  },
]

export function resolveJurisdictionRule(stateInput: string, isUttarakhandExecution: boolean | null): JurisdictionRule {
  const normalized = (stateInput ?? '').trim().toLowerCase()

  if (isUttarakhandExecution === true) {
    return RULES.find((rule) => rule.state === 'Uttarakhand') ?? DEFAULT_RULE
  }
  if (normalized) {
    // Exact matches only: substring matching would let short aliases such as "uk" or "goa" match unrelated text.
    const match = RULES.find((rule) => rule.state.toLowerCase() === normalized || rule.aliases.includes(normalized))
    if (match) return match
  }
  return DEFAULT_RULE
}

export function jurisdictionFlags(data: WillData): LegalFlag[] {
  const rule = resolveJurisdictionRule(data.personal.state, data.execution.isUttarakhandExecution)

  if (rule.registration === 'mandatory') {
    return [
      {
        id: `jurisdiction-registration-${rule.state.toLowerCase()}`,
        severity: 'warning',
        title: `${rule.state}: Will registration is mandatory`,
        description: rule.registrationNote,
        sourceStepId: 'execution',
      },
    ]
  }

  return [
    {
      id: 'jurisdiction-registration-general',
      severity: 'info',
      title: `${rule.state}: registration optional but recommended`,
      description: rule.registrationNote,
      sourceStepId: 'execution',
    },
  ]
}

export function jurisdictionChecklistItems(data: WillData): ExecutionChecklistItem[] {
  const rule = resolveJurisdictionRule(data.personal.state, data.execution.isUttarakhandExecution)
  const existing = new Set(data.estateOs.executionChecklist.map((item) => item.id))

  return rule.additionalChecklist
    .filter((item) => !existing.has(item.id))
    .map((item) => ({ id: item.id, label: item.label, completed: false }))
}

export function jurisdictionSummary(data: WillData) {
  const rule = resolveJurisdictionRule(data.personal.state, data.execution.isUttarakhandExecution)
  return {
    state: rule.state,
    registration: rule.registration,
    witnessesRequired: rule.witnessesRequired,
    videoRecording: rule.videoRecording,
    stampDutyNote: rule.stampDutyNote,
    registrationNote: rule.registrationNote,
    version: rule.version,
  }
}
