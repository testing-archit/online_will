/**
 * Live voice: a real-time, audio-in / audio-out conversation with Gemini Live, opened straight from the browser with a
 * single-use token the server minted (the API key never reaches the browser, and the model, voice, tool and
 * instructions are locked into that token). Spoken in whatever language the person uses, or the one they pin.
 *
 * Audio in: microphone → 16 kHz 16-bit PCM, streamed in ~40 ms chunks. Audio out: 24 kHz PCM, scheduled back to back.
 * When the person starts talking over her, the server says `interrupted` and whatever is still queued is dropped.
 *
 * Google hard-disconnects an audio-only session at 15 minutes and also drops the connection on ordinary network
 * hiccups; without help every drop would end the call and lose the conversation. Session resumption avoids that:
 * the server hands back a resumption handle as the call goes on, and on an unexpected drop this reconnects with
 * that handle instead of ending the call -- the person never has to restart. A clean, person-initiated stop() never
 * reconnects. https://ai.google.dev/gemini-api/docs/live-session
 */

const LIVE_WS = 'wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContentConstrained'
const INPUT_RATE = 16_000
const OUTPUT_RATE = 24_000
const SEND_SAMPLES = 640 // 40 ms of 16 kHz audio -- Google's recommended range is 20-40 ms; smaller chunks cut latency

export type LiveState = 'connecting' | 'listening' | 'speaking' | 'ended'

export interface LiveSession {
  token: string
  setup: Record<string, unknown>
}

