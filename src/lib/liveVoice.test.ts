import { describe, expect, it, vi } from 'vitest'
import { base64ToPcm16, durationMs, floatToPcm16, PcmPlaybackQueue, pcm16ToBase64, pcm16ToFloat, StreamDownsampler } from './liveVoice'

describe('live voice audio helpers', () => {
  it('round-trips PCM16 through base64 without loss', () => {
    const pcm = Int16Array.from([0, 1, -1, 12345, -12345, 32767, -32768])
    expect([...base64ToPcm16(pcm16ToBase64(pcm))]).toEqual([...pcm])
  })

  it('handles audio longer than one base64 slice', () => {
    const pcm = new Int16Array(50_000).map((_, index) => (index * 7) % 30_000)
    expect(base64ToPcm16(pcm16ToBase64(pcm)).length).toBe(pcm.length)
  })

  it('clamps and scales float samples to PCM16 and back', () => {
    expect([...floatToPcm16(Float32Array.from([0, 1, -1, 2, -2]))]).toEqual([0, 32767, -32768, 32767, -32768])
    const back = pcm16ToFloat(floatToPcm16(Float32Array.from([0.5, -0.25])))
    expect(back[0]).toBeCloseTo(0.5, 3)
    expect(back[1]).toBeCloseTo(-0.25, 3)
  })

  it('downsamples 48 kHz to 16 kHz by averaging, across block boundaries, keeping a tone at the same length in seconds', () => {
    const down = new StreamDownsampler(48_000, 16_000)
    const output: number[] = []
    for (let block = 0; block < 37; block += 1) down.push(new Float32Array(128).fill(0.5), (value) => output.push(value))
    expect(output.length).toBe(Math.floor((37 * 128) / 3))
    expect(output.every((value) => Math.abs(value - 0.5) < 1e-6)).toBe(true)
  })

  it('keeps a fractional ratio (44.1 kHz) seamless: the output count tracks elapsed time exactly', () => {
    const down = new StreamDownsampler(44_100, 16_000)
    let count = 0
    for (let block = 0; block < 1_000; block += 1) down.push(new Float32Array(128), () => (count += 1))
    expect(Math.abs(count - (1_000 * 128 * 16_000) / 44_100)).toBeLessThanOrEqual(1)
  })

  it('ignores a stray odd byte instead of throwing', () => {
    expect(base64ToPcm16(btoa('\u0001\u0000\u0002')).length).toBe(1)
  })
})

describe('live voice playback buffer', () => {
  const block = () => new Float32Array(10)
  const chunk = (length: number, value = 16_384) => new Int16Array(length).fill(value)

  it('holds a cushion before starting, then plays continuously', () => {
    const queue = new PcmPlaybackQueue(30, 1)
    queue.push(chunk(20))
    const out = block()
    queue.fill(out)
    expect(queue.playing).toBe(false)
    expect([...out].every((value) => value === 0)).toBe(true)
    queue.push(chunk(20))
    queue.fill(out)
    expect(queue.playing).toBe(true)
    expect(out[5]).toBeCloseTo(0.5, 3)
  })

  it('still plays a short last word once it has waited as long as the cushion', () => {
    const queue = new PcmPlaybackQueue(30, 1)
    queue.push(chunk(5))
    const out = block()
    for (let index = 0; index < 3; index += 1) queue.fill(out)
    expect(queue.buffered).toBe(0)
    expect(out[0]).toBe(0) // the fade-in starts from silence
    expect(out[1]).toBeGreaterThan(0)
    expect(out[5]).toBe(0)
  })

  it('fades out and drops everything when cleared mid-word', () => {
    const queue = new PcmPlaybackQueue(0, 4)
    queue.push(chunk(100))
    const out = block()
    queue.fill(out)
    queue.clear()
    queue.fill(out)
    expect(out[0]).toBeGreaterThan(out[2])
    expect(out[4]).toBe(0)
    expect(queue.buffered).toBe(0)
    expect(queue.playing).toBe(false)
  })

  it('reads a protobuf duration', () => {
    expect(durationMs('12s')).toBe(12_000)
    expect(durationMs('0.5s')).toBe(500)
    expect(durationMs(undefined)).toBeUndefined()
    expect(durationMs('soon')).toBeUndefined()
  })
})

