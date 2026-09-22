import { synthesizeSpeechBlob } from './backendClient'
// Voice capture for the estate interview. Two paths, both feeding the same
// "structured proposal → user confirmation" flow as typed input:
//   1. live dictation through the browser's Speech Recognition (no upload), and
//   2. recording audio and sending it to the backend for transcription, which
//      handles Hindi/Hinglish better and works in browsers without dictation.

interface RecognitionResultLike {
  isFinal: boolean
  0: { transcript: string }
}
interface RecognitionEventLike {
  resultIndex: number
  results: ArrayLike<RecognitionResultLike>
}
interface RecognitionLike {
  lang: string
  continuous: boolean
  interimResults: boolean
  onresult: ((event: RecognitionEventLike) => void) | null
  onerror: ((event: { error: string }) => void) | null
  onend: (() => void) | null
  start(): void
  stop(): void
  abort(): void
}
type RecognitionConstructor = new () => RecognitionLike

function recognitionConstructor(): RecognitionConstructor | null {
  const scope = window as unknown as { SpeechRecognition?: RecognitionConstructor; webkitSpeechRecognition?: RecognitionConstructor }
  return scope.SpeechRecognition ?? scope.webkitSpeechRecognition ?? null
}

export function isDictationSupported() {
  return recognitionConstructor() !== null
}

export function isRecordingSupported() {
  return typeof navigator !== 'undefined' && Boolean(navigator.mediaDevices?.getUserMedia) && typeof MediaRecorder !== 'undefined'
}

export interface DictationHandle {
  stop: () => void
}

/** Live speech-to-text. `onText` receives the full transcript so far (final + interim). */
export function startDictation(options: {
  lang: string
  /** false = stop automatically after one utterance (conversation turns). Default true. */
  continuous?: boolean
  onText: (text: string, isFinal: boolean) => void
  onEnd: () => void
  onError: (message: string) => void
}): DictationHandle | null {
  const Recognition = recognitionConstructor()
  if (!Recognition) return null

  const recognition = new Recognition()
  recognition.lang = options.lang
  recognition.continuous = options.continuous ?? true
  recognition.interimResults = true

  let finalText = ''
  recognition.onresult = (event) => {
    let interim = ''
    for (let index = event.resultIndex; index < event.results.length; index += 1) {
      const result = event.results[index]
      if (result.isFinal) finalText += `${result[0].transcript} `
      else interim += result[0].transcript
    }
    options.onText(`${finalText}${interim}`.trim(), interim === '')
  }
  recognition.onerror = (event) => {
    options.onError(
      event.error === 'not-allowed' || event.error === 'service-not-allowed'
        ? 'Microphone permission was denied.'
        : event.error === 'no-speech'
          ? 'No speech was detected.'
          : `Speech recognition error: ${event.error}`,
    )
  }
  recognition.onend = options.onEnd
  recognition.start()
  return { stop: () => recognition.stop() }
}

export interface RecordingHandle {
  stop: () => Promise<File>
  cancel: () => void
}

/** Record microphone audio; `stop()` resolves with a File ready for upload. */
export async function startRecording(): Promise<RecordingHandle> {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
  const preferred = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus']
  const mimeType = preferred.find((type) => MediaRecorder.isTypeSupported(type)) ?? ''
  const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined)
  const chunks: Blob[] = []
  recorder.ondataavailable = (event) => {
    if (event.data.size > 0) chunks.push(event.data)
  }
  recorder.start()

  const release = () => stream.getTracks().forEach((track) => track.stop())
  return {
    stop: () =>
      new Promise<File>((resolve, reject) => {
        recorder.onstop = () => {
          release()
          const type = (recorder.mimeType || mimeType || 'audio/webm').split(';')[0]
          const extension = type.includes('mp4') ? 'm4a' : type.includes('ogg') ? 'ogg' : 'webm'
          resolve(new File(chunks, `voice-interview-${Date.now()}.${extension}`, { type }))
        }
        recorder.onerror = () => {
          release()
          reject(new Error('Recording failed'))
        }
        if (recorder.state !== 'inactive') recorder.stop()
        else recorder.onstop?.(new Event('stop'))
      }),
    cancel: () => {
      recorder.onstop = null
      if (recorder.state !== 'inactive') recorder.stop()
      release()
    },
  }
}

// ------------------------------------------------------------ speaking