export interface LiveCallbacks {
  onState: (state: LiveState) => void
  /** Microphone loudness, 0 to 1 (what the person is saying). */
  onLevel: (level: number) => void
  /** Her voice's loudness, 0 to 1, so the screen can move with what she is saying. */
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

/** Linear resample by averaging (down) or interpolating (up); good enough for speech. */
export function resample(input: Float32Array, fromRate: number, toRate: number): Float32Array {
  if (fromRate === toRate || input.length === 0) return input
  const ratio = fromRate / toRate
  const length = Math.max(1, Math.floor(input.length / ratio))
  const output = new Float32Array(length)
  for (let index = 0; index < length; index += 1) {
    const start = index * ratio
    const end = Math.min(input.length, (index + 1) * ratio)
    if (ratio > 1) {
      let sum = 0
      let count = 0
      for (let position = Math.floor(start); position < Math.ceil(end); position += 1) {
        sum += input[position]
        count += 1
      }
      output[index] = count ? sum / count : 0
    } else {
      const position = Math.floor(start)
      const next = Math.min(input.length - 1, position + 1)
      output[index] = input[position] + (input[next] - input[position]) * (start - position)
    }
  }
  return output
}

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

const CAPTURE_WORKLET = `
class Capture extends AudioWorkletProcessor {
  process(inputs) {
    const channel = inputs[0] && inputs[0][0]
    if (channel) this.port.postMessage(channel.slice())
    return true
  }
}
registerProcessor('live-capture', Capture)
`

export function isLiveSupported(): boolean {
  return typeof WebSocket !== 'undefined' && typeof AudioContext !== 'undefined' && typeof AudioWorkletNode !== 'undefined' && Boolean(navigator.mediaDevices?.getUserMedia)
}

// ---------------------------------------------------------------- the conversation

export async function startLiveConversation(session: LiveSession, callbacks: LiveCallbacks, options: LiveStartOptions = {}): Promise<LiveHandle> {
  callbacks.onState('connecting')

  const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 } })
  const inputContext = new AudioContext()
  const outputContext = new AudioContext({ sampleRate: OUTPUT_RATE })
  await Promise.all([inputContext.resume(), outputContext.resume()])
  const workletUrl = URL.createObjectURL(new Blob([CAPTURE_WORKLET], { type: 'application/javascript' }))
  await inputContext.audioWorklet.addModule(workletUrl)
  URL.revokeObjectURL(workletUrl)

  let stopped = false
  let ready = false
  let muted = false
  let userText = ''
  let samairaText = ''
  let nextStart = 0
  let sources: AudioBufferSourceNode[] = []
  let pending = new Float32Array(0)
  let currentState: LiveState = 'connecting'
  let socket: WebSocket
  let firstConnection = true
  let reconnecting = false
  let resumeHandle: string | undefined

  const setState = (state: LiveState) => {
    if (currentState === state) return
    currentState = state
    callbacks.onState(state)
  }

  const send = (message: unknown) => {
    if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message))
  }

  // Microphone → PCM16 @ 16 kHz → server.
  const source = inputContext.createMediaStreamSource(stream)
  const capture = new AudioWorkletNode(inputContext, 'live-capture')
  const mute = inputContext.createGain()
  mute.gain.value = 0 // keeps the graph running without playing the microphone back
  source.connect(capture).connect(mute).connect(inputContext.destination)
  capture.port.onmessage = (event: MessageEvent<Float32Array>) => {
    if (stopped || !ready) return
    const block = event.data
    if (muted) {
      callbacks.onLevel(0)
      return
    }
    let energy = 0
    for (let index = 0; index < block.length; index += 1) energy += block[index] * block[index]
    callbacks.onLevel(Math.min(1, Math.sqrt(energy / block.length) * 6))

    const merged = new Float32Array(pending.length + block.length)
    merged.set(pending)
    merged.set(block, pending.length)
    const converted = resample(merged, inputContext.sampleRate, INPUT_RATE)
    let offset = 0
    while (converted.length - offset >= SEND_SAMPLES) {
      const chunk = converted.subarray(offset, offset + SEND_SAMPLES)
      send({ realtimeInput: { audio: { data: pcm16ToBase64(floatToPcm16(chunk)), mimeType: `audio/pcm;rate=${INPUT_RATE}` } } })
      offset += SEND_SAMPLES
    }
    // Keep the unsent tail (in input-rate samples) for the next block.
    const keep = Math.round(((converted.length - offset) * inputContext.sampleRate) / INPUT_RATE)
    pending = merged.slice(Math.max(0, merged.length - keep))
  }

  const dropQueuedAudio = () => {
    for (const node of sources) {
      node.onended = null
      try {
        node.stop()
      } catch {
        // already finished
      }
    }
    sources = []
    nextStart = 0
  }

  // How loud she is right now, for the screen to move with her voice.
  const analyser = outputContext.createAnalyser()
  analyser.fftSize = 512
  analyser.connect(outputContext.destination)
  const samples = new Uint8Array(analyser.fftSize)
  let meter = 0
  const measure = () => {
    if (stopped) return
    analyser.getByteTimeDomainData(samples)
    let energy = 0
    for (const value of samples) energy += ((value - 128) / 128) ** 2
    callbacks.onOutputLevel?.(sources.length ? Math.min(1, Math.sqrt(energy / samples.length) * 5) : 0)
    meter = requestAnimationFrame(measure)
  }
  meter = requestAnimationFrame(measure)

  const playChunk = (base64: string) => {
    const samples = pcm16ToFloat(base64ToPcm16(base64))
    if (!samples.length) return
    const buffer = outputContext.createBuffer(1, samples.length, OUTPUT_RATE)
    buffer.copyToChannel(new Float32Array(samples), 0)
    const node = outputContext.createBufferSource()
    node.buffer = buffer
    node.connect(analyser)
    const start = Math.max(outputContext.currentTime + 0.02, nextStart)
    node.start(start)
    nextStart = start + buffer.duration
    sources.push(node)
    setState('speaking')
    node.onended = () => {
      sources = sources.filter((item) => item !== node)
      if (sources.length === 0 && !stopped) setState('listening')
    }
  }

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
    cancelAnimationFrame(meter)
    callbacks.onOutputLevel?.(0)
    flushTurn()
    dropQueuedAudio()
    try {
      capture.port.onmessage = null
      source.disconnect()
      capture.disconnect()
    } catch {
      // already disconnected
    }
    stream.getTracks().forEach((track) => track.stop())
    void inputContext.close().catch(() => {})
    void outputContext.close().catch(() => {})
    if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) socket.close(1000)
    if (error) callbacks.onError(error)
    setState('ended')
  }

  /**
   * A drop that wasn't `stop()` calling this. Every attempt needs a fresh session (a new resumption handle can only
   * be used once), so this re-mints one through the caller rather than just re-opening the same socket. One attempt
   * per drop: if it also fails, that failure comes back around to here again and finish()es instead of looping.
   */
  const reconnectOrFinish = async (fallbackError: string) => {
    if (stopped || reconnecting) return
    if (!options.remint) {
      finish(fallbackError)
      return
    }
    reconnecting = true
    setState('connecting')
    dropQueuedAudio()
    flushTurn() // the turn in progress was cut off mid-air; nothing more of it is coming
    try {
      const next = await options.remint(resumeHandle)
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

  function connect(sess: LiveSession) {
    ready = false
    const mySocket = new WebSocket(`${LIVE_WS}?access_token=${encodeURIComponent(sess.token)}`)
    socket = mySocket
    // A reconnect leaves the previous socket's listeners attached; without this check, a stale event arriving
    // after `socket` has already moved on to a newer connection could fire finish()/reconnectOrFinish() again.
    const stale = () => socket !== mySocket
    mySocket.onopen = () => {
      if (!stale()) send({ setup: sess.setup })
    }
    mySocket.onerror = () => {
      if (!stale()) void reconnectOrFinish('The live connection failed. Please try again.')
    }
    mySocket.onclose = (event) => {
      if (stopped || reconnecting || stale()) return
      // A clean close (1000) from the server side is a deliberate, quiet end -- not a drop to reconnect from.
      if (event.code === 1000) {
        finish()
        return
      }
      void reconnectOrFinish(event.reason || 'The live connection closed.')
    }
    mySocket.onmessage = async (event) => {
      if (stopped || stale()) return
      let message: Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any
      try {
        message = JSON.parse(typeof event.data === 'string' ? event.data : await (event.data as Blob).text())
      } catch {
        return
      }

      if (message.setupComplete) {
        ready = true
        setState('listening')
        // She opens the conversation herself, but only the very first time -- a reconnect picks the call back up mid-flow.
        if (firstConnection && options.greeting) send({ realtimeInput: { text: options.greeting } })
        firstConnection = false
        return
      }

      if (message.sessionResumptionUpdate?.resumable && message.sessionResumptionUpdate?.newHandle) {
        resumeHandle = message.sessionResumptionUpdate.newHandle
      }

      const content = message.serverContent
      if (content) {
        if (content.interrupted) dropQueuedAudio()
        for (const part of content.modelTurn?.parts ?? []) if (part.inlineData?.data) playChunk(part.inlineData.data)
        if (content.inputTranscription?.text) userText += content.inputTranscription.text
        if (content.outputTranscription?.text) samairaText += content.outputTranscription.text
        if (content.inputTranscription?.text || content.outputTranscription?.text) callbacks.onCaption?.({ user: userText.trim(), samaira: samairaText.trim() })
        if (content.turnComplete) flushTurn()
      }

      if (message.toolCall?.functionCalls) {
        const responses = []
        for (const call of message.toolCall.functionCalls as { id: string; name: string; args?: Record<string, unknown> }[]) {
          let response: Record<string, unknown>
          try {
            response = await callbacks.onToolCall(call.name, call.args ?? {}, userText.trim())
          } catch {
            response = { error: 'That could not be recorded.' }
          }
          responses.push({ id: call.id, name: call.name, response })
        }
        send({ toolResponse: { functionResponses: responses } })
      }

      // The server is about to close the socket on its own terms; get ahead of it instead of waiting for onclose.
      if (message.goAway) void reconnectOrFinish('The live session ended and could not be resumed. Start it again to continue.')
    }
  }

  connect(session)

  return {
    stop: () => finish(),
    sendText: (text) => send({ realtimeInput: { text } }),
    // The server cancels a reply still being generated when text arrives, but audio it already sent is queued here.
    interrupt: (text) => {
      dropQueuedAudio()
      setState('listening')
      send({ realtimeInput: { text } })
    },
    setMuted: (value) => {
      muted = value
      if (value) callbacks.onLevel(0)
    },
  }
}
