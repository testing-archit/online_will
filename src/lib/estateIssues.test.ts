import { describe, expect, it } from 'vitest'
import { defaultWillData, emptyPerson } from './defaultData'
import { detectEstateIssues, estateIssuesToItems, hasMandatoryEstateIssues } from './estateIssues'
import { newId } from './id'
import type { AssistantExtraction, Beneficiary, WillData } from './types'

function beneficiary(overrides: Partial<Beneficiary>): Beneficiary {
  return { id: newId(), name: '', relationship: '', share: '', substituteBeneficiary: '', ...overrides }
}

function issueIds(data: WillData) {
  return detectEstateIssues(data).map((issue) => issue.id)
}

describe('detectEstateIssues: deterministic completeness', () => {
  it('suggests an alternate executor once a primary one is named', () => {
    const data = defaultWillData()
    data.executorsGuardians.executors = [{ ...emptyPerson(), fullName: 'Primary Only', isAlternate: false }]
    expect(issueIds(data)).toContain('no-alternate-executor')
  })

  it('does not suggest an alternate executor when one is already named', () => {
    const data = defaultWillData()
    data.executorsGuardians.executors = [
      { ...emptyPerson(), fullName: 'Primary', isAlternate: false },
      { ...emptyPerson(), fullName: 'Backup', isAlternate: true },
    ]
    expect(issueIds(data)).not.toContain('no-alternate-executor')
  })

  it('flags missing insurance policy details when policies were said to exist', () => {
    const data = defaultWillData()
    data.insurance.hasPolicies = true
    data.insurance.policies = []
    const issue = detectEstateIssues(data).find((i) => i.id === 'insurance-policy-details-missing')
    expect(issue?.severity).toBe('mandatory')
  })

  it('flags a policy with no nominee recorded', () => {
    const data = defaultWillData()
    const policyId = newId()
    data.insurance.hasPolicies = true
    data.insurance.policies = [{ id: policyId, insurer: 'LIC', policyNumber: '1', nomineeName: '', nomineeRelationship: '', alignWithWill: null }]
    expect(issueIds(data)).toContain(`policy-nominee-missing-${policyId}`)
  })

  it('flags beneficiaries with no substitute', () => {
    const data = defaultWillData()
    data.distribution.beneficiaries = [beneficiary({ name: 'Only Child', relationship: 'child', share: '100%', substituteBeneficiary: '' })]
    expect(issueIds(data)).toContain('beneficiary-substitutes-missing')
  })

  it('flags a percentage scheme where a beneficiary has no percentage', () => {
    const data = defaultWillData()
    data.distribution.scheme = 'percentage'
    data.distribution.beneficiaries = [beneficiary({ name: 'A', relationship: 'child', share: '' })]
    expect(issueIds(data)).toContain('percentage-share-missing')
  })

  it('flags a percentage scheme that does not add up to 100', () => {
    const data = defaultWillData()
    data.distribution.scheme = 'percentage'
    data.distribution.beneficiaries = [
      beneficiary({ name: 'A', relationship: 'child', share: '30%' }),
      beneficiary({ name: 'B', relationship: 'child', share: '30%' }),
    ]
    expect(issueIds(data)).toContain('percentage-total-not-100')
  })

  it('does not flag a percentage scheme that adds up to exactly 100', () => {
    const data = defaultWillData()
    data.distribution.scheme = 'percentage'
    data.distribution.beneficiaries = [
      beneficiary({ name: 'A', relationship: 'child', share: '60%' }),
      beneficiary({ name: 'B', relationship: 'child', share: '40%' }),
    ]
    expect(issueIds(data)).not.toContain('percentage-total-not-100')
  })

  it('flags an invalid date of birth as mandatory, distinct from under-18', () => {
    const data = defaultWillData()
    data.personal.dateOfBirth = 'not-a-date'
    const issue = detectEstateIssues(data).find((i) => i.id === 'invalid-date-of-birth')
    expect(issue?.severity).toBe('mandatory')
  })

  it('flags a testator under 18 distinctly from an invalid date', () => {
    const data = defaultWillData()
    data.personal.dateOfBirth = new Date().toISOString().slice(0, 10)
    const ids = issueIds(data)
    expect(ids).toContain('testator-under-18')
    expect(ids).not.toContain('invalid-date-of-birth')
  })
})

