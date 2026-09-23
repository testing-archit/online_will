import { describe, expect, it } from 'vitest'
import { defaultWillData, emptyPerson } from './defaultData'
import { newId } from './id'
import { computeLegalFlags, flagCounts } from './legalRules'
import type { Beneficiary, WillData } from './types'

function beneficiary(overrides: Partial<Beneficiary>): Beneficiary {
  return { id: newId(), name: '', relationship: '', share: '', substituteBeneficiary: '', ...overrides }
}

/** A will with every rule's happy path already satisfied, so each test only has to break one thing. */
function cleanWill(): WillData {
  const data = defaultWillData()
  data.personal = { ...data.personal, fullLegalName: 'Archit Mehta', dateOfBirth: '1980-05-10', state: 'Delhi', religion: 'hindu' }
  data.revocation = { hasPriorWills: false, revokesAllPrior: false, soundMindDeclaration: true, hasMedicalCertificate: true }
  data.executorsGuardians.executors[0] = { ...data.executorsGuardians.executors[0], fullName: 'Ravi Mehta', relationship: 'brother' }
  data.assets.hasEncumberedAssets = false
  data.insurance.hasPolicies = false
  data.execution.witnesses = [
    { ...emptyPerson(), fullName: 'Witness One', isAlsoBeneficiary: false, idNumber: '' },
    { ...emptyPerson(), fullName: 'Witness Two', isAlsoBeneficiary: false, idNumber: '' },
  ]
  data.execution.plansVideoRecording = true
  return data
}

function flagIds(data: WillData) {
  return computeLegalFlags(data).map((flag) => flag.id)
}

describe('computeLegalFlags: testamentary capacity', () => {
  it('flags a testator who is not yet an adult', () => {
    const data = cleanWill()
    data.personal.dateOfBirth = new Date().toISOString().slice(0, 10) // born today
    expect(flagIds(data)).toContain('testator-not-adult')
  })

  it('does not flag an adult testator', () => {
    expect(flagIds(cleanWill())).not.toContain('testator-not-adult')
  })
})

describe('computeLegalFlags: Shariat (Muslim personal law)', () => {
  it('flags a bequest to non-heirs over the one-third limit', () => {
    const data = cleanWill()
    data.personal.religion = 'muslim'
    data.distribution.scheme = 'percentage'
    data.distribution.beneficiaries = [beneficiary({ name: 'Friend', relationship: 'other', share: '50%' })]
    expect(flagIds(data)).toContain('shariat-one-third')
  })

  it('gives an informational note instead when non-heir bequests stay within one-third', () => {
    const data = cleanWill()
    data.personal.religion = 'muslim'
    data.distribution.scheme = 'percentage'
    data.distribution.beneficiaries = [beneficiary({ name: 'Friend', relationship: 'other', share: '20%' })]
    const ids = flagIds(data)
    expect(ids).toContain('shariat-note')
    expect(ids).not.toContain('shariat-one-third')
  })

  it('treats an unparseable share for a non-heir as needing review', () => {
    const data = cleanWill()
    data.personal.religion = 'muslim'
    data.distribution.scheme = 'percentage'
    data.distribution.beneficiaries = [beneficiary({ name: 'Friend', relationship: 'other', share: 'the rest' })]
    expect(flagIds(data)).toContain('shariat-one-third')
  })
})

describe('computeLegalFlags: revocation', () => {
  it('requires an explicit revocation clause when a prior will exists', () => {
    const data = cleanWill()
    data.revocation.hasPriorWills = true
    data.revocation.revokesAllPrior = false
    expect(flagIds(data)).toContain('missing-revocation-clause')
  })

  it('requires the sound-mind declaration', () => {
    const data = cleanWill()
    data.revocation.soundMindDeclaration = false
    expect(flagIds(data)).toContain('missing-sound-mind')
  })

  it('suggests (but does not require) a medical certificate', () => {
    const data = cleanWill()
    data.revocation.hasMedicalCertificate = false
    const flags = computeLegalFlags(data)
    const flag = flags.find((f) => f.id === 'no-medical-certificate')
    expect(flag?.severity).toBe('info')
  })
})

describe('computeLegalFlags: executors and guardians', () => {
  it('requires a named primary executor', () => {
    const data = cleanWill()
    data.executorsGuardians.executors = [{ ...emptyPerson(), fullName: '', isAlternate: false }]
    expect(flagIds(data)).toContain('no-primary-executor')
  })

  it('does not count an alternate as satisfying the primary-executor requirement', () => {
    const data = cleanWill()
    data.executorsGuardians.executors = [{ ...emptyPerson(), fullName: 'Backup Only', isAlternate: true }]
    expect(flagIds(data)).toContain('no-primary-executor')
  })

  it('requires a primary guardian when there are minor children', () => {
    const data = cleanWill()
    data.executorsGuardians.hasChildren = true
    data.executorsGuardians.hasMinorChildren = true
    data.executorsGuardians.guardians = []
    expect(flagIds(data)).toContain('no-primary-guardian')
  })

  it('does not require a guardian when there are no minor children', () => {
    const data = cleanWill()
    data.executorsGuardians.hasChildren = false
    data.executorsGuardians.hasMinorChildren = false
    expect(flagIds(data)).not.toContain('no-primary-guardian')
  })
})

