/**
 * Live voice: a real-time, audio-in / audio-out conversation with Gemini Live, opened straight from the browser with a
 * single-use token the server minted (the API key never reaches the browser, and the model, voice, tool and
 * instructions are locked into that token). Spoken in whatever language the person uses, or the one they pin.
 *
 * Audio in: microphone → 16 kHz 16-bit PCM, streamed in 40 ms chunks. Audio out: 24 kHz PCM through a small jitter
 * buffer. Both run on the audio thread (AudioWorklets), so a busy page -- React re-rendering the form, a PDF being
 * built -- can never stutter her voice or drop what the person is saying. When the person starts talking over her,
 * the server says `interrupted` and whatever is still buffered fades out and is dropped.
 *
 * Google hard-disconnects an audio-only session at 15 minutes and also drops the connection on ordinary network
 * hiccups; without help every drop would end the call and lose the conversation. Session resumption avoids that:
 * the server hands back a resumption handle as the call goes on, and on an unexpected drop this reconnects with
 * that handle instead of ending the call -- the person never has to restart. A planned disconnect (`goAway`) waits
 * for her to finish her sentence first, and what the person says while the line is re-established is held and sent
 * once it is back. A clean, person-initiated stop() never reconnects. https://ai.google.dev/gemini-api/docs/live-session
 */

const LIVE_WS = 'wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContentConstrained'
const INPUT_RATE = 16_000
const OUTPUT_RATE = 24_000
const SEND_SAMPLES = 640 // 40 ms of 16 kHz audio -- Google's recommended range is 20-40 ms
/**
 * Audio held before she starts (and after a network stall) so late packets don't turn into gaps mid-word. Costs
 * next to nothing: gemini-3.8-live streams faster than real time in large chunks (median ~320 ms of audio, measured
 * Sept 2026), so the first chunk alone usually covers it; on a plain connection 40 ms already removed every underrun.
 */
const PREBUFFER_MS = 80
/** How long the playback buffer must stay empty before she counts as done talking (bridges jitter between chunks). */
const SPEAKING_HOLD_MS = 250
/** Fade applied when she is cut off, so an interruption is a quick fade rather than a click. */
const FADE_MS = 12
/** At most this much of the person's speech is held while a dropped line is re-established. */
const RECONNECT_HOLD_CHUNKS = 100 // 4 s
const MAX_RECONNECT_ATTEMPTS = 3
/** A resumed connection has to stay up this long before its retry budget (and the right to try the handle again)
 * is considered earned back -- see the RECONNECT_STABLE_MS comment in reconnectOrFinish for why. */
const RECONNECT_STABLE_MS = 5_000

export type LiveState = 'connecting' | 'listening' | 'speaking' | 'ended'

export interface LiveSession {
  token: string
  setup: Record<string, unknown>
}

export interface LiveCallbacks {
  onState: (state: LiveState) => void
  /** Microphone loudness, 0 to 1 (what the person is saying). Called at most once per animation frame. */
  onLevel: (level: number) => void
  /** Her voice's loudness, 0 to 1, so the screen can move with what she is saying. Called at most once per animation frame. */
  onOutputLevel?: (level: number) => void
  /** The words of the turn in progress, as they arrive: what the person is saying and what she is saying. */
  onCaption?: (caption: { user: string; samaira: string }) => void
  /** One finished exchange: what the person said and what Samaira said back (either may be empty). */
  onTurn: (turn: { user: string; samaira: string }) => void
  /** Samaira asked for something to be done, with what the person has said so far this turn. The result goes back to her as the tool's answer. */
  onToolCall: (name: string, args: Record<string, unknown>, heard: string) => Promise<Record<string, unknown>> | Record<string, unknown>
  onError: (message: string) => void
}

export interface LiveStartOptions {
  /** What Samaira opens the call with, sent once the very first time the socket comes up (never resent on a reconnect). */
  greeting?: string
  /**
   * Mint a fresh session for a reconnect, carrying the last resumption handle this call saw (undefined on the very
   * first connection, or if the server never sent one). Returns null to give up and end the call instead.
   */
  remint?: (resumeHandle: string | undefined) => Promise<LiveSession | null>
}

