// DOMPurify profiles for every string of markup inserted into the page (§17 "XSS via Mermaid or SVG").
import DOMPurify from 'dompurify'

/** SVG profile for Mermaid output. Keeps Mermaid's scoped <style> and data attributes; drops scripts,
 * event handlers, foreignObject and external references. */
export function sanitizeSvg(svg: string): string {
  return DOMPurify.sanitize(svg, {
    USE_PROFILES: { svg: true, svgFilters: true },
    ADD_TAGS: ['style'],
    FORBID_TAGS: ['foreignObject', 'script', 'a', 'use', 'image'],
  })
}

/** MathML profile for formulas taken from the book. */
export function sanitizeMathMl(mathml: string): string {
  return DOMPurify.sanitize(mathml, { USE_PROFILES: { mathMl: true } })
}

/** KaTeX output (HTML + MathML). KaTeX escapes its input; this is defence in depth. */
export function sanitizeKatex(html: string): string {
  return DOMPurify.sanitize(html, { USE_PROFILES: { html: true, mathMl: true, svg: true }, FORBID_TAGS: ['a'] })
}
