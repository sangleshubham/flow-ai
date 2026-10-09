// Deterministic concept clustering and Concept records (§6 phase B step 5). Pure.
import { makeConceptId } from '@illus/core'
import type { Concept, ConceptMerge, Evidence, SectionIndexRecord } from '@illus/core'

/** Simple singularisation of one word: ies→y, sses→ss, trailing s dropped (not ss, us, is). */
export function singular(word: string): string {
  if (word.length > 4 && word.endsWith('ies')) return `${word.slice(0, -3)}y`
  if (word.endsWith('sses')) return word.slice(0, -2)
  if (word.length > 3 && word.endsWith('s') && !/(ss|us|is)$/.test(word)) return word.slice(0, -1)
  return word
}

/** Cluster key: lowercase, punctuation stripped, whitespace collapsed, last word singularised. */
export function nameKey(name: string): string {
  const words = name
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]+/gu, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
  if (words.length) words[words.length - 1] = singular(words.at(-1)!)
  return words.join(' ')
}

/** "Long Name (LN)" pairs: acronym key → long-name key, when the acronym matches the initials. */
export function acronymPairs(texts: readonly string[]): Map<string, string> {
  const out = new Map<string, string>()
  for (const text of texts)
    for (const m of text.matchAll(/((?:[\p{L}\p{N}-]+\s+){1,6})\(([A-Z][A-Za-z]{1,7}s?)\)/gu)) {
      const acronym = m[2]!.replace(/s$/, '')
      const words = m[1]!.trim().split(/\s+/).slice(-acronym.length)
      if (words.length === acronym.length && words.every((w, i) => w[0]!.toUpperCase() === acronym[i]!.toUpperCase()))
        out.set(nameKey(acronym), nameKey(words.join(' ')))
    }
  return out
}

export interface Cluster {
  key: string
  /** Surface form → number of mentions. */
  names: Map<string, number>
  defines: { name: string; sectionId: string; ordinal: number; evidence: Evidence }[]
  sectionIds: Set<string>
  firstOrdinal: number
  /** Canonical name chosen by a merge (glossary output or an earlier concept). */
  canonical?: string
}

/**
 * Groups every defined or used name of the index records by `nameKey` and acronym pairs, then unions
 * clusters that `merges` (earlier concepts or glossary output) put together.
 */
export function clusterConcepts(
  records: readonly SectionIndexRecord[],
  ordinals: ReadonlyMap<string, number>,
  merges: readonly ConceptMerge[] = [],
): Cluster[] {
  const acronyms = acronymPairs(records.flatMap((r) => r.defines.flatMap((d) => [d.name, d.evidence.quote])))
  const keyOf = (name: string) => {
    const k = nameKey(name)
    return acronyms.get(k) ?? k
  }
  const clusters = new Map<string, Cluster>()
  const add = (name: string, sectionId: string, evidence?: Evidence) => {
    const ordinal = ordinals.get(sectionId)
    if (ordinal === undefined || !nameKey(name)) return
    const key = keyOf(name)
    let c = clusters.get(key)
    if (!c) clusters.set(key, (c = { key, names: new Map(), defines: [], sectionIds: new Set(), firstOrdinal: ordinal }))
    c.names.set(name, (c.names.get(name) ?? 0) + 1)
    c.sectionIds.add(sectionId)
    c.firstOrdinal = Math.min(c.firstOrdinal, ordinal)
    if (evidence) c.defines.push({ name, sectionId, ordinal, evidence })
  }
  for (const r of [...records].sort((a, b) => (ordinals.get(a.sectionId) ?? 0) - (ordinals.get(b.sectionId) ?? 0))) {
    for (const d of r.defines) add(d.name, r.sectionId, d.evidence)
    for (const u of r.uses) add(u.name, r.sectionId)
  }

  // Union-find over cluster keys for the merges.
  const parent = new Map([...clusters.keys()].map((k) => [k, k]))
  const find = (k: string): string => (parent.get(k) === k ? k : find(parent.get(k)!))
  const canonicalOf = new Map<string, string>()
  for (const m of merges) {
    const keys = [m.canonical, ...m.aliases].map(keyOf).filter((k) => parent.has(k))
    for (const k of keys.slice(1)) parent.set(find(k), find(keys[0]!))
    if (keys.length) canonicalOf.set(keys[0]!, m.canonical)
  }
  const merged = new Map<string, Cluster>()
  for (const [k, c] of [...clusters].sort(([a], [b]) => (a < b ? -1 : 1))) {
    const root = find(k)
    const into = merged.get(root)
    if (!into) {
      merged.set(root, { ...c, key: root, names: new Map(c.names), sectionIds: new Set(c.sectionIds), defines: [...c.defines] })
      continue
    }
    for (const [n, count] of c.names) into.names.set(n, (into.names.get(n) ?? 0) + count)
    c.sectionIds.forEach((s) => into.sectionIds.add(s))
    into.defines.push(...c.defines)
    into.firstOrdinal = Math.min(into.firstOrdinal, c.firstOrdinal)
  }
  for (const [k, canonical] of canonicalOf) {
    const c = merged.get(find(k))
    if (!c) continue
    if (!c.names.has(canonical)) c.names.set(canonical, 0)
    c.canonical = canonical
  }
  return [...merged.values()].sort((a, b) => a.firstOrdinal - b.firstOrdinal || (a.key < b.key ? -1 : 1))
}