export interface LiveHandle {
  stop: () => void
  /** Say something to her as text (used for screen updates); she answers out loud. */
  sendText: (text: string) => void
  /** Cut her off mid-sentence and tell her something at once: whatever she was saying is dropped, and she answers the text instead. */
  interrupt: (text: string) => void
  /** Stop sending the microphone (she keeps talking and listening for text); the call stays open. */
  setMuted: (muted: boolean) => void
}

// ---------------------------------------------------------------- pure audio helpers

export function floatToPcm16(samples: Float32Array): Int16Array {
  const pcm = new Int16Array(samples.length)
  for (let index = 0; index < samples.length; index += 1) {
    const clamped = Math.max(-1, Math.min(1, samples[index]))
    pcm[index] = clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff
  }
  return pcm
}

export function pcm16ToFloat(pcm: Int16Array): Float32Array {
  const samples = new Float32Array(pcm.length)
  for (let index = 0; index < pcm.length; index += 1) samples[index] = pcm[index] / (pcm[index] < 0 ? 0x8000 : 0x7fff)
  return samples
}

export function pcm16ToBase64(pcm: Int16Array): string {
  const bytes = new Uint8Array(pcm.buffer, pcm.byteOffset, pcm.byteLength)
  let binary = ''
  for (let index = 0; index < bytes.length; index += 0x8000) binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000))
  return btoa(binary)
}

export function base64ToPcm16(base64: string): Int16Array {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length - (binary.length % 2))
  for (let index = 0; index < bytes.length; index += 1) bytes[index] = binary.charCodeAt(index)
  return new Int16Array(bytes.buffer)
}

// The two classes below run inside the AudioWorklet (their source is embedded into it), so they must stay
// self-contained: no imports, no references to anything outside the class body.

/**
 * Streaming resampler for the microphone: averages each output sample's share of the input (a box filter, which also
 * keeps hiss above 8 kHz from folding back into speech). Fractional ratios such as 44.1 → 16 kHz carry their
 * position across blocks, so there are no seams between the 128-sample blocks the audio thread delivers.
 */
export class StreamDownsampler {
  ratio: number
  phase = 0
  sum = 0
  count = 0
  last = 0

  constructor(fromRate: number, toRate: number) {
    this.ratio = fromRate / toRate
  }

  push(input: Float32Array, emit: (sample: number) => void) {
    for (let index = 0; index < input.length; index += 1) {
      this.sum += input[index]
      this.count += 1
      this.phase += 1
      while (this.phase >= this.ratio) {
        this.phase -= this.ratio
        if (this.count) {
          this.last = this.sum / this.count
          this.sum = 0
          this.count = 0
        }
        emit(this.last)
      }
    }
  }
}

/**
 * Playback jitter buffer for her voice. Chunks arrive from the network unevenly; playing each the moment it lands
 * leaves gaps whenever one is late. This holds a short cushion before starting (and again after running dry), then
 * plays continuously, fading in on a (re)start and fading out when cleared so nothing clicks.
 */
export class PcmPlaybackQueue {
  chunks: Int16Array[] = []
  head = 0
  buffered = 0
  playing = false
  waited = 0
  prebuffer: number
  fadeLength: number
  fadeOut = 0
  fadeIn = 0

  constructor(prebufferSamples: number, fadeSamples: number) {
    this.prebuffer = prebufferSamples
    this.fadeLength = Math.max(1, fadeSamples)
  }

  push(pcm: Int16Array) {
    if (!pcm.length) return
    this.chunks.push(pcm)
    this.buffered += pcm.length
  }

  /** Drop everything queued: a quick fade if she is mid-word, at once otherwise. */
  clear() {
    if (this.playing && this.buffered > 0) this.fadeOut = Math.min(this.fadeLength, this.buffered)
    else this.reset()
  }

  reset() {
    this.chunks = []
    this.head = 0
    this.buffered = 0
    this.playing = false
    this.waited = 0
    this.fadeOut = 0
  }

