// §16 L4 render checks and the L4/L5 review loop (critic, repair). Owner: W10.
export { aspectRatio, checkGeometry, countCrossings, RENDER_LIMITS } from './geometry.ts'
export type { Box, EdgePath, LabelBox, RenderGeometry, RenderIssueCode } from './geometry.ts'
export { checkRender, collectGeometry } from './dom.ts'
export { reviewVisual } from './review.ts'
export type { Rendered, ReviewEnv } from './review.ts'
export { renderForReview, reviewHook, REVIEW_SCALE, REVIEW_WIDTH } from './render.tsx'
export type { RenderForReviewOptions, ReviewHookContext, ReviewHookEnv } from './render.tsx'
