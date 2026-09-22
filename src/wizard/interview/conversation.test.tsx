// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { encodeWav, FIRST_CHUNK_CHARS, MAX_CHUNK_CHARS, pickBestVoice, speechChunks, splitSentences } from '../../lib/voice'
import { detectLanguage } from '../../lib/language'
import { ConversationMode } from './ConversationMode'

const spoken: string[] = []
let utterances: string[] = []
let langs: string[] = []
let recognitionScript: string[] = []

class FakeRecognition {
  lang = ''
  continuous = false
  interimResults = false
  onresult: ((e: { resultIndex: number; results: unknown[] }) => void) | null = null
  onerror: ((e: { error: string }) => void) | null = null
  onend: (() => void) | null = null
  start() {
    const next = recognitionScript.shift() ?? ''
    setTimeout(() => {
      if (next) this.onresult?.({ resultIndex: 0, results: [Object.assign([{ transcript: next }], { isFinal: true })] })
      this.onend?.()
    }, 5)
  }
  stop() {}
  abort() {}
}

beforeEach(() => {
  spoken.length = 0
  utterances = []
  langs = []
  // No backend in these tests: speech falls back to the (fake) browser APIs.
  vi.stubGlobal('fetch', () => Promise.reject(new Error('offline')))
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  ;(window as unknown as Record<string, unknown>).SpeechRecognition = FakeRecognition
  ;(window as unknown as Record<string, unknown>).SpeechSynthesisUtterance = class {
    text: string
    lang = ''
    voice = null
    rate = 1
    onend: (() => void) | null = null
    onerror: (() => void) | null = null
    constructor(text: string) {
      this.text = text
    }
  }
  ;(window as unknown as Record<string, unknown>).speechSynthesis = {
    cancel() {},
    getVoices: () => [],
    speak(u: { text: string; lang: string; onend: (() => void) | null }) {
      utterances.push(u.text)
      langs.push(u.lang)
      setTimeout(() => u.onend?.(), 2)
    },
  }
  ;(globalThis as Record<string, unknown>).SpeechSynthesisUtterance = (window as unknown as Record<string, unknown>).SpeechSynthesisUtterance
})

async function until(check: () => boolean, ms = 2000) {
  const start = Date.now()
  while (!check() && Date.now() - start < ms) await act(async () => new Promise((r) => setTimeout(r, 10)))
}

async function mountAndStart(send: ReturnType<typeof vi.fn>, language: 'auto' | 'en' | 'hi' | 'hinglish' = 'en') {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  await act(async () => root.render(<ConversationMode send={send} isThinking={false} lastSamairaMessage="Who should inherit your assets?" language={language} onLanguageChange={() => {}} />))
  const start = [...container.querySelectorAll('button')].find((b) => b.textContent?.includes('Start talking'))!
  await act(async () => start.click())
  return { container, root }
}

describe('conversation mode', () => {
  it('speaks, listens, sends what was said, speaks the reply, and ends on a spoken "stop"', async () => {
    recognitionScript = ['my daughter should get the Noida house', 'stop']
    const send = vi.fn().mockResolvedValue({ reply: 'Noted the Noida house for your daughter.', proposalCount: 1, language: 'en' })
    const { container, root } = await mountAndStart(send)

    await until(() => utterances.some((text) => /talk soon/i.test(text)))

    expect(utterances[0]).toBe('Who should inherit your assets?')
    expect(send).toHaveBeenCalledTimes(1)
    expect(send).toHaveBeenCalledWith('my daughter should get the Noida house', { language: 'en', source: 'voice' })
    expect(utterances[1]).toBe('Noted the Noida house for your daughter.')
    expect(utterances.at(-1)).toMatch(/talk soon/i)
    // "stop" is a command, never sent as a statement
    expect(send).not.toHaveBeenCalledWith('stop', expect.anything())
    await until(() => Boolean([...container.querySelectorAll('button')].find((b) => b.textContent?.includes('Start talking'))))
    expect(container.textContent).toContain('Start talking')
    await act(async () => root.unmount())
  })

  it('pauses politely after two silent turns instead of looping forever', async () => {
    recognitionScript = ['', '']
    const send = vi.fn()
    const { container, root } = await mountAndStart(send)
    await until(() => utterances.some((text) => /pause here/i.test(text)))
    expect(send).not.toHaveBeenCalled()
    await until(() => Boolean([...container.querySelectorAll('button')].find((b) => b.textContent?.includes('Resume'))))
    expect(container.textContent).toContain('Resume')
    await act(async () => root.unmount())
  })
})