  /** Fills one block of output and returns its energy (sum of squares) for metering. */
  fill(out: Float32Array): number {
    if (!this.playing) {
      if (this.buffered === 0) {
        this.waited = 0
        out.fill(0)
        return 0
      }
      this.waited += out.length
      // Start once the cushion is there -- or once we've waited as long as the cushion, so a short last word still plays.
      if (this.buffered < this.prebuffer && this.waited < this.prebuffer) {
        out.fill(0)
        return 0
      }
      this.playing = true
      this.fadeIn = this.fadeLength
    }
    let energy = 0
    for (let index = 0; index < out.length; index += 1) {
      if (this.buffered === 0) {
        out[index] = 0
        continue
      }
      const chunk = this.chunks[0]
      let sample = chunk[this.head] / 32768
      if (this.fadeIn > 0) {
        sample *= 1 - this.fadeIn / this.fadeLength
        this.fadeIn -= 1
      }
      if (this.fadeOut > 0) {
        sample *= this.fadeOut / this.fadeLength
        this.fadeOut -= 1
        if (this.fadeOut === 0) {
          out[index] = sample
          out.fill(0, index + 1)
          this.reset()
          return energy + sample * sample
        }
      }
      out[index] = sample
      energy += sample * sample
      this.head += 1
      this.buffered -= 1
      if (this.head >= chunk.length) {
        this.chunks.shift()
        this.head = 0
      }
    }
    if (this.buffered === 0) {
      this.playing = false
      this.waited = 0
    }
    return energy
  }
}

/** Both processors, sharing the tested classes above. Built lazily, once. */
let workletSource: string | undefined
function audioWorkletSource() {
  workletSource ??= `
const StreamDownsampler = (${StreamDownsampler.toString()});
const PcmPlaybackQueue = (${PcmPlaybackQueue.toString()});

// Microphone: resample to the send rate on the audio thread and hand over finished 16-bit chunks with their loudness.
class Capture extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const { targetRate, chunkSamples } = options.processorOptions;
    this.down = new StreamDownsampler(sampleRate, targetRate);
    this.size = chunkSamples;
    this.chunk = new Int16Array(chunkSamples);
    this.length = 0;
    this.energy = 0;
    this.emit = (value) => {
      const clamped = value > 1 ? 1 : value < -1 ? -1 : value;
      this.energy += clamped * clamped;
      this.chunk[this.length++] = clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff;
      if (this.length === this.size) {
        this.port.postMessage({ pcm: this.chunk, level: Math.min(1, Math.sqrt(this.energy / this.size) * 6) }, [this.chunk.buffer]);
        this.chunk = new Int16Array(this.size);
        this.length = 0;
        this.energy = 0;
      }
    };
  }
  process(inputs) {
    const channel = inputs[0] && inputs[0][0];
    if (channel) this.down.push(channel, this.emit);
    return true;
  }
}
registerProcessor('live-capture', Capture);

// Her voice: a jitter buffer that reports when she starts and stops being audible, and how loud she is.
class Player extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const { prebufferMs, holdMs, fadeMs } = options.processorOptions;
    this.queue = new PcmPlaybackQueue(Math.round((sampleRate * prebufferMs) / 1000), Math.round((sampleRate * fadeMs) / 1000));
    this.hold = Math.round((sampleRate * holdMs) / 1000);
    this.silent = 0;
    this.speaking = false;
    this.meterEnergy = 0;
    this.meterSamples = 0;
    this.cleared = false;
    this.port.onmessage = (event) => {
      if (event.data === 'clear') {
        this.queue.clear();
        this.cleared = true;
      } else this.queue.push(event.data);
    };
  }
  process(_inputs, outputs) {
    const out = outputs[0] && outputs[0][0];
    if (!out) return true;
    const energy = this.queue.fill(out);
    if (this.cleared && this.queue.buffered > 0 && this.queue.fadeOut === 0) this.cleared = false; // new speech after the cut
    const audible = this.queue.playing || this.queue.buffered > 0;
    if (audible) {
      this.silent = 0;
      if (!this.speaking) {
        this.speaking = true;
        this.port.postMessage({ speaking: true });
      }
    } else if (this.speaking) {
      this.silent += out.length;
      // After a cut-off she is done at once; a natural stop waits out the hold, since the next chunk may just be late.
      if (this.cleared || this.silent >= this.hold) {
        this.speaking = false;
        this.cleared = false;
        this.port.postMessage({ speaking: false, level: 0 });
      }
    }
    if (this.speaking) {
      this.meterEnergy += energy;
      this.meterSamples += out.length;
      if (this.meterSamples >= sampleRate / 30) {
        this.port.postMessage({ level: Math.min(1, Math.sqrt(this.meterEnergy / this.meterSamples) * 5) });
        this.meterEnergy = 0;
        this.meterSamples = 0;
      }
    }
    return true;
  }
}
registerProcessor('live-player', Player);
`
  return workletSource
}

