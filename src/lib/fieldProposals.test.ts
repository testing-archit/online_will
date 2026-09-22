import { describe, expect, it } from 'vitest'
import { buildAssistantContext } from './assistantContext'
import { defaultWillData } from './defaultData'
import { applyInterviewProposal } from './estateInterview'
import { describeFieldValue, fieldChangeRows, getFillableFields, resolveFieldUpdates } from './fieldProposals'

const paths = (stepId: string) => getFillableFields(defaultWillData(), stepId).map((field) => field.path)

describe('which answers Samaira may propose', () => {
  it('offers ordinary answers on the step, with the allowed options for a select', () => {
    expect(paths('personal')).toEqual(expect.arrayContaining(['personal.fullLegalName', 'personal.city', 'personal.religion', 'personal.religionOther']))
    const religion = getFillableFields(defaultWillData(), 'personal').find((field) => field.path === 'personal.religion')!
    expect(religion.options?.map((option) => option.value)).toContain('sikh')
    expect(getFillableFields(defaultWillData(), 'personal').find((field) => field.path === 'personal.religionOther')!.visible).toBe(false)
  })

  it('never offers legal declarations, lists of people or assets, or the review step', () => {
    const everything = ['personal', 'revocation', 'executors', 'assets', 'insurance', 'distribution', 'funeral', 'execution', 'review'].flatMap(paths)
    for (const forbidden of ['revocation.soundMindDeclaration', 'revocation.revokesAllPrior', 'execution.acknowledgesCodicilProcess', 'executorsGuardians.executors', 'assets.bankAccounts', 'distribution.beneficiaries', 'review.answers']) {
      expect(everything).not.toContain(forbidden)
    }
    expect(paths('revocation')).toContain('revocation.hasPriorWills')
  })

  it('shares the fields with the model without sharing any answers', () => {
    const data = defaultWillData()
    data.personal.fullLegalName = 'Secret Name'
    data.personal.city = 'Secretville'
    const steps = [{ id: 'personal', title: 'About you' }]
    const context = buildAssistantContext(data, steps, 'personal')
    expect(JSON.stringify(context)).not.toMatch(/Secret Name|Secretville/)
    expect(context.fillableFields.find((field) => field.path === 'personal.city')?.answered).toBe(true)
  })
})

describe('validating suggested answers', () => {
  const data = defaultWillData()

  it('accepts well-formed values and reads select labels case-insensitively', () => {
    const updates = resolveFieldUpdates(data, 'personal', [
      { path: 'personal.city', value: '  Gurugram ' },
      { path: 'personal.religion', value: 'Sikh' },
      { path: 'personal.dateOfBirth', value: '1980-05-10' },
    ])
    expect(updates).toEqual([
      { path: 'personal.city', value: 'Gurugram' },
      { path: 'personal.religion', value: 'sikh' },
      { path: 'personal.dateOfBirth', value: '1980-05-10' },
    ])
    expect(resolveFieldUpdates(data, 'revocation', [{ path: 'revocation.hasPriorWills', value: 'Yes' }])).toEqual([{ path: 'revocation.hasPriorWills', value: true }])
  })

  it('rejects anything that is not a fillable field on this step', () => {
    expect(resolveFieldUpdates(data, 'personal', [{ path: 'revocation.hasPriorWills', value: true }])).toEqual([])
    expect(resolveFieldUpdates(data, 'revocation', [{ path: 'revocation.soundMindDeclaration', value: true }])).toEqual([])
    expect(resolveFieldUpdates(data, 'executors', [{ path: 'executorsGuardians.executors', value: 'x' }])).toEqual([])
    expect(resolveFieldUpdates(data, 'personal', [{ path: '__proto__.polluted', value: 'x' }, { path: 'estateOs.auditTrail', value: [] }])).toEqual([])
    expect(({} as Record<string, unknown>).polluted).toBeUndefined()
  })

  it('rejects values of the wrong type or outside the allowed options', () => {
    const bad = [
      { path: 'personal.religion', value: 'jedi' },
      { path: 'personal.dateOfBirth', value: '10/05/1980' },
      { path: 'personal.dateOfBirth', value: '1980-02-31' },
      { path: 'personal.dateOfBirth', value: '2999-01-01' },
      { path: 'personal.city', value: '' },
      { path: 'personal.city', value: 42 },
      { path: 'personal.pincode', value: { $ne: 1 } },
      null,
      'nonsense',
    ]
    expect(resolveFieldUpdates(data, 'personal', bad)).toEqual([])
    expect(resolveFieldUpdates(data, 'revocation', [{ path: 'revocation.hasPriorWills', value: 'maybe' }])).toEqual([])
    expect(resolveFieldUpdates(data, 'personal', 'not an array')).toEqual([])
  })

  it('caps length, strips control characters, and limits the batch', () => {
    const [long] = resolveFieldUpdates(data, 'personal', [{ path: 'personal.addressLine', value: `a\u0000b${'x'.repeat(900)}` }])
    expect(String(long.value)).not.toContain('\u0000')
    expect(String(long.value).length).toBe(500)
    const many = Array.from({ length: 30 }, (_, index) => ({ path: 'personal.city', value: `City ${index}` }))
    expect(resolveFieldUpdates(data, 'personal', many).length).toBe(1)
  })

  it('drops changes that would not change anything, and fields that stay hidden', () => {
    const filled = defaultWillData()
    filled.personal.city = 'Gurugram'
    expect(resolveFieldUpdates(filled, 'personal', [{ path: 'personal.city', value: 'Gurugram' }])).toEqual([])
    // "Please specify" only exists once the religion is Other…
    expect(resolveFieldUpdates(data, 'personal', [{ path: 'personal.religionOther', value: 'Bahá’í' }])).toEqual([])
    // …but is fine when the same batch sets it.
    expect(resolveFieldUpdates(data, 'personal', [{ path: 'personal.religionOther', value: 'Bahá’í' }, { path: 'personal.religion', value: 'other' }]).map((update) => update.path).sort()).toEqual(['personal.religion', 'personal.religionOther'])
  })

  it('describes values and before/after rows for the confirmation card', () => {
    const filled = defaultWillData()
    filled.personal.city = 'Noida'
    expect(describeFieldValue('personal.religion', 'sikh')).toBe('Sikh')
    expect(describeFieldValue('revocation.hasPriorWills', false)).toBe('No')
    expect(fieldChangeRows(filled, [{ path: 'personal.city', value: 'Gurugram' }])).toEqual([{ path: 'personal.city', label: 'City', before: 'Noida', after: 'Gurugram' }])
  })
})

describe('confirming a suggestion that only fills in answers', () => {
  it('does not touch the assets or the distribution scheme', () => {
    const data = defaultWillData()
    const proposal = { id: 'p1', originalStatement: 'my city is Noida', assistantReply: '', followUpQuestion: '', beneficiaries: [], fieldUpdates: [{ path: 'personal.city', value: 'Noida' }], status: 'pending' as const, createdAt: '' }
    data.assistantIntake.interviewProposals = [proposal]
    const next = applyInterviewProposal(data, proposal)
    expect(next.distribution).toBe(data.distribution)
    expect(next.assets).toBe(data.assets)
    expect(next.assistantIntake.interviewProposals[0].status).toBe('confirmed')
  })
})
