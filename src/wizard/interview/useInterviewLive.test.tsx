// @vitest-environment jsdom
import { act, useEffect, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import { FormProvider, useForm } from 'react-hook-form'
import { describe, expect, it } from 'vitest'
import { buildAssistantContext } from '../../lib/assistantContext'
import { defaultWillData } from '../../lib/defaultData'
import type { WillData } from '../../lib/types'
import { STEPS } from '../stepConfig'
import { useInterview } from './useInterview'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

async function mount() {
  let api!: ReturnType<typeof useInterview>
  let form!: ReturnType<typeof useForm<WillData>>
  function Probe() {
    const value = useInterview({ getContext: (data) => buildAssistantContext(data, STEPS, 'personal') })
    useEffect(() => {
      api = value
    })
    return null
  }
  function Wrapper({ children }: { children: ReactNode }) {
    const value = useForm<WillData>({ defaultValues: defaultWillData() })
    useEffect(() => {
      form = value
    })
    return <FormProvider {...value}>{children}</FormProvider>
  }
  const host = document.createElement('div')
  await act(async () => createRoot(host).render(<Wrapper><Probe /></Wrapper>))
  return { api: () => api, form: () => form }
}

describe('live voice → interview', () => {
  it('puts single answers, beneficiaries and list entries straight into the form, as one undoable change', async () => {
    const { api, form } = await mount()
    let result!: ReturnType<ReturnType<typeof api>['applyFromLive']>
    await act(async () => {
      result = api().applyFromLive('my name is Rohan Mehta, my wife Priya is the executor and my daughter Anaya gets the Noida house', {
        fieldUpdates: [
          { path: 'personal.fullLegalName', value: 'Rohan Mehta' },
          { path: 'personal.notAField', value: 'x' },
        ],
        beneficiaries: [{ name: 'Anaya', relationship: 'child', share: '', specificBequest: 'Noida house' }],
        listEdits: [{ list: 'executors', action: 'add', values: { fullName: 'Priya Mehta', relationship: 'wife' } }],
      })
    })
    expect(result.applied).toBe(3)
    expect(result.changes[0]).toMatch(/Rohan Mehta/)
    expect(result.problems).toEqual(['"personal.notAField" is not a field you can fill.'])
    expect(result.focus).toEqual(['personal.fullLegalName', 'distribution.beneficiaries', 'executorsGuardians.executors.0'])

    expect(form().getValues('personal.fullLegalName')).toBe('Rohan Mehta')
    expect(form().getValues('executorsGuardians.executors')[0]).toMatchObject({ fullName: 'Priya Mehta', relationship: 'wife' })
    expect(form().getValues('distribution.beneficiaries').map((beneficiary) => beneficiary.name)).toContain('Anaya')
    expect(form().getValues('assets.immovableAssets').some((asset) => asset.address === 'Noida house')).toBe(true)
    // Kept as a confirmed record of what was said, not left waiting.
    expect(form().getValues('assistantIntake.interviewProposals')[0]).toMatchObject({ status: 'confirmed' })
    expect(api().liveChanges).toHaveLength(1)
  })

  it('explains what could not be done, so she can put it right', async () => {
    const { api, form } = await mount()
    let result!: ReturnType<ReturnType<typeof api>['applyFromLive']>
    await act(async () => {
      result = api().applyFromLive('x', {
        fieldUpdates: [{ path: 'revocation.hasPriorWills', value: 'no' }, { path: 'personal.dateOfBirth', value: 'someday' }],
        listEdits: [{ list: 'guardians', action: 'add', values: { fullName: 'Meera' } }],
      })
    })
    expect(result.applied).toBe(0)
    expect(result.problems.join(' ')).toMatch(/another step/)
    expect(result.problems.join(' ')).toMatch(/not valid, already set/)
    expect(result.problems.join(' ')).toMatch(/hasMinorChildren/)
    expect(api().liveChanges).toHaveLength(0)
    expect(form().getValues('assistantIntake.interviewProposals')).toHaveLength(0)
  })

  it('undoes the latest change and only that, newest first', async () => {
    const { api, form } = await mount()
    await act(async () => api().applyFromLive('a', { fieldUpdates: [{ path: 'personal.fullLegalName', value: 'Rohan Mehta' }] }))
    await act(async () => api().applyFromLive('b', { listEdits: [{ list: 'bankAccounts', action: 'add', values: { bankName: 'HDFC Bank' } }] }))
    expect(form().getValues('assets.bankAccounts')).toHaveLength(1)

    let undone: string | null = null
    await act(async () => {
      undone = api().undoLiveChange()
    })
    expect(undone).toMatch(/HDFC Bank/)
    expect(form().getValues('assets.bankAccounts')).toHaveLength(0)
    expect(form().getValues('personal.fullLegalName')).toBe('Rohan Mehta') // the earlier change is untouched
    expect(api().liveChanges.map((change) => change.undone)).toEqual([true, false])

    await act(async () => {
      undone = api().undoLiveChange()
    })
    expect(undone).toMatch(/Rohan Mehta/)
    expect(form().getValues('personal.fullLegalName')).toBe('')
    await act(async () => {
      undone = api().undoLiveChange()
    })
    expect(undone).toBeNull()
  })

  it('keeps both sides of the conversation in the log, and the person’s words as voice notes in their own language', async () => {
    const { api, form } = await mount()
    await act(async () => api().recordLiveTurn({ user: 'I want to make a will', samaira: 'Of course. What is your full name?' }))
    await act(async () => api().recordLiveTurn({ user: '', samaira: 'Take your time.' }))
    await act(async () => api().recordLiveTurn({ user: 'मेरा नाम रोहन है', samaira: 'ठीक है।' }))
    const messages = form().getValues('assistantIntake.interviewMessages')
    expect(messages.map((message) => [message.role, message.content])).toEqual([
      ['user', 'I want to make a will'],
      ['samaira', 'Of course. What is your full name?'],
      ['samaira', 'Take your time.'],
      ['user', 'मेरा नाम रोहन है'],
      ['samaira', 'ठीक है।'],
    ])
    expect(form().getValues('estateOs.voiceInterviewNotes')).toEqual(['हिन्दी (Hindi): मेरा नाम रोहन है', 'English: I want to make a will'])
  })
})
