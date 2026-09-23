// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { LiveCallbacks } from '../lib/liveVoice'
import { CompanyAssistant } from './CompanyAssistant'

// React's controlled-input tracker intercepts a plain `input.value = ...` assignment in some configurations, so
// the change is silently dropped; going through the native setter first (the standard workaround) is reliable.
function typeInto(input: HTMLInputElement, text: string) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!
  setter.call(input, text)
  input.dispatchEvent(new Event('input', { bubbles: true }))
}

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const ask = vi.fn()
const createLiveSession = vi.fn()
vi.mock('../lib/backendClient', () => ({
  askAboutOctaraa: (...args: unknown[]) => ask(...args),
  createCompanyLiveSessionFromApi: (...args: unknown[]) => createLiveSession(...args),
}))

let liveCallbacks: LiveCallbacks
const liveSupported = vi.fn(() => false)
const stopCall = vi.fn()
const startLive = vi.fn()
vi.mock('../lib/liveVoice', () => ({
  isLiveSupported: () => liveSupported(),
  startLiveConversation: (...args: unknown[]) => startLive(...args),
}))

async function render() {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  await act(async () => root.render(<CompanyAssistant />))
  return { host, unmount: () => act(async () => root.unmount()) }
}

beforeEach(() => {
  document.body.innerHTML = ''
  vi.clearAllMocks()
  liveSupported.mockReturnValue(false)
})

