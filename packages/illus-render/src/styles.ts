// Stylesheet for every renderer and the chrome. Uses `--illus-*` tokens only (§10); rendered once per
// view as an inline <style> (Next.js 12 forbids global CSS imports from packages) and embedded into
// exported SVGs so frame classes survive export.
import { GROUP_COLOR_ORDER } from './graph/palette.ts'

/** Rules that style SVG content (also embedded in exports). */
export const SVG_CSS = `
.illus-svg text { fill: var(--illus-fg); font-family: var(--illus-font); }
.illus-svg .illus-sub { fill: var(--illus-muted); }
.illus-shape { fill: var(--illus-bg); stroke: var(--illus-fg); stroke-width: 1.25px; }
.illus-shape-back { fill: var(--illus-bg); stroke: var(--illus-muted); stroke-width: 1px; }
.illus-glyph { fill: none; stroke: var(--illus-fg); stroke-width: 1.5px; }
.illus-edge-line { fill: none; stroke: var(--illus-muted); stroke-width: 1.5px; }
.illus-edge-head { fill: var(--illus-muted); stroke: none; }
.illus-dashed .illus-edge-line { stroke-dasharray: 5 4; }
.illus-label-bg { fill: var(--illus-bg); }
.illus-svg .illus-edge-label { fill: var(--illus-muted); font-size: 11px; }
.illus-group-box { fill: none; stroke: var(--illus-line); stroke-width: 1.25px; stroke-dasharray: 4 3; }
.illus-svg .illus-group-label { fill: var(--illus-muted); font-size: 11px; font-weight: 600; }
.illus-lane-line { stroke: var(--illus-line); stroke-width: 1px; }
.illus-event-dot { fill: var(--illus-accent); }
.illus-axis { stroke: var(--illus-line); }
.illus-svg .illus-tick { fill: var(--illus-muted); font-size: 10px; }
[data-ir-id] { transition: opacity 0.2s; }
[data-ir-id].illus-hidden { opacity: 0 !important; pointer-events: none; }
[data-ir-id].illus-removed { opacity: 0.15 !important; }
.illus-tone-muted { opacity: 0.35; }
/* Scene player: GSAP owns the body's inline opacity, so a muted tone dims the outer element instead. */
[data-target]:has(> [data-anim-body][data-tone="muted"]) { opacity: 0.35; }
:is(.illus-tone-focus, [data-tone="focus"]) :is(rect, polygon, circle, ellipse, path.illus-shape):not(.illus-label-bg, .background, .illus-icon *), td:is(.illus-tone-focus, [data-tone="focus"]), tr:is(.illus-tone-focus, [data-tone="focus"]) td { fill: var(--illus-highlight) !important; background: var(--illus-highlight); }
:is(.illus-tone-focus, [data-tone="focus"]) :is(rect, polygon, circle, ellipse, path, line):not(.illus-label-bg, .background, .illus-icon *), :is(path, line):is(.illus-tone-focus, [data-tone="focus"]) { stroke: var(--illus-accent) !important; stroke-width: 2.5px !important; }
:is(.illus-tone-focus, [data-tone="focus"]) .illus-edge-head { fill: var(--illus-accent) !important; }
:is(.illus-tone-success, [data-tone="success"]) :is(rect, polygon, circle, ellipse, path, line):not(.illus-label-bg, .background, .illus-icon *), :is(path, line):is(.illus-tone-success, [data-tone="success"]) { stroke: var(--illus-new) !important; stroke-width: 2.5px !important; }
:is(.illus-tone-success, [data-tone="success"]) .illus-edge-head { fill: var(--illus-new) !important; }
:is(.illus-tone-warning, [data-tone="warning"]) :is(rect, polygon, circle, ellipse, path, line):not(.illus-label-bg, .background, .illus-icon *), :is(path, line):is(.illus-tone-warning, [data-tone="warning"]) { stroke: var(--illus-fg) !important; stroke-width: 2.5px !important; stroke-dasharray: 3 2 !important; }
.illus-new :is(rect, polygon, circle, ellipse, path.illus-shape, line):not(.illus-label-bg, .background, .illus-icon *), :is(path, line).illus-new { stroke: var(--illus-new) !important; stroke-width: 2px !important; }
.illus-earlier { opacity: 0.6; }
.illus-earlier :is(rect, polygon, circle, ellipse, path, line):not(.illus-label-bg, .background, .illus-icon *), :is(path, line).illus-earlier { stroke: var(--illus-earlier) !important; }
.illus-icon { color: var(--illus-fg); overflow: visible; }
.illus-icon * { transition: none; }
${GROUP_COLOR_ORDER.map(
  (
    name,
  ) => `[data-color="${name}"] > :is(.illus-shape, .illus-shape-back), [data-color="${name}"] > .illus-node-body > :is(.illus-shape, .illus-shape-back) { stroke: var(--illus-${name}-ink); fill: var(--illus-${name}-node-fill); }