describe('detectEstateIssues: contextual checks', () => {
  it('flags unnamed children when the person said they have children', () => {
    const data = defaultWillData()
    data.executorsGuardians.hasChildren = true
    data.executorsGuardians.children = []
    expect(issueIds(data)).toContain('children-names-missing')
  })

  it('flags a named child who is not listed as a beneficiary', () => {
    const data = defaultWillData()
    data.executorsGuardians.hasChildren = true
    data.executorsGuardians.children = [{ id: newId(), fullName: 'Anaya Mehta', age: '10' }]
    data.distribution.beneficiaries = []
    expect(issueIds(data)).toContain('children-not-beneficiaries')
  })

  it('does not flag a child who is also listed as a beneficiary', () => {
    const data = defaultWillData()
    data.executorsGuardians.hasChildren = true
    data.executorsGuardians.children = [{ id: newId(), fullName: 'Anaya Mehta', age: '10' }]
    data.distribution.beneficiaries = [beneficiary({ name: 'Anaya Mehta', relationship: 'child', share: '100%' })]
    expect(issueIds(data)).not.toContain('children-not-beneficiaries')
  })

  it('flags encumbered assets combined with an itemized distribution', () => {
    const data = defaultWillData()
    data.assets.hasEncumberedAssets = true
    data.distribution.scheme = 'itemized'
    expect(issueIds(data)).toContain('itemized-distribution-with-encumbrance')
  })

  it('flags an itemized asset with no recipient', () => {
    const data = defaultWillData()
    data.distribution.scheme = 'itemized'
    data.assets.immovableAssets = [{ id: newId(), address: 'Plot 7, Noida', surveyNumber: '', registryDetails: '', ownershipShare: '' }]
    expect(issueIds(data)).toContain('assets-without-recipient')
  })
})

