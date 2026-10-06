import { Fragment, StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { buildFrames } from '@illus/core'
import { make } from '@illus/core/testing'
import { VisualView, templateRegistry } from '@illus/render'
import { Player } from '../../src/index.ts'
import { SceneHarness, ScenePlayerHarness } from './scene.tsx'
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
const reducedMotion =
  params.get('motion') === 'on'
    ? true
    : params.get('motion') === 'off'
    ? false
    : undefined
/** `?strict=on` mounts the scene player under StrictMode, which replays effects (mount, cleanup, mount). */
const Wrapper = params.get('strict') === 'on' ? StrictMode : Fragment
createRoot(document.getElementById('root')!).render(
  kind === 'scene' || kind === 'scene-details' ? (
    <SceneHarness details={kind === 'scene-details'} />
  ) : kind === 'scene-player' ? (
    <Wrapper>
      <ScenePlayerHarness
        reducedMotion={reducedMotion}
        autoPlay={params.get('autoplay') === 'on'}
        swap={params.get('swap') === 'on'}
      />
    </Wrapper>
  ) : (
    <Player
      frames={frames}
      reducedMotion={reducedMotion}
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
    />
  ),
)
