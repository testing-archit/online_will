import { httpError } from './auth.mjs'
import { prepareSpeechText } from './smallest.mjs'

const DEEPGRAM = 'https://api.deepgram.com/v1'
const TTS_TIMEOUT_MS = 20_000
const STT_TIMEOUT_MS = 30_000

export const MAX_TTS_CHARS = 500
export const MAX_LISTEN_BYTES = 10 * 1024 * 1024

export function isDeepgramConfigured() {
  return Boolean(process.env.DEEPGRAM_API_KEY)
}

function headers(extra = {}) {
  const key = process.env.DEEPGRAM_API_KEY
  if (!key) throw httpError(503, 'DEEPGRAM_API_KEY is not configured')
  return { authorization: `Token ${key}`, ...extra }
}

/** Aura-2 voices are English-only; other languages are voiced by the browser. */
export function isTtsLanguageSupported(language) {
  return /^en(-|$)/i.test(String(language || 'en'))
}

/**
 * Text → WAV bytes with a Deepgram Aura-2 voice. Deepgram's MP3 output is capped at 48 kbps, which sounds muffled
 * and tinny; lossless 24 kHz PCM is the voice's native quality. The text is tidied first (markdown marks, emoji and
 * dashes make a voice stumble or read symbols aloud).
 */
export async function synthesizeSpeech(rawText) {
  const text = prepareSpeechText(rawText)
  if (!text) throw httpError(400, 'Nothing to speak')
  const model = process.env.DEEPGRAM_TTS_MODEL || 'aura-2-thalia-en'
  const response = await fetch(`${DEEPGRAM}/speak?model=${encodeURIComponent(model)}&encoding=linear16&container=wav&sample_rate=24000`, {
    method: 'POST',
    headers: headers({ 'content-type': 'application/json' }),
    body: JSON.stringify({ text }),
    signal: AbortSignal.timeout(TTS_TIMEOUT_MS),
  })
  if (!response.ok) throw httpError(502, `Deepgram speech synthesis failed with ${response.status}`)
  return Buffer.from(await response.arrayBuffer())
}

// Interview language → Deepgram Nova-3 language. "multi" handles Hindi/English code-switching (Hinglish).
// "auto" also uses multi: it transcribes English, Hindi and code-switched speech in one model.
const STT_LANGUAGE = { en: 'en-IN', hi: 'hi', hinglish: 'multi', auto: 'multi' }

export function speechLanguageFor(hint) {
  const text = String(hint || 'en').toLowerCase()
  if (STT_LANGUAGE[text]) return STT_LANGUAGE[text]
  if (text.startsWith('hi')) return 'hi'
  if (text.includes('hinglish') || text.includes('multi') || text.includes('auto')) return 'multi'
  return 'en-IN'
}

/** Audio bytes → transcript with Deepgram Nova-3 (auto-detects webm/opus, mp4, wav, mp3…). */
export async function transcribeWithDeepgram(buffer, mimeType, hint) {
  const language = speechLanguageFor(hint)
  const response = await fetch(`${DEEPGRAM}/listen?model=nova-3&language=${encodeURIComponent(language)}&smart_format=true&punctuate=true`, {
    method: 'POST',
    headers: headers({ 'content-type': mimeType || 'application/octet-stream' }),
    body: buffer,
    signal: AbortSignal.timeout(STT_TIMEOUT_MS),
  })
  if (!response.ok) throw httpError(502, `Deepgram transcription failed with ${response.status}`)
  const payload = await response.json()
  const alternative = payload?.results?.channels?.[0]?.alternatives?.[0]
  return {
    transcript: String(alternative?.transcript ?? '').trim(),
    confidence: Number(alternative?.confidence ?? 0),
    language,
  }
}
