import { describe, expect, it } from 'vitest'
import { buildNominationAlignment, mapAssetsToBeneficiaries } from './assetMapping'
import { defaultWillData } from './defaultData'
import { classifyFileName, mergeBackendAnalysis, reconcileDocument, acceptExtractedAsset } from './documentIntelligence'
import { detectEstateIssues } from './estateIssues'
import { applyInterviewProposal, createInterviewProposal } from './estateInterview'
import { annualReviewDue, answerEstateQuestion, canAdvanceTo, fullExecutionChecklist, generateFollowUpQuestions, looksLikeSecret, reviewRunAt, simulateScenario } from './estateOs'
import { buildEstateProfile, buildFamilyGraph } from './estateProfile'
import { buildEstateSummary } from './estateSummary'
import { newId } from './id'
import { resolveJurisdictionRule } from './jurisdictionRules'
import { computeLegalFlags } from './legalRules'
import { formatInr, parseInr } from './money'
import { getAnswerReview, getMissingRequiredQuestions, isQuestionAnswered, QUESTIONNAIRE_QUESTIONS } from './questionnaireSchema'
import { retrieveLegalSources } from './legalKnowledge'
import type { Beneficiary, VaultDocument, WillData } from './types'

function beneficiary(overrides: Partial<Beneficiary>): Beneficiary {
  return { id: newId(), name: '', relationship: '', share: '', substituteBeneficiary: '', ...overrides }
}

function baseWill(): WillData {
  const data = defaultWillData()
  data.personal = { ...data.personal, fullLegalName: 'Archit Mehta', dateOfBirth: '1980-05-10', state: 'Delhi', religion: 'hindu' }
  data.executorsGuardians.executors[0] = { ...data.executorsGuardians.executors[0], fullName: 'Ravi Mehta', relationship: 'brother' }
  return data
}

function doc(overrides: Partial<VaultDocument>): VaultDocument {
  return {
    id: newId(),
    fileName: 'file.pdf',
    fileSize: 1,
    mimeType: 'application/pdf',
    category: 'property',
    confidence: 0.9,
    extractedMetadata: {},
    reconciliationNotes: [],
    status: 'classified',
    createdAt: new Date().toISOString(),
    ...overrides,
  }
}

describe('ids and money', () => {
  it('produces RFC4122 v4 ids even without crypto.randomUUID (insecure-context fallback)', () => {
    const original = globalThis.crypto.randomUUID
    Object.defineProperty(globalThis.crypto, 'randomUUID', { value: undefined, configurable: true })
    try {
      const id = newId()
      expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
      expect(newId()).not.toBe(id)
    } finally {
      Object.defineProperty(globalThis.crypto, 'randomUUID', { value: original, configurable: true })
    }
  })

  it('parses Indian amounts', () => {
    expect(parseInr('₹2.5 Cr')).toBe(25_000_000)
    expect(parseInr('50 lakh')).toBe(5_000_000)
    expect(parseInr('Rs. 1,20,000')).toBe(120_000)
    expect(parseInr('n/a')).toBeNull()
    expect(formatInr(84_000_000)).toBe('₹8.4 Cr')
  })
})