export function isSpeechSynthesisSupported() {
  return typeof window !== 'undefined' && 'speechSynthesis' in window && typeof SpeechSynthesisUtterance !== 'undefined'
}

export type SpokenLanguage = 'en' | 'hi' | 'hinglish'

/** Browser voice locale for each spoken language. Hinglish is written in Roman letters, so an Indian-English voice reads it best. */
export const SPEECH_LOCALE: Record<SpokenLanguage, string> = { en: 'en-IN', hi: 'hi-IN', hinglish: 'en-IN' }

interface VoiceLike {
  name: string
  lang: string
}

/**
 * The default browser voice is often the worst one installed. Rank the voices for the
 * language: exact locale first, then neural / "Natural" / Google / Enhanced voices,
 * and avoid compact or robotic engines.
 */
export function pickBestVoice<T extends VoiceLike>(voices: T[], lang: string): T | undefined {
  const prefix = lang.split('-')[0].toLowerCase()
  const candidates = voices.filter((voice) => voice.lang.toLowerCase().replace('_', '-').startsWith(prefix))
  const score = (voice: T) => {
    let points = 0
    if (voice.lang.toLowerCase().replace('_', '-') === lang.toLowerCase()) points += 100
    if (/natural|neural|online/i.test(voice.name)) points += 40
    if (/enhanced|premium|siri/i.test(voice.name)) points += 30
    if (/google/i.test(voice.name)) points += 25
    if (/compact|espeak|novelty|fred|zarvox|whisper/i.test(voice.name)) points -= 60
    return points
  }
  return [...candidates].sort((a, b) => score(b) - score(a))[0]
}

/** Split a reply into speakable sentences (short ones are merged so each request is worth its round trip). */
export function splitSentences(text: string, minLength = 45, maxLength = 400): string[] {
  const raw = text.replace(/\s+/g, ' ').trim().match(/[^.!?।]+[.!?।]*\s*/g) ?? []
  const merged: string[] = []
  for (const part of raw) {
    const last = merged.at(-1)
    if (last !== undefined && (last.length < minLength || part.trim().length < 12) && last.length + part.length <= maxLength) merged[merged.length - 1] = `${last}${part}`
    else merged.push(part)
  }
  return merged.map((part) => part.trim()).filter(Boolean)
}

/**
 * How a reply is cut up for the server voice. English is voiced a few sentences at a time.
 *
 * Hindi and Hinglish sound best in as few pieces as possible (every request is a separate take), but one request for
 * a whole reply means several seconds of silence before the first word. So the reply is cut only at natural pauses
 * (full stops and commas): a small first piece so speech starts quickly, then pieces at most twice the size of the
 * one before, so each is ready by the time the previous one has finished playing. Playback joins them without gaps.
 */
export const FIRST_CHUNK_CHARS = 55
export const MAX_CHUNK_CHARS = 400
const SINGLE_CHUNK_CHARS = 90
// English sentences are merged into pieces of about ENGLISH_CHUNK_CHARS: the voice shapes its tone from the text
// around a sentence, so a sentence on its own comes out flat.
const ENGLISH_CHUNK_CHARS = 110
export function speechChunks(text: string, language: SpokenLanguage): string[] {
  if (language === 'en') return splitSentences(text, ENGLISH_CHUNK_CHARS, 320)
  const clean = text.replace(/\s+/g, ' ').trim()
  if (!clean) return []
  if (clean.length <= SINGLE_CHUNK_CHARS) return [clean]

  // Pauses only where punctuation ends a word, so "₹2.5 Cr" and "1,00,000" are never cut in half.
  const pauses = (clean.match(/.+?(?:[.!?।,;:]+(?=\s|$)|$)/g) ?? [clean]).map((part) => part.trim()).filter(Boolean)
  const chunks: string[] = []
  let current = ''
  for (const part of pauses) {
    const limit = chunks.length === 0 ? Infinity : Math.min(MAX_CHUNK_CHARS, (chunks[chunks.length - 1]?.length ?? 0) * 2)
    if (current && current.length + 1 + part.length > limit) {
      chunks.push(current)
      current = ''
    }
    current = current ? `${current} ${part}` : part
    if (chunks.length === 0 && current.length >= FIRST_CHUNK_CHARS) {
      chunks.push(current)
      current = ''
    }
  }
  if (current) chunks.push(current)
  return chunks
}

