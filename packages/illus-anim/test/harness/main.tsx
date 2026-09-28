import { createRoot } from 'react-dom/client'
import { buildFrames } from '@illus/core'
import { make } from '@illus/core/testing'
import { VisualView, templateRegistry } from '@illus/render'
import { Player } from '../../src/index.ts'
import {
  arrayIR,
  arrayAnimation,
  sequenceIR,
  sequenceAnimation,
  graphIR,
  graphAnimation,
  mutedGraphAnimation,
  hiddenGraphIR,
  hiddenGraphAnimation,
} from '../golden.ts'

const params = new URLSearchParams(location.search)
const kind = params.get('kind')
const ir =
    kind === 'graph-hidden'
      ? hiddenGraphIR
      : kind === 'graph' || kind === 'graph-muted'
      ? graphIR
      : kind === 'sequence'
      ? sequenceIR
      : arrayIR,
  animation =
    kind === 'graph-hidden'
      ? hiddenGraphAnimation
      : kind === 'graph'
      ? graphAnimation
      : kind === 'graph-muted'
      ? mutedGraphAnimation
      : kind === 'sequence'
      ? sequenceAnimation
      : arrayAnimation
const frames = buildFrames(ir, animation, { templates: templateRegistry })
createRoot(document.getElementById('root')!).render(
  <Player
    frames={frames}
    reducedMotion={
      params.get('motion') === 'on'
        ? true
        : params.get('motion') === 'off'
        ? false
        : undefined
    }
    renderFrame={(frame) => (
      <VisualView
        spec={{ ir }}
        frame={frame}
        theme={make.themeTokens()}
        templates={templateRegistry}
      />
    )}
    onStepChange={(index) =>
      document.documentElement.setAttribute('data-step', String(index))
    }
  />,
)