describe('document classification', () => {
  it('treats underscores as separators and prefers specific types', () => {
    expect(classifyFileName('PAN_card.pdf')).toBe('pan')
    expect(classifyFileName('CAS_statement_2025.pdf')).toBe('cas')
    expect(classifyFileName('home_loan_statement.pdf')).toBe('loan')
    expect(classifyFileName('property-sale-deed.pdf')).toBe('property')
    expect(classifyFileName('showcase.pdf')).toBe('unknown')
  })

  it('flags value and ownership mismatches against the questionnaire (Task 14 examples)', () => {
    const data = baseWill()
    data.assets.immovableAssets = [{ id: 'p1', address: 'Sector 62, Noida', surveyNumber: '', registryDetails: '', ownershipShare: '100', estimatedValue: '₹2.5 Cr' }]
    const notes = reconcileDocument(
      doc({ fileName: 'noida_sale_deed.pdf', extractedMetadata: { value: '₹3.1 Cr', owner: 'Archit Mehta & Priya Mehta' } }),
      data,
    )
    expect(notes.join(' ')).toMatch(/Value mismatch.*₹3\.1 Cr.*₹2\.5 Cr/)
    expect(notes.join(' ')).toMatch(/multiple owners/)
  })

  it('flags a different owner name', () => {
    const notes = reconcileDocument(doc({ extractedMetadata: { owner: 'Suresh Kumar' } }), baseWill())
    expect(notes.join(' ')).toMatch(/verify ownership/i)
  })

  it('sanitises untrusted AI output: object metadata cannot reach the UI as an object, and AI cannot confirm', () => {
    const merged = mergeBackendAnalysis(
      doc({ category: 'unknown', status: 'needs_review' }),
      {
        category: 'not-a-category',
        confidence: 7,
        status: 'confirmed',
        extractedMetadata: { owner: { first: 'A' }, value: 5 },
        reconciliationNotes: 'oops',
        extractedAssets: [{ kind: 'bank', label: 'HDFC FD', identifier: '123456', value: '5 lakh', nominee: 'Priya' }, { nonsense: true }],
      },
      baseWill(),
    )
    expect(merged.category).toBe('unknown')
    expect(merged.confidence).toBe(1)
    expect(merged.status).not.toBe('confirmed')
    expect(Object.values(merged.extractedMetadata).every((value) => typeof value === 'string')).toBe(true)
    expect(merged.extractedAssets).toHaveLength(1)
    expect(merged.extractedAssets?.[0].status).toBe('pending')
  })

  it('adds an extracted asset only on explicit acceptance, and never twice', () => {
    const data = baseWill()
    const merged = mergeBackendAnalysis(
      doc({ category: 'bank' }),
      { category: 'bank', confidence: 0.9, extractedAssets: [{ kind: 'bank', label: 'HDFC FD', identifier: 'FD-99887', value: '5 lakh', nominee: 'Priya' }] },
      data,
    )
    data.documentVault.documents = [merged]
    expect(data.assets.bankAccounts).toHaveLength(0)

    const assetId = merged.extractedAssets![0].id
    const once = acceptExtractedAsset(data, merged.id, assetId)
    expect(once.assets.bankAccounts).toHaveLength(1)
    expect(once.assets.bankAccounts[0].nomineeName).toBe('Priya')
    expect(once.documentVault.documents[0].extractedAssets?.[0].status).toBe('added')
    expect(data.assets.bankAccounts).toHaveLength(0) // input not mutated

    const twice = acceptExtractedAsset(once, merged.id, assetId)
    expect(twice.assets.bankAccounts).toHaveLength(1)
  })
})

describe('interview proposals', () => {
  it('does not mutate existing beneficiary objects when merging', () => {
    const data = baseWill()
    const wife = beneficiary({ name: 'Wife', relationship: 'spouse', share: 'residue' })
    data.distribution.beneficiaries = [wife]
    const frozen = Object.freeze({ ...wife })
    data.distribution.beneficiaries = [frozen as Beneficiary]

    const proposal = createInterviewProposal('Mostly my wife, but I want my daughter to get the property in Noida.')
    const next = applyInterviewProposal(data, proposal)
    expect(frozen.share).toBe('residue')
    expect(next.distribution.beneficiaries.map((item) => item.name)).toEqual(['Wife', 'Daughter'])
  })

  it('understands pure Hindi (Devanagari) so a Hindi speaker still gets a proposal when the AI is unavailable', () => {
    const proposal = createInterviewProposal('मेरी बेटी को नोएडा का मकान दे दीजिए, बाकी सब पत्नी को।', 'hi')
    const byName = Object.fromEntries(proposal.beneficiaries.map((item) => [item.name, item]))
    expect(byName.Daughter).toMatchObject({ relationship: 'child', specificBequest: 'नोएडा मकान' })
    expect(byName.Wife).toMatchObject({ relationship: 'spouse', share: 'residue' })
    expect(proposal.assistantReply).toMatch(/[\u0900-\u097F]/) // replied in Hindi
    // and Hinglish replies stay in Roman script
    expect(createInterviewProposal('Meri beti ko Noida wala ghar dena hai', 'hinglish').assistantReply).toMatch(/^Samajh gayi/)
  })

  it('understands Hinglish and does not add the same asset twice', () => {
    const data = baseWill()
    const proposal = createInterviewProposal('Meri beti ko Noida wala ghar dena hai')
    expect(proposal.beneficiaries[0]).toMatchObject({ name: 'Daughter', specificBequest: 'Noida house' })
    const once = applyInterviewProposal(data, proposal)
    const twice = applyInterviewProposal(once, createInterviewProposal('Meri beti ko Noida wala ghar dena hai'))
    expect(twice.assets.immovableAssets).toHaveLength(1)
    expect(twice.distribution.beneficiaries[0].share).toBe('Noida house')
  })
})

