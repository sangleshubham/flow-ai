// Exposes the render-check helpers and IR factories to the Playwright spec.
import { make } from '@illus/core/testing'

import { readFlowTheme } from '../../../theme.ts'
import { templateRegistry } from '../../../templates/index.ts'
import { checkRender, renderForReview } from '../../index.ts'

declare global {
  interface Window {
    __check: { make: typeof make; checkRender: typeof checkRender; review: (ir: Parameters<typeof renderForReview>[0]) => ReturnType<typeof renderForReview> }
  }
}

window.__check = {
  make,
  checkRender,
  review: (ir) => renderForReview(ir, { theme: readFlowTheme(), templates: templateRegistry }),
}
document.body.dataset.ready = 'true'
