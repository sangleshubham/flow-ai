import type { Block, ThemeTokens, VisualKind, VisualRecord } from '@illus/core'
import { VisualView, irElements, readFlowTheme, templateRegistry, watchFlowTheme } from '@illus/render'
import type { EvidenceEvent } from '@illus/render'
import React, { useEffect, useState } from 'react'

import { enabledKinds, getRepos, highlightEvidence, parsedVisual, requestVisual, updateRecord } from './runtime'
import { pane } from './state'

export function RecordView({ record }: { record: VisualRecord }) {
  const [theme, setTheme] = useState<ThemeTokens>(() => readFlowTheme())
  const [instruction, setInstruction] = useState('')
  const [regenerate, setRegenerate] = useState(false)
  const [note, setNote] = useState('')
  const [feedbackOpen, setFeedbackOpen] = useState(false)
  const [wrong, setWrong] = useState<{ irId: string; evidence?: EvidenceEvent['evidence'] } | null>(null)
  const [mathBlock, setMathBlock] = useState<Block | undefined>()
  const parsed = parsedVisual(record)
  const sourceBlockId = parsed.success && parsed.data.type === 'math' ? parsed.data.sourceBlockId : undefined
  useEffect(() => watchFlowTheme(setTheme, document.documentElement), [])
  useEffect(() => {
    setRegenerate(false); setWrong(null); setFeedbackOpen(false); setNote('')
    if (sourceBlockId) {
      void getRepos().then((r) => r.blocks.get(sourceBlockId)).then(setMathBlock)
    }
  }, [record.cacheKey, sourceBlockId])
  if (!parsed.success) return <p role="alert">This saved visual cannot be displayed. Regenerate it to update its format.</p>
  const ir = parsed.data
  const vote = async (value: 'up' | 'down') => {
    await updateRecord({ ...record, feedback: { vote: value } })
    setFeedbackOpen(value === 'down')
    pane.announcement = 'Feedback saved.'
  }
  const simulated = record.validation.issues.find((issue) => issue.code === 'trace-simulated')
  return <div className="illus-record" onContextMenu={(e) => {
    const element = (e.target as Element).closest('[data-ir-id]')
    if (!element) return
    e.preventDefault()
    const id = element.getAttribute('data-ir-id')!
    setWrong({ irId: id, evidence: irElements(ir).find((el) => el.id === id)?.evidence }); setNote('')
  }}>
    {record.stale && <p role="status">This saved illustration is from an earlier version. Regenerate to update it.</p>}
    {simulated && <p role="status">Simulated illustration: {simulated.message}</p>}
    <VisualView spec={{ ir, groundingScore: record.validation.groundingScore, layout: record.layout as any, mathBlock }}
      theme={theme} flags={pane.preferences.flags} templates={templateRegistry}
      onEvidenceHover={(event) => { void highlightEvidence(event) }} onEvidenceClick={(event) => { void highlightEvidence(event, true) }}
      onLayout={(layout) => { if (!record.layout) void updateRecord({ ...record, layout }) }}
      actions={{ onRegenerate: () => setRegenerate(true), onKindOverride: (kind: VisualKind) => requestVisual({ kindOverride: kind, planItemId: record.planItemId }),
        kinds: enabledKinds(), onVote: (value) => { void vote(value) }, vote: record.feedback?.vote }} />
    <p className="illus-token-usage" title="Input and output tokens for this illustration">{record.usageTokens.toLocaleString()} tokens</p>
    {regenerate && <form className="illus-inline-form" onSubmit={(e) => { e.preventDefault(); requestVisual({ instruction, planItemId: record.planItemId }); setRegenerate(false) }}>
      <label>Instruction <textarea maxLength={300} value={instruction} onChange={(e) => setInstruction(e.target.value)} /></label><small>{instruction.length}/300</small>
      <button type="submit">Regenerate with instruction</button><button type="button" onClick={() => setRegenerate(false)}>Cancel</button>
    </form>}
    {feedbackOpen && <form className="illus-inline-form" onSubmit={(e) => { e.preventDefault(); void updateRecord({ ...record, feedback: { vote: 'down', note } }).then(() => { setFeedbackOpen(false); pane.announcement = 'Feedback saved.' }) }}>
      <label>Feedback note (optional)<textarea value={note} onChange={(e) => setNote(e.target.value)} /></label><button>Save feedback</button>
    </form>}
    <details><summary>Element feedback</summary>{irElements(ir).map((el) => <button key={el.id} onClick={() => { setWrong({ irId: el.id, evidence: el.evidence }); setNote('') }}>{el.label}: This is wrong</button>)}</details>
    {wrong && <form className="illus-inline-form" aria-label="Element report" onSubmit={(e) => {
      e.preventDefault(); void updateRecord({ ...record, elementReports: [...record.elementReports ?? [], { elementId: wrong.irId, evidence: wrong.evidence, note, createdAt: Date.now() }] }).then(() => { setWrong(null); pane.announcement = 'Element report saved.' })
    }}><h3>This is wrong</h3><p>{wrong.evidence?.quote}</p><label>What should change?<textarea value={note} onChange={(e) => setNote(e.target.value)} required /></label><button>Save report</button><button type="button" onClick={() => setWrong(null)}>Cancel</button></form>}
  </div>
}
