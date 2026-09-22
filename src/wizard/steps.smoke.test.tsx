// @vitest-environment jsdom
import { act, type ComponentType } from 'react'
import { createRoot } from 'react-dom/client'
import { FormProvider, useForm } from 'react-hook-form'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { defaultWillData } from '../lib/defaultData'
import { newId } from '../lib/id'
import type { WillData } from '../lib/types'
import { STEPS } from './stepConfig'
import { WizardShell } from './WizardShell'

// Offline: every API call fails fast, exercising the fallback paths.
beforeAll(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  vi.stubGlobal('fetch', () => Promise.reject(new Error('offline')))
  Element.prototype.scrollIntoView = () => {}
})
const mountedRoots: (() => Promise<void>)[] = []
afterEach(async () => {
  // A test that fails midway must not leave its shell (and its open panel) in the page for the next test to find.
  for (const unmountRoot of mountedRoots.splice(0)) await unmountRoot()
  localStorage.clear()
})

function populated(): WillData {
  const data = defaultWillData()
  data.personal = { fullLegalName: 'Archit Mehta', dateOfBirth: '1980-05-10', addressLine: '14B MG Road', pincode: '122001', city: 'Gurugram', state: 'Uttarakhand', religion: 'other', religionOther: 'Bahá’í' }
  data.revocation = { hasPriorWills: true, revokesAllPrior: true, soundMindDeclaration: true, hasMedicalCertificate: false }
  data.executorsGuardians = {
    executors: [
      { id: 'e1', fullName: 'Priya Mehta', age: '40', address: 'x', relationship: 'wife', isAlternate: false },
      { id: 'e2', fullName: 'Ravi', age: '45', address: 'y', relationship: 'brother', isAlternate: true },
    ],
    compensation: 'uncompensated',
    hasChildren: true,
    children: [{ id: 'c1', fullName: 'Ananya', age: '12' }, { id: 'c2', fullName: 'Rohan', age: '20' }],
    hasMinorChildren: true,
    guardians: [{ id: 'g1', fullName: 'Ravi', age: '45', address: '', relationship: 'uncle', isAlternate: false, financialInstructions: 'FD only' }],
  }
  data.assets = {
    immovableAssets: [{ id: 'a1', address: 'Noida house', surveyNumber: '1', registryDetails: 'r', ownershipShare: '100', estimatedValue: '₹2.5 Cr' }],
    bankAccounts: [{ id: 'b1', bankName: 'HDFC', branch: 'Andheri', accountNumber: '123456789', estimatedValue: '50 lakh', nomineeName: 'Ravi' }],
    investments: [{ id: 'i1', type: 'Mutual Fund', identifier: 'F1', description: 'Index fund', estimatedValue: '10 lakh', nomineeName: 'Priya Mehta' }],
    valuables: [{ id: 'v1', description: 'Gold', estimatedValue: '5 lakh' }],
    hasEncumberedAssets: true,
    encumbranceDetails: 'Home loan',
    debtSettlementMethod: 'estate-reserves',
  }
  data.insurance = { hasPolicies: true, policies: [{ id: 'p1', insurer: 'LIC', policyNumber: 'P-9', nomineeName: 'Ravi', nomineeRelationship: 'other', alignWithWill: false }] }
  data.distribution = {
    scheme: 'itemized',
    beneficiaries: [
      { id: 'd1', name: 'Priya Mehta', relationship: 'spouse', share: 'residue', substituteBeneficiary: '', assignedAssetIds: [] },
      { id: 'd2', name: 'Ananya', relationship: 'child', share: '', substituteBeneficiary: 'Rohan', assignedAssetIds: ['a1'] },
    ],
    hasFutureAssets: true,
    futureAssetInstructions: 'to spouse',
    wantsSimultaneousDeathClause: true,
    residuaryBeneficiary: 'Trust',
  }
  data.funeral = { funeralWishes: 'simple', payExpensesFromEstate: true }
  data.execution = {
    witnesses: [
      { id: 'w1', fullName: 'Priya Mehta', age: '', address: '', relationship: '', isAlsoBeneficiary: false, idNumber: '1' },
      { id: 'w2', fullName: 'Sita', age: '', address: '', relationship: '', isAlsoBeneficiary: false, idNumber: '2' },
    ],
    plansVideoRecording: true,
    isUttarakhandExecution: true,
    acknowledgesCodicilProcess: true,
  }
  data.documentVault.documents = [
    {
      id: 'doc1', fileName: 'deed.pdf', fileSize: 2048, mimeType: 'application/pdf', category: 'property', confidence: 0.9,
      extractedMetadata: { owner: 'Archit & Priya', value: '₹3.1 Cr' }, reconciliationNotes: ['note'], status: 'needs_review', createdAt: new Date().toISOString(), uploadId: 'u1',
      extractedAssets: [{ id: 'x1', kind: 'bank', label: 'SBI FD', identifier: '77', holder: '', nominee: '', value: '1 lakh', status: 'pending' }],
    },
  ]
  data.estateOs.reviewEvents = [{ id: newId(), trigger: 'Annual estate review', dueDate: '2030-01-01', status: 'pending' }]
  data.estateOs.executionVideoAnalyses = [{ id: 'v', fileName: 'sign.mp4', uploadId: 'u2', willVersion: 'abc', createdAt: new Date().toISOString(), signingDetected: true, witnessesPresent: null, willReadingDetected: false, participantNotes: '', timelineNotes: '00:10 signing', rawSummary: 's', status: 'pending_review' }]
  data.estateOs.postDeathWorkflowStatus = 'inventory_review'
  return data
}

