import { createHash } from 'node:crypto'
import { httpError } from './auth.mjs'

const SMALLEST_TTS_URL = 'https://api.smallest.ai/waves/v1/tts'
const TTS_TIMEOUT_MS = 30_000

// A whole spoken reply goes out as ONE request, so it is voiced in a single flow: separate requests per sentence
// give every sentence its own intonation and a gap before the next. Replies are at most ~1,400 characters.
export const MAX_SMALLEST_TTS_CHARS = 1500

export function isSmallestConfigured() {
  return Boolean(process.env.SMALLEST_API_KEY)
}

/**
 * Hindi and Hinglish are voiced by Smallest.ai Lightning v3.1 Pro. Its `hi` language covers Hindi in
 * Devanagari, Roman-script Hinglish and Indian-accented English code-switching in one voice.
 */
export function isSmallestLanguage(language) {
  return /^(hi|hinglish)(-|$)/i.test(String(language || ''))
}

const MODEL = 'lightning_v3.1_pro'

/**
 * Written text is not spoken text. Markdown marks, emoji and dashes make a voice stumble or stop dead, so tidy
 * them into the commas and spaces a person would pause on. "Samaira" is respelled for the voice only — both
 * engines read it as "SAM-eye-ruh" (stressed on the first syllable); "Sumyra" is the spelling that came back
 * correct ("suh-MY-ruh") when A/B'd against Deepgram Aura-2. The screen and transcript keep "Samaira".
 */
export function prepareSpeechText(text) {
  return String(text)
    .replace(/\bSamaira\b/gi, 'Sumyra')
    .replace(/[*_#`>~]+/g, '')
    .replace(/\p{Extended_Pictographic}/gu, '')
    .replace(/\s*[—–]\s*/g, ', ')
    .replace(/\s+/g, ' ')
    .replace(/\s+([,.!?।])/g, '$1')
    .trim()
}

// Identical text + voice + speed always yields the same audio, so repeat requests (the fixed prompts
// Samaira says every session, or a user replaying a line) cost nothing. The cache is in memory only and
// bounded, so client-specific audio is never written to disk and vanishes on restart.
const cache = new Map() // key → Buffer, insertion order = least recently used first
const inflight = new Map() // key → Promise<Buffer>, so concurrent duplicates share one API call
let cachedBytes = 0

function cacheLimitBytes() {
  const megabytes = Number(process.env.SMALLEST_TTS_CACHE_MB)
  return (Number.isFinite(megabytes) && megabytes >= 0 ? megabytes : 64) * 1024 * 1024
}

function remember(key, audio) {
  const limit = cacheLimitBytes()
  if (audio.length > limit) return
  cache.set(key, audio)
  cachedBytes += audio.length
  for (const [oldest, value] of cache) {
    if (cachedBytes <= limit) break
    cache.delete(oldest)
    cachedBytes -= value.length
  }
}

export function clearSmallestCache() {
  cache.clear()
  inflight.clear()
  cachedBytes = 0
}

function settings() {
  const speed = Number(process.env.SMALLEST_TTS_SPEED)
  return {
    voice_id: process.env.SMALLEST_TTS_VOICE || 'meher',
    model: MODEL,
    language: 'hi',
    sample_rate: 24000,
    // Slightly slower than default reads better for legal guidance.
    speed: speed >= 0.5 && speed <= 2 ? speed : 0.95,
    output_format: 'wav',
  }
}

async function requestAudio(key, text, voice) {
  const response = await fetch(SMALLEST_TTS_URL, {
    method: 'POST',
    headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json', accept: 'audio/wav' },
    body: JSON.stringify({ text, ...voice }),
    signal: AbortSignal.timeout(TTS_TIMEOUT_MS),
  })
  if (!response.ok) throw httpError(502, `Smallest.ai speech synthesis failed with ${response.status}`)
  return Buffer.from(await response.arrayBuffer())
}

/** Text → WAV bytes. The key stays on the server; the browser only ever sees the audio. */
export async function synthesizeWithSmallest(rawText) {
  const text = prepareSpeechText(rawText)
  if (!text) throw httpError(400, 'Nothing to speak')
  const key = process.env.SMALLEST_API_KEY
  if (!key) throw httpError(503, 'SMALLEST_API_KEY is not configured')
  const voice = settings()
  const cacheKey = createHash('sha256').update(JSON.stringify([text, voice])).digest('hex')

  const hit = cache.get(cacheKey)
  if (hit) {
    cache.delete(cacheKey) // re-insert to mark as most recently used
    cache.set(cacheKey, hit)
    return hit
  }
  let pending = inflight.get(cacheKey)
  if (!pending) {
    pending = requestAudio(key, text, voice)
      .then((audio) => {
        remember(cacheKey, audio)
        return audio
      })
      .finally(() => inflight.delete(cacheKey))
    inflight.set(cacheKey, pending)
  }
  return pending
}