describe('live voice audio worklet', () => {
  it('builds a worklet whose embedded classes run: the mic becomes 40 ms PCM chunks, and her voice plays back', async () => {
    const source = await captureWorkletSource()
    const processors: Record<string, new (options: unknown) => { port: { postMessage: (...args: unknown[]) => void; onmessage?: (event: { data: unknown }) => void }; process: (inputs: Float32Array[][], outputs: Float32Array[][]) => boolean }> = {}
    const posted: unknown[] = []
    class AudioWorkletProcessor {
      port = { postMessage: (message: unknown) => posted.push(message), onmessage: undefined as ((event: { data: unknown }) => void) | undefined }
    }
    new Function('AudioWorkletProcessor', 'registerProcessor', 'sampleRate', source)(AudioWorkletProcessor, (name: string, processor: never) => (processors[name] = processor), 48_000)

    const capture = new processors['live-capture']({ processorOptions: { targetRate: 16_000, chunkSamples: 640 } })
    for (let index = 0; index < 15; index += 1) capture.process([[new Float32Array(128).fill(0.25)]], [])
    const chunk = posted.find((message) => (message as { pcm?: Int16Array }).pcm) as { pcm: Int16Array; level: number }
    expect(chunk.pcm.length).toBe(640)
    expect(chunk.pcm[0]).toBe(Math.trunc(0.25 * 0x7fff)) // Int16Array truncates toward zero
    expect(chunk.level).toBeGreaterThan(0)

    posted.length = 0
    const player = new processors['live-player']({ processorOptions: { prebufferMs: 0, holdMs: 10, fadeMs: 1 } })
    player.port.onmessage!({ data: new Int16Array(4_800).fill(8_192) })
    const out = new Float32Array(128)
    player.process([], [[out]])
    expect(posted).toContainEqual({ speaking: true })
    expect(out[127]).toBeCloseTo(0.25, 3)
  })
})

/** The worklet source, as the browser would load it (the Blob handed to addModule). */
async function captureWorkletSource(): Promise<string> {
  const { startLiveConversation } = await import('./liveVoice')
  let source = ''
  const realBlob = globalThis.Blob
  const stub = class extends realBlob {
    constructor(parts: BlobPart[], options?: BlobPropertyBag) {
      super(parts, options)
      source = String(parts[0])
    }
  }
  Object.assign(globalThis, { Blob: stub })
  const stop = new Error('stop after building the worklet')
  Object.assign(globalThis, {
    WebSocket: Object.assign(class { binaryType = ''; readyState = 0; close() {} }, { OPEN: 1, CONNECTING: 0 }),
    AudioContext: class {
      sampleRate = 48_000
      audioWorklet = { addModule: () => Promise.reject(stop) }
      resume = () => Promise.resolve()
      close = () => Promise.resolve()
    },
  })
  Object.defineProperty(globalThis.navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: async () => ({ getTracks: () => [] }) } })
  URL.createObjectURL ??= () => 'blob:x'
  URL.revokeObjectURL ??= () => {}
  try {
    await startLiveConversation({ token: 't', setup: {} }, { onState: () => {}, onLevel: () => {}, onTurn: () => {}, onToolCall: () => ({}), onError: () => {} }).catch((error) => {
      if (error !== stop) throw error
    })
  } finally {
    Object.assign(globalThis, { Blob: realBlob })
  }
  return source
}

/** A node whose `.connect()` chains indefinitely, however many `.connect(x)` calls are stacked. */
function chainable(): { connect: () => ReturnType<typeof chainable> } {
  const node: { connect: () => ReturnType<typeof chainable> } = { connect: () => node }
  return node
}

