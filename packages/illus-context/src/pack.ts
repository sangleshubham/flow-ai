// packContext(): deterministic slot packing (§7). Same inputs → byte-identical prefix and body.
import type {
  Block,
  BlocksRepo,
  BooksRepo,
  Concept,
  ConceptModel,
  ConceptModelsRepo,
  ConceptsRepo,
  CrossRef,
  CrossRefsRepo,
  PlanItem,
  RoleName,
  SectionIndexRepo,
  SectionNode,
  SectionsRepo,
} from '@illus/core'

import { attrs, clipTokens, escapeText, estimateTokens, renderBlock, renderSection } from './format.ts'

/** Bump when the packed format or slot rules change: it is part of the plan cache key (§5). */
export const CONTEXT_VERSION = 1

export const SLOT_NAMES = [
  'bookPrefix',
  'current',
  'referenced',
  'definitions',
  'path',
  'previous',
  'conceptModel',
  'lexicalFallback',
] as const
export type SlotName = (typeof SLOT_NAMES)[number]

/** Per-slot caps in tokens (§7 slot table). */
export const SLOT_CAPS: Readonly<Record<SlotName, number>> = {
  bookPrefix: 2500,
  current: 8000,
  referenced: 2500,
  definitions: 2000,
  path: 600,
  previous: 200,
  conceptModel: 2000,
  lexicalFallback: 800,
}

/** Per reference (§7 slot 3) and per definition (slot 4). */
export const REFERENCE_TOKENS = 600
export const DEFINITION_TOKENS = 150

/** The MiniSearch block index of `@illus/book-index` (`buildLexicalIndex`), structurally. */
export interface LexicalSearch {
  search(query: string, opts: { beforeOrdinal: number; limit?: number }): { blockId: string; score: number }[]
}

/** Read-only view over the store that the packer needs (§7), satisfied by `IllusRepos` plus `lexical`. */
export interface ContextRepo {
  books: Pick<BooksRepo, 'get'>
  sections: Pick<SectionsRepo, 'get' | 'listByBook'>
  blocks: Pick<BlocksRepo, 'get' | 'listBySection'>
  crossRefs: Pick<CrossRefsRepo, 'listFromBlock'>
  sectionIndex: Pick<SectionIndexRepo, 'get'>
  concepts: Pick<ConceptsRepo, 'listByBook'>
  conceptModels: Pick<ConceptModelsRepo, 'get'>
  /** Absent → no lexical fallback slot. */
  lexical?: LexicalSearch
}

export interface PackInput {
  role: RoleName
  sectionId: string
  planItem?: PlanItem
  budgetTokens: number
  repo: ContextRepo
  /**
   * A synthetic section that is not in the store ("Illustrate selection", §8): its blocks are the
   * selected blocks and its `parentId` gives the path context.
   */
  synthetic?: { section: SectionNode; blocks: Block[] }
  /** Compact state of a concept model before `beforeOrdinal` (W8). Default: its earlier patches. */
  conceptModelState?: (model: ConceptModel, beforeOrdinal: number) => unknown
}

export interface PackedContext {
  /** Stable, cacheable part (`<book_context>`). */
  prefix: string
  /** Per-call part. */
  body: string
  /** The whitelist grounding accepts evidence from (§7). */
  usedBlockIds: string[]
  /** Slots that lost at least one item to their cap or to the budget. */
  dropped: SlotName[]
  tokens: number
}

interface Slot {
  name: SlotName
  open: string
  close: string
  /** Candidate items in priority order; packing stops at the first that does not fit. */
  items: { text: string; blockIds: string[] }[]
}

const BACK_REFERENCE = /\b(as we saw|recall|earlier|previous chapter|the approach above)\b/i
const STOPWORDS = new Set(
  'a an and are as at be by for from has have in is it its of on or that the this to was we were which with will saw recall earlier previous chapter approach above see seen'.split(
    ' ',
  ),
)

const byString = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0)
const lower = (s: string) => s.toLowerCase()

