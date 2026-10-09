import { useEffect, useState } from 'react'
import type { ComponentType } from 'react'
import { PlaybackControls, usePlayback } from '@illus/anim'
import type { PlaybackControlsProps } from '@illus/anim'
import {
  getTemplate,
  ILLUS_CSS,
  tokensFromFlowVars,
  readFlowTheme,
  watchFlowTheme,
  themeVars,
} from '@illus/render'
import type { BundledLanguage, SpecialLanguage } from 'shiki'
import type { Flags, TraceRecord, TraceStep, ValueRef } from '@illus/core'
import { projectHint } from './projection.ts'

export type TracePlaybackControlsProps = PlaybackControlsProps
export interface TraceViewProps {
  record: TraceRecord
  originalCode: string
  langHint?: string
  flags: Pick<Flags, 'tracer'>
  controls?: ComponentType<TracePlaybackControlsProps>
  onStep?: (step: TraceStep) => void
}
type Token = { content: string; color?: string }
const show = (v?: ValueRef) =>
  !v ? '—' : 'prim' in v ? JSON.stringify(v.prim) : `@${v.ref}`

function language(code: string, hint?: string) {
  hint = hint?.trim().toLowerCase()
  if (hint)
    return (
      (
        {
          golang: 'go',
          'c++': 'cpp',
          js: 'javascript',
          ts: 'typescript',
          py: 'python',
          'c#': 'csharp',
        } as Record<string, string>
      )[hint] ?? hint
    )
  if (/\bfunc\s+\w+|package\s+\w+/.test(code)) return 'go'
  if (/\bfn\s+\w+|\blet\s+mut\s/.test(code)) return 'rust'
  if (/\bpublic\s+(static\s+)?(class|void|int)\b/.test(code)) return 'java'
  if (/\binterface\s+\w+|\btype\s+\w+\s*=/.test(code)) return 'typescript'
  if (/\bfunction\s+\w+|\bconst\s+\w+\s*=|=>/.test(code)) return 'javascript'
  if (/std::|#include\s*<iostream>/.test(code)) return 'cpp'
  if (/#include|\bstruct\s+\w+/.test(code)) return 'c'
  if (/\bdef\s+\w+/.test(code)) return 'python'
  return 'text'
}
export function TraceView({
  record,
  originalCode,
  langHint,
  flags,
  controls: Transport = PlaybackControls,
  onStep,
}: TraceViewProps) {
  const [scenario, setScenario] = useState(0),
    [index, setIndex] = useState(0),
    [python, setPython] = useState(false)
  const [tokens, setTokens] = useState<Token[][]>([])
  const [theme, setTheme] = useState(() => tokensFromFlowVars(() => '', true))
  const trace = record.scenarios[scenario]?.trace,
    steps = trace?.steps ?? [],
    step = steps[index],
    previous = steps[index - 1]
  const { playing, setPlaying, speed, setSpeed, loop, setLoop } = usePlayback({
    count: steps.length,
    index,
    onIndex: setIndex,
    delayMs: 800,
  })
  const code = python
    ? trace?.python ?? record.translation.python
    : originalCode
  useEffect(() => {
    setScenario(0)
    setIndex(0)
    setPlaying(false)
  }, [record.cacheKey])
  useEffect(() => {
    setTheme(readFlowTheme())
    return watchFlowTheme(setTheme)
  }, [])
  useEffect(() => {
    let active = true
    setTokens([])
    import('shiki')
      .then(async ({ codeToTokens }) =>
        codeToTokens(code, {
          lang: (python ? 'python' : language(code, langHint)) as
            | BundledLanguage
            | SpecialLanguage,
          theme: theme.dark ? 'github-dark' : 'github-light',
        }),
      )
      .then((result) => {
        if (active) setTokens(result.tokens)
      })
      .catch(() => undefined)
    return () => {
      active = false
    }
  }, [code, langHint, python, theme.dark])
  useEffect(() => {
    if (step && flags.tracer) onStep?.(step)
  }, [step, onStep, flags.tracer])
  if (!flags.tracer) return <p>Code tracing is disabled.</p>
  const highlights = python ? [step?.pyLine] : step?.origLines ?? []
  return (
    <section
      className="illus trace-view"
      aria-label="Code trace"
      style={themeVars(theme)}
    >
      <style>{ILLUS_CSS + CSS}</style>
      <header>
        <span className="trace-badge">{record.mode}</span>
        {trace?.truncated && <span>Trace shortened</span>}
        <label>
          <input
            type="checkbox"
            checked={python}
            onChange={(e) => setPython(e.target.checked)}
          />
          Show Python
        </label>
        {record.translation.assumptions.length > 0 && (
          <details>
            <summary>Assumptions</summary>
            <ul>
              {record.translation.assumptions.map((a, i) => (
                <li key={i}>{a}</li>
              ))}
            </ul>
          </details>
        )}
      </header>
      {record.scenarios.length > 1 && (
        <div role="tablist" aria-label="Scenarios">
          {record.scenarios.map((s, i) => (
            <button
              key={i}
              role="tab"
              aria-selected={scenario === i}
              onClick={() => {
                setScenario(i)
                setIndex(0)
                setPlaying(false)
              }}
            >
              {s.label}
            </button>
          ))}
        </div>
      )}
      <div className="trace-columns">
        <pre aria-label={python ? 'Python code' : 'Original code'}>
          {code.split('\n').map((line, i) => (
            <div
              key={i}
              data-line={i + 1}
              data-current={highlights.includes(i + 1)}
              className={highlights.includes(i + 1) ? 'trace-active' : ''}
            >
              <span className="trace-line-number">{i + 1}</span>
              {tokens[i]?.map((t, k) => (
                <span key={k} style={{ color: t.color }}>
                  {t.content}
                </span>
              )) ?? line}
              {'\n'}
            </div>
          ))}
        </pre>
        <div>
          {step &&
            record.translation.vizHints
              .filter((h) => !h.pointerOf)
              .map((hint, i) => {
                const projected = projectHint(
                  step,
                  hint,
                  record.translation.vizHints,
                )
                const template = projected && getTemplate(projected.templateId)
                const parsed = template?.propsSchema.safeParse(projected?.props)
                if (!projected || !template || !parsed?.success) return null
                const Component = template.Component
                return (
                  <div key={i} className="trace-structure">
                    <Component
                      ir={{
                        type: 'template',
                        templateId: projected.templateId,
                        props: parsed.data,
                        evidence: [],
                      }}
                      props={parsed.data}
                      layout={template.layout(parsed.data)}
                      theme={theme}
                    />
                    {projected.clipped && <small>Structure shortened</small>}
                  </div>
                )
              })}
          <div aria-label="Call stack">
            {step?.frames.map((f, fi) => (
              <div key={fi}>
                <strong>{f.fn}</strong>
                <dl>
                  {Object.entries(f.locals).map(([name, value]) => (
                    <div
                      key={name}
                      data-changed={
                        show(previous?.frames[fi]?.locals[name]) !== show(value)
                      }
                    >
                      <dt>{name}</dt>
                      <dd>{show(value)}</dd>
                    </div>
                  ))}
                </dl>
              </div>
            ))}
          </div>
          {step?.returnValue && (
            <p aria-label="Return value">Returns {show(step.returnValue)}</p>
          )}
          {step?.skipped && (
            <p>{step.skipped.iterations} iterations/events skipped</p>
          )}
          <pre aria-label="Standard output">{step?.stdout ?? ''}</pre>
          {trace?.error && <p role="alert">{trace.error}</p>}
        </div>
      </div>
      <Transport
        count={steps.length}
        index={index}
        onIndex={(i) => setIndex(Math.max(0, Math.min(i, steps.length - 1)))}
        playing={playing}
        onPlaying={setPlaying}
        speed={speed}
        onSpeed={setSpeed}
        loop={loop}
        onLoop={setLoop}
      />
      <p aria-live="polite">
        Step {steps.length ? index + 1 : 0} of {steps.length}
      </p>
    </section>
  )
}
const CSS = `.trace-view{color:var(--illus-fg,#ddd);background:var(--illus-bg,#161b22);padding:12px;font-family:var(--illus-font,system-ui)}.trace-view header,.trace-controls{display:flex;gap:8px;align-items:center;flex-wrap:wrap}.trace-badge{border:1px solid var(--illus-line,#777);border-radius:14px;padding:2px 8px}.trace-columns{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:16px}.trace-view pre{overflow:auto;font:13px var(--illus-mono,monospace);white-space:pre;margin:12px 0}.trace-active{background:var(--illus-highlight,#394256)}.trace-line-number{color:var(--illus-muted,#aaa);display:inline-block;width:3ch;user-select:none}.trace-view dl>div{display:flex;gap:12px}.trace-view dt{min-width:5ch}.trace-view dd{margin:0}.trace-view [data-changed=true]{background:var(--illus-highlight,#394256)}.trace-structure{overflow:auto}.trace-view button,.trace-view select{font:inherit}@media(max-width:600px){.trace-columns{grid-template-columns:1fr}}`
