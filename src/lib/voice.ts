// Voice capture for the estate interview. Two paths, both feeding the same
// "structured proposal → user confirmation" flow as typed input:
//   1. live dictation through the browser's Speech Recognition (no upload), and
//   2. recording audio and sending it to the backend for transcription, which
//      handles Hindi/Hinglish better and works in browsers without dictation.
//
// Speaking replies out loud is Gemini Live's job now (native audio, see lib/liveVoice.ts) -- this file no longer
// has a text-to-speech path.

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
