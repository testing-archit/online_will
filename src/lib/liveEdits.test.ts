import { describe, expect, it } from 'vitest'
import { defaultWillData } from './defaultData'
import { applyListEdit, listsOnStep, LIVE_LISTS } from './liveEdits'
import type { WillData } from './types'

function ok(result: ReturnType<typeof applyListEdit>): { data: WillData; summary: string; focus: string; touched: string[] } {
  if (!result.ok) throw new Error(result.error)
  return result
}

describe('live list editing', () => {
  it('adds an executor with the same defaults the on-screen button gives, alternate from the second on', () => {
    const first = ok(applyListEdit(defaultWillData(), { list: 'executors', action: 'add', values: { fullName: 'Priya Mehta', relationship: 'wife' } }))
    // The form's empty starter row is filled in, not left blank above the new entry.
    expect(first.data.executorsGuardians.executors).toHaveLength(1)
    expect(first.data.executorsGuardians.executors[0]).toMatchObject({ fullName: 'Priya Mehta', relationship: 'wife', isAlternate: false })
    expect(first.touched).toEqual(['executorsGuardians'])
    const second = ok(applyListEdit(first.data, { list: 'executors', action: 'add', values: { fullName: 'Karan Mehta' } }))
    expect(second.data.executorsGuardians.executors.at(-1)).toMatchObject({ fullName: 'Karan Mehta', isAlternate: true })
    expect(second.focus).toBe(`executorsGuardians.executors.${second.data.executorsGuardians.executors.length - 1}`)
  })

  it('does not duplicate: adding the same name again updates that entry', () => {
    const a = ok(applyListEdit(defaultWillData(), { list: 'bankAccounts', action: 'add', values: { bankName: 'HDFC Bank' } }))
    const b = ok(applyListEdit(a.data, { list: 'bankAccounts', action: 'add', values: { bankName: 'hdfc bank', branch: 'Noida Sector 18' } }))
    expect(b.data.assets.bankAccounts).toHaveLength(1)
    expect(b.data.assets.bankAccounts[0]).toMatchObject({ bankName: 'HDFC Bank', branch: 'Noida Sector 18' })
    expect(b.summary).toMatch(/^Updated bank account "HDFC Bank"/)
  })

  it('updates the entry the person names, by part of the name or by position, and refuses an ambiguous one', () => {
    let data = ok(applyListEdit(defaultWillData(), { list: 'bankAccounts', action: 'add', values: { bankName: 'HDFC Bank' } })).data
    data = ok(applyListEdit(data, { list: 'bankAccounts', action: 'add', values: { bankName: 'HDFC Securities' } })).data
    data = ok(applyListEdit(data, { list: 'bankAccounts', action: 'add', values: { bankName: 'State Bank of India' } })).data

    expect(ok(applyListEdit(data, { list: 'bankAccounts', action: 'update', match: 'state bank', values: { accountNumber: '0011223344' } })).data.assets.bankAccounts[2].accountNumber).toBe('0011223344')
    expect(ok(applyListEdit(data, { list: 'bankAccounts', action: 'update', match: '2', values: { branch: 'Delhi' } })).data.assets.bankAccounts[1].branch).toBe('Delhi')
    const ambiguous = applyListEdit(data, { list: 'bankAccounts', action: 'update', match: 'hdfc', values: { branch: 'x' } })
    expect(ambiguous.ok).toBe(false)
    expect(!ambiguous.ok && ambiguous.error).toMatch(/More than one/)
    expect(applyListEdit(data, { list: 'bankAccounts', action: 'update', match: 'axis', values: { branch: 'x' } }).ok).toBe(false)
  })

  it('removes an entry, and clears (never appends to) the two fixed witness places', () => {
    const added = ok(applyListEdit(defaultWillData(), { list: 'valuables', action: 'add', values: { description: 'Gold necklace', estimatedValue: '3 lakh' } }))
    expect(ok(applyListEdit(added.data, { list: 'valuables', action: 'remove', match: 'necklace' })).data.assets.valuables).toHaveLength(0)

    let data = ok(applyListEdit(defaultWillData(), { list: 'witnesses', action: 'add', values: { fullName: 'Asha Rao' } })).data
    data = ok(applyListEdit(data, { list: 'witnesses', action: 'add', values: { fullName: 'Vikram Shah', isAlsoBeneficiary: 'no' } })).data
    expect(data.execution.witnesses.map((witness) => witness.fullName)).toEqual(['Asha Rao', 'Vikram Shah'])
    expect(data.execution.witnesses[1].isAlsoBeneficiary).toBe(false)
    expect(applyListEdit(data, { list: 'witnesses', action: 'add', values: { fullName: 'Third Person' } }).ok).toBe(false)
    const cleared = ok(applyListEdit(data, { list: 'witnesses', action: 'remove', match: 'Asha' }))
    expect(cleared.data.execution.witnesses).toHaveLength(2)
    expect(cleared.data.execution.witnesses[0].fullName).toBe('')
  })

  it('only opens a list once the answer that makes it appear has been given', () => {
    const data = defaultWillData()
    const blocked = applyListEdit(data, { list: 'guardians', action: 'add', values: { fullName: 'Meera' } })
    expect(!blocked.ok && blocked.error).toMatch(/hasMinorChildren/)
    expect(applyListEdit(data, { list: 'children', action: 'add', values: { fullName: 'Anaya' } }).ok).toBe(false)

    data.executorsGuardians.hasChildren = true
    data.executorsGuardians.hasMinorChildren = true
    expect(ok(applyListEdit(data, { list: 'children', action: 'add', values: { fullName: 'Anaya', age: '9' } })).data.executorsGuardians.children[0]).toMatchObject({ fullName: 'Anaya', age: '9' })
    expect(ok(applyListEdit(data, { list: 'guardians', action: 'add', values: { fullName: 'Meera', relationship: 'sister' } })).data.executorsGuardians.guardians[0].fullName).toBe('Meera')
  })

  it('treats model output as untrusted: unknown lists, actions and fields are refused, values are coerced', () => {
    const data = defaultWillData()
    expect(applyListEdit(data, { list: 'passwords', action: 'add', values: { x: 1 } }).ok).toBe(false)
    expect(applyListEdit(data, { list: 'executors', action: 'drop', values: {} }).ok).toBe(false)
    expect(applyListEdit(data, { list: 'executors', action: 'add', values: { idNumber: '1234', __proto__: 'x' } }).ok).toBe(false)

    const policy = defaultWillData()
    policy.insurance.hasPolicies = true
    const result = ok(applyListEdit(policy, { list: 'policies', action: 'add', values: { insurer: 'LIC', nomineeRelationship: 'Spouse', alignWithWill: 'yes', secret: 'x' } }))
    expect(result.data.insurance.policies[0]).toMatchObject({ insurer: 'LIC', nomineeRelationship: 'spouse', alignWithWill: true })
    expect(result.summary).toContain('ignored: secret')
    const badSelect = ok(applyListEdit(policy, { list: 'policies', action: 'add', values: { insurer: 'HDFC Life', nomineeRelationship: 'cousin' } }))
    expect(badSelect.data.insurance.policies[0].nomineeRelationship).toBe('')
    const long = ok(applyListEdit(data, { list: 'valuables', action: 'add', values: { description: `a${'b'.repeat(500)}\u0000` } }))
    expect(long.data.assets.valuables[0].description.length).toBeLessThanOrEqual(200)
    expect(long.data.assets.valuables[0].description).not.toContain('\u0000')
  })

  it('does not change the input, and reports what each step offers', () => {
    const data = defaultWillData()
    const before = JSON.stringify(data)
    applyListEdit(data, { list: 'executors', action: 'add', values: { fullName: 'Priya' } })
    expect(JSON.stringify(data)).toBe(before)

    const onExecutors = listsOnStep(data, 'executors')
    expect(onExecutors.map((entry) => entry.list)).toEqual(['executors', 'children', 'guardians'])
    expect(onExecutors.find((entry) => entry.list === 'guardians')).toMatchObject({ available: false })
    expect(onExecutors.find((entry) => entry.list === 'executors')?.fields).toContain('fullName')
    expect(Object.keys(LIVE_LISTS).length).toBeGreaterThanOrEqual(10)
  })
})