describe('asset → beneficiary mapping', () => {
  it('maps by explicit assignment, description, share and residue — never by list position', () => {
    const data = baseWill()
    data.assets.immovableAssets = [
      { id: 'a1', address: 'Noida house', surveyNumber: '', registryDetails: '', ownershipShare: '' },
      { id: 'a2', address: 'Pune flat', surveyNumber: '', registryDetails: '', ownershipShare: '' },
    ]
    data.assets.bankAccounts = [{ id: 'b1', bankName: 'HDFC', branch: '', accountNumber: '1234567890' }]
    data.distribution.scheme = 'itemized'
    data.distribution.beneficiaries = [
      beneficiary({ id: 'w', name: 'Priya', relationship: 'spouse', share: 'residue' }),
      beneficiary({ id: 'd', name: 'Ananya', relationship: 'child', share: 'Noida property' }),
      beneficiary({ id: 's', name: 'Rohan', relationship: 'child', assignedAssetIds: ['a2'] }),
    ]
    const byAsset = Object.fromEntries(mapAssetsToBeneficiaries(data).map(({ asset, targets }) => [asset.id, targets.map((target) => `${target.name}:${target.basis}`)]))
    expect(byAsset.a1).toEqual(['Ananya:described'])
    expect(byAsset.a2).toEqual(['Rohan:assigned'])
    expect(byAsset.b1).toEqual(['Priya:residue'])
  })

  it('splits a percentage scheme across everyone and leaves undecidable assets unmapped', () => {
    const data = baseWill()
    data.assets.valuables = [{ id: 'v1', description: 'Gold', estimatedValue: '' }]
    data.distribution.scheme = 'itemized'
    data.distribution.beneficiaries = [beneficiary({ name: 'Priya', relationship: 'spouse', share: '50%' })]
    expect(mapAssetsToBeneficiaries(data)[0].targets).toEqual([])
    data.distribution.scheme = 'percentage'
    expect(mapAssetsToBeneficiaries(data)[0].targets[0]).toMatchObject({ name: 'Priya', basis: 'share' })
  })

  it('flags nominee ≠ intended beneficiary without declaring legal consequences', () => {
    const data = baseWill()
    data.assets.bankAccounts = [{ id: 'b1', bankName: 'HDFC FD', branch: '', accountNumber: '1', nomineeName: 'Father' }]
    data.insurance = { hasPolicies: true, policies: [{ id: 'p1', insurer: 'LIC', policyNumber: '9', nomineeName: 'Priya', nomineeRelationship: 'spouse', alignWithWill: null }] }
    data.distribution.scheme = 'all-in-one'
    data.distribution.beneficiaries = [beneficiary({ name: 'Priya', relationship: 'spouse' })]
    const rows = Object.fromEntries(buildNominationAlignment(data).map((row) => [row.assetId, row.status]))
    expect(rows).toEqual({ b1: 'mismatch', p1: 'aligned' })
  })
})

describe('estate issues (Tasks 7, 8, 15)', () => {
  it('detects "three children but only two beneficiaries"', () => {
    const data = baseWill()
    data.executorsGuardians.hasChildren = true
    data.executorsGuardians.children = [
      { id: '1', fullName: 'Ananya Mehta', age: '20' },
      { id: '2', fullName: 'Rohan Mehta', age: '17' },
      { id: '3', fullName: 'Kabir Mehta', age: '9' },
    ]
    data.distribution.beneficiaries = [beneficiary({ name: 'Ananya Mehta', relationship: 'child' }), beneficiary({ name: 'Rohan Mehta', relationship: 'child' })]
    const issue = detectEstateIssues(data).find((item) => item.id === 'children-not-beneficiaries')
    expect(issue?.title).toBe('You listed 3 children but only 2 are named as a beneficiary')
    expect(issue?.description).toContain('Kabir Mehta')
  })

  it('checks percentage totals, underage testators and witness/beneficiary overlap', () => {
    const data = baseWill()
    data.distribution.scheme = 'percentage'
    data.distribution.beneficiaries = [beneficiary({ name: 'A', share: '60%' }), beneficiary({ name: 'B', share: '30%' })]
    data.personal.dateOfBirth = new Date(Date.now() - 10 * 365 * 24 * 3600 * 1000).toISOString().slice(0, 10)
    data.execution.witnesses[0] = { ...data.execution.witnesses[0], fullName: 'A', isAlsoBeneficiary: false }
    const ids = detectEstateIssues(data).map((issue) => issue.id)
    expect(ids).toContain('percentage-total-not-100')
    expect(ids).toContain('testator-under-18')
    expect(ids.some((id) => id.startsWith('witness-is-beneficiary'))).toBe(true)
    expect(computeLegalFlags(data).some((flag) => flag.id === 'testator-not-adult')).toBe(true)
  })

  it('voids the bequest for a Christian testator when the witness is a beneficiary by name, even if the toggle says No', () => {
    const data = baseWill()
    data.personal.religion = 'christian'
    data.distribution.beneficiaries = [beneficiary({ name: 'Maria Dsouza', relationship: 'other' })]
    data.execution.witnesses[0] = { ...data.execution.witnesses[0], fullName: 'Maria Dsouza', isAlsoBeneficiary: false }
    expect(computeLegalFlags(data).some((flag) => flag.id === 'witness-beneficiary-void')).toBe(true)
  })

  it('does not inflate contingency completion when there are no beneficiaries', () => {
    const data = baseWill()
    expect(buildEstateProfile(data).completion.contingencies).toBe(0)
  })

  it('does not count a jurisdiction alias substring as a match', () => {
    expect(resolveJurisdictionRule('Lucknow', null).state).toBe('General (India)')
    expect(resolveJurisdictionRule('Uttarakhand', null).registration).toBe('mandatory')
  })
})

