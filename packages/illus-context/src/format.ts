// Prompt-format helpers (§7 "Prompt format"). Pure string building; no I/O.
import type { Block, SectionNode } from '@illus/core'

/** Token estimate used for budgets: `ceil(chars / 3.6)` (§6 step 10, prose rate). */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 3.6)
}

/** The first `tokens` tokens of `text` (by the same estimate), cut at a word boundary when possible. */
export function clipTokens(text: string, tokens: number): string {
  const max = Math.floor(tokens * 3.6)
  if (text.length <= max) return text
  const cut = text.slice(0, max)
  const space = cut.lastIndexOf(' ')
  return `${space > max * 0.8 ? cut.slice(0, space) : cut}…`
}

/**
 * Book text inside tags. Only a `<` that could open a tag is escaped, so code such as `lo <= hi` stays
 * verbatim and quotable, while `</section>` or `<system>` inside a book cannot close or open our tags.
 */
export function escapeText(text: string): string {
  return text.replace(/<(?=[A-Za-z/!?])/g, '&lt;')
}

export function escapeAttr(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

/** Attributes in the given order; `undefined` values are left out. */
export function attrs(pairs: [string, string | number | boolean | undefined][]): string {
  return pairs
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => ` ${k}="${escapeAttr(String(v))}"`)
    .join('')
}

/**
 * `<block id="…" kind="…" label="…" lang="…" alt="…">text</block>`. `extra` attributes come after `id`.
 * A caption-less figure has empty `text` (ADR 0025); its `figure.alt` goes in an attribute so the model sees it
 * but cannot quote it as evidence (alt text is not in the CFI range, so it would never ground).
 */
export function renderBlock(block: Block, extra: [string, string | undefined][] = [], text: string = block.text): string {
  const alt = block.text ? undefined : block.figure?.alt
  return `<block${attrs([['id', block.blockId], ...extra, ['kind', block.kind], ['label', block.label], ['lang', block.code?.langHint], ['alt', alt]])}>${escapeText(text)}</block>`
}

/** Heading path as shown in the `path` attribute: 'Ch 5 › 5.3 Log Replication'. */
export function sectionPath(section: Pick<SectionNode, 'headingPath' | 'title'>): string {
  return (section.headingPath.length ? section.headingPath : [section.title]).join(' › ')
}

/** `<section id path ordinal>` with every block, one per line (§7 slot 2). */
export function renderSection(section: SectionNode, blocks: readonly Block[]): string {
  const open = `<section${attrs([['id', section.sectionId], ['path', sectionPath(section)], ['ordinal', section.ordinal]])}>`
  return [open, ...blocks.map((b) => `  ${renderBlock(b)}`), '</section>'].join('\n')
}