describe('automatic language', () => {
  it('lets the hook decide (language "auto" is passed through) and speaks each reply in the detected language', async () => {
    recognitionScript = ['meri beti ko ghar dena hai', 'मेरी बेटी को मकान दे दो', 'bas']
    const send = vi
      .fn()
      .mockResolvedValueOnce({ reply: 'Samajh gayi. Ghar beti ke liye note kar liya.', proposalCount: 1, language: 'hinglish' })
      .mockResolvedValueOnce({ reply: 'समझ गई। मकान बेटी के लिए दर्ज किया।', proposalCount: 1, language: 'hi' })
    const { root } = await mountAndStart(send, 'auto')
    await until(() => utterances.some((text) => /Theek hai/.test(text)))

    expect(send.mock.calls.map((call) => call[1].language)).toEqual(['auto', 'auto'])
    const langOf = (fragment: string) => langs[utterances.findIndex((text) => text.includes(fragment))]
    expect(langOf('Samajh gayi')).toBe('en-IN') // Hinglish is Roman script → Indian-English voice
    expect(langOf('समझ गई')).toBe('hi-IN')
    // the goodbye is spoken in the language the user said "bas" in (Hinglish)
    expect(utterances.at(-1)).toMatch(/Theek hai, phir baat/)
    await act(async () => root.unmount())
  })
})

describe('detectLanguage', () => {
  it.each([
    ['I want my daughter to get the Noida house', 'en'],
    ['Mostly my wife, the rest to charity', 'en'],
    ['hello there, how are you', 'en'],
    ['ok', 'en'],
    ['', 'en'],
    ['meri beti ko Noida wala ghar dena hai', 'hinglish'],
    ['Mera naam Archit hai', 'hinglish'],
    ['mujhe apni wife ko sab kuch dena hai', 'hinglish'],
    ['मेरी बेटी को नोएडा का मकान दे दो', 'hi'],
    ['मेरी पत्नी को सब कुछ मिलेगा', 'hi'],
    ['मेरी बेटी को नोएडा का मकान दे देश है.', 'hi'],
    // how Deepgram writes spoken Hinglish: Devanagari with English words left in Latin, or as Devanagari loanwords
    ['मेरी बेटी को नोएडा वाला घर देना है और बाकी सब मेरी wife को.', 'hinglish'],
    ['नोएडा की प्रॉपर्टी बेटी को दे दो', 'hinglish'],
    ['मेरी beti ko house dena hai, and the flat to my son', 'hinglish'],
  ])('%s → %s', (text, expected) => {
    expect(detectLanguage(text)).toBe(expected)
  })
})

describe('voice helpers', () => {
  it('prefers natural/neural/Google/enhanced voices and an exact locale, and avoids robotic ones', () => {
    const voices = [
      { name: 'Fred', lang: 'en-US' },
      { name: 'Samantha', lang: 'en-US' },
      { name: 'Microsoft Neerja Online (Natural) - English (India)', lang: 'en-IN' },
      { name: 'Google UK English Female', lang: 'en-GB' },
      { name: 'Lekha', lang: 'hi-IN' },
      { name: 'Google हिन्दी', lang: 'hi-IN' },
    ]
    expect(pickBestVoice(voices, 'en-IN')?.name).toContain('Neerja')
    expect(pickBestVoice(voices, 'hi-IN')?.name).toBe('Google हिन्दी')
    expect(pickBestVoice([{ name: 'Fred', lang: 'en-US' }, { name: 'Samantha', lang: 'en-US' }], 'en-US')?.name).toBe('Samantha')
    expect(pickBestVoice(voices, 'ta-IN')).toBeUndefined()
  })

  it('splits replies into speakable sentences, merging fragments', () => {
    expect(splitSentences('Got it. Your daughter will receive the Noida house. Anything else you want to add for her?')).toEqual([
      'Got it. Your daughter will receive the Noida house.',
      'Anything else you want to add for her?',
    ])
    expect(splitSentences('समझ गई। मकान बेटी के लिए दर्ज किया। क्या और कुछ जोड़ना है?').length).toBeGreaterThan(0)
    expect(splitSentences('')).toEqual([])
    expect(splitSentences('word '.repeat(300)).every((part) => part.length <= 1600)).toBe(true)
  })
})