let generation = 0
let currentAudio: HTMLAudioElement | null = null
let pendingFetches: AbortController[] = []
let audioContext: AudioContext | null = null
let scheduledSources: AudioBufferSourceNode[] = []

/** Stop anything Samaira is saying (server audio and browser voice) and abandon queued sentences. */
export function cancelSpeech() {
  generation += 1
  pendingFetches.forEach((controller) => controller.abort())
  pendingFetches = []
  if (currentAudio) {
    currentAudio.pause()
    currentAudio.src = ''
    currentAudio = null
  }
  for (const source of scheduledSources) {
    try {
      source.stop()
    } catch {
      // already finished
    }
  }
  scheduledSources = []
  if (isSpeechSynthesisSupported()) window.speechSynthesis.cancel()
}

/** Browser voices read "Samaira" as "SAM-eye-ruh"; "Sumyra" is the spelling that comes out right ("suh-MY-ruh"). The screen keeps "Samaira". */
function speakableText(text: string) {
  return text.replace(/\bSamaira\b/gi, 'Sumyra')
}

/** Speak with the browser voice. Resolves when finished; a length-based timeout stops browsers that never fire `onend` from stalling the conversation. */
export function speak(text: string, lang: string): Promise<void> {
  if (!isSpeechSynthesisSupported() || !text.trim()) return Promise.resolve()
  return new Promise((resolve) => {
    const synth = window.speechSynthesis
    synth.cancel()
    const utterance = new SpeechSynthesisUtterance(speakableText(text))
    utterance.lang = lang
    const voice = pickBestVoice(synth.getVoices(), lang)
    if (voice) utterance.voice = voice
    utterance.rate = 1

    let finished = false
    const done = () => {
      if (finished) return
      finished = true
      window.clearTimeout(timer)
      resolve()
    }
    const timer = window.setTimeout(done, Math.max(4000, text.length * 110))
    utterance.onend = done
    utterance.onerror = done
    synth.speak(utterance)
  })
}

function playBlob(blob: Blob, myGeneration: number): Promise<void> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(blob)
    const audio = new Audio(url)
    currentAudio = audio
    const done = () => {
      URL.revokeObjectURL(url)
      if (currentAudio === audio) currentAudio = null
      resolve()
    }
    audio.onended = done
    audio.onerror = done
    audio.play().catch(done)
    if (generation !== myGeneration) done()
  })
}

const CROSSFADE_S = 0.012
const EDGE_SILENCE_THRESHOLD = 0.01
const EDGE_PADDING_S = 0.02

/** Synthesised clips carry a little silence at both ends; left in, it becomes an audible gap at every join. */
function trimEdgeSilence(context: AudioContext, buffer: AudioBuffer): AudioBuffer {
  const samples = buffer.getChannelData(0)
  const padding = Math.round(buffer.sampleRate * EDGE_PADDING_S)
  let first = 0
  while (first < samples.length && Math.abs(samples[first]) < EDGE_SILENCE_THRESHOLD) first += 1
  let last = samples.length - 1
  while (last > first && Math.abs(samples[last]) < EDGE_SILENCE_THRESHOLD) last -= 1
  first = Math.max(0, first - padding)
  last = Math.min(samples.length - 1, last + padding)
  if (first === 0 && last === samples.length - 1) return buffer
  const trimmed = context.createBuffer(buffer.numberOfChannels, last - first + 1, buffer.sampleRate)
  for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) trimmed.copyToChannel(buffer.getChannelData(channel).subarray(first, last + 1), channel)
  return trimmed
}

/**
 * Play the pieces of one reply back to back as a single stream: each is scheduled to start the instant the previous
 * one ends (with a very short crossfade), rather than after an audio element's "ended" event and a fresh request.
 * Returns false when the browser has no Web Audio, so the caller can play them one by one instead.
 */
