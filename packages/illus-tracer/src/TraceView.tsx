import { useEffect, useState } from 'react'
import type { ComponentType } from 'react'
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

/** Same controlled transport contract as W6 PlaybackControls; inject it after W6 merges. */
export interface TracePlaybackControlsProps {
  count: number
  index: number
  onIndex(index: number): void
  playing: boolean
  onPlaying(playing: boolean): void
  speed: number
  onSpeed(speed: number): void
  loop: boolean
  onLoop(loop: boolean): void
}
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

function Controls(p: TracePlaybackControlsProps) {
  return (
    <div className="trace-controls" role="group" aria-label="Trace playback">
      <button onClick={() => p.onPlaying(!p.playing)}>
        {p.playing ? 'Pause' : 'Play'}
      </button>
      <button
        aria-label="Previous step"
        disabled={p.index === 0}
        onClick={() => p.onIndex(p.index - 1)}
      >
        Previous
      </button>
      <button
        aria-label="Next step"
        disabled={p.index >= p.count - 1}
        onClick={() => p.onIndex(p.index + 1)}
      >
        Next
      </button>
      <button
        onClick={() => {
          p.onPlaying(false)
          p.onIndex(0)
        }}
      >
        Restart
      </button>
      <input
        aria-label="Animation step"
        type="range"
        min={0}
        max={Math.max(0, p.count - 1)}
        value={p.index}
        onChange={(e) => p.onIndex(Number(e.target.value))}
      />
      <label>
        Speed{' '}
        <select
          aria-label="Playback speed"
          value={p.speed}
          onChange={(e) => p.onSpeed(Number(e.target.value))}
        >
          {[0.25, 0.5, 1, 2, 4].map((s) => (
            <option key={s} value={s}>
              {s}×
            </option>
          ))}
        </select>
      </label>
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
function language(code: string, hint?: string) {
  if (hint)
    return (
      (
        {
          golang: 'go',
          'c++': 'cpp',
          js: 'javascript',
          ts: 'typescript',
          py: 'python',
        } as Record<string, string>
      )[hint] ?? hint
    )
  if (/\bfunc\s+\w+|package\s+\w+/.test(code)) return 'go'
  if (/#include|\bstruct\s+\w+/.test(code)) return 'c'
  if (/\bdef\s+\w+/.test(code)) return 'python'
  return 'text'
}
export function TraceView({
  record,
  originalCode,
  langHint,
  flags,
  controls: Transport = Controls,
  onStep,
}: TraceViewProps) {
  const [scenario, setScenario] = useState(0),
    [index, setIndex] = useState(0),
    [python, setPython] = useState(false)
  const [playing, setPlaying] = useState(false),
    [speed, setSpeed] = useState(1),
    [loop, setLoop] = useState(false)
  const [tokens, setTokens] = useState<Token[][]>([])
  const [theme, setTheme] = useState(() => tokensFromFlowVars(() => '', true))
  const trace = record.scenarios[scenario]?.trace,
    steps = trace?.steps ?? [],
    step = steps[index],
    previous = steps[index - 1]
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
    if (!playing || !steps.length) return
    const timer = setTimeout(() => {
      if (index < steps.length - 1) setIndex(index + 1)
      else if (loop) setIndex(0)
      else setPlaying(false)
    }, 800 / speed)
    return () => clearTimeout(timer)
  }, [playing, index, steps.length, speed, loop])
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
