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
} from '../golden.ts'

const kind = new URLSearchParams(location.search).get('kind')
const ir =
    kind === 'graph' ? graphIR : kind === 'sequence' ? sequenceIR : arrayIR,
  animation =
    kind === 'graph'
      ? graphAnimation
      : kind === 'sequence'
      ? sequenceAnimation
      : arrayAnimation
const frames = buildFrames(ir, animation, { templates: templateRegistry })
createRoot(document.getElementById('root')!).render(
  <Player
    frames={frames}
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