describe('computeLegalFlags: assets and insurance', () => {
  it('flags encumbered assets with no settlement method', () => {
    const data = cleanWill()
    data.assets.hasEncumberedAssets = true
    data.assets.debtSettlementMethod = ''
    expect(flagIds(data)).toContain('unspecified-debt-settlement')
  })

  it('warns when a spouse/parent/child insurance nominee is not the intended ultimate beneficiary', () => {
    const data = cleanWill()
    const policyId = newId()
    data.insurance.hasPolicies = true
    data.insurance.policies = [{ id: policyId, insurer: 'LIC', policyNumber: '123', nomineeName: 'Spouse', nomineeRelationship: 'spouse', alignWithWill: false }]
    expect(flagIds(data)).toContain(`insurance-beneficial-owner-${policyId}`)
  })

  it('notes that a non-family nominee only collects proceeds as a trustee', () => {
    const data = cleanWill()
    const policyId = newId()
    data.insurance.hasPolicies = true
    data.insurance.policies = [{ id: policyId, insurer: 'LIC', policyNumber: '123', nomineeName: 'Friend', nomineeRelationship: 'other', alignWithWill: null }]
    expect(flagIds(data)).toContain(`insurance-trustee-nominee-${policyId}`)
  })
})

describe('computeLegalFlags: distribution', () => {
  it('requires at least one beneficiary once a scheme is chosen', () => {
    const data = cleanWill()
    data.distribution.scheme = 'all-in-one'
    data.distribution.beneficiaries = []
    expect(flagIds(data)).toContain('no-beneficiaries')
  })

  it('suggests a residuary (fallback) beneficiary', () => {
    const data = cleanWill()
    data.distribution.scheme = 'all-in-one'
    data.distribution.beneficiaries = [beneficiary({ name: 'Child', relationship: 'child', share: '100%' })]
    data.distribution.residuaryBeneficiary = ''
    expect(flagIds(data)).toContain('no-residuary-beneficiary')
  })

  it('suggests a simultaneous-death clause when beneficiaries exist and none was requested', () => {
    const data = cleanWill()
    data.distribution.scheme = 'all-in-one'
    data.distribution.beneficiaries = [beneficiary({ name: 'Child', relationship: 'child', share: '100%' })]
    data.distribution.wantsSimultaneousDeathClause = false
    expect(flagIds(data)).toContain('no-simultaneous-death-clause')
  })
})

describe('computeLegalFlags: execution and attestation', () => {
  it('requires at least two named witnesses', () => {
    const data = cleanWill()
    data.execution.witnesses = [{ ...emptyPerson(), fullName: 'Only One', isAlsoBeneficiary: false, idNumber: '' }]
    expect(flagIds(data)).toContain('witness-count')
  })

  it('voids a Christian testator bequest to a witness who is also a beneficiary', () => {
    const data = cleanWill()
    data.personal.religion = 'christian'
    data.distribution.scheme = 'all-in-one'
    data.distribution.beneficiaries = [beneficiary({ name: 'Witness One', relationship: 'child', share: '100%' })]
    data.execution.witnesses[0] = { ...data.execution.witnesses[0], fullName: 'Witness One', isAlsoBeneficiary: true }
    const flags = computeLegalFlags(data)
    expect(flags.find((f) => f.id === 'witness-beneficiary-void')?.severity).toBe('critical')
  })

  it('allows a Hindu testator bequest to a witness who is also a beneficiary, with an informational note', () => {
    const data = cleanWill()
    data.personal.religion = 'hindu'
    data.execution.witnesses[0] = { ...data.execution.witnesses[0], isAlsoBeneficiary: true }
    const flags = computeLegalFlags(data)
    expect(flags.find((f) => f.id === 'witness-beneficiary-allowed')?.severity).toBe('info')
    expect(flagIds(data)).not.toContain('witness-beneficiary-void')
  })

  it('suggests (but does not require) recording the signing', () => {
    const data = cleanWill()
    data.execution.plansVideoRecording = false
    const flags = computeLegalFlags(data)
    expect(flags.find((f) => f.id === 'video-recording-suggestion')?.severity).toBe('info')
  })
})

describe('computeLegalFlags: jurisdiction and ordering', () => {
  it('always surfaces a jurisdiction registration flag, even on an otherwise clean will', () => {
    const ids = flagIds(cleanWill())
    expect(ids).toContain('jurisdiction-registration-general')
  })

  it('escalates to a mandatory-registration warning for Uttarakhand execution', () => {
    const data = cleanWill()
    data.execution.isUttarakhandExecution = true
    expect(flagIds(data)).toContain('jurisdiction-registration-uttarakhand')
  })

  it('sorts critical flags before warnings before info', () => {
    const data = cleanWill()
    data.personal.dateOfBirth = new Date().toISOString().slice(0, 10) // critical: testator-not-adult
    data.execution.plansVideoRecording = false // info: video-recording-suggestion
    const severities = computeLegalFlags(data).map((flag) => flag.severity)
    const firstWarningOrInfo = severities.findIndex((s) => s !== 'critical')
    expect(severities.slice(0, firstWarningOrInfo).every((s) => s === 'critical')).toBe(true)
  })
})

describe('flagCounts', () => {
  it('tallies flags by severity', () => {
    const data = cleanWill()
    data.personal.dateOfBirth = new Date().toISOString().slice(0, 10) // critical
    data.revocation.hasMedicalCertificate = false // info
    const counts = flagCounts(computeLegalFlags(data))
    expect(counts.critical).toBeGreaterThanOrEqual(1)
    expect(counts.info).toBeGreaterThanOrEqual(1)
    expect(counts.critical + counts.warning + counts.info).toBe(computeLegalFlags(data).length)
  })
})