/**
 * Groups of clusters the deterministic rules cannot settle: clusters sharing a head noun (the last word
 * of the key), e.g. 'log' and 'replicated log', with at least one cluster no merge has settled yet.
 */
export function ambiguousGroups(clusters: readonly Cluster[]): Cluster[][] {
  const byHead = new Map<string, Cluster[]>()
  for (const c of clusters) {
    const head = c.key.split(' ').at(-1)!
    byHead.set(head, [...(byHead.get(head) ?? []), c])
  }
  return [...byHead.values()].filter((g) => g.length > 1 && g.some((c) => c.canonical === undefined))
}

/**
 * The cluster's canonical name: the one a merge chose, else the most frequent surface form among the
 * defined names (all names when none is defined); ties: shortest, then alphabetical.
 */
export function canonicalName(c: Cluster): string {
  if (c.canonical) return c.canonical
  const defined = new Set(c.defines.map((d) => d.name))
  return [...c.names]
    .filter(([n]) => !defined.size || defined.has(n)).sort(([a, x], [b, y]) => y - x || a.length - b.length || (a < b ? -1 : 1))[0]![0]
}

/** `Concept` records of a book from clusters (§5): spanning when used in 3 or more sections. */
export function toConcepts(
  bookId: string,
  clusters: readonly Cluster[],
  ordinals: ReadonlyMap<string, number>,
  existingIds: ReadonlyMap<string, string> = new Map(),
): Concept[] {
  const out = new Map<string, Concept>()
  for (const c of clusters) {
    const canonical = canonicalName(c)
    const def = [...c.defines].sort((a, b) => a.ordinal - b.ordinal)[0]
    const usedIn = [...c.sectionIds].sort((a, b) => (ordinals.get(a) ?? 0) - (ordinals.get(b) ?? 0))
    const conceptId = [...c.names.keys()].map((n) => existingIds.get(nameKey(n))).find(Boolean) ?? makeConceptId(bookId, canonical)
    if (out.has(conceptId)) continue
    out.set(conceptId, {
      conceptId,
      bookId,
      canonical,
      aliases: [...c.names.keys()].filter((n) => n !== canonical).sort(),
      ...(def && { definedInSectionId: def.sectionId, definition: def.evidence }),
      firstOrdinal: c.firstOrdinal,
      usedInSectionIds: usedIn,
      spanning: usedIn.length >= 3,
    })
  }
  return [...out.values()]
}