describe('live voice reconnects', () => {
  interface FakeSocket {
    url: string
    readyState: number
    sent: unknown[]
    onopen: (() => void) | null
    onclose: ((event: { code: number; reason: string }) => void) | null
    onmessage: ((event: { data: string }) => void) | null
    onerror: (() => void) | null
    close: () => void
    send: (data: string) => void
  }

  /** Stubs just enough of the browser (WebSocket, AudioContext/AudioWorkletNode, getUserMedia) for
   * startLiveConversation to run for real, and returns `opened()` to drive a socket through its lifecycle. */
  function setupFakeLiveEnvironment() {
    class FakeAudioWorkletNode {
      port = { postMessage: () => {}, onmessage: null as unknown }
      connect() {
        return this
      }
      disconnect() {}
    }
    class FakeAudioContext {
      sampleRate = 48_000
      audioWorklet = { addModule: () => Promise.resolve() }
      resume = () => Promise.resolve()
      close = () => Promise.resolve()
      createMediaStreamSource() {
        return chainable()
      }
      createGain() {
        return { gain: { value: 0 }, ...chainable() }
      }
    }
    const sockets: FakeSocket[] = []
    class FakeWebSocket {
      static OPEN = 1
      static CONNECTING = 0
      binaryType = ''
      readyState = FakeWebSocket.CONNECTING
      onopen: (() => void) | null = null
      onclose: ((event: { code: number; reason: string }) => void) | null = null
      onmessage: ((event: { data: string }) => void) | null = null
      onerror: (() => void) | null = null
      sent: unknown[] = []
      url: string
      constructor(url: string) {
        this.url = url
        sockets.push(this as unknown as FakeSocket)
      }
      send(data: string) {
        this.sent.push(JSON.parse(data))
      }
      close() {
        this.readyState = 3
      }
    }
    Object.assign(globalThis, { WebSocket: FakeWebSocket, AudioContext: FakeAudioContext, AudioWorkletNode: FakeAudioWorkletNode })
    Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { mediaDevices: { getUserMedia: async () => ({ getTracks: () => [{ stop: () => {} }] }) } } })
    Object.assign(globalThis, {
      requestAnimationFrame: () => 0,
      cancelAnimationFrame: () => {},
      URL: Object.assign(globalThis.URL, { createObjectURL: () => 'blob:x', revokeObjectURL: () => {} }),
    })

    const opened = (token: string) => {
      const socket = sockets[sockets.length - 1]
      socket.readyState = FakeWebSocket.OPEN
      socket.onopen?.()
      socket.onmessage?.({ data: JSON.stringify({ setupComplete: true }) })
      expect(socket.url).toContain(`access_token=${token}`)
      return socket
    }
    return { opened }
  }

  it('resumes with the handle on the first reconnect attempt, but drops it on later attempts (a known Gemini Live failure mode is a handle that keeps failing on every resume with it)', async () => {
    const { startLiveConversation } = await import('./liveVoice')
    const { opened } = setupFakeLiveEnvironment()
    const remint = vi.fn(async (resumeHandle: string | undefined) => ({ token: resumeHandle ? `resumed-${resumeHandle}` : 'fresh-token', setup: {} }))

    await startLiveConversation(
      { token: 'first-token', setup: {} },
      { onState: () => {}, onLevel: () => {}, onOutputLevel: () => {}, onTurn: () => {}, onToolCall: () => ({}), onError: () => {} },
      { remint },
    )

    // First connection opens, then Google sends a resumption handle and later drops the socket with a 1011-style
    // non-clean close -- this is the exact scenario the fix targets.
    let socket = opened('first-token')
    socket.onmessage?.({ data: JSON.stringify({ sessionResumptionUpdate: { resumable: true, newHandle: 'handle-A' } }) })
    socket.onclose?.({ code: 1011, reason: 'Internal error encountered.' })
    await vi.waitFor(() => expect(remint).toHaveBeenCalledTimes(1))
    expect(remint).toHaveBeenNthCalledWith(1, 'handle-A') // attempt 1: resume with the handle

    // That resume also fails the same way (the "poisoned handle" failure mode) -- attempt 2 must NOT reuse it.
    socket = opened('resumed-handle-A')
    socket.onclose?.({ code: 1011, reason: 'Internal error encountered.' })
    await vi.waitFor(() => expect(remint).toHaveBeenCalledTimes(2))
    expect(remint).toHaveBeenNthCalledWith(2, undefined) // attempt 2: fresh session, handle dropped

    socket = opened('fresh-token')
    expect(socket.sent).toContainEqual({ setup: {} })
  })

  it('gives a genuinely healthy reconnect (stayed up a while before an unrelated later drop) a fresh attempt at the handle, rather than treating it as part of the same failing streak', async () => {
    vi.useFakeTimers()
    try {
      const { startLiveConversation } = await import('./liveVoice')
      const { opened } = setupFakeLiveEnvironment()
      const remint = vi.fn(async (resumeHandle: string | undefined) => ({ token: resumeHandle ? `resumed-${resumeHandle}` : 'fresh-token', setup: {} }))

      await startLiveConversation(
        { token: 'first-token', setup: {} },
        { onState: () => {}, onLevel: () => {}, onOutputLevel: () => {}, onTurn: () => {}, onToolCall: () => ({}), onError: () => {} },
        { remint },
      )

      let socket = opened('first-token')
      socket.onmessage?.({ data: JSON.stringify({ sessionResumptionUpdate: { resumable: true, newHandle: 'handle-A' } }) })
      socket.onclose?.({ code: 1011, reason: 'blip' })
      await vi.waitFor(() => expect(remint).toHaveBeenCalledTimes(1))
      expect(remint).toHaveBeenNthCalledWith(1, 'handle-A')

      // This reconnect succeeds and stays up well past the stability window -- an ordinary, unrelated network drop
      // later on should get its own fresh budget and try the (now presumably fine) handle again, not inherit the
      // earlier failure's streak.
      socket = opened('resumed-handle-A')
      socket.onmessage?.({ data: JSON.stringify({ sessionResumptionUpdate: { resumable: true, newHandle: 'handle-B' } }) })
      await vi.advanceTimersByTimeAsync(6_000)
      socket.onclose?.({ code: 1006, reason: 'network blip' })
      await vi.waitFor(() => expect(remint).toHaveBeenCalledTimes(2))
      expect(remint).toHaveBeenNthCalledWith(2, 'handle-B') // fresh streak: the handle is tried again, not skipped
    } finally {
      vi.useRealTimers()
    }
  })
})