describe('CompanyAssistant (landing-page widget)', () => {
  it('is closed by default, and never sends a request before the person asks anything', async () => {
    const { host } = await render()
    expect(host.querySelector('section')).toBeNull()
    expect(ask).not.toHaveBeenCalled()
  })

  it('opens on tap, asks the typed question, and shows the grounded answer', async () => {
    ask.mockResolvedValue({ ok: true, answer: 'Starting your Will is free, and no account is needed.' })
    const { host } = await render()
    const toggle = host.querySelector('button[aria-label="Ask about Octaraa"]') as HTMLButtonElement
    await act(async () => toggle.click())
    expect(host.querySelector('section')).not.toBeNull()

    const input = host.querySelector('input') as HTMLInputElement
    const form = host.querySelector('form') as HTMLFormElement
    await act(async () => {
      typeInto(input, 'Is starting free?')
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    })

    expect(ask).toHaveBeenCalledWith('Is starting free?')
    expect(host.textContent).toContain('Starting your Will is free')
    // The question box is cleared for the next question, and never grows a stray trailing question mark from the suggestion chips.
    expect(input.value).toBe('')
  })

  it('a suggestion chip asks the same way typing would', async () => {
    ask.mockResolvedValue({ ok: true, answer: 'A lawyer reviews every draft before you sign.' })
    const { host } = await render()
    await act(async () => (host.querySelector('button[aria-label="Ask about Octaraa"]') as HTMLButtonElement).click())
    const chip = [...host.querySelectorAll('button')].find((button) => button.textContent === 'Do I need a lawyer?')!
    await act(async () => chip.click())
    expect(ask).toHaveBeenCalledWith('Do I need a lawyer?')
    expect(host.textContent).toContain('A lawyer reviews every draft')
  })

  it('shows an error rather than a blank reply when the request fails', async () => {
    ask.mockResolvedValue({ ok: false, error: 'Network error' })
    const { host } = await render()
    await act(async () => (host.querySelector('button[aria-label="Ask about Octaraa"]') as HTMLButtonElement).click())
    const input = host.querySelector('input') as HTMLInputElement
    const form = host.querySelector('form') as HTMLFormElement
    await act(async () => {
      typeInto(input, 'How does this work?')
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    })
    expect(host.textContent).toContain('Network error')
  })

  it('hides the mic button when the browser cannot do live voice, so nobody taps a dead control', async () => {
    const { host } = await render()
    await act(async () => (host.querySelector('button[aria-label="Ask about Octaraa"]') as HTMLButtonElement).click())
    expect(host.querySelector('button[aria-label="Talk instead of typing"]')).toBeNull()
  })

  describe('voice mode', () => {
    beforeEach(() => {
      liveSupported.mockReturnValue(true)
      createLiveSession.mockResolvedValue({ ok: true, session: { token: 'auth_tokens/x', setup: {}, expiresAt: '2099-01-01T00:00:00Z' } })
      startLive.mockImplementation(async (_session: unknown, callbacks: LiveCallbacks) => {
        liveCallbacks = callbacks
        return { stop: stopCall, sendText: vi.fn(), interrupt: vi.fn(), setMuted: vi.fn() }
      })
    })

    async function startVoiceCall(host: HTMLElement) {
      await act(async () => (host.querySelector('button[aria-label="Ask about Octaraa"]') as HTMLButtonElement).click())
      await act(async () => (host.querySelector('button[aria-label="Talk instead of typing"]') as HTMLButtonElement).click())
    }

    it('mints a session, starts a live call, and swaps the typing form for the call bar', async () => {
      const { host } = await render()
      await startVoiceCall(host)
      expect(createLiveSession).toHaveBeenCalled()
      expect(startLive).toHaveBeenCalled()
      expect(host.querySelector('input')).toBeNull() // typing is replaced while on a call
      expect(host.querySelector('[data-testid="voice-call"]')).not.toBeNull()
      await act(async () => liveCallbacks.onState('listening'))
      expect(host.textContent).toContain('Listening')
    })

    it('shows the live caption as she speaks, then files the finished turn in the same transcript as typed questions', async () => {
      const { host } = await render()
      await startVoiceCall(host)
      await act(async () => liveCallbacks.onCaption?.({ user: 'How does this work', samaira: '' }))
      expect(host.textContent).toContain('How does this work')
      await act(async () => liveCallbacks.onTurn({ user: 'How does this work?', samaira: 'You talk or type, and a lawyer reviews it.' }))
      expect(host.textContent).toContain('How does this work?')
      expect(host.textContent).toContain('You talk or type, and a lawyer reviews it.')
    })

    // Regression: the growing caption used to sit in a `truncate` (single-line, ellipsized) element, so a longer
    // answer was cut off mid-sentence while she was still speaking it.
    it('never truncates the caption while she is mid-answer, however long it runs', async () => {
      const { host } = await render()
      await startVoiceCall(host)
      const long = 'Octaraa works in four steps. Talk or type your answers, watch them fill in live, a lawyer reviews the draft against Indian succession law, and then you sign and register it if your state requires that.'
      await act(async () => liveCallbacks.onCaption?.({ user: '', samaira: long }))
      const bubble = [...host.querySelectorAll('p')].find((p) => p.textContent === long)
      expect(bubble).toBeTruthy()
      expect(bubble?.className).not.toContain('truncate')
    })

    // Regression: an empty transcript (her own opening line, before the person has said anything) used to render
    // as a fake "(spoken)" question bubble instead of just her line on its own.
    it('never shows a fake "(spoken)" question when nothing was actually transcribed from the person', async () => {
      const { host } = await render()
      await startVoiceCall(host)
      await act(async () => liveCallbacks.onTurn({ user: '', samaira: "Hi, I'm Samaira. What would you like to know about Octaraa?" }))
      expect(host.textContent).not.toContain('(spoken)')
      expect(host.textContent).toContain("Hi, I'm Samaira.")
    })

    // Regression: the UI said "Listening…" for the whole gap between the person finishing and her reply starting,
    // reading as "it didn't hear me" rather than "it's working on a reply".
    it('shows "Thinking…" once something was heard from the person but before she has replied', async () => {
      const { host } = await render()
      await startVoiceCall(host)
      await act(async () => liveCallbacks.onState('listening'))
      expect(host.textContent).toContain('Listening')
      await act(async () => liveCallbacks.onCaption?.({ user: 'How does this work', samaira: '' }))
      expect(host.textContent).toContain('Thinking')
      expect(host.textContent).not.toContain('Listening…')
    })

    it('ending the call restores the typing form', async () => {
      const { host } = await render()
      await startVoiceCall(host)
      const end = [...host.querySelectorAll('button')].find((button) => button.textContent?.includes('End'))!
      await act(async () => end.click())
      expect(stopCall).toHaveBeenCalled()
      await act(async () => liveCallbacks.onState('ended'))
      expect(host.querySelector('input')).not.toBeNull()
      expect(host.querySelector('[data-testid="voice-call"]')).toBeNull()
    })

    it('shows a fallback notice and leaves typing available when the session cannot be minted', async () => {
      createLiveSession.mockResolvedValue({ ok: false, error: 'GEMINI_API_KEY is not configured' })
      const { host } = await render()
      await startVoiceCall(host)
      expect(host.textContent).toContain('not available right now')
      expect(host.querySelector('input')).not.toBeNull() // never stuck without a way to ask
    })

    it('refuses an unknown tool call -- there is no form-writing tool in this mode, only the legal lookup', async () => {
      const { host } = await render()
      await startVoiceCall(host)
      expect(await liveCallbacks.onToolCall('anything', {}, '')).toMatchObject({ ok: false })
    })

    // Answered locally from the same bundled shared/legal-knowledge.json the text widget's offline fallback uses --
    // no network call, which is the whole point of moving this out of the always-loaded system prompt (see
    // server/live.mjs LEGAL_LOOKUP_TOOL): the common case (no legal question) gets a smaller, faster prompt, and the
    // rare legal one still gets a real, grounded answer without a server round trip on top of the tool-call one.
    it('answers the legal-lookup tool call from the bundled knowledge base, with no network request', async () => {
      const { host } = await render()
      await startVoiceCall(host)
      const result = await liveCallbacks.onToolCall('search_legal_information', { query: 'Do I need witnesses?' }, '')
      expect(result).toMatchObject({ ok: true })
      expect(JSON.stringify(result)).toMatch(/witness/i)
    })

    it('tells her plainly when a legal question is not covered, rather than leaving her to guess', async () => {
      const { host } = await render()
      await startVoiceCall(host)
      const result = await liveCallbacks.onToolCall('search_legal_information', { query: 'what is the capital of Peru' }, '')
      expect(result).toMatchObject({ ok: false })
    })

    describe('end_call', () => {
      // Regression: nothing ever ended the call on its own. She'd say a clear goodbye and it would just sit there
      // on "Listening…" forever, with only the manual End button to fall back on.
      it('does NOT hang up the instant end_call arrives while her goodbye is still playing', async () => {
        const { host } = await render()
        await startVoiceCall(host)
        await act(async () => liveCallbacks.onState('speaking'))
        await act(async () => {
          liveCallbacks.onToolCall('end_call', {}, '')
        })
        expect(stopCall).not.toHaveBeenCalled()
        expect(host.querySelector('[data-testid="voice-call"]')).not.toBeNull() // still on the call
      })

      it('hangs up once her goodbye finishes playing (phase settles out of speaking)', async () => {
        const { host } = await render()
        await startVoiceCall(host)
        await act(async () => liveCallbacks.onState('speaking'))
        await act(async () => {
          liveCallbacks.onToolCall('end_call', {}, '')
        })
        await act(async () => liveCallbacks.onState('listening')) // the buffered audio has now actually finished
        expect(stopCall).toHaveBeenCalled()
      })

      it('hangs up immediately if she calls end_call when she is not mid-sentence', async () => {
        const { host } = await render()
        await startVoiceCall(host)
        await act(async () => liveCallbacks.onState('listening'))
        await act(async () => {
          liveCallbacks.onToolCall('end_call', {}, '')
        })
        expect(stopCall).toHaveBeenCalled()
      })

      it('hangs up on a fallback timer even if playback never reports finishing, so the call is never stuck open', async () => {
        vi.useFakeTimers()
        try {
          const { host } = await render()
          await startVoiceCall(host)
          await act(async () => liveCallbacks.onState('speaking'))
          await act(async () => {
            liveCallbacks.onToolCall('end_call', {}, '')
          })
          expect(stopCall).not.toHaveBeenCalled()
          await act(async () => vi.advanceTimersByTime(6_000))
          expect(stopCall).toHaveBeenCalled()
        } finally {
          vi.useRealTimers()
        }
      })
    })
  })
})
