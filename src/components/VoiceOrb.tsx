import { Loader2 } from 'lucide-react'
import { useEffect, useRef } from 'react'
import type { LiveState } from '../lib/liveVoice'

export type OrbPhase = LiveState | 'off'
export type OrbLevels = { mic: number; out: number }

const REACHES = [1.42, 1.2]
const SIZES = {
  sm: { box: 'h-11 w-11', core: 'h-8 w-8', loader: 'h-4 w-4' },
  lg: { box: 'h-[76px] w-[76px] sm:h-[92px] sm:w-[92px]', core: 'h-[52px] w-[52px] sm:h-[62px] sm:w-[62px]', loader: 'h-6 w-6' },
} as const

/**
 * The voice: a living orb that moves with whoever is talking (the microphone when the person speaks, Samaira's own
 * voice when she does), so it is obvious at a glance who has the floor and that she can hear them. Loudness changes
 * every frame, so the orb animates itself straight from `levels` rather than through React state -- re-rendering
 * whatever it's embedded in that often would compete with the audio for the main thread. Shared by the wizard's
 * full interview dock and the landing-page assistant's voice mode, so Samaira looks the same wherever she's heard.
 */
export function VoiceOrb({ phase, levels, muted, size = 'lg' }: { phase: OrbPhase; levels: { current: OrbLevels }; muted: boolean; size?: keyof typeof SIZES }) {
  const speaking = phase === 'speaking'
  const halos = useRef<(HTMLSpanElement | null)[]>([])
  const coreRef = useRef<HTMLSpanElement>(null)
  const mode = useRef({ phase, muted })
  useEffect(() => {
    mode.current = { phase, muted }
  }, [phase, muted])

  useEffect(() => {
    if (typeof requestAnimationFrame === 'undefined') return
    let energy = 0
    let frame = 0
    const draw = () => {
      const { phase: now, muted: silenced } = mode.current
      const target = now === 'connecting' || now === 'off' ? 0 : now === 'speaking' ? levels.current.out : silenced ? 0 : levels.current.mic
      // Quick to rise, slower to fall: follows syllables without flickering between them.
      energy += (target - energy) * (target > energy ? 0.5 : 0.15)
      if (energy < 0.002) energy = 0
      REACHES.forEach((reach, index) => {
        const halo = halos.current[index]
        if (!halo) return
        halo.style.transform = `scale(${1 + energy * (reach - 1)})`
        halo.style.opacity = String((index === 0 ? 0.18 : 0.3) * (0.3 + energy))
      })
      const core = coreRef.current
      if (core) {
        core.style.transform = `scale(${1 + energy * 0.12})`
        // Breathes gently while it is listening to silence; set here (not via className) so React never overwrites it.
        core.dataset.quiet = String(now === 'listening' && energy < 0.06)
      }
      frame = requestAnimationFrame(draw)
    }
    frame = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(frame)
  }, [levels])

  const dims = SIZES[size]
  const core = muted
    ? 'bg-[radial-gradient(circle_at_30%_30%,#cbd5e1,#64748b_60%,#334155)]'
    : speaking
      ? 'bg-[radial-gradient(circle_at_30%_30%,#ffffff,#a5b4fc_50%,#5b6cff)]'
      : 'bg-[radial-gradient(circle_at_30%_30%,#ffc48a,#fe7f00_55%,#c25f00)]'
  return (
    <div className={`relative flex shrink-0 items-center justify-center ${dims.box}`} aria-hidden>
      {/* Halos start at the size of the orb and grow with the voice, but never past this box, so nothing is clipped. */}
      {REACHES.map((reach, index) => (
        <span
          key={reach}
          ref={(element) => {
            halos.current[index] = element
          }}
          className={`absolute rounded-full will-change-transform ${dims.core} ${speaking ? 'bg-indigo-300' : 'bg-brand-secondary'}`}
          style={{ opacity: index === 0 ? 0.054 : 0.09 }}
        />
      ))}
      <span
        ref={coreRef}
        className={`orb-core relative rounded-full shadow-[0_0_28px_rgba(254,127,0,0.45)] will-change-transform ${dims.core} ${core} ${phase === 'connecting' ? 'orb-connecting' : ''}`}
      />
      {phase === 'connecting' && <Loader2 className={`absolute animate-spin text-white/90 ${dims.loader}`} />}
    </div>
  )
}