describe('questionnaire', () => {
  it('requires an adult date of birth and the religion detail', () => {
    const data = baseWill()
    const dob = QUESTIONNAIRE_QUESTIONS.find((item) => item.id === 'personal.dateOfBirth')!
    data.personal.dateOfBirth = '2015-01-01'
    expect(isQuestionAnswered(dob, data)).toBe(false)
    data.personal.dateOfBirth = '1990-01-01'
    expect(isQuestionAnswered(dob, data)).toBe(true)

    data.personal.religion = 'other'
    expect(getMissingRequiredQuestions(data, 'personal').map((item) => item.id)).toContain('personal.religionOther')
  })

  it('produces a readable answer review', () => {
    const data = baseWill()
    data.executorsGuardians.hasChildren = true
    data.executorsGuardians.children = [{ id: 'c', fullName: 'Ananya', age: '20' }]
    const review = getAnswerReview(data)
    const executors = review.find((section) => section.sectionId === 'executors')!
    expect(executors.rows.find((row) => row.path === 'executorsGuardians.executors')?.answer).toBe('Ravi Mehta')
    expect(executors.rows.find((row) => row.path === 'executorsGuardians.children')?.answer).toBe('Ananya, 20')
    expect(review.find((section) => section.sectionId === 'personal')!.rows.find((row) => row.path === 'personal.religion')?.answer).toBe('Hindu')
  })
})

describe('copilot and scenarios', () => {
  it('matches words, not substrings ("person"/"reason" are not children)', () => {
    const data = baseWill()
    data.distribution.beneficiaries = [beneficiary({ name: 'Ananya', relationship: 'child', share: 'Noida property' })]
    expect(answerEstateQuestion(data, 'What is the reason for the person flag?')).toMatch(/Estate readiness/)
  })

  it('answers "what assets have I assigned to my daughter?" from the mapping', () => {
    const data = baseWill()
    data.assets.immovableAssets = [{ id: 'a1', address: 'Noida house', surveyNumber: '', registryDetails: '', ownershipShare: '' }]
    data.distribution.scheme = 'itemized'
    data.distribution.beneficiaries = [beneficiary({ id: 'd', name: 'Ananya', relationship: 'child', share: 'Noida property' })]
    const answer = answerEstateQuestion(data, 'What assets have I assigned to my daughter?')
    expect(answer).toContain('Ananya')
    expect(answer).toContain('Noida house')
  })

  it('falls back to the recorded alternate executor and substitutes, and names the residuary when none', () => {
    const data = baseWill()
    data.executorsGuardians.executors.push({ id: 'e2', fullName: 'Sita', age: '', address: '', relationship: 'sister', isAlternate: true })
    expect(simulateScenario(data, 'What if my primary executor cannot act?')).toContain('Sita')

    data.distribution.beneficiaries = [
      beneficiary({ name: 'Priya', relationship: 'spouse', substituteBeneficiary: 'Ananya' }),
      beneficiary({ name: 'Rohan', relationship: 'child' }),
    ]
    data.distribution.residuaryBeneficiary = 'Charity Trust'
    expect(simulateScenario(data, 'What happens if my wife dies before me?')).toContain('recorded substitute is Ananya')
    expect(simulateScenario(data, 'What if my son predeceases me?')).toContain('Charity Trust')
  })

  it('keeps earlier follow-up answers when the list is regenerated and enforces ordered post-death steps', () => {
    const data = baseWill()
    const first = generateFollowUpQuestions(data)
    data.estateOs.generatedFollowUps = first.map((item) => ({ ...item, status: 'dismissed' as const }))
    expect(generateFollowUpQuestions(data).every((item) => item.status === 'dismissed')).toBe(true)
    expect(canAdvanceTo('not_started', 'executor_authenticated')).toBe(false)
    expect(canAdvanceTo('not_started', 'death_reported')).toBe(true)
    expect(canAdvanceTo('inventory_review', 'death_reported')).toBe(true)
  })
})