/** Builds the prompt context for one call (§7). */
export async function packContext(input: PackInput): Promise<PackedContext> {
  const { repo, planItem } = input
  const section = input.synthetic?.section ?? (await repo.sections.get(input.sectionId))
  if (!section) throw new Error(`packContext: unknown section ${input.sectionId}`)
  const blocks = input.synthetic?.blocks ?? (await repo.blocks.listBySection(section.sectionId))
  const [book, allSections, allConcepts, index] = await Promise.all([
    repo.books.get(section.bookId),
    repo.sections.listByBook(section.bookId),
    repo.concepts.listByBook(section.bookId),
    repo.sectionIndex.get(section.sectionId),
  ])
  const sectionsById = new Map(allSections.map((s) => [s.sectionId, s]))
  const ordinal = section.ordinal

  // Reading-position gating (§7): nothing introduced after the current ordinal.
  const concepts = allConcepts.filter((c) => c.firstOrdinal <= ordinal).sort((a, b) => byString(a.canonical, b.canonical))
  const usedNames = new Set([...(index?.uses ?? []), ...(index?.defines ?? [])].map((u) => lower(u.name)))
  const isUsed = (c: Concept) =>
    planItem?.conceptIds.includes(c.conceptId) || [c.canonical, ...c.aliases].some((n) => usedNames.has(lower(n)))

  const slots: Slot[] = []

  // 1. bookPrefix
  const header = [
    `<title>${escapeText(book?.title ?? '')}</title>`,
    book?.summary ? `<summary>${escapeText(book.summary.summary)}</summary>` : '',
    book?.summary?.conventions.length
      ? `<conventions>${book.summary.conventions.map((c) => `<convention>${escapeText(c)}</convention>`).join('')}</conventions>`
      : '',
  ]
    .filter(Boolean)
    .join('\n')
  const glossaryOrder = [
    ...concepts.filter(isUsed),
    ...concepts.filter((c) => !isUsed(c)).sort((a, b) => a.firstOrdinal - b.firstOrdinal || byString(a.canonical, b.canonical)),
  ]
  slots.push({
    name: 'bookPrefix',
    open: '<book_context>',
    close: '</book_context>',
    items: [
      { text: header, blockIds: [] },
      ...glossaryOrder.map((c) => ({
        text: `<concept${attrs([['name', c.canonical], ['aliases', c.aliases.length ? c.aliases.join('; ') : undefined]])}/>`,
        blockIds: [],
      })),
    ],
  })

  // 2. current: never truncated
  slots.push({ name: 'current', open: '', close: '', items: [{ text: renderSection(section, blocks), blockIds: blocks.map((b) => b.blockId) }] })

  // 3. referenced: explicit, resolved cross-references to earlier material
  const ownIds = new Set(blocks.map((b) => b.blockId))
  const refsByBlock = new Map<string, CrossRef[]>()
  for (const b of blocks) refsByBlock.set(b.blockId, await repo.crossRefs.listFromBlock(b.blockId))
  const seenTargets = new Set<string>()
  const referenced: Slot['items'] = []
  for (const b of blocks) {
    for (const ref of refsByBlock.get(b.blockId) ?? []) {
      if (!ref.resolved) continue
      const target = ref.targetBlockId ?? ref.targetSectionId
      if (!target || seenTargets.has(target)) continue
      seenTargets.add(target)
      let targetBlocks: Block[] = []
      if (ref.targetBlockId) {
        const tb = await repo.blocks.get(ref.targetBlockId)
        if (tb) targetBlocks = [tb]
      } else if (ref.targetSectionId) targetBlocks = await repo.blocks.listBySection(ref.targetSectionId)
      targetBlocks = targetBlocks.filter((tb) => !ownIds.has(tb.blockId) && (sectionsById.get(tb.sectionId)?.ordinal ?? Infinity) < ordinal)
      if (!targetBlocks.length) continue
      let left = REFERENCE_TOKENS
      const parts: string[] = []
      const ids: string[] = []
      for (const tb of targetBlocks) {
        if (left <= 0) break
        const text = clipTokens(tb.text, left)
        left -= estimateTokens(text)
        parts.push(`  ${renderBlock(tb, [['from', ref.label]], text)}`)
        ids.push(tb.blockId)
      }
      referenced.push({ text: parts.join('\n'), blockIds: ids })
    }
  }
  slots.push({ name: 'referenced', open: '<referenced>', close: '</referenced>', items: referenced })

  // 4. definitions of used concepts defined earlier, elsewhere
  const definitions: Slot['items'] = []
  for (const c of concepts) {
    if (!isUsed(c) || !c.definition || !c.definedInSectionId || c.definedInSectionId === section.sectionId) continue
    if ((sectionsById.get(c.definedInSectionId)?.ordinal ?? Infinity) >= ordinal) continue
    const db = await repo.blocks.get(c.definition.blockId)
    if (!db) continue
    definitions.push({
      text: `  <concept${attrs([['name', c.canonical]])}>${renderBlock(db, [], around(db.text, c.definition.quote, DEFINITION_TOKENS))}</concept>`,
      blockIds: [db.blockId],
    })
  }
  slots.push({ name: 'definitions', open: '<definitions>', close: '</definitions>', items: definitions })

  // 5. path: heading ancestors, deepest first
  const pathItems: Slot['items'] = []
  const visited = new Set([section.sectionId])
  for (let p = section.parentId; p && !visited.has(p); p = sectionsById.get(p)?.parentId) {
    visited.add(p)
    const anc = sectionsById.get(p)
    const summary = (await repo.sectionIndex.get(p))?.summary
    if (anc && summary) pathItems.push({ text: `  <summary${attrs([['section', anc.title]])}>${escapeText(summary)}</summary>`, blockIds: [] })
  }
  slots.push({ name: 'path', open: '<path_summaries>', close: '</path_summaries>', items: pathItems })

  // 6. previous sibling
  const prev = allSections
    .filter((s) => s.parentId === section.parentId && s.ordinal < ordinal && s.sectionId !== section.sectionId)
    .sort((a, b) => b.ordinal - a.ordinal)[0]
  const prevSummary = prev && (await repo.sectionIndex.get(prev.sectionId))?.summary
  slots.push({
    name: 'previous',
    open: '',
    close: '',
    items: prev && prevSummary ? [{ text: `<previous_summary${attrs([['section', prev.title]])}>${escapeText(prevSummary)}</previous_summary>`, blockIds: [] }] : [],
  })

  // 7. concept model state
  const cmItems: Slot['items'] = []
  if (planItem?.conceptModelId) {
    const model = await repo.conceptModels.get(planItem.conceptModelId)
    if (model) {
      const state = input.conceptModelState?.(model, ordinal) ?? defaultModelState(model, ordinal)
      const json = shrinkJson(state, SLOT_CAPS.conceptModel)
      if (json) cmItems.push({ text: `<concept_model${attrs([['id', model.conceptModelId], ['kind', model.kind]])}>${escapeText(json)}</concept_model>`, blockIds: [] })
    }
  }
  slots.push({ name: 'conceptModel', open: '', close: '', items: cmItems })

  // 8. lexical fallback for vague back-references with no resolved cross-reference
  const lexItems: Slot['items'] = []
  if (repo.lexical) {
    const best = new Map<string, number>()
    for (const b of blocks) {
      if (b.kind === 'code' || (refsByBlock.get(b.blockId) ?? []).some((r) => r.resolved)) continue
      for (const sentence of b.text.split(/(?<=[.!?])\s+/)) {
        if (!BACK_REFERENCE.test(sentence)) continue
        const query = [...new Set(sentence.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [])].filter((w) => w.length > 2 && !STOPWORDS.has(w)).join(' ')
        if (!query) continue
        for (const hit of repo.lexical.search(query, { beforeOrdinal: ordinal, limit: 3 }))
          if (!ownIds.has(hit.blockId)) best.set(hit.blockId, Math.max(best.get(hit.blockId) ?? -Infinity, hit.score))
      }
    }
    const top = [...best].sort((a, b) => b[1] - a[1] || byString(a[0], b[0])).slice(0, 3)
    for (const [blockId] of top) {
      const lb = await repo.blocks.get(blockId)
      if (lb) lexItems.push({ text: `  ${renderBlock(lb)}`, blockIds: [blockId] })
    }
  }
  slots.push({ name: 'lexicalFallback', open: '<earlier_passages>', close: '</earlier_passages>', items: lexItems })

  // Fill in priority order until the budget is used.
  let left = input.budgetTokens
  const dropped: SlotName[] = []
  const used: string[] = []
  let prefix = ''
  const bodyParts: string[] = []
  for (const slot of slots) {
    const kept: string[] = []
    let slotTokens = estimateTokens(slot.open + slot.close)
    let lost = false
    for (const item of slot.items) {
      const t = estimateTokens(item.text) + 1
      if (slot.name !== 'current' && (lost || slotTokens + t > SLOT_CAPS[slot.name] || slotTokens + t > left)) {
        lost = true
        continue
      }
      kept.push(item.text)
      slotTokens += t
      used.push(...item.blockIds)
    }
    if (lost) dropped.push(slot.name)
    if (!kept.length) continue
    left -= slotTokens
    const text = slot.open ? [slot.open, ...kept, slot.close].join('\n') : kept.join('\n')
    if (slot.name === 'bookPrefix') prefix = text
    else bodyParts.push(text)
  }
  if (planItem)
    bodyParts.push(
      `<plan_item${attrs([
        ['id', planItem.planItemId],
        ['kind', planItem.kind],
        ['template', planItem.templateId],
        ['code_block', planItem.codeBlockId],
        ['animate', planItem.animate],
      ])}>${escapeText(planItem.intent)}</plan_item>`,
    )
  const body = bodyParts.join('\n')
  return { prefix, body, usedBlockIds: [...new Set(used)], dropped, tokens: estimateTokens(prefix) + estimateTokens(body) }
}

