import { describe, expect, it } from 'vitest'
import { buildAssistantContext, buildLiveContext, contextGreeting, newlyAnswered, screenSignature, screenUpdateMessage } from './assistantContext'
import { detectLanguage } from './language'
import { defaultWillData } from './defaultData'

const STEPS = [
  { id: 'personal', title: 'About you' },
  { id: 'revocation', title: 'Capacity & revocation' },
  { id: 'review', title: 'Review' },
]

describe('assistant context', () => {
  it('reports the current step, section progress and the open required questions', () => {
    const context = buildAssistantContext(defaultWillData(), STEPS, 'personal')
    expect(context.currentStep).toEqual({ id: 'personal', title: 'About you' })
    expect(context.sections.map((section) => section.id)).toEqual(['personal', 'revocation', 'review'])
    expect(context.openQuestions.length).toBeGreaterThan(0)
    expect(context.overallCompletionPercent).toBeLessThan(100)
  })

  it('updates as the person fills things in, and never carries their answers', () => {
    const data = defaultWillData()
    const before = buildAssistantContext(data, STEPS, 'personal')
    data.personal.fullLegalName = 'Secret Name'
    const after = buildAssistantContext(data, STEPS, 'personal')
    expect(after.openQuestions.length).toBe(before.openQuestions.length - 1)
    expect(JSON.stringify(after)).not.toContain('Secret Name')
  })

  it('has no open questions on read-only steps, and falls back to the first step for an unknown id', () => {
    expect(buildAssistantContext(defaultWillData(), STEPS, 'review').openQuestions).toEqual([])
    expect(buildAssistantContext(defaultWillData(), STEPS, 'nope').currentStep.id).toBe('personal')
  })

  it('opens a voice conversation from where the person is', () => {
    const context = buildAssistantContext(defaultWillData(), STEPS, 'personal')
    const greeting = contextGreeting(context)
    expect(greeting).toContain('About you')
    expect(greeting).toContain(context.openQuestions[0])
    expect(contextGreeting(buildAssistantContext(defaultWillData(), STEPS, 'review'))).toContain('Review')
  })
})