describe('summary and family graph', () => {
  it('sums only recorded values and says how many were excluded', () => {
    const data = baseWill()
    data.assets.immovableAssets = [{ id: 'a1', address: 'Noida house', surveyNumber: '', registryDetails: '', ownershipShare: '', estimatedValue: '₹2.5 Cr' }]
    data.assets.bankAccounts = [{ id: 'b1', bankName: 'HDFC', branch: '', accountNumber: '1', estimatedValue: '50 lakh' }, { id: 'b2', bankName: 'SBI', branch: '', accountNumber: '2' }]
    const summary = buildEstateSummary(data)
    expect(summary.estimatedValue).toBe(30_000_000)
    expect(summary.valueNote).toContain('2 of 3')
    expect(summary.text).toContain('Estimated estate value: ₹3 Cr')
  })

  it('merges a person named as beneficiary and executor into one node with both roles', () => {
    const data = baseWill()
    data.executorsGuardians.executors[0] = { ...data.executorsGuardians.executors[0], fullName: 'Priya Mehta', relationship: 'wife' }
    data.distribution.beneficiaries = [beneficiary({ name: 'Priya Mehta', relationship: 'spouse', share: 'residue' })]
    const graph = buildFamilyGraph(data)
    expect(graph.spouse).toHaveLength(1)
    expect(graph.spouse[0].roles).toEqual(expect.arrayContaining(['Beneficiary', 'Primary executor']))
  })
})

describe('legal knowledge retrieval', () => {
  it('matches whole words/stems only', () => {
    expect(retrieveLegalSources('Can a witness also be a beneficiary?').map((source) => source.id)).toEqual(expect.arrayContaining(['isa-1925-s67']))
    expect(retrieveLegalSources('What is the capital of Peru?')).toEqual([])
  })
})

describe('legacy vault, checklist and reviews', () => {
  it('blocks passwords, PINs, seed phrases and keys but allows locations and instructions', () => {
    expect(looksLikeSecret('Gmail password: Hunter2!')).toBe(true)
    expect(looksLikeSecret('my ATM PIN 4821')).toBe(true)
    expect(looksLikeSecret('seed phrase: ' + 'apple banana cherry dog eel fox goat hat ink jar kite lamp')).toBe(true)
    expect(looksLikeSecret('0x' + 'a'.repeat(64))).toBe(true)
    expect(looksLikeSecret('Login details are in the sealed envelope in the locker at HDFC Andheri')).toBe(false)
    expect(looksLikeSecret('The PIN is in the safe; ask my lawyer for the key')).toBe(false)
    expect(looksLikeSecret('Executor should close the account and download the photos first')).toBe(false)
  })

  it('adds the mandatory Uttarakhand registration steps to the live checklist and derives witness items from recorded data', () => {
    const data = baseWill()
    expect(fullExecutionChecklist(data).some((item) => item.id === 'ucc-registration-booking')).toBe(false)
    data.execution.isUttarakhandExecution = true
    data.execution.witnesses[0] = { ...data.execution.witnesses[0], fullName: 'Asha', idNumber: 'XXXX1234' }
    const checklist = fullExecutionChecklist(data)
    expect(checklist.find((item) => item.id === 'ucc-registration-booking')).toMatchObject({ completed: false })
    expect(checklist.find((item) => item.id === 'witness-1')).toMatchObject({ completed: true, auto: true })
    expect(checklist.find((item) => item.id === 'witness-2')).toMatchObject({ completed: false })
  })

  it('schedules reminders at 09:00 on the due date and never in the past; flags a stale annual review', () => {
    const future = new Date(Date.now() + 40 * 24 * 3600 * 1000).toISOString().slice(0, 10)
    expect(new Date(reviewRunAt(future)).getHours()).toBe(9)
    expect(Date.parse(reviewRunAt('2001-01-01'))).toBeGreaterThan(Date.now() - 5000)

    const data = baseWill()
    expect(annualReviewDue(data)).toBe(false)
    data.estateOs.reviewEvents = [{ id: 'r1', trigger: 'Annual estate review', dueDate: '2024-01-01', status: 'completed' }]
    expect(annualReviewDue(data)).toBe(true)
    data.estateOs.reviewEvents.push({ id: 'r2', trigger: 'Annual estate review', dueDate: '2027-01-01', status: 'pending' })
    expect(annualReviewDue(data)).toBe(false)
  })
})