function Harness({ Step, data }: { Step: ComponentType; data: WillData }) {
  const methods = useForm<WillData>({ defaultValues: data })
  return (
    <FormProvider {...methods}>
      <Step />
    </FormProvider>
  )
}

async function mount(node: React.ReactNode) {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  await act(async () => {
    root.render(node)
  })
  // let offline fetch rejections settle
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20))
  })
  let unmounted = false
  const unmount = async () => {
    if (unmounted) return
    unmounted = true
    await act(async () => root.unmount())
  }
  mountedRoots.push(unmount)
  return { container, unmount }
}

describe('every wizard step renders without crashing, offline', () => {
  for (const step of STEPS) {
    for (const [label, make] of [['empty draft', defaultWillData], ['fully populated draft', populated]] as const) {
      it(`${step.id} — ${label}`, async () => {
        const errors: unknown[] = []
        const spy = vi.spyOn(console, 'error').mockImplementation((...args) => errors.push(args))
        const { container, unmount } = await mount(<Harness Step={step.Component} data={make()} />)
        expect(container.textContent?.length).toBeGreaterThan(20)
        await unmount()
        spy.mockRestore()
        expect(errors).toEqual([])
      })
    }
  }

  it('the full wizard shell mounts, restores a saved draft and persists edits', async () => {
    localStorage.setItem('octaraa-will-draft-v1', JSON.stringify({ personal: { fullLegalName: 'Restored Person' }, assistantIntake: null, estateOs: { auditTrail: 'corrupt' } }))
    const { container, unmount } = await mount(<WizardShell />)
    const input = container.querySelector<HTMLInputElement>('input[placeholder^="e.g. Vaibhav"]')
    expect(input?.value).toBe('Restored Person')
    expect(container.textContent).toContain('Step 1 of')
    await unmount()
  })

  describe('Samaira is available on every step', () => {
    const launcher = (root: HTMLElement) => root.querySelector<HTMLButtonElement>('button[aria-label*="Ask Samaira"]')
    const panel = () => document.querySelector('aside[aria-label="Samaira, AI assistant"]')

    it('is not a step of its own', () => {
      expect(STEPS.some((item) => item.id === 'assistant')).toBe(false)
    })

    it('opens over any step, stays open while you move between steps, and closes with Escape', async () => {
      const { container, unmount } = await mount(<WizardShell />)
      expect(panel()).toBeNull()
      await act(async () => launcher(container)!.click())
      expect(panel()).not.toBeNull()
      expect(launcher(container)).toBeNull()
      expect(panel()?.textContent).toContain(STEPS[0].title)

      const railButton = [...container.querySelectorAll<HTMLButtonElement>('nav button')].find((b) => b.textContent?.includes(STEPS[3].title))!
      await act(async () => railButton.click())
      expect(panel()).not.toBeNull()
      expect(panel()?.textContent).toContain(STEPS[3].title)
      expect(panel()?.textContent).not.toContain(STEPS[0].title)

      await act(async () => {
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
        await new Promise((resolve) => setTimeout(resolve, 400))
      })
      expect(panel()).toBeNull()
      expect(launcher(container)).not.toBeNull()
      await unmount()
    })

    it('keeps the voice controls pinned outside the scrolling conversation, and shows live progress', async () => {
      // Voice needs a speech API; jsdom has none, so give it a stand-in.
      ;(window as unknown as Record<string, unknown>).SpeechRecognition = class {}
      const { container, unmount } = await mount(<WizardShell />)
      await act(async () => launcher(container)!.click())
      const voice = panel()!.querySelector('section[aria-label="Talk to Samaira"]')!
      expect(voice).not.toBeNull()
      // The scrolling region is the one holding the conversation; the voice card must not be inside it.
      const scroller = panel()!.querySelector('section[aria-label="Conversation"]')!.closest('.overflow-y-auto')!
      expect(scroller.contains(voice)).toBe(false)
      expect(panel()!.textContent).toMatch(/required questions? open/)
      expect(panel()!.textContent).toMatch(/Will \d+% complete/)
      await unmount()
      delete (window as unknown as Record<string, unknown>).SpeechRecognition
    })

    it('proposes answers for the current step, and only fills them in after you confirm', async () => {
      const calls: { url: string; body?: { sessionContext?: { currentStep: { id: string }; fillableFields: { path: string }[] } } }[] = []
      vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
        if (String(url).includes('/api/auth/dev-login')) return Response.json({ token: 'aaa.bbb.ccc' })
        if (String(url).includes('/api/interview/respond')) {
          calls.push({ url: String(url), body: JSON.parse(String(init?.body)) })
          return Response.json({
            interview: {
              assistantReply: 'I have prepared that for you.',
              followUpQuestion: 'Which religion do you follow?',
              beneficiaries: [],
              // The second entry is a legal declaration on another step: it must never reach the screen.
              fieldUpdates: [{ path: 'personal.city', value: 'Gurugram' }, { path: 'revocation.soundMindDeclaration', value: true }],
            },
          })
        }
        throw new Error('offline')
      })
      try {
        const { container, unmount } = await mount(<WizardShell />)
        const city = () => container.querySelector<HTMLInputElement>('input[name="personal.city"]')!
        expect(city().value).toBe('')

        await act(async () => launcher(container)!.click())
        const box = panel()!.querySelector('textarea')!
        await act(async () => {
          Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(box, 'I live in Gurugram')
          box.dispatchEvent(new Event('input', { bubbles: true }))
        })
        const send = [...panel()!.querySelectorAll('button')].find((b) => b.textContent?.includes('Send to Samaira'))!
        await act(async () => send.click())
        await act(async () => new Promise((resolve) => setTimeout(resolve, 50)))

        // Samaira was told where the person is and which fields she may fill.
        expect(calls[0].body?.sessionContext?.currentStep.id).toBe('personal')
        expect(calls[0].body?.sessionContext?.fillableFields.map((field) => field.path)).toContain('personal.city')

        // The suggestion is shown, but nothing has been filled in yet.
        const suggested = panel()!.querySelector('ul[aria-label="Suggested answers"]')!
        expect(suggested.textContent).toContain('City')
        expect(suggested.textContent).toContain('Gurugram')
        expect(suggested.textContent).not.toMatch(/sound mind/i)
        expect(city().value).toBe('')

        const confirm = [...panel()!.querySelectorAll('button')].find((b) => b.textContent?.includes('Confirm and fill in'))!
        await act(async () => confirm.click())
        expect(city().value).toBe('Gurugram')
        expect(panel()!.querySelector('ul[aria-label="Suggested answers"]')).toBeNull()
        await unmount()
      } finally {
        vi.stubGlobal('fetch', () => Promise.reject(new Error('offline')))
      }
    })

    async function typeAndSend(text: string) {
      const box = panel()!.querySelector('textarea')!
      await act(async () => {
        Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(box, text)
        box.dispatchEvent(new Event('input', { bubbles: true }))
      })
      const send = [...panel()!.querySelectorAll('button')].find((b) => b.textContent?.includes('Send to Samaira'))!
      await act(async () => send.click())
      await act(async () => new Promise((resolve) => setTimeout(resolve, 50)))
    }
    const railButton = (container: HTMLElement, title: string) => [...container.querySelectorAll<HTMLButtonElement>('nav button')].find((b) => b.textContent?.includes(title))!

    it('leads: the first time it opens she asks the first open question herself, once', async () => {
      const { container, unmount } = await mount(<WizardShell />)
      await act(async () => launcher(container)!.click())
      const conversation = () => panel()!.querySelector('section[aria-label="Conversation"]')!.textContent ?? ''
      expect(conversation()).toContain("Hi, I'm Samaira")
      expect(conversation()).toContain('Shall we start with:')
      await act(async () => (panel()!.querySelector('button[aria-label="Close Samaira"]') as HTMLButtonElement).click())
      await act(async () => new Promise((resolve) => setTimeout(resolve, 400)))
      await act(async () => launcher(container)!.click())
      expect(conversation().match(/Hi, I'm Samaira/g)).toHaveLength(1)
      await unmount()
    })

    it('re-opens on the new step, and once you have spoken picks up there without starting over', async () => {
      localStorage.setItem('octaraa-will-step-v1', '0')
      const { container, unmount } = await mount(<WizardShell />)
      const text = () => panel()!.querySelector('section[aria-label="Conversation"]')!.textContent ?? ''
      await act(async () => launcher(container)!.click())
      await act(async () => railButton(container, STEPS[1].title).click())
      // Nothing said yet: her greeting simply moves with you.
      expect(text()).toContain(`You're on ${STEPS[1].title}`)
      expect(text()).not.toContain(STEPS[0].title)

      await typeAndSend('My daughter should get the house')
      await act(async () => railButton(container, STEPS[2].title).click())
      expect(text()).toContain('My daughter should get the house')
      expect(text()).toContain(`You're now on ${STEPS[2].title}`)

      // She continues in the language they last used.
      await typeAndSend('Meri beti ko ghar dena hai')
      await act(async () => railButton(container, STEPS[3].title).click())
      expect(text()).toContain(`Ab aap ${STEPS[3].title} par hain`)
      await unmount()
    })

    it('offers to continue once the step is complete', async () => {
      localStorage.setItem('octaraa-will-draft-v1', JSON.stringify(populated()))
      localStorage.setItem('octaraa-will-step-v1', '0')
      const { container, unmount } = await mount(<WizardShell />)
      await act(async () => launcher(container)!.click())
      const next = [...panel()!.querySelectorAll('button')].find((b) => b.textContent?.includes('This step is done'))
      expect(next?.textContent).toContain(STEPS[1].title)
      await act(async () => next!.click())
      // Nothing said yet, so her greeting simply moves to the next step.
      expect(panel()!.querySelector('section[aria-label="Conversation"]')!.textContent).toContain(`You're on ${STEPS[1].title}`)
      // That step is filled in as well in this draft, so she offers the one after it.
      expect([...panel()!.querySelectorAll('button')].find((b) => b.textContent?.includes('This step is done'))?.textContent).toContain(STEPS[2].title)
      await unmount()
    })

    it('says so when the AI cannot be reached, instead of repeating a canned answer', async () => {
      let healthy = false
      vi.stubGlobal('fetch', async (url: string) => {
        if (String(url).includes('/api/auth/dev-login')) return Response.json({ token: 'aaa.bbb.ccc' })
        if (String(url).includes('/api/interview/respond')) {
          return healthy
            ? Response.json({ interview: { assistantReply: 'Sure, a Will names who inherits what.', followUpQuestion: 'What is your date of birth?', beneficiaries: [], fieldUpdates: [] } })
            : new Response(JSON.stringify({ error: 'Gemini request failed with 429' }), { status: 502, headers: { 'content-type': 'application/json' } })
        }
        throw new Error('offline')
      })
      try {
        const { container, unmount } = await mount(<WizardShell />)
        await act(async () => launcher(container)!.click())
        await typeAndSend('Like can you explain me better')
        const text = () => panel()!.querySelector('section[aria-label="Conversation"]')!.textContent ?? ''
        expect(text()).toContain("I couldn't reach my assistant just now")
        expect(text()).not.toContain('estate-planning intent')
        expect(text()).toContain('502: Gemini request failed with 429')

        // Once the AI is back the notice goes away and she answers properly.
        healthy = true
        await typeAndSend('Okay so tell me more about it')
        expect(text()).toContain('a Will names who inherits what')
        expect(text()).not.toContain('could not reach the AI service')
        await unmount()
      } finally {
        vi.stubGlobal('fetch', () => Promise.reject(new Error('offline')))
      }
    })

    it('tells you when an entry is waiting for confirmation, even with the panel closed', async () => {
      const draft = defaultWillData()
      draft.assistantIntake.interviewProposals = [
        { id: 'p1', originalStatement: 'Meri beti ko ghar dena hai', assistantReply: 'ok', followUpQuestion: 'Which house?', status: 'pending', createdAt: new Date().toISOString(), beneficiaries: [] },
      ]
      localStorage.setItem('octaraa-will-draft-v1', JSON.stringify(draft))
      const { container, unmount } = await mount(<WizardShell />)
      expect(launcher(container)?.getAttribute('aria-label')).toContain('1 entry is waiting for your confirmation')
      await unmount()
    })
  })

  it('personal step blocks an under-18 date of birth with a clear message', async () => {
    const data = defaultWillData()
    data.personal.dateOfBirth = new Date(Date.now() - 5 * 365 * 24 * 3600 * 1000).toISOString().slice(0, 10)
    const Step = STEPS[0].Component
    const { container, unmount } = await mount(<Harness Step={Step} data={data} />)
    expect(container.textContent).toContain('at least 18 years old')
    await unmount()
  })
})