export function isLiveSupported(): boolean {
  return typeof WebSocket !== 'undefined' && typeof AudioContext !== 'undefined' && typeof AudioWorkletNode !== 'undefined' && Boolean(navigator.mediaDevices?.getUserMedia)
}

/** A protobuf Duration as JSON ("12s", "0.5s") in milliseconds, or undefined if it isn't one. */
export function durationMs(value: unknown): number | undefined {
  const match = typeof value === 'string' ? /^(\d+(?:\.\d+)?)s$/.exec(value) : null
  return match ? Number(match[1]) * 1000 : undefined
}

// ---------------------------------------------------------------- the conversation

interface Audio {
  stream: MediaStream
  inputContext: AudioContext
  outputContext: AudioContext
  source: MediaStreamAudioSourceNode
  capture: AudioWorkletNode
  player: AudioWorkletNode
}

async function openAudio(): Promise<Audio> {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 } })
  let inputContext: AudioContext | undefined
  let outputContext: AudioContext | undefined
  try {
    inputContext = new AudioContext({ latencyHint: 'interactive' })
    outputContext = new AudioContext({ sampleRate: OUTPUT_RATE, latencyHint: 'interactive' })
    const url = URL.createObjectURL(new Blob([audioWorkletSource()], { type: 'application/javascript' }))
    try {
      await Promise.all([inputContext.resume(), outputContext.resume(), inputContext.audioWorklet.addModule(url), outputContext.audioWorklet.addModule(url)])
    } finally {
      URL.revokeObjectURL(url)
    }
    const source = inputContext.createMediaStreamSource(stream)
    const capture = new AudioWorkletNode(inputContext, 'live-capture', {
      channelCount: 1,
      channelCountMode: 'explicit',
      processorOptions: { targetRate: INPUT_RATE, chunkSamples: SEND_SAMPLES },
    })
    // Routed into a silent gain so every browser keeps pulling audio through the capture node without playing the mic back.
    const silent = inputContext.createGain()
    silent.gain.value = 0
    source.connect(capture).connect(silent).connect(inputContext.destination)
    const player = new AudioWorkletNode(outputContext, 'live-player', {
      numberOfInputs: 0,
      outputChannelCount: [1],
      processorOptions: { prebufferMs: PREBUFFER_MS, holdMs: SPEAKING_HOLD_MS, fadeMs: FADE_MS },
    })
    player.connect(outputContext.destination)
    return { stream, inputContext, outputContext, source, capture, player }
  } catch (error) {
    stream.getTracks().forEach((track) => track.stop())
    void inputContext?.close().catch(() => {})
    void outputContext?.close().catch(() => {})
    throw error
  }
}

function closeAudio(audio: Audio) {
  audio.capture.port.onmessage = null
  audio.player.port.onmessage = null
  try {
    audio.source.disconnect()
    audio.capture.disconnect()
    audio.player.disconnect()
  } catch {
    // already disconnected
  }
  audio.stream.getTracks().forEach((track) => track.stop())
  void audio.inputContext.close().catch(() => {})
  void audio.outputContext.close().catch(() => {})
}

const decoder = new TextDecoder()

