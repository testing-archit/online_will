import { describe, expect, it } from 'vitest'
import { base64ToPcm16, floatToPcm16, pcm16ToBase64, pcm16ToFloat, resample } from './liveVoice'

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

  it('resamples 48 kHz to 16 kHz by averaging, keeping a tone at the same length in seconds', () => {
    const input = new Float32Array(4_800).fill(0.5)
    const output = resample(input, 48_000, 16_000)
    expect(output.length).toBe(1_600)
    expect(output.every((value) => Math.abs(value - 0.5) < 1e-6)).toBe(true)
    expect(resample(input, 16_000, 16_000)).toBe(input)
  })

  it('ignores a stray odd byte instead of throwing', () => {
    expect(base64ToPcm16(btoa('\u0001\u0000\u0002')).length).toBe(1)
  })
})