describe('WAV encoding', () => {
  it('produces a valid 16-bit mono PCM header and clamps samples', () => {
    const wav = new DataView(encodeWav(new Float32Array([0, 1, -1, 2]), 16000))
    const text = (o: number) => String.fromCharCode(wav.getUint8(o), wav.getUint8(o + 1), wav.getUint8(o + 2), wav.getUint8(o + 3))
    expect([text(0), text(8), text(36)]).toEqual(['RIFF', 'WAVE', 'data'])
    expect(wav.getUint16(20, true)).toBe(1)
    expect(wav.getUint32(24, true)).toBe(16000)
    expect(wav.getUint32(40, true)).toBe(8)
    expect(wav.getInt16(46, true)).toBe(32767)
    expect(wav.getInt16(48, true)).toBe(-32768)
    expect(wav.getInt16(50, true)).toBe(32767) // 2.0 clamped
  })
})

describe('how a reply is cut up for the server voice', () => {
  const reply =
    'Samajh gayi. Main wife ko primary beneficiary note kar rahi hoon, aur Noida wala ghar beti ke liye specific bequest ke roop mein. Kya aap us ghar ki approximate value bata sakte hain? Maine ise aapki screen par rakh diya hai, please wahin confirm kijiye.'

  it('sends a short Hindi or Hinglish reply as one piece', () => {
    expect(speechChunks('Samajh gayi, main note kar rahi hoon.', 'hinglish')).toEqual(['Samajh gayi, main note kar rahi hoon.'])
    expect(speechChunks('ठीक है।', 'hi')).toHaveLength(1)
  })

  it('opens with a small piece so speech starts quickly, then grows no faster than it plays', () => {
    const chunks = speechChunks(reply, 'hinglish')
    expect(chunks).toEqual([
      'Samajh gayi. Main wife ko primary beneficiary note kar rahi hoon,',
      'aur Noida wala ghar beti ke liye specific bequest ke roop mein. Kya aap us ghar ki approximate value bata sakte hain?',
      'Maine ise aapki screen par rakh diya hai, please wahin confirm kijiye.',
    ])
    expect(chunks[0].length).toBeGreaterThanOrEqual(FIRST_CHUNK_CHARS)
    for (let index = 1; index < chunks.length; index += 1) expect(chunks[index].length).toBeLessThanOrEqual(chunks[index - 1].length * 2)
  })

  it('cuts only at pauses, loses nothing, and never splits inside a number', () => {
    const text = `Ghar ki value ₹2.5 Cr hai aur FD 1,00,000 ki hai, ${reply}`
    const chunks = speechChunks(text, 'hinglish')
    expect(chunks.join(' ')).toBe(text.replace(/\s+/g, ' ').trim())
    for (const chunk of chunks.slice(0, -1)) expect(chunk).toMatch(/[.!?।,;:]$/)
    expect(chunks.some((chunk) => chunk.endsWith('₹2.') || chunk.endsWith('1,'))).toBe(false)
    expect(chunks.every((chunk) => chunk.length <= MAX_CHUNK_CHARS)).toBe(true)
  })

  it('handles a very long reply and empty text', () => {
    const chunks = speechChunks(`${reply} `.repeat(6), 'hinglish')
    expect(chunks.length).toBeGreaterThan(2)
    expect(chunks.every((chunk) => chunk.length <= MAX_CHUNK_CHARS + reply.length)).toBe(true)
    expect(speechChunks('   ', 'hinglish')).toEqual([])
  })

  it('still goes sentence by sentence in English', () => {
    expect(speechChunks(reply, 'en').length).toBeGreaterThan(1)
  })
})