/** A window of about `tokens` tokens of `text` centred on `quote` (or its start when not found). */
function around(text: string, quote: string, tokens: number): string {
  const max = Math.floor(tokens * 3.6)
  if (text.length <= max) return text
  const at = Math.max(0, text.toLowerCase().indexOf(quote.toLowerCase()))
  const start = Math.max(0, Math.min(at - Math.floor((max - quote.length) / 2), text.length - max))
  return `${start > 0 ? '…' : ''}${text.slice(start, start + max)}${start + max < text.length ? '…' : ''}`
}

function defaultModelState(model: ConceptModel, beforeOrdinal: number): unknown {
  return {
    kind: model.kind,
    patches: model.patches.filter((p) => p.sectionOrdinal < beforeOrdinal).map((p) => ({ section: p.sectionId, ops: p.ops })),
  }
}

/** Compact JSON within `cap` tokens: drop sublabels, then the oldest annotations; `null` if it still does not fit. */
function shrinkJson(state: unknown, cap: number): string | null {
  const fits = (v: unknown) => estimateTokens(JSON.stringify(v)) <= cap - 20
  if (fits(state)) return JSON.stringify(state)
  const s = JSON.parse(JSON.stringify(state, (k, v) => (k === 'sublabel' ? undefined : v))) as unknown
  if (fits(s)) return JSON.stringify(s)
  // Annotate ops in reading order: remove from the oldest until it fits.
  const annotations: { list: unknown[]; item: unknown }[] = []
  const walk = (v: unknown) => {
    if (Array.isArray(v)) {
      for (const x of v) if (x && typeof x === 'object' && (x as { op?: string }).op === 'annotate') annotations.push({ list: v, item: x })
      v.forEach(walk)
    } else if (v && typeof v === 'object') Object.values(v).forEach(walk)
  }
  walk(s)
  for (const a of annotations) {
    a.list.splice(a.list.indexOf(a.item), 1)
    if (fits(s)) return JSON.stringify(s)
  }
  return null
}