async function playPiecesAsOneStream(pieces: string[], clips: Promise<Blob | null>[], myGeneration: number, locale: string): Promise<boolean> {
  const AudioCtx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  if (!AudioCtx) return false
  audioContext ??= new AudioCtx()
  const context = audioContext
  await context.resume().catch(() => {})

  let cursor = 0
  let lastEnded: Promise<void> = Promise.resolve()
  for (let index = 0; index < pieces.length; index += 1) {
    const blob = await clips[index]
    if (generation !== myGeneration) return true
    let buffer: AudioBuffer | null = null
    if (blob && blob.size > 100) {
      try {
        buffer = trimEdgeSilence(context, await context.decodeAudioData(await blob.arrayBuffer()))
      } catch {
        buffer = null
      }
    }
    if (generation !== myGeneration) return true

    if (!buffer) {
      // This piece could not be voiced: let what is queued finish, then say it with the browser voice.
      await lastEnded
      if (generation !== myGeneration) return true
      await speak(pieces[index], locale)
      cursor = 0
      lastEnded = Promise.resolve()
      continue
    }

    const source = context.createBufferSource()
    const gain = context.createGain()
    source.buffer = buffer
    source.connect(gain).connect(context.destination)
    const start = Math.max(context.currentTime + 0.03, cursor - CROSSFADE_S)
    const end = start + buffer.duration
    gain.gain.setValueAtTime(0, start)
    gain.gain.linearRampToValueAtTime(1, start + CROSSFADE_S)
    gain.gain.setValueAtTime(1, Math.max(start + CROSSFADE_S, end - CROSSFADE_S))
    gain.gain.linearRampToValueAtTime(0, end)
    lastEnded = new Promise<void>((resolve) => {
      source.onended = () => {
        scheduledSources = scheduledSources.filter((item) => item !== source)
        resolve()
      }
    })
    scheduledSources.push(source)
    source.start(start)
    cursor = end
  }
  await lastEnded
  return true
}

/**
 * Say a reply in the language it is written in.
 *  - Server voice (English: Deepgram Aura, Hindi / Hinglish: Smallest.ai), sentence by sentence — all
 *    sentences are requested up front and played in order, so the first starts after ~1 s while the rest
 *    load. Any sentence the server cannot voice falls back to the browser voice.
 *  - Without a server voice for the language, the best matching browser voice.
 */
export async function speakReply(text: string, options: { language: SpokenLanguage; useServerVoice: boolean; useServerHindiVoice?: boolean }): Promise<void> {
  cancelSpeech()
  const myGeneration = generation
  const locale = SPEECH_LOCALE[options.language]
  if (!text.trim()) return

  const serverVoice = options.language === 'en' ? options.useServerVoice : Boolean(options.useServerHindiVoice)
  if (!serverVoice) return speak(text, locale)

  const sentences = speechChunks(text, options.language)
  const controllers = sentences.map(() => new AbortController())
  pendingFetches = controllers
  const audio = sentences.map((sentence, index) => synthesizeSpeechBlob(sentence, controllers[index].signal, options.language))

  // Hindi / Hinglish: all pieces are requested at once and joined into one continuous stream.
  if (options.language !== 'en' && (await playPiecesAsOneStream(sentences, audio, myGeneration, locale))) return

  for (let index = 0; index < sentences.length; index += 1) {
    if (generation !== myGeneration) return
    const blob = await audio[index]
    if (generation !== myGeneration) return
    if (blob && blob.size > 100) await playBlob(blob, myGeneration)
    else await speak(sentences[index], locale)
  }
}

// -------------------------------------------------- hands-free listening

export interface UtteranceHandle {
  /** Resolves with the recorded speech, or null if nobody spoke (or it was cancelled). */
  result: Promise<Blob | null>
  /** Finish now with whatever has been heard. */
  finish: () => void
  cancel: () => void
}

/**
 * Record one utterance and stop by itself when the speaker pauses. The noise floor is measured in
 * the first moments, so quiet rooms and noisy ones both work.
 */