export async function startLiveConversation(session: LiveSession, callbacks: LiveCallbacks, options: LiveStartOptions = {}): Promise<LiveHandle> {
  callbacks.onState('connecting')

  let stopped = false
  let ready = false
  let muted = false
  let userText = ''
  let samairaText = ''
  let currentState: LiveState = 'connecting'
  let socket: WebSocket | undefined
  let firstConnection = true
  let reconnecting = false
  let reconnectAttempts = 0
  let connectionHealthyAt = 0 // when the most recent connection reached setupComplete; 0 if none has since a failure
  let resumeHandle: string | undefined
  let audio: Audio | undefined
  let herVoiceAudible = false
  let generating = false // between the first piece of her reply and turnComplete
  let goAwayTimer: ReturnType<typeof setTimeout> | undefined
  let goAwayPending = false
  let heldSpeech: string[] = [] // mic chunks captured while the line was being re-established
  // Socket events that arrive before the microphone is up are replayed once it is (see the end of this function).
  let early: (() => void)[] | null = []
  const gated = <A extends unknown[]>(handler: (...args: A) => void) => (...args: A) => {
    if (early) early.push(() => handler(...args))
    else handler(...args)
  }

  // Loudness is only ever handed to the page once per frame, however often the audio thread measures it.
  let micLevel = 0
  let outLevel = 0
  let shownMic = -1
  let shownOut = -1
  let meter = 0
  const measure = () => {
    if (stopped) return
    const mic = muted ? 0 : micLevel
    const out = herVoiceAudible ? outLevel : 0
    if (Math.abs(mic - shownMic) >= 0.01) callbacks.onLevel((shownMic = mic))
    if (callbacks.onOutputLevel && Math.abs(out - shownOut) >= 0.01) callbacks.onOutputLevel((shownOut = out))
    meter = requestAnimationFrame(measure)
  }

  const setState = (state: LiveState) => {
    if (currentState === state) return
    currentState = state
    callbacks.onState(state)
  }

  /** Listening or speaking, from whether her voice is actually coming out of the speaker right now. */
  const settleState = () => {
    if (ready && !stopped) setState(herVoiceAudible ? 'speaking' : 'listening')
  }

  const send = (message: unknown) => {
    if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message))
  }

  const sendAudio = (base64: string) => send({ realtimeInput: { audio: { data: base64, mimeType: `audio/pcm;rate=${INPUT_RATE}` } } })

  const dropQueuedAudio = () => audio?.player.port.postMessage('clear')

  const flushTurn = () => {
    const user = userText.trim()
    const samaira = samairaText.trim()
    userText = ''
    samairaText = ''
    if (user || samaira) callbacks.onTurn({ user, samaira })
  }

  const finish = (error?: string) => {
    if (stopped) return
    stopped = true
    ready = false
    clearTimeout(goAwayTimer)
    cancelAnimationFrame(meter)
    callbacks.onOutputLevel?.(0)
    flushTurn()
    if (audio) closeAudio(audio)
    if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) socket.close(1000)
    if (error) callbacks.onError(error)
    setState('ended')
  }

  /**
   * A drop that wasn't `stop()` calling this. Every attempt needs a fresh session (a resumption handle rides on a
   * new single-use token), so this re-mints one through the caller rather than just re-opening the same socket. A
   * few attempts with a short back-off ride out a flaky network; a connection that never comes back ends the call
   * instead of retrying forever. Whatever she had already said keeps playing while the line comes back.
   */
  const reconnectOrFinish = async (fallbackError: string) => {
    if (stopped || reconnecting) return
    // The retry budget (and the right to try the resumption handle again -- see the remint call below) is only
    // earned back once a reconnect has actually stayed up a while, not the moment it technically reaches
    // setupComplete: a handle that keeps causing the same server-side fault can otherwise reach setupComplete once
    // per attempt, die again seconds later, and win a fresh 3-attempt budget every single time -- never actually
    // escaping to a clean session.
    if (connectionHealthyAt && Date.now() - connectionHealthyAt >= RECONNECT_STABLE_MS) reconnectAttempts = 0
    connectionHealthyAt = 0
    if (!options.remint || reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
      finish(fallbackError)
      return
    }
    reconnecting = true
    ready = false
    goAwayPending = false
    generating = false
    clearTimeout(goAwayTimer)
    reconnectAttempts += 1
    setState('connecting')
    flushTurn() // the turn in progress was cut off mid-air; nothing more of it is coming
    try {
      if (reconnectAttempts > 1) await new Promise((resolve) => setTimeout(resolve, 400 * 2 ** (reconnectAttempts - 2)))
      if (stopped) return
      // The first attempt resumes with the handle, so a plain network blip picks the conversation back up
      // seamlessly. Google's Live API has a known failure mode (WebSocket close 1011, "internal error") where a
      // handle that triggered it keeps triggering it on every subsequent resume with that same handle -- so if the
      // first attempt didn't work, later ones drop the handle and start a fresh session rather than retrying into
      // the same wall. Losing conversation context this way beats the call dying outright.
      // https://discuss.ai.google.dev/t/live-api-gemini-3-1-flash-live-preview-audio-video-sessions-die-with-1011-internal-error-encountered-2-min-in-resuming-the-handle-then-kills-every-next-session/175234
      const next = await options.remint(reconnectAttempts === 1 ? resumeHandle : undefined)
      if (stopped) return // stop() was called while remint() was in flight
      if (!next) {
        finish(fallbackError)
        return
      }
      reconnecting = false
      connect(next)
    } catch {
      if (!stopped) finish(fallbackError)
    }
  }

  /** Google is about to close this session: move to a new one once she finishes her sentence (or just before it's too late). */
  const onGoAway = (timeLeft: unknown) => {
    if (goAwayPending || reconnecting) return
    goAwayPending = true
    const reconnect = () => void reconnectOrFinish('The live session ended and could not be resumed. Start it again to continue.')
    if (!generating) {
      reconnect()
      return
    }
    goAwayTimer = setTimeout(reconnect, Math.max(0, (durationMs(timeLeft) ?? 5_000) - 1_500))
  }

  const handleToolCalls = async (calls: { id: string; name: string; args?: Record<string, unknown> }[]) => {
    const heard = userText.trim()
    const functionResponses = await Promise.all(
      calls.map(async (call) => {
        let response: Record<string, unknown>
        try {
          response = await callbacks.onToolCall(call.name, call.args ?? {}, heard)
        } catch {
          response = { error: 'That could not be recorded.' }
        }
        return { id: call.id, name: call.name, response }
      }),
    )
    if (!stopped) send({ toolResponse: { functionResponses } })
  }

  const handleMessage = (message: Record<string, any>) => { // eslint-disable-line @typescript-eslint/no-explicit-any
    if (message.setupComplete) {
      ready = true
      // NOT reset here: see the RECONNECT_STABLE_MS check in reconnectOrFinish -- resetting the moment a resumed
      // connection technically comes back up, rather than once it's actually stayed up a while, is exactly what
      // let a poisoned resumption handle keep winning a fresh 3-attempt budget forever, since each resume reached
      // setupComplete once before dying again from the same underlying fault.
      connectionHealthyAt = Date.now()
      settleState()
      // She opens the conversation herself, but only the very first time -- a reconnect picks the call back up mid-flow.
      if (firstConnection && options.greeting) send({ realtimeInput: { text: options.greeting } })
      firstConnection = false
      // Whatever the person said while the line was down goes through now, so they don't have to repeat it.
      for (const chunk of heldSpeech) sendAudio(chunk)
      heldSpeech = []
      return
    }

    if (message.sessionResumptionUpdate?.resumable && message.sessionResumptionUpdate?.newHandle) {
      resumeHandle = message.sessionResumptionUpdate.newHandle
    }

    const content = message.serverContent
    if (content) {
      if (content.interrupted) {
        generating = false
        dropQueuedAudio()
      }
      for (const part of content.modelTurn?.parts ?? []) {
        if (!part.inlineData?.data) continue
        generating = true
        const pcm = base64ToPcm16(part.inlineData.data)
        if (pcm.length) audio?.player.port.postMessage(pcm, [pcm.buffer])
      }
      if (content.inputTranscription?.text) userText += content.inputTranscription.text
      if (content.outputTranscription?.text) samairaText += content.outputTranscription.text
      if (content.inputTranscription?.text || content.outputTranscription?.text) callbacks.onCaption?.({ user: userText.trim(), samaira: samairaText.trim() })
      if (content.turnComplete) {
        generating = false
        flushTurn()
        if (goAwayPending) {
          clearTimeout(goAwayTimer)
          void reconnectOrFinish('The live session ended and could not be resumed. Start it again to continue.')
        }
      }
    }

    if (Array.isArray(message.toolCall?.functionCalls)) void handleToolCalls(message.toolCall.functionCalls)

    // The server is about to close the socket on its own terms; get ahead of it instead of waiting for onclose.
    if (message.goAway) onGoAway(message.goAway.timeLeft)
  }

  function connect(sess: LiveSession) {
    ready = false
    const previous = socket
    const mySocket = new WebSocket(`${LIVE_WS}?access_token=${encodeURIComponent(sess.token)}`)
    // Frames arrive as binary; decoding them synchronously keeps her audio strictly in the order it was sent.
    mySocket.binaryType = 'arraybuffer'
    socket = mySocket
    // The old connection (a goAway, or one that errored) is done; its late events are ignored below either way.
    if (previous && (previous.readyState === WebSocket.OPEN || previous.readyState === WebSocket.CONNECTING)) previous.close(1000)
    const stale = () => socket !== mySocket
    mySocket.onopen = () => {
      if (!stale()) send({ setup: sess.setup })
    }
    mySocket.onerror = gated(() => {
      if (!stale()) void reconnectOrFinish('The live connection failed. Please try again.')
    })
    mySocket.onclose = gated((event: CloseEvent) => {
      if (stopped || reconnecting || stale()) return
      // A clean close (1000) from the server side is a deliberate, quiet end -- not a drop to reconnect from.
      if (event.code === 1000) {
        finish()
        return
      }
      // Google's own close reason (e.g. "Internal error encountered", a known Live API server-side fault -- see
      // the reconnectOrFinish comment below) is debug information, not something to show the person; logged for
      // developers, but reconnectOrFinish always gets our own plain-language text as the user-visible fallback.
      if (event.reason) console.warn(`Live connection closed: ${event.code} ${event.reason}`)
      void reconnectOrFinish('The live connection closed. Please try again.')
    })
    mySocket.onmessage = gated((event: MessageEvent) => {
      if (stopped || stale()) return
      let message: Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any
      try {
        message = JSON.parse(typeof event.data === 'string' ? event.data : decoder.decode(event.data as ArrayBuffer))
      } catch {
        return
      }
      handleMessage(message)
    })
  }

  // The line and the microphone come up side by side: the handshake with Google overlaps the permission prompt and
  // audio start-up instead of waiting behind them.
  connect(session)
  try {
    audio = await openAudio()
  } catch (error) {
    stopped = true
    early = null
    socket?.close(1000)
    throw error
  }
  audio.capture.port.onmessage = (event: MessageEvent<{ pcm: Int16Array; level: number }>) => {
    if (stopped) return
    micLevel = event.data.level
    if (muted) return
    const chunk = pcm16ToBase64(event.data.pcm)
    if (ready) sendAudio(chunk)
    else if (!firstConnection) {
      // The call was up and the line is being re-established.
      heldSpeech.push(chunk)
      if (heldSpeech.length > RECONNECT_HOLD_CHUNKS) heldSpeech.shift()
    }
  }
  audio.player.port.onmessage = (event: MessageEvent<{ speaking?: boolean; level?: number }>) => {
    if (stopped) return
    if (typeof event.data.level === 'number') outLevel = event.data.level
    if (typeof event.data.speaking === 'boolean') {
      herVoiceAudible = event.data.speaking
      settleState()
    }
  }
  meter = requestAnimationFrame(measure)

  // Replay anything the socket did while the microphone was starting -- after this function has returned its
  // handle, so a connection that already failed ends the call through onState('ended') like any other failure.
  setTimeout(() => {
    const pending = early ?? []
    early = null
    for (const run of pending) run()
  }, 0)

  return {
    stop: () => finish(),
    sendText: (text) => send({ realtimeInput: { text } }),
    // The server cancels a reply still being generated when text arrives, but audio it already sent is buffered here.
    interrupt: (text) => {
      dropQueuedAudio()
      generating = false
      if (ready) setState('listening') // the audio thread confirms she's quiet a moment later, after the fade
      send({ realtimeInput: { text } })
    },
    setMuted: (value) => {
      if (muted === value) return
      muted = value
      // Tell the server the microphone went quiet, so a sentence cut off by muting is answered now rather than the
      // voice detector waiting for a silence that never arrives.
      if (value && ready) send({ realtimeInput: { audioStreamEnd: true } })
    },
  }
}
