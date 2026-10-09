// Shared chrome (§10): header badges and footer legend and actions.
import { VisualKind } from '@illus/core'
import type { IR } from '@illus/core'

import type { VisualActions } from './types.ts'

export function kindLabel(ir: IR): string {
  return ir.type === 'template' ? ir.templateId : ir.type
}

export function Header({ title, ir, groundingScore }: { title: string; ir: IR; groundingScore?: number | undefined }) {
  return (
    <div className="illus-header">
      <h3 className="illus-title" title={title}>
        {title}
      </h3>
      <span className="illus-badge" data-badge="kind">
        {kindLabel(ir)}
      </span>
      {groundingScore !== undefined && ir.type !== 'html' && (
        <span className="illus-badge" data-badge="grounding" title="Share of elements whose evidence was found in the book">
          {Math.round(groundingScore * 100)}% grounded
        </span>
      )}
      {ir.type === 'timeline' && (
        <span className="illus-badge illus-badge-warn" data-badge="simulated" title="A simulated ordering, not an execution">
          simulated
        </span>
      )}
      {ir.type === 'html' && (
        <span className="illus-badge illus-badge-warn" data-badge="unverified" title="Generated HTML without evidence links">
          unverified
        </span>
      )}
    </div>
  )
}

export interface FooterProps {
  legend: boolean
  actions?: VisualActions | undefined
  onExportSvg?: (() => void) | undefined
  onExportPng?: (() => void) | undefined
  kind: VisualKind
}

export function Footer({ legend, actions = {}, onExportSvg, onExportPng, kind }: FooterProps) {
  const kinds = actions.kinds ?? VisualKind.options
  return (
    <div className="illus-footer">
      {legend && (
        <span className="illus-legend" data-legend="">
          <span>
            <span className="illus-swatch" style={{ background: 'var(--illus-new)' }} />
            New in this section
          </span>
          <span>
            <span className="illus-swatch" style={{ background: 'var(--illus-earlier)' }} />
            From earlier
          </span>
        </span>
      )}
      <span className="illus-actions">
        {actions.onShowEvidence && (
          <button type="button" className="illus-btn" onClick={actions.onShowEvidence}>
            Evidence
          </button>
        )}
        {actions.onRegenerate && (
          <button type="button" className="illus-btn" onClick={actions.onRegenerate}>
            Regenerate
          </button>
        )}
        {actions.onKindOverride && (
          <select
            className="illus-select"
            aria-label="Draw as another kind"
            value={kind}
            onChange={(e) => actions.onKindOverride!(e.target.value as VisualKind)}
          >
            {kinds.map((k) => (
              <option key={k} value={k}>
                {k}
              </option>
            ))}
          </select>
        )}
        {onExportSvg && (
          <button type="button" className="illus-btn" onClick={onExportSvg}>
            SVG
          </button>
        )}
        {onExportPng && (
          <button type="button" className="illus-btn" onClick={onExportPng}>
            PNG
          </button>
        )}
        {actions.onVote && (
          <>
            <button type="button" className="illus-btn" aria-label="Helpful" aria-pressed={actions.vote === 'up'} onClick={() => actions.onVote!('up')}>
              Helpful
            </button>
            <button type="button" className="illus-btn" aria-label="Not helpful" aria-pressed={actions.vote === 'down'} onClick={() => actions.onVote!('down')}>
              Not helpful
            </button>
          </>
        )}
      </span>
    </div>
  )
}