export async function recordUtterance(options: {
  onLevel?: (level: number) => void
  maxWaitMs?: number
  silenceMs?: number
  maxMs?: number
}): Promise<UtteranceHandle> {
  const { maxWaitMs = 9000, silenceMs = 1300, maxMs = 30_000 } = options
  const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } })
  const AudioCtx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  const context = AudioCtx ? new AudioCtx() : null
  const analyser = context?.createAnalyser()
  if (context && analyser) {
    analyser.fftSize = 1024
    context.createMediaStreamSource(stream).connect(analyser)
  }

  const preferred = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4']
  const mimeType = preferred.find((type) => MediaRecorder.isTypeSupported(type)) ?? ''
  const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined)
  const chunks: Blob[] = []
  recorder.ondataavailable = (event) => {
    if (event.data.size > 0) chunks.push(event.data)
  }
  recorder.start(200)

  const buffer = new Uint8Array(analyser?.fftSize ?? 0)
  const startedAt = Date.now()
  let noiseFloor = 0
  let calibrationSamples = 0
  let speechStartedAt = 0
  let lastVoiceAt = 0
  let finished = false
  let resolveResult: (blob: Blob | null) => void = () => {}
  const result = new Promise<Blob | null>((resolve) => {
    resolveResult = resolve
  })

  const release = () => {
    window.clearInterval(timer)
    stream.getTracks().forEach((track) => track.stop())
    void context?.close()
    options.onLevel?.(0)
  }

  const end = (keep: boolean) => {
    if (finished) return
    finished = true
    release()
    recorder.onstop = () => resolveResult(keep && chunks.length ? new Blob(chunks, { type: (recorder.mimeType || mimeType || 'audio/webm').split(';')[0] }) : null)
    if (recorder.state !== 'inactive') recorder.stop()
    else recorder.onstop?.(new Event('stop'))
  }

  const timer = window.setInterval(() => {
    const now = Date.now()
    let level = 0
    if (analyser) {
      analyser.getByteTimeDomainData(buffer)
      let sum = 0
      for (const value of buffer) sum += ((value - 128) / 128) ** 2
      level = Math.sqrt(sum / buffer.length)
    }
    options.onLevel?.(Math.min(1, level * 6))

    // Measure the room's background noise for the first ~400 ms.
    if (now - startedAt < 400) {
      noiseFloor = (noiseFloor * calibrationSamples + level) / (calibrationSamples + 1)
      calibrationSamples += 1
      return
    }
    const threshold = Math.max(0.02, noiseFloor * 3)
    if (level > threshold) {
      if (!speechStartedAt) speechStartedAt = now
      lastVoiceAt = now
    }
    if (speechStartedAt && now - lastVoiceAt > silenceMs) end(lastVoiceAt - speechStartedAt > 250)
    else if (!speechStartedAt && now - startedAt > maxWaitMs) end(false)
    else if (now - startedAt > maxMs) end(Boolean(speechStartedAt))
  }, 50)

  return { result, finish: () => end(Boolean(speechStartedAt)), cancel: () => end(false) }
}

// ------------------------------------------------------ WAV conversion

/**
 * Browsers record webm/opus (Chrome) or mp4 (Safari), which transcription
 * providers do not reliably accept. Decode and re-encode as 16 kHz mono
 * 16-bit WAV — universally supported and small for speech. Falls back to the
 * original file if decoding is not possible.
 */
export async function toWavFile(file: File): Promise<File> {
  try {
    const AudioCtx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!AudioCtx) return file
    const context = new AudioCtx()
    const decoded = await context.decodeAudioData(await file.arrayBuffer())
    void context.close()

    const targetRate = 16000
    const frames = Math.max(1, Math.ceil(decoded.duration * targetRate))
    const offline = new OfflineAudioContext(1, frames, targetRate)
    const source = offline.createBufferSource()
    source.buffer = decoded
    source.connect(offline.destination)
    source.start()
    const rendered = await offline.startRendering()
    return new File([encodeWav(rendered.getChannelData(0), targetRate)], file.name.replace(/\.[^.]+$/, '') + '.wav', { type: 'audio/wav' })
  } catch {
    return file
  }
}

export function encodeWav(samples: Float32Array, sampleRate: number): ArrayBuffer {
  const buffer = new ArrayBuffer(44 + samples.length * 2)
  const view = new DataView(buffer)
  const write = (offset: number, text: string) => {
    for (let index = 0; index < text.length; index += 1) view.setUint8(offset + index, text.charCodeAt(index))
  }
  write(0, 'RIFF')
  view.setUint32(4, 36 + samples.length * 2, true)
  write(8, 'WAVE')
  write(12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true) // PCM
  view.setUint16(22, 1, true) // mono
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * 2, true)
  view.setUint16(32, 2, true)
  view.setUint16(34, 16, true)
  write(36, 'data')
  view.setUint32(40, samples.length * 2, true)
  for (let index = 0; index < samples.length; index += 1) {
    const clamped = Math.max(-1, Math.min(1, samples[index]))
    view.setInt16(44 + index * 2, clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff, true)
  }
  return buffer
}
