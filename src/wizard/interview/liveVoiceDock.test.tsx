// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { buildLiveContext } from '../../lib/assistantContext'
import { defaultWillData } from '../../lib/defaultData'
import type { LiveCallbacks } from '../../lib/liveVoice'
import { STEPS } from '../stepConfig'
import { LiveVoiceDock } from './LiveVoiceDock'
import type { LiveApplyResult } from './useInterview'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let callbacks: LiveCallbacks
const sendText = vi.fn()
const stop = vi.fn()
const setMuted = vi.fn()
const interrupt = vi.fn()
const startLive = vi.fn()
const createSession = vi.fn()
const flash = vi.fn()
const focus = vi.fn()

vi.mock('../../lib/liveVoice', () => ({
  startLiveConversation: (...args: unknown[]) => startLive(...args),
}))
vi.mock('../../lib/backendClient', () => ({
  createLiveSessionFromApi: (...args: unknown[]) => createSession(...args),
}))
vi.mock('../../lib/liveHighlight', () => ({
  flashPaths: (...args: unknown[]) => flash(...args),
  focusQuestion: (...args: unknown[]) => focus(...args),
  clearFocus: () => {},
}))

const data = defaultWillData()
const getContextFor = (id: string) => buildLiveContext(data, STEPS, id)
const applied = (overrides: Partial<LiveApplyResult> = {}): LiveApplyResult => ({ applied: 1, changes: ['Executor "Priya"'], problems: [], focus: ['executorsGuardians.executors.0'], ...overrides })

async function render(overrides: Partial<Parameters<typeof LiveVoiceDock>[0]> = {}) {
  const props = {
    getData: () => data,
    getContextFor,
    currentStepId: 'personal',
    pendingCount: 0,
    liveChanges: [] as Parameters<typeof LiveVoiceDock>[0]['liveChanges'],
    onNavigate: vi.fn(),
    onTurn: vi.fn(),
    onApply: vi.fn(() => applied()),
    onUndo: vi.fn((): string | null => 'Executor "Priya"'),
    onClose: vi.fn(),
    ...overrides,
  }
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  await act(async () => root.render(<LiveVoiceDock {...props} />))
  const rerender = (next: Partial<typeof props>) => act(async () => root.render(<LiveVoiceDock {...props} {...next} />))
  return { host, props, rerender, unmount: () => act(async () => root.unmount()) }
}

async function start(host: HTMLElement) {
  const button = [...host.querySelectorAll('button')].find((item) => item.textContent?.includes('Start live'))!
  await act(async () => button.click())
}

beforeEach(() => {
  document.body.innerHTML = ''
  vi.clearAllMocks()
  createSession.mockResolvedValue({ ok: true, session: { token: 'auth_tokens/x', setup: { model: 'models/gemini-3.8-live' }, expiresAt: '2099-01-01T00:00:00Z' } })
  startLive.mockImplementation(async (_session: unknown, cb: LiveCallbacks) => {
    callbacks = cb
    return { stop, sendText, interrupt, setMuted }
  })
})