describe('detectEstateIssues: contradictions', () => {
  it('flags an all-in-one scheme with more than one beneficiary', () => {
    const data = defaultWillData()
    data.distribution.scheme = 'all-in-one'
    data.distribution.beneficiaries = [beneficiary({ name: 'A', relationship: 'spouse' }), beneficiary({ name: 'B', relationship: 'child' })]
    expect(issueIds(data)).toContain('all-in-one-multiple-beneficiaries')
  })

  it('flags an all-in-one scheme where specific assets are still assigned', () => {
    const data = defaultWillData()
    data.distribution.scheme = 'all-in-one'
    data.distribution.beneficiaries = [beneficiary({ name: 'A', relationship: 'spouse', assignedAssetIds: ['asset-1'] })]
    expect(issueIds(data)).toContain('all-in-one-with-specific-assets')
  })

  it('flags an itemized scheme that mixes in percentage shares', () => {
    const data = defaultWillData()
    data.distribution.scheme = 'itemized'
    data.distribution.beneficiaries = [beneficiary({ name: 'A', relationship: 'spouse', share: '50%' })]
    expect(issueIds(data)).toContain('itemized-with-percentages')
  })

  it('flags the same asset assigned to two different beneficiaries', () => {
    const data = defaultWillData()
    const assetId = newId()
    data.distribution.scheme = 'itemized'
    data.assets.immovableAssets = [{ id: assetId, address: 'Plot 7', surveyNumber: '', registryDetails: '', ownershipShare: '' }]
    data.distribution.beneficiaries = [
      beneficiary({ name: 'A', relationship: 'child', assignedAssetIds: [assetId] }),
      beneficiary({ name: 'B', relationship: 'child', assignedAssetIds: [assetId] }),
    ]
    expect(issueIds(data)).toContain(`asset-multiple-recipients-${assetId}`)
  })

  it('flags a beneficiary listed more than once', () => {
    const data = defaultWillData()
    data.distribution.beneficiaries = [
      beneficiary({ name: 'Rohan Mehta', relationship: 'child', share: '50%' }),
      beneficiary({ name: 'rohan mehta', relationship: 'child', share: '50%' }),
    ]
    expect(issueIds(data)).toContain('duplicate-beneficiary-rohan-mehta')
  })

  it('flags a witness who is also a beneficiary without the toggle confirming it', () => {
    const data = defaultWillData()
    data.execution.witnesses[0] = { ...data.execution.witnesses[0], fullName: 'Rohan Mehta', isAlsoBeneficiary: false }
    data.distribution.beneficiaries = [beneficiary({ name: 'Rohan Mehta', relationship: 'other', share: '10%' })]
    expect(issueIds(data)).toContain(`witness-is-beneficiary-${data.execution.witnesses[0].id}`)
  })

  it('flags residing/executing in Uttarakhand with a "No" answer to Uttarakhand execution', () => {
    const data = defaultWillData()
    data.personal.state = 'Uttarakhand'
    data.execution.isUttarakhandExecution = false
    expect(issueIds(data)).toContain('uttarakhand-state-conflict')
  })

  it('flags a confirmed assistant instruction not reflected in the beneficiary list', () => {
    const data = defaultWillData()
    const extraction: AssistantExtraction = {
      id: newId(),
      originalStatement: 'my flat in Pune goes to my brother Karan',
      assetDescription: 'flat in Pune',
      assetType: 'immovable',
      intendedBeneficiary: 'Karan',
      distributionInstruction: '',
      confidence: 0.9,
      status: 'confirmed',
      createdAt: new Date().toISOString(),
    }
    data.assistantIntake.extractions = [extraction]
    data.distribution.beneficiaries = [beneficiary({ name: 'Someone Else', relationship: 'other', share: '100%' })]
    expect(issueIds(data)).toContain(`assistant-beneficiary-not-in-distribution-${extraction.id}`)
  })

  it('flags a child marked as a minor whose listed age is 18 or older', () => {
    const data = defaultWillData()
    data.executorsGuardians.hasMinorChildren = true
    data.executorsGuardians.children = [{ id: newId(), fullName: 'Grown Up', age: '25' }]
    expect(issueIds(data)).toContain('minor-children-but-all-adults')
  })

  it('flags a child under 18 when no child was said to be a minor', () => {
    const data = defaultWillData()
    data.executorsGuardians.hasMinorChildren = false
    data.executorsGuardians.children = [{ id: newId(), fullName: 'Young One', age: '10' }]
    expect(issueIds(data)).toContain('adult-children-but-minor-listed')
  })
})

describe('estateIssuesToItems and hasMandatoryEstateIssues', () => {
  it('formats issues into estate-profile items with severity/source in the meta line', () => {
    const data = defaultWillData()
    data.insurance.hasPolicies = true
    data.insurance.policies = []
    const items = estateIssuesToItems(detectEstateIssues(data))
    const item = items.find((i) => i.id === 'insurance-policy-details-missing')
    expect(item?.meta).toBe('mandatory · deterministic-rule')
  })

  it('is true whenever detectEstateIssues includes a mandatory-severity issue', () => {
    // A blank questionnaire already has unanswered required questions (mandatory by definition), so this is
    // true from the default state; adding another mandatory condition keeps it true.
    const withMandatory = defaultWillData()
    withMandatory.insurance.hasPolicies = true
    withMandatory.insurance.policies = []
    expect(hasMandatoryEstateIssues(withMandatory)).toBe(true)
    expect(detectEstateIssues(withMandatory).some((issue) => issue.severity === 'mandatory')).toBe(true)
  })
})
