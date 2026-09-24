// Shared chrome (§10): header badges and footer legend and actions; the compact toolbar (ADR 0048).
import { VisualKind } from '@illus/core'
import type { IR } from '@illus/core'
import { useEffect, useRef } from 'react'
import type { ReactNode } from 'react'

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

export function Legend() {
  return (
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
  )
}

export interface ToolbarProps {
  ir: IR
  groundingScore?: number | undefined
  actions?: VisualActions | undefined
  onExportSvg?: (() => void) | undefined
  onExportPng?: (() => void) | undefined
}

/**
 * Compact chrome (ADR 0048): an overlay with Expand and a "More actions" menu, so the diagram gets the
 * space. Warning badges stay visible; everything else is one click away.
 */
export function Toolbar({ ir, groundingScore, actions = {}, onExportSvg, onExportPng }: ToolbarProps) {
  const kinds = actions.kinds ?? VisualKind.options
  const menu = useRef<HTMLDetailsElement>(null)
  useEffect(() => {
    const close = (e: PointerEvent) => {
      if (menu.current?.open && !menu.current.contains(e.target as Node)) menu.current.open = false
    }
    document.addEventListener('pointerdown', close)
    return () => document.removeEventListener('pointerdown', close)
  }, [])
  const item = (label: string, onClick: () => void, pressed?: boolean): ReactNode => (
    <button type="button" className="illus-menu-item" role="menuitem" aria-pressed={pressed} onClick={onClick}>
      {label}
    </button>
  )
  return (
    <div className="illus-toolbar">
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
      {actions.onExpand && (
        <button
          type="button"
          className="illus-btn illus-icon-btn"
          aria-label={actions.expanded ? 'Close large view' : 'Open large view'}
          aria-pressed={!!actions.expanded}
          onClick={actions.onExpand}
        >
          {actions.expanded ? '✕' : '⤢'}
        </button>
      )}
      <details
        ref={menu}
        className="illus-menu"
        onClick={(e) => {
          // A chosen item closes the menu; the summary toggles it natively.
          if ((e.target as Element).closest('.illus-menu-panel button') && menu.current) menu.current.open = false
        }}
        onKeyDown={(e) => {
          if (e.key === 'Escape' && menu.current?.open) {
            e.preventDefault()
            e.stopPropagation()
            menu.current.open = false
          }
        }}
      >
        <summary className="illus-btn illus-icon-btn" aria-label="More actions">
          ⋯
        </summary>
        <div className="illus-menu-panel" role="menu">
          {actions.onVote && (
            <div className="illus-menu-row">
              {item('👍 Helpful', () => actions.onVote!('up'), actions.vote === 'up')}
              {item('👎 Not helpful', () => actions.onVote!('down'), actions.vote === 'down')}
            </div>
          )}
          {actions.onShowEvidence && item('Show evidence', actions.onShowEvidence)}
          {actions.onRegenerate && item('Regenerate…', actions.onRegenerate)}
          {actions.onKindOverride && (
            <label className="illus-menu-item">
              Draw as{' '}
              <select
                className="illus-select"
                aria-label="Draw as another kind"
                value={ir.type}
                onChange={(e) => actions.onKindOverride!(e.target.value as VisualKind)}
              >
                {kinds.map((k) => (
                  <option key={k} value={k}>
                    {k}
                  </option>
                ))}
              </select>
            </label>
          )}
          {onExportSvg && item('Download SVG', onExportSvg)}
          {onExportPng && item('Download PNG', onExportPng)}
          {actions.menuExtra}
          <p className="illus-menu-note">
            {kindLabel(ir)}
            {groundingScore !== undefined && ir.type !== 'html' && ` · ${Math.round(groundingScore * 100)}% grounded in the text`}
          </p>
        </div>
      </details>
    </div>
  )
}

export function Footer({ legend, actions = {}, onExportSvg, onExportPng, kind }: FooterProps) {
  const kinds = actions.kinds ?? VisualKind.options
  return (
    <div className="illus-footer">
      {legend && <Legend />}
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