describe('Live voice dock', () => {
  it('opens a session from the current screen, greets first, and shows what is said', async () => {
    const { host, props } = await render()
    await start(host)
    expect(createSession).toHaveBeenCalledWith(data, expect.objectContaining({ currentStep: expect.objectContaining({ id: 'personal' }) }), 'auto')
    expect(startLive.mock.calls[0][2].greeting).toMatch(/^\[Screen update\]/)

    await act(async () => {
      callbacks.onState('listening')
      callbacks.onTurn({ user: 'My name is Rohan', samaira: 'Nice to meet you, Rohan.' })
    })
    expect(host.textContent).toContain('Nice to meet you, Rohan.')
    expect(host.textContent).toContain('My name is Rohan')
    expect(props.onTurn).toHaveBeenCalledWith({ user: 'My name is Rohan', samaira: 'Nice to meet you, Rohan.' })
  })

  it('speaks any language: auto by default, or the one that was pinned before starting', async () => {
    const { host } = await render()
    const select = host.querySelector('select[aria-label="Conversation language"]') as HTMLSelectElement
    expect([...select.options].map((option) => option.value)).toEqual(expect.arrayContaining(['auto', 'en', 'hi', 'hinglish', 'ta', 'mr']))
    await act(async () => {
      select.value = 'hi'
      select.dispatchEvent(new Event('change', { bubbles: true }))
    })
    await start(host)
    expect(createSession).toHaveBeenCalledWith(data, expect.anything(), 'hi')
    expect(startLive.mock.calls[0][2].greeting).toContain('हिन्दी')
    expect(host.querySelector('select[aria-label="Conversation language"]')).toBeNull() // fixed for the call, so the space goes to the conversation
  })

  it('moves the screen when she asks, returns the new screen to her, and refuses an unknown step', async () => {
    const { host, props } = await render()
    await start(host)

    const moved = await callbacks.onToolCall('go_to_step', { stepId: 'revocation' }, '')
    expect(props.onNavigate).toHaveBeenCalledWith('revocation')
    expect(moved).toMatchObject({ ok: true, screen: { currentStep: { id: 'revocation' } } })

    vi.mocked(props.onNavigate).mockClear()
    expect(await callbacks.onToolCall('go_to_step', { stepId: 'nowhere' }, '')).toMatchObject({ ok: false })
    expect(props.onNavigate).not.toHaveBeenCalled()
  })

  it('puts answers straight into the form, lights them up, and tells her what is still open', async () => {
    const { host, props } = await render()
    await start(host)
    const args = { fieldUpdates: [{ path: 'personal.fullLegalName', value: 'Rohan Mehta' }] }
    const reply = await callbacks.onToolCall('record_estate_details', args, 'my name is Rohan Mehta')
    expect(props.onApply).toHaveBeenCalledWith('my name is Rohan Mehta', { beneficiaries: undefined, fieldUpdates: args.fieldUpdates })
    expect(flash).toHaveBeenCalledWith(['executorsGuardians.executors.0'])
    expect(reply).toMatchObject({ ok: true, applied: 1, changes: ['Executor "Priya"'] })
    expect((reply as { stillOpen: string[] }).stillOpen.length).toBeGreaterThan(0)
    expect(reply).toHaveProperty('nextStepId')

    vi.mocked(props.onApply).mockReturnValue(applied({ applied: 0, changes: [], problems: ['"Age" is on another step'], focus: [] }))
    expect(await callbacks.onToolCall('record_estate_details', args, '')).toMatchObject({ ok: false, problems: ['"Age" is on another step'] })
    // The refusal is spelled out, so she tells the person instead of talking past it (measured against the live model).
    expect(await callbacks.onToolCall('record_estate_details', args, '')).toMatchObject({ notSaved: expect.stringContaining('NOT saved') })
    vi.mocked(props.onApply).mockReturnValue(applied())
    expect(await callbacks.onToolCall('record_estate_details', args, '')).not.toHaveProperty('notSaved')
    expect(await callbacks.onToolCall('something_else', {}, '')).toMatchObject({ ok: false })
  })

  it('edits lists by voice through the same path, and undoes on request', async () => {
    const { host, props } = await render()
    await start(host)
    const reply = await callbacks.onToolCall('edit_list', { list: 'executors', action: 'add', values: { fullName: 'Priya' } }, '')
    expect(props.onApply).toHaveBeenCalledWith('', { listEdits: [{ list: 'executors', action: 'add', match: undefined, values: { fullName: 'Priya' } }] })
    expect(reply).toMatchObject({ ok: true })

    expect(await callbacks.onToolCall('undo_last_change', {}, '')).toEqual({ ok: true, undone: 'Executor "Priya"' })
    vi.mocked(props.onUndo).mockReturnValue(null)
    expect(await callbacks.onToolCall('undo_last_change', {}, '')).toMatchObject({ ok: false })
  })

  it('shows what is being asked with tappable answers built from the field data, and applies a tap like a spoken answer', async () => {
    const { host, props } = await render({ currentStepId: 'revocation' })
    await start(host)
    await act(async () => callbacks.onState('listening'))
    const card = host.querySelector('[data-testid="now-asking"]')!
    expect(card.textContent).toContain('Now asking')
    const yes = [...card.querySelectorAll('button')].find((button) => button.textContent === 'Yes')
    expect(yes).toBeTruthy()
    await act(async () => yes!.click())
    expect(props.onApply).toHaveBeenCalledWith('tapped an answer', { fieldUpdates: [{ path: expect.stringMatching(/^revocation\./), value: 'true' }] })
  })

  it('shows progress per step from the data, and jumps when one is tapped', async () => {
    const { host, props } = await render()
    await start(host)
    const chips = [...host.querySelectorAll('ol[aria-label="Progress"] button')]
    expect(chips.length).toBe(STEPS.length)
    expect(chips[0].getAttribute('aria-current')).toBe('step')
    await act(async () => (chips[3] as HTMLButtonElement).click())
    expect(props.onNavigate).toHaveBeenCalledWith(STEPS[3].id)
  })

  it('lists what she filled in, with Undo only on the latest change', async () => {
    const changes = [
      { id: 'b', summary: 'Added bank account "HDFC"', at: '', undone: false },
      { id: 'a', summary: 'Full name: Rohan Mehta', at: '', undone: false },
    ]
    const { host, props } = await render({ liveChanges: changes })
    await start(host)
    const items = host.querySelectorAll('ul[aria-label="What Samaira filled in"] li')
    expect(items).toHaveLength(2)
    expect(items[0].textContent).toContain('Undo')
    expect(items[1].textContent).not.toContain('Undo')
    await act(async () => (items[0].querySelector('button') as HTMLButtonElement).click())
    expect(props.onUndo).toHaveBeenCalled()
  })

  it('tells her when the screen changes without her, once she is listening', async () => {
    vi.useFakeTimers()
    try {
      const { host, rerender } = await render()
      await start(host)
      await act(async () => callbacks.onState('listening'))
      await act(async () => vi.advanceTimersByTime(2000))
      expect(sendText).not.toHaveBeenCalled() // nothing changed yet

      await rerender({ currentStepId: 'revocation', pendingCount: 1 }) // the person moved to another step themselves
      await act(async () => vi.advanceTimersByTime(2000))
      expect(sendText).toHaveBeenCalledTimes(1)
      const message = sendText.mock.calls[0][0] as string
      expect(message).toMatch(/^\[Screen update\]/)
      expect(message).toContain('1 suggestion is waiting')
      expect(message).toContain('"id":"revocation"')

      await act(async () => vi.advanceTimersByTime(5000))
      expect(sendText).toHaveBeenCalledTimes(1) // said once, not repeated
    } finally {
      vi.useRealTimers()
    }
  })

  it('tells her when the person answers or changes a field on screen, and which one', async () => {
    vi.useFakeTimers()
    try {
      const { host, rerender } = await render()
      await start(host)
      await act(async () => callbacks.onState('listening'))
      await act(async () => vi.advanceTimersByTime(2000))
      expect(sendText).not.toHaveBeenCalled()

      data.personal.religion = 'hindu' // picked from the dropdown, not spoken
      await rerender({})
      await act(async () => vi.advanceTimersByTime(2000))
      expect(sendText).toHaveBeenCalledTimes(1)
      const answered = sendText.mock.calls[0][0] as string
      expect(answered).toContain('themselves on screen')
      expect(answered).toContain('"religion":"hindu"')

      data.personal.religion = 'muslim' // changed later: still answered, but she must hear the new value
      await rerender({})
      await act(async () => vi.advanceTimersByTime(2000))
      expect(sendText).toHaveBeenCalledTimes(2)
      expect(sendText.mock.calls[1][0] as string).toContain('"religion":"muslim"')
    } finally {
      data.personal.religion = ''
      vi.useRealTimers()
    }
  })

  it('cuts her off when what she is saying is stale, but waits when the change does not affect her question', async () => {
    vi.useFakeTimers()
    try {
      const { host, rerender } = await render()
      await start(host)
      await act(async () => callbacks.onState('speaking'))
      await act(async () => vi.advanceTimersByTime(2000))

      data.personal.religion = 'hindu' // the question she is asking right now, answered on screen
      await rerender({})
      await act(async () => vi.advanceTimersByTime(1000))
      expect(interrupt).toHaveBeenCalledTimes(1)
      expect(sendText).not.toHaveBeenCalled()
      expect(interrupt.mock.calls[0][0] as string).toContain('themselves on screen')

      // Editing a value that was already answered never interrupts her; she hears it once she stops.
      data.personal.religion = 'muslim'
      await rerender({})
      await act(async () => vi.advanceTimersByTime(3000))
      expect(interrupt).toHaveBeenCalledTimes(1)
      expect(sendText).not.toHaveBeenCalled()
      await act(async () => callbacks.onState('listening'))
      await act(async () => vi.advanceTimersByTime(2000))
      expect(sendText).toHaveBeenCalledTimes(1)
      expect(sendText.mock.calls[0][0] as string).toContain('"religion":"muslim"')
    } finally {
      data.personal.religion = ''
      vi.useRealTimers()
    }
  })

  it('remembers the language they pinned', async () => {
    window.localStorage.setItem('octaraa-live-language', 'hi')
    const { host } = await render()
    expect((host.querySelector('select[aria-label="Conversation language"]') as HTMLSelectElement).value).toBe('hi')
    window.localStorage.removeItem('octaraa-live-language')
  })

  it('does not echo back a move she made herself', async () => {
    vi.useFakeTimers()
    try {
      const { host, rerender } = await render()
      await start(host)
      await act(async () => callbacks.onState('listening'))
      await callbacks.onToolCall('go_to_step', { stepId: 'revocation' }, '')
      await rerender({ currentStepId: 'revocation' }) // the app catches up with the step she chose
      await act(async () => vi.advanceTimersByTime(5000))
      expect(sendText).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })

  it('shows a plain notice and stays off when the server cannot open a session, and when the microphone is refused', async () => {
    createSession.mockResolvedValueOnce({ ok: false, error: 'Gemini Live session could not be created (403)' })
    const first = await render()
    await start(first.host)
    expect(first.host.textContent).toContain('Live voice is not available right now')
    expect(startLive).not.toHaveBeenCalled()

    document.body.innerHTML = ''
    startLive.mockRejectedValueOnce(new DOMException('denied', 'NotAllowedError'))
    const second = await render()
    await start(second.host)
    expect(second.host.textContent).toContain('Microphone access was denied')
    expect([...second.host.querySelectorAll('button')].some((item) => item.textContent?.includes('Start live'))).toBe(true)
  })

  it('ends the conversation and releases the microphone when the panel closes', async () => {
    const { host, unmount } = await render()
    await start(host)
    await unmount()
    expect(stop).toHaveBeenCalled()
  })

  it('starts the call by itself when opened with "Talk", once', async () => {
    const { host } = await render({ autoStart: true })
    await act(async () => {})
    expect(createSession).toHaveBeenCalledTimes(1)
    expect(startLive).toHaveBeenCalledTimes(1)
    expect([...host.querySelectorAll('button')].some((item) => item.textContent?.includes('Start live'))).toBe(false)
  })

  it('shows live subtitles of whoever is talking, and who is speaking', async () => {
    const { host } = await render({ autoStart: true })
    await act(async () => {})
    await act(async () => callbacks.onState('listening'))
    expect(host.textContent).toContain('Listening')
    expect(host.querySelector('[data-testid="caption"]')!.textContent).toContain('Just start talking')

    await act(async () => callbacks.onCaption?.({ user: 'my name is Rohan', samaira: '' }))
    expect(host.querySelector('[data-testid="caption"]')!.textContent).toContain('my name is Rohan')

    await act(async () => {
      callbacks.onState('speaking')
      callbacks.onCaption?.({ user: '', samaira: 'Nice to meet you, Rohan.' })
    })
    expect(host.textContent).toContain('Samaira is speaking')
    expect(host.querySelector('[data-testid="caption"]')!.textContent).toContain('Nice to meet you, Rohan.')
  })

  it('mutes and unmutes the microphone without ending the call', async () => {
    const { host } = await render({ autoStart: true })
    await act(async () => {})
    await act(async () => callbacks.onState('listening'))
    const mute = host.querySelector('button[aria-label="Mute microphone"]') as HTMLButtonElement
    await act(async () => mute.click())
    expect(setMuted).toHaveBeenLastCalledWith(true)
    expect(host.textContent).toContain('Muted')
    await act(async () => (host.querySelector('button[aria-label="Unmute microphone"]') as HTMLButtonElement).click())
    expect(setMuted).toHaveBeenLastCalledWith(false)
    expect(stop).not.toHaveBeenCalled()
  })

  it('closes itself when the call ends normally, but stays to explain when it fails', async () => {
    const ended = await render({ autoStart: true })
    await act(async () => {})
    await act(async () => callbacks.onState('ended'))
    expect(ended.props.onClose).toHaveBeenCalledTimes(1)

    document.body.innerHTML = ''
    const failed = await render({ autoStart: true })
    await act(async () => {})
    await act(async () => {
      callbacks.onError('The live connection failed. Please try again.')
      callbacks.onState('ended')
    })
    expect(failed.props.onClose).not.toHaveBeenCalled()
    expect(failed.host.textContent).toContain('The live connection failed')
    expect([...failed.host.querySelectorAll('button')].some((item) => item.textContent?.includes('Start live'))).toBe(true)
  })

  it('End hangs up, and closing before the call starts just closes', async () => {
    const started = await render({ autoStart: true })
    await act(async () => {})
    await act(async () => (started.host.querySelector('button[aria-label="End the conversation"]') as HTMLButtonElement).click())
    expect(stop).toHaveBeenCalled()

    document.body.innerHTML = ''
    createSession.mockResolvedValueOnce({ ok: false, error: 'nope' })
    const idle = await render({ autoStart: true })
    await act(async () => {})
    await act(async () => (idle.host.querySelector('button[aria-label="Close"]') as HTMLButtonElement).click())
    expect(idle.props.onClose).toHaveBeenCalled()
  })

  it('keeps clear of the chat panel when it is open', async () => {
    const { host } = await render({ panelOpen: true })
    expect(host.firstElementChild!.className).toContain('sm:pr-[456px]')
  })
})
