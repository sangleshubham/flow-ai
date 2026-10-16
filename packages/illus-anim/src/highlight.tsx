import { useEffect, useRef, useState } from 'react'
import type { Evidence, FrameState } from '@illus/core'

/** Send the current step's evidence while enabled, clearing missing evidence and on unmount.
 * Callback identity changes do not resend an unchanged passage. */
export function useStepHighlight({
  evidence,
  enabled,
  onEvidenceHighlight,
}: {
  evidence: Evidence | undefined
  enabled: boolean
  onEvidenceHighlight?: (e: Evidence | null) => void
}): void {
  const callback = useRef(onEvidenceHighlight)
  const last = useRef<Evidence | null | undefined>(undefined)
  useEffect(() => {
    callback.current = onEvidenceHighlight
  }, [onEvidenceHighlight])
  useEffect(() => {
    const next = enabled ? evidence ?? null : null
    const previous = last.current
    const same =
      previous === next ||
      (previous &&
        next &&
        previous.blockId === next.blockId &&
        previous.quote === next.quote &&
        previous.start === next.start &&
        previous.end === next.end)
    if (same || !callback.current) return
    callback.current(next)
    last.current = next ? { ...next } : null
  }, [evidence, enabled, onEvidenceHighlight])
  useEffect(
    () => () => {
      callback.current?.(null)
      // React StrictMode replays mount effects after cleanup; restore the current passage then too.
      last.current = undefined
    },
    [],
  )
}

/** The shared passage-highlighting option for animation players. */
export function HighlightToggle({
  checked,
  onChange,
}: {
  checked: boolean
  onChange: (on: boolean) => void
}): JSX.Element {
  return (
    <label className="illus-player-option">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
      Highlight passage while playing
    </label>
  )
}

/** The option's value for a player: host-controlled when `onChange` is given, local (re-synced when
 * `value` changes) otherwise. */
export function useHighlightOption({
  value,
  onChange,
}: {
  value: boolean
  onChange?: (on: boolean) => void
}): { checked: boolean; onChange: (on: boolean) => void } {
  const [local, setLocal] = useState(value)
  useEffect(() => {
    setLocal(value)
  }, [value])
  return onChange
    ? { checked: value, onChange }
    : { checked: local, onChange: setLocal }
}

/** The live-region narration line shared by the players; clicking it hands the step's passage to the host. */
export function Narration({
  frame,
  onEvidenceClick,
}: {
  frame: Pick<FrameState, 'narration' | 'evidence'>
  onEvidenceClick?: (evidence: Evidence) => void
}): JSX.Element {
  return (
    <div className="illus-narration" aria-live="polite" aria-atomic="true">
      {frame.narration ? (
        <button
          type="button"
          onClick={() => frame.evidence && onEvidenceClick?.(frame.evidence)}
        >
          {frame.narration}
        </button>
      ) : (
        <span>Initial state</span>
      )}
    </div>
  )
}
