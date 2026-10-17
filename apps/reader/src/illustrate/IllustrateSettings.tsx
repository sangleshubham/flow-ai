import { FlagName } from '@illus/core'
import React, { useState } from 'react'
import { useSnapshot } from 'valtio'

import {
  clearVisuals,
  downloadCache,
  reindex,
  savePreferences,
  togglePane,
  uploadCache,
} from './runtime'
import { DWELL_OPTIONS_MS, pane } from './state'
import type { PaneState, Preferences } from './state'

export function IllustrateSettings() {
  const s = useSnapshot(pane) as unknown as PaneState
  const [message, setMessage] = useState('')
  const [confirm, setConfirm] = useState<'clear' | 'reindex' | null>(null)
  const change = <K extends keyof Preferences>(
    key: K,
    value: Preferences[K],
  ) => {
    void savePreferences({ ...pane.preferences, [key]: value })
  }
  const action = (fn: () => Promise<unknown>) => {
    void fn()
      .then(() => setMessage('Done.'))
      .catch((e) => setMessage(e.message))
  }
  return (
    <section className="illus-settings" aria-label="Illustration settings">
      <h2>Illustrations</h2>
      <p>{s.account || 'Connect ChatGPT to use your plan.'}</p>
      {!s.signedIn && <a href="/auth/chatgpt/start">Continue with ChatGPT</a>}
      <button
        onClick={() =>
          action(async () => {
            const res = await fetch('/auth/chatgpt/logout', { method: 'POST' })
            if (!res.ok) throw new Error('Sign out failed. Try again.')
            window.location.assign('/login')
          })
        }
      >
        Sign out
      </button>
      {s.usage && (
        <p>
          {s.usage.used5h} requests in the last five hours, {s.usage.usedDay}{' '}
          today on your ChatGPT plan.
        </p>
      )}
      <label>
        <input type="checkbox" checked={s.open} onChange={togglePane} />
        Show Illustrate pane (Alt+I)
      </label>
      <label>
        <input
          type="checkbox"
          checked={s.preferences.autoHighlight}
          onChange={(e) => change('autoHighlight', e.target.checked)}
        />
        Highlight evidence on focus and hover
      </label>
      <label>
        <input
          type="checkbox"
          checked={s.preferences.highlightSteps}
          onChange={(e) => change('highlightSteps', e.target.checked)}
        />
        Highlight the passage while an animation plays
      </label>
      <label>
        Wait on a new section before illustrating
        <select
          value={s.preferences.dwellMs}
          onChange={(e) => change('dwellMs', Number(e.target.value))}
        >
          {DWELL_OPTIONS_MS.map((ms) => (
            <option key={ms} value={ms}>
              {ms ? `${ms / 1000} s` : 'Don’t wait'}
            </option>
          ))}
        </select>
      </label>
      <label>
        Animation speed
        <select
          value={s.preferences.speed}
          onChange={(e) => change('speed', Number(e.target.value))}
        >
          {[0.5, 1, 1.5, 2].map((speed) => (
            <option key={speed} value={speed}>
              {speed}×
            </option>
          ))}
        </select>
      </label>
      <label>
        Reduced motion
        <select
          value={s.preferences.reducedMotion}
          onChange={(e) =>
            change(
              'reducedMotion',
              e.target.value as Preferences['reducedMotion'],
            )
          }
        >
          <option value="system">Use system setting</option>
          <option value="on">On</option>
          <option value="off">Off</option>
        </select>
      </label>
      <fieldset>
        <legend>Features</legend>
        {FlagName.options.map((flag) => (
          <label key={flag}>
            <input
              type="checkbox"
              checked={s.preferences.flags[flag]}
              onChange={(e) =>
                change('flags', {
                  ...pane.preferences.flags,
                  [flag]: e.target.checked,
                })
              }
            />
            {
              {
                templates: 'Data structure templates',
                animations: 'Step animations',
                sceneAnimations: 'Scene animations for graphs (beta)',
                tracer: 'Executed code traces',
                conceptModels: 'Growing concept diagrams',
                critic: 'Visual quality review (uses plan requests)',
                htmlFallback: 'Sandboxed HTML illustrations',
              }[flag]
            }
          </label>
        ))}
      </fieldset>
      <label>
        <input
          type="checkbox"
          checked={s.preferences.debugPrompts}
          onChange={(e) => change('debugPrompts', e.target.checked)}
        />
        Save full prompts locally for debugging
      </label>
      <h3>Current book’s illustrations</h3>
      <button disabled={!s.bookId} onClick={() => setConfirm('reindex')}>
        Re-index book
      </button>
      <button disabled={!s.bookId} onClick={() => setConfirm('clear')}>
        Clear visuals
      </button>
      <button disabled={!s.bookId} onClick={() => action(downloadCache)}>
        Export cache JSON
      </button>
      <label>
        Import cache JSON
        <input
          type="file"
          accept="application/json,.json"
          onChange={(e) => {
            const file = e.target.files?.[0]
            if (file) action(() => uploadCache(file))
            e.target.value = ''
          }}
        />
      </label>
      {confirm && (
        <div role="group" aria-label="Confirm book action">
          <p>
            {confirm === 'clear'
              ? 'Clear this book’s saved visuals, plans and traces?'
              : 'Clear this book’s concept index and rebuild its structure? Re-indexing uses plan requests when you approve it.'}
          </p>
          <button
            onClick={() => {
              action(confirm === 'clear' ? clearVisuals : reindex)
              setConfirm(null)
            }}
          >
            Confirm {confirm === 'clear' ? 'clear visuals' : 're-index'}
          </button>
          <button onClick={() => setConfirm(null)}>Cancel</button>
        </div>
      )}
      <p role="status">{message}</p>
    </section>
  )
}