[data-color="${name}"] > .illus-group-box, [data-color="${name}"] > .illus-group-body > .illus-group-box { stroke: var(--illus-${name}-ink); stroke-width: 1.75px; fill: var(--illus-${name}-fill); }
.illus-svg [data-color="${name}"] > .illus-group-label, .illus-svg [data-color="${name}"] > .illus-group-body > .illus-group-label, .illus-svg .illus-node[data-color="${name}"] text, .illus-svg .illus-node[data-color="${name}"] .illus-sub { fill: var(--illus-${name}-ink); }`,
).join('\n')}
.illus-term-active { color: var(--illus-accent); background: var(--illus-highlight); border-radius: 2px; }
`

export const ILLUS_CSS = `
.illus-view { background: var(--illus-bg); color: var(--illus-fg); font-family: var(--illus-font); border: 1px solid var(--illus-line); border-radius: 8px; display: flex; flex-direction: column; min-width: 0; }
.illus-header { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; padding: 8px 12px; border-bottom: 1px solid var(--illus-line); }
.illus-title { font-weight: 600; font-size: 14px; flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; margin: 0; }
.illus-badge { font-size: 11px; line-height: 16px; padding: 0 6px; border-radius: 999px; border: 1px solid var(--illus-line); color: var(--illus-muted); white-space: nowrap; }
.illus-badge-warn { border-color: var(--illus-accent); color: var(--illus-accent); }
.illus-surface { position: relative; overflow: hidden; touch-action: none; cursor: grab; min-height: 80px; }
.illus-surface:active { cursor: grabbing; }
.illus-canvas { position: absolute; left: 0; top: 0; transform-origin: 0 0; display: inline-block; padding: 12px; }
.illus-canvas [data-ir-id] { cursor: pointer; }
.illus-canvas [data-ir-id]:focus { outline: none; }
.illus-canvas [data-ir-id]:focus-visible { outline: 2px solid var(--illus-accent); outline-offset: 2px; }
.illus-overlay { position: absolute; left: 0; top: 0; width: 0; height: 0; pointer-events: none; }
.illus-mark { position: absolute; transform: translate(-50%, -100%); font: 600 11px var(--illus-mono); color: var(--illus-accent); white-space: nowrap; }
.illus-annotation { position: absolute; transform: translate(-50%, 4px); font: 11px var(--illus-font); color: var(--illus-fg); background: var(--illus-bg); border: 1px solid var(--illus-accent); border-radius: 4px; padding: 1px 4px; white-space: nowrap; }
.illus-value { position: absolute; transform: translate(-50%, -50%); font: 600 11px var(--illus-mono); color: var(--illus-bg); background: var(--illus-accent); border-radius: 999px; padding: 0 5px; }
.illus-token { position: absolute; transform: translate(-50%, -50%); min-width: 12px; height: 12px; border-radius: 999px; background: var(--illus-accent); color: var(--illus-bg); font: 600 10px/12px var(--illus-mono); text-align: center; padding: 0 3px; }
.illus-footer { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; padding: 6px 12px; border-top: 1px solid var(--illus-line); font-size: 12px; }
.illus-legend { display: flex; gap: 10px; align-items: center; color: var(--illus-muted); margin-right: auto; }
.illus-swatch { display: inline-block; width: 10px; height: 10px; border-radius: 2px; margin-right: 4px; vertical-align: -1px; }
.illus-actions { display: flex; flex-wrap: wrap; gap: 4px; margin-left: auto; }
.illus-btn, .illus-select { font: inherit; font-size: 12px; color: var(--illus-fg); background: var(--illus-bg); border: 1px solid var(--illus-line); border-radius: 4px; padding: 2px 8px; cursor: pointer; }
.illus-btn[aria-pressed="true"] { border-color: var(--illus-accent); color: var(--illus-accent); }
.illus-btn:focus-visible, .illus-select:focus-visible { outline: 2px solid var(--illus-accent); }
.illus-note { padding: 16px; color: var(--illus-muted); font-size: 13px; }
.illus-math { display: flex; flex-wrap: wrap; gap: 16px; align-items: flex-start; font-size: 15px; }
.illus-formula { padding: 4px 0; }
.illus-formula math { font-size: 1.2em; }
.illus-terms { border-collapse: collapse; font-size: 13px; }
.illus-terms td { padding: 3px 8px; border-bottom: 1px solid var(--illus-line); vertical-align: top; }
.illus-terms td:first-child { font-family: var(--illus-mono); white-space: nowrap; }
.illus-chart { width: 520px; }
.illus-iframe { width: 100%; height: 400px; border: 0; display: block; background: var(--illus-bg); }
.illus-view-compact { position: relative; border: 0; border-radius: 0; flex: 1 1 auto; min-height: 320px; }
.illus-view-compact .illus-iframe { height: 100%; min-height: 320px; }
.illus-surface-fill { flex: 1 1 auto; min-height: 280px; }
.illus-toolbar { position: absolute; top: 8px; right: 8px; z-index: 3; display: flex; gap: 6px; align-items: center; }
.illus-icon-btn { display: inline-flex; align-items: center; justify-content: center; width: 32px; height: 32px; padding: 0; font-size: 16px; line-height: 1; border-radius: 8px; background: var(--illus-bg); box-shadow: 0 1px 3px rgb(0 0 0 / 0.12); }
.illus-icon-btn.illus-fit { font-size: 11px; font-weight: 600; }
.illus-icon-btn:hover { border-color: var(--illus-accent); color: var(--illus-accent); }
.illus-zoom { position: absolute; right: 8px; bottom: 8px; z-index: 2; display: flex; flex-direction: column; gap: 4px; opacity: 0.55; transition: opacity 0.15s; }
.illus-surface:hover .illus-zoom, .illus-zoom:focus-within { opacity: 1; }
.illus-menu { position: relative; }
.illus-menu > summary { list-style: none; cursor: pointer; }
.illus-menu > summary::-webkit-details-marker { display: none; }
.illus-menu-panel { position: absolute; right: 0; top: 38px; min-width: 240px; display: flex; flex-direction: column; gap: 2px; padding: 6px; background: var(--illus-bg); color: var(--illus-fg); border: 1px solid var(--illus-line); border-radius: 10px; box-shadow: 0 10px 28px rgb(0 0 0 / 0.2); }
.illus-menu-item { display: block; width: 100%; margin: 0; white-space: nowrap; text-align: left; font: inherit; font-size: 13px; padding: 7px 10px; border: 0; border-radius: 6px; background: none; color: var(--illus-fg); cursor: pointer; }
.illus-menu-item:hover, .illus-menu-item:focus-visible { background: var(--illus-highlight); }
.illus-menu-item[aria-pressed="true"] { color: var(--illus-accent); font-weight: 600; }
.illus-menu-row { display: flex; gap: 2px; }
.illus-menu-row .illus-menu-item { flex: 1; text-align: center; }
.illus-menu-note { margin: 4px 0 0; padding: 6px 10px 2px; border-top: 1px solid var(--illus-line); font-size: 11px; color: var(--illus-muted); }
${SVG_CSS}
`
