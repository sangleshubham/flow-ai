import { useEffect, useState } from 'react'
import type { KeyboardEvent } from 'react'

export interface PlaybackControlsProps {
  count: number
  index: number
  onIndex: (index: number) => void
  playing: boolean
  onPlaying: (playing: boolean) => void
  speed: number
  onSpeed: (speed: number) => void
  loop: boolean
  onLoop: (loop: boolean) => void
}

export function playbackKey(
  event: KeyboardEvent,
  props: Pick<
    PlaybackControlsProps,
    'count' | 'index' | 'onIndex' | 'playing' | 'onPlaying'
  >,
) {
  const el = event.target as HTMLElement
  if (
    ['INPUT', 'SELECT', 'TEXTAREA', 'BUTTON'].includes(el.tagName) ||
    el.isContentEditable ||
    event.altKey ||
    event.ctrlKey ||
    event.metaKey
  )
    return
  if (![' ', 'ArrowLeft', 'ArrowRight', 'Home'].includes(event.key)) return
  event.preventDefault()
  event.stopPropagation()
  if (event.key === ' ') props.onPlaying(!props.playing)
  else {
    props.onPlaying(false)
    props.onIndex(
      event.key === 'Home'
        ? 0
        : Math.max(
            0,
            Math.min(
              props.count - 1,
              props.index + (event.key === 'ArrowRight' ? 1 : -1),
            ),
          ),
    )
  }
}

/** A glyph for sighted readers; the label stays the button's text (hidden by `.illus-sr` when styled). */
function Icon({ glyph, label }: { glyph: string; label: string }) {
  return (
    <>
      <span aria-hidden="true" className="illus-glyph-icon">
        {glyph}
      </span>
      <span className="illus-sr">{label}</span>
    </>
  )
}

/** Evidence-independent controlled transport; usable for executed traces too. */
export function PlaybackControls(p: PlaybackControlsProps) {
  const step = (index: number) => {
    p.onPlaying(false)
    p.onIndex(index)
  }
  return (
    <div
      className="illus-transport"
      role="group"
      aria-label="Playback controls"
      onKeyDown={(e) => playbackKey(e, p)}
    >
      <button type="button" onClick={() => step(0)}>
        <Icon glyph="⟲" label="Restart" />
      </button>
      <button
        type="button"
        aria-label="Previous step"
        disabled={p.index === 0}
        onClick={() => step(p.index - 1)}
      >
        ←
      </button>
      <button
        type="button"
        className="illus-transport-play"
        disabled={p.count < 2}
        onClick={() => {
          if (!p.playing && p.index >= p.count - 1) p.onIndex(0)
          p.onPlaying(!p.playing)
        }}
      >
        {p.playing ? (
          <Icon glyph="❚❚" label="Pause" />
        ) : (
          <Icon glyph="▶" label="Play" />
        )}
      </button>
      <button
        type="button"
        aria-label="Next step"
        disabled={p.index >= p.count - 1}
        onClick={() => step(p.index + 1)}
      >
        →
      </button>
      <input
        aria-label="Animation step"
        type="range"
        min={0}
        max={Math.max(0, p.count - 1)}
        value={p.index}
        onChange={(e) => step(Number(e.target.value))}
      />
      <output aria-label="Step number">
        {p.index}/{Math.max(0, p.count - 1)}
      </output>
      <select
        aria-label="Playback speed"
        value={p.speed}
        onChange={(e) => p.onSpeed(Number(e.target.value))}
      >
        {[0.5, 1, 1.5, 2].map((s) => (
          <option key={s} value={s}>
            {s}×
          </option>
        ))}
      </select>
      <label>
        <input
          type="checkbox"
          checked={p.loop}
          onChange={(e) => p.onLoop(e.target.checked)}
        />
        Loop
      </label>
    </div>
  )
}

export function usePlayback({
  count,
  index,
  onIndex,
  delayMs = 1500,
  initialSpeed = 1,
}: {
  count: number
  index: number
  onIndex: (index: number) => void
  delayMs?: number
  initialSpeed?: number
}) {
  const [playing, setPlaying] = useState(false)
  const validSpeed = (value: number) =>
    [0.5, 1, 1.5, 2].includes(value) ? value : 1
  const [speed, setSpeed] = useState(() => validSpeed(initialSpeed))
  const [loop, setLoop] = useState(false)
  useEffect(() => {
    setSpeed(validSpeed(initialSpeed))
  }, [initialSpeed])
  useEffect(() => {
    if (!playing || count < 2) return
    if (index >= count - 1 && !loop) {
      setPlaying(false)
      return
    }
    const timer = setTimeout(
      () => onIndex(index >= count - 1 ? 0 : index + 1),
      delayMs / speed,
    )
    return () => clearTimeout(timer)
  }, [playing, index, count, loop, speed, delayMs, onIndex])
  return { playing, setPlaying, speed, setSpeed, loop, setLoop }
}