describe('the first thing Samaira says, in the language you chose', () => {
  const context = buildAssistantContext(defaultWillData(), STEPS, 'personal')

  it('opens in Hindi, Hinglish or English as chosen, with the step name', () => {
    expect(contextGreeting(context, 'hi')).toMatch(/[\u0900-\u097F]/)
    expect(contextGreeting(context, 'hi')).toContain('About you')
    expect(detectLanguage(contextGreeting(context, 'hinglish'))).toBe('hinglish')
    expect(detectLanguage(contextGreeting(context, 'en'))).toBe('en')
    for (const language of ['hi', 'hinglish', 'en'] as const) expect(contextGreeting(context, language)).toContain(context.openQuestions[0])
  })

  describe('live voice screen context', () => {
    const LIVE_STEPS = [
      { id: 'personal', title: 'About you', subtitle: 'Personal details' },
      { id: 'revocation', title: 'Capacity & revocation', subtitle: 'Prior Wills' },
      { id: 'review', title: 'Review', subtitle: 'Check everything' },
    ]

    it('adds what each step is for, so she can explain it and pick where to go next', () => {
      const context = buildLiveContext(defaultWillData(), LIVE_STEPS, 'revocation')
      expect(context.currentStep).toMatchObject({ id: 'revocation', purpose: 'Prior Wills' })
      expect(context.sections.map((section) => section.purpose)).toEqual(['Personal details', 'Prior Wills', 'Check everything'])
      expect(context.fillableFields.length).toBeGreaterThan(0)
    })

    it('plans from the data: each step gets a status, and the next step is the next one that still needs work', () => {
      const data = defaultWillData()
      const context = buildLiveContext(data, LIVE_STEPS, 'personal')
      expect(context.sections.map((section) => section.status)).toEqual(['not-started', 'not-started', 'optional'])
      expect(context.nextStepId).toBe('revocation')
      // From the last real step it goes back to what is still missing, and once nothing is missing it points at review.
      expect(buildLiveContext(data, LIVE_STEPS, 'revocation').nextStepId).toBe('personal')
      expect(buildLiveContext(data, LIVE_STEPS, 'review').nextStepId).toBe('personal')
    })

    it('says which question is highlighted, with the field behind it when it can be answered by voice', () => {
      const context = buildLiveContext(defaultWillData(), LIVE_STEPS, 'revocation')
      expect(context.focus?.label).toBe(context.openQuestions[0])
      expect(context.focus?.path).toMatch(/^revocation\./)
      expect(context.focus?.kind).toBe('yes-no')
      const done = buildLiveContext(defaultWillData(), LIVE_STEPS, 'review')
      expect(done.focus).toBeNull()
    })

    it('lists the repeating lists on the step, and notices when one gains an entry or unlocks', () => {
      const data = defaultWillData()
      const before = buildLiveContext(data, [{ id: 'executors', title: 'Executors & guardians', subtitle: '' }], 'executors')
      expect(before.lists.map((entry) => [entry.list, entry.available])).toEqual([['executors', true], ['children', false], ['guardians', false]])
      data.executorsGuardians.hasChildren = true
      const unlocked = buildLiveContext(data, [{ id: 'executors', title: 'Executors & guardians', subtitle: '' }], 'executors')
      expect(unlocked.lists.find((entry) => entry.list === 'children')?.available).toBe(true)
      expect(screenSignature(unlocked)).not.toBe(screenSignature(before))
    })

    it('changes its signature when the step, an open question or an answer changes, and only then', () => {
      const data = defaultWillData()
      const before = screenSignature(buildLiveContext(data, LIVE_STEPS, 'personal'))
      expect(screenSignature(buildLiveContext(data, LIVE_STEPS, 'personal'))).toBe(before)
      expect(screenSignature(buildLiveContext(data, LIVE_STEPS, 'revocation'))).not.toBe(before)
      data.personal.fullLegalName = 'Rohan Mehta'
      expect(screenSignature(buildLiveContext(data, LIVE_STEPS, 'personal'))).not.toBe(before)
    })

    it('tells her which question the person just answered on screen, so she does not ask it again', () => {
      const data = defaultWillData()
      const before = buildLiveContext(data, LIVE_STEPS, 'personal')
      data.personal.religion = 'hindu'
      const after = buildLiveContext(data, LIVE_STEPS, 'personal')
      const previous = { stepId: before.currentStep.id, openQuestions: before.openQuestions }
      const answered = newlyAnswered(after, previous)
      expect(answered.length).toBeGreaterThan(0)
      expect(screenUpdateMessage(after, 0, previous)).toContain('do not ask')
      expect(newlyAnswered(buildLiveContext(data, LIVE_STEPS, 'revocation'), previous)).toEqual([])
      expect(screenUpdateMessage(after, 0)).not.toContain('do not ask')
    })

    it('carries the fresh recorded values when given, so a changed answer is not left stale', () => {
      const context = buildLiveContext(defaultWillData(), LIVE_STEPS, 'personal')
      const withSnapshot = screenUpdateMessage(context, 0, undefined, { personal: { religion: 'muslim' } })
      expect(withSnapshot).toContain('name="estate_snapshot"')
      expect(withSnapshot).toContain('"religion":"muslim"')
      expect(screenUpdateMessage(context, 0)).not.toContain('estate_snapshot')
    })

    it('words a screen update as a notice from the app, with the screen fenced as data', () => {
      const message = screenUpdateMessage(buildLiveContext(defaultWillData(), LIVE_STEPS, 'personal'), 2)
      expect(message.startsWith('[Screen update]')).toBe(true)
      expect(message).toContain('2 suggestions are waiting')
      expect(message).toContain('<user_data name="session_context">')
      expect(screenUpdateMessage(buildLiveContext(defaultWillData(), LIVE_STEPS, 'personal'), 0)).not.toContain('waiting')
    })
  })
})
