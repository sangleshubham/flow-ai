import { useEffect, useRef } from 'react'
import type { Evidence } from '@illus/core'

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