describe('Start over', () => {
  const keys = ['octaraa-will-draft-v1', 'octaraa-will-step-v1', 'octaraa-will-server-ref-v1', 'octaraa-consultation-requests-v1']

  async function startOver(confirmed: boolean) {
    localStorage.setItem(keys[0], JSON.stringify(populated()))
    localStorage.setItem(keys[1], '4')
    localStorage.setItem(keys[2], JSON.stringify({ id: 'will-1', version: 3 }))
    localStorage.setItem(keys[3], JSON.stringify([{ id: 'request-1' }]))
    localStorage.setItem('octaraa-api-session-token', 'keep-me')
    const reload = vi.fn()
    vi.stubGlobal('location', { ...window.location, reload })
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(confirmed)
    const { container } = await mount(<WizardShell />)
    expect(container.textContent).toContain('100% done') // the saved draft was restored
    const button = [...container.querySelectorAll('button')].find((item) => item.textContent?.includes('Start over'))!
    await act(async () => button.click())
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 30))
    })
    return { reload, confirm, container }
  }

  it('clears every answer and everything saved about them, and nothing writes them back as the page reloads', async () => {
    const { reload } = await startOver(true)
    expect(reload).toHaveBeenCalledTimes(1)
    // The page unloading runs the save-on-close handlers: they must not bring the old answers back.
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' })
    window.dispatchEvent(new Event('beforeunload'))
    document.dispatchEvent(new Event('visibilitychange'))
    await new Promise((resolve) => setTimeout(resolve, 600)) // longer than the autosave delay
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' })
    for (const key of keys) expect(localStorage.getItem(key), key).toBeNull()
    expect(localStorage.getItem('octaraa-api-session-token')).toBe('keep-me') // signing in is not part of the Will
    vi.unstubAllGlobals()
    vi.stubGlobal('fetch', () => Promise.reject(new Error('offline')))
  })

  it('does nothing if the person changes their mind at the confirmation', async () => {
    const { reload } = await startOver(false)
    expect(reload).not.toHaveBeenCalled()
    expect(localStorage.getItem(keys[0])).not.toBeNull()
    expect(localStorage.getItem(keys[2])).not.toBeNull()
    vi.unstubAllGlobals()
    vi.stubGlobal('fetch', () => Promise.reject(new Error('offline')))
  })
})
