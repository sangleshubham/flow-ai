// §6 steps 3–5 and 11–13 on jsdom documents: sections, TOC alignment, splits, merges, cross-references.
import { createMemoryRepos, make } from '@illus/core/testing'
import { describe, expect, test } from 'vitest'

import { buildLexicalIndex, getSectionAt, getSectionForPage, runInSlices } from '../src/index.ts'
import { indexDocs, prose } from './helpers.ts'

const titles = async (...args: Parameters<typeof indexDocs>) =>
  (await indexDocs(...args)).sections.map((s) => [s.level, s.title, s.number ?? null, s.parentId ? 'child' : 'root'])

describe('headings (§6 steps 4, 5)', () => {
  test('h1–h4 start sections, h5/h6 do not', async () => {
    expect(
      await titles(['<h1>1 A</h1><p>a</p><h2>1.1 B</h2><p>b</p><h3>C</h3><p>c</p><h4>D</h4><p>d</p><h5>E</h5><p>e</p>']),
    ).toEqual([
      [1, '1 A', '1', 'root'],
      [2, '1.1 B', '1.1', 'child'],
      [3, 'C', null, 'child'],
      [4, 'D', null, 'child'],
    ])
  })

  test('tree: parentId, childIds and headingPath', async () => {
    const { sections } = await indexDocs(['<h1>A</h1><p>a</p><h2>B</h2><p>b</p><h2>C</h2><p>c</p><h1>D</h1><p>d</p>'])
    const [a, b, c, d] = sections
    expect(a!.childIds).toEqual([b!.sectionId, c!.sectionId])
    expect(c!.headingPath).toEqual(['A', 'C'])
    expect(d!.parentId).toBeUndefined()
    expect(sections.map((s) => s.ordinal)).toEqual([0, 1, 2, 3])
    expect(b!.sectionId).toBe('00112233aabbccdd:0:a/b:1')
    expect(b!.blockIds).toEqual(['00112233aabbccdd:0:a/b:1#b0'])
  })

  test('the tree continues across spine items', async () => {
    const { sections } = await indexDocs(['<h1>A</h1><p>a</p>', '<h2>B</h2><p>b</p>'])
    expect(sections[1]!.parentId).toBe(sections[0]!.sectionId)
  })

  test('a spine item without headings is one section titled from its TOC entry, at its TOC depth', async () => {
    const toc = [{ href: 'a.xhtml', label: 'Part I', subitems: [{ href: 'b.xhtml', label: 'Preface' }] }]
    const { sections } = await indexDocs(
      [
        { href: 'a.xhtml', body: '<h1>Part I</h1><p>x</p>' },
        { href: 'b.xhtml', body: '<p>No heading.</p>' },
      ],
      toc,
    )
    expect(sections[1]).toMatchObject({ title: 'Preface', level: 2, headingPath: ['Part I', 'Preface'] })
  })

  test('without a TOC entry the document title is used', async () => {
    expect(await titles([{ href: 'x.xhtml', body: '<p>text</p>', title: 'Colophon' }])).toEqual([[1, 'Colophon', null, 'root']])
  })

  test('text before the first heading is its own section', async () => {
    expect(await titles([{ href: 'x.xhtml', body: '<p>intro</p><h1>1 One</h1><p>a</p>', title: 'T' }])).toEqual([
      [1, 'T', null, 'root'],
      [1, '1 One', '1', 'root'],
    ])
  })

  test('TOC labels give clean titles: by heading id, by enclosing anchor, by file for the first heading', async () => {
    const toc = [
      { href: 'c.xhtml', label: 'Chapter 7 Clean' },
      { href: 'c.xhtml#s1', label: '7.1 Clean Sub' },
      { href: 'c.xhtml#wrap', label: '7.2 Wrapped' },
    ]
    const body =
      '<h1>Chapter 7 Messy<sup>*</sup></h1><p>a</p><h2 id="s1">7.1 messy</h2><p>b</p><section id="wrap"><h2>7.2 messy</h2><p>c</p></section>'
    expect(await titles([{ href: 'c.xhtml', body }], toc)).toEqual([
      [1, 'Chapter 7 Clean', '7', 'root'],
      [2, '7.1 Clean Sub', '7.1', 'child'],
      [2, '7.2 Wrapped', '7.2', 'child'],
    ])
  })

  test('empty headings and anchor-only headings start no section', async () => {
    expect(await titles(['<h1>A</h1><p>a</p><h2></h2><p>b</p><h2> <a id="x"></a> </h2><p>c</p>'])).toEqual([[1, 'A', null, 'root']])
  })

  test('<section epub:type="subchapter"> raises an h1 to level 2', async () => {
    const body =
      '<section epub:type="chapter"><h1>A</h1><p>a</p><section epub:type="subchapter"><h1>B</h1><p>b</p></section></section>'
    expect(await titles([body])).toEqual([
      [1, 'A', null, 'root'],
      [2, 'B', null, 'child'],
    ])
  })

  test('O\'Reilly HTMLBook <section data-type="sect1"> nests its h1 under the chapter h1', async () => {
    const body =
      '<section data-type="chapter" epub:type="chapter"><h1>Replication</h1><p>a</p>' +
      '<section data-type="sect1"><h1>Single-Leader</h1><p>b</p><section data-type="sect2"><h2>Followers</h2><p>c</p></section></section>' +
      '<section data-type="sect1"><h1>Leaderless</h1><p>d</p></section></section>'
    expect(await titles([body])).toEqual([
      [1, 'Replication', null, 'root'],
      [2, 'Single-Leader', null, 'child'],
      [3, 'Followers', null, 'child'],
      [2, 'Leaderless', null, 'child'],
    ])
  })

  test('cfiStart is the heading, cfiEnd the end of the last block', async () => {
    const { sections, blocks } = await indexDocs(['<h1 id="h">A</h1><p>one</p><p>two</p>'])
    expect(sections[0]!.cfiStart).toBe('epubcfi(/6/2!/4/2[h])')
    expect(sections[0]!.cfiEnd).toBe('epubcfi(/6/2!/4/6/1:3)')
    expect(blocks[1]!.cfiRange).toBe('epubcfi(/6/2!/4/6,/1:0,/1:3)')
  })

  test('contentHash and tokenEstimate', async () => {
    const { sections } = await indexDocs(['<h1>A</h1><p>abc</p><pre>abcdef</pre>'])
    expect(sections[0]!.tokenEstimate).toBe(1 + 2)
    expect(sections[0]!.contentHash).toMatch(/^[0-9a-f]{64}$/)
    const again = await indexDocs(['<h1>A</h1><p>abc</p><pre>abcdef</pre>'])
    const changed = await indexDocs(['<h1>A</h1><p>abd</p><pre>abcdef</pre>'])
    expect(again.sections[0]!.contentHash).toBe(sections[0]!.contentHash)
    expect(changed.sections[0]!.contentHash).not.toBe(sections[0]!.contentHash)
  })
})

describe('oversized sections (§6 step 11)', () => {
  test('at or under 6,000 tokens: no split', async () => {
    const { sections } = await indexDocs([`<h1>A</h1>${prose(6000)}`])
    expect(sections).toHaveLength(1)
    expect(sections[0]!.tokenEstimate).toBe(6000)
  })

  test('over 6,000 tokens without h5/h6: ~3,000-token parts at paragraph boundaries', async () => {
    const { sections } = await indexDocs([`<h1 id="a">2 A</h1>${prose(6500)}<h2>2.1 B</h2><p>b</p>`])
    expect(sections.map((s) => [s.title, s.tokenEstimate, s.level])).toEqual([
      ['2 A (part 1)', 2100, 1],
      ['2 A (part 2)', 2100, 1],
      ['2 A (part 3)', 2300, 1],
      ['2.1 B', 1, 2],
    ])
    expect(sections.every((s, i) => i === 3 || s.number === '2')).toBe(true)
    expect(sections[1]!.cfiStart).not.toBe(sections[0]!.cfiStart)
  })

  test('never cuts between a caption and its listing', async () => {
    const body = `<h1>A</h1>${prose(3000)}<p class="caption">Listing 1 X</p><pre>${'x'.repeat(9000)}</pre>`
    const { sections, blocks } = await indexDocs([body])
    const caption = blocks.find((b) => b.text.startsWith('Listing 1'))!
    const code = blocks.find((b) => b.kind === 'code')!
    expect(caption.sectionId).toBe(code.sectionId)
    expect(sections.length).toBeGreaterThan(1)
  })

  test('with h5 headings: split before each h5; later parts are titled by their h5', async () => {
    const body = `<h1>1 A</h1><h5>One</h5>${prose(3500)}<h5>Two</h5>${prose(3500)}`
    const { sections, blocks } = await indexDocs([body])
    expect(sections.map((s) => [s.title, s.number, s.headingPath])).toEqual([
      ['1 A', '1', ['1 A']],
      ['Two', '1', ['Two']],
    ])
    expect(blocks.find((b) => b.sectionId === sections[1]!.sectionId)!.text).toBe('Two')
  })
})

describe('tiny sections (§6 step 12)', () => {
  test('under 80 tokens with a child → mergedInto the first child; chains resolve', async () => {
    const { sections } = await indexDocs([`<h1>A</h1><h2>B</h2><p>short</p><h3>C</h3>${prose(100)}<h3>D</h3><p>d</p>`])
    const [a, b, c] = sections
    expect(b!.mergedInto).toBe(c!.sectionId)
    expect(a!.mergedInto).toBe(c!.sectionId)
    expect(c!.mergedInto).toBeUndefined()
  })
  test('tiny sections without children stay', async () => {
    const { sections } = await indexDocs(['<h1>A</h1><p>a</p><h1>B</h1><p>b</p>'])
    expect(sections.every((s) => s.mergedInto === undefined)).toBe(true)
  })
  test('80 tokens or more is not tiny', async () => {
    const { sections } = await indexDocs([`<h1>A</h1>${prose(100)}<h2>B</h2><p>b</p>`])
    expect(sections[0]!.mergedInto).toBeUndefined()
  })
})

describe('cross-references (§6 step 13)', () => {
  const book = () =>
    indexDocs([
      {
        href: 'Text/ch1.xhtml',
        body: `<h1 id="c1">1 One</h1><p>Intro.</p><h2 id="s12">1.2 Code</h2>
          <p class="caption" id="l11">Listing 1.1 Search</p><pre>code</pre>
          <p class="caption">Table 1.1 Types</p><table><tr><td>x</td></tr></table>
          <figure><img src="a.png"/><figcaption>Figure 1.3 A figure</figcaption></figure>`,
      },
      {
        href: 'Text/ch2.xhtml',
        body: `<h1>2 Two</h1>
          <p>Links: <a href="ch1.xhtml#l11">the listing</a>, <a href="ch1.xhtml">chapter one</a>, <a href="#here">here</a>,
             <a href="ch1.xhtml#missing">gone</a>, <a href="https://example.com/">web</a>, <a href="../Text/ch1.xhtml#s12">up and back</a>.</p>
          <p id="here">See Listing 1.1, Fig. 1.3, Table 1.1, Section 1.2 and Chapter 1; Figure 9.9 and Appendix 3 do not exist.</p>
          <p>Linked text is not counted twice: <a href="ch1.xhtml#l11">Listing 1.1</a>. Listing 1.1 again.</p>`,
      },
    ])

  test('links resolve to the block or heading carrying the id, or to the file’s first section', async () => {
    const { sections, blocks, crossRefs } = await book()
    const code = blocks.find((b) => b.kind === 'code')!
    const links = crossRefs.filter((r) => r.kind === 'link' && r.fromBlockId === blocks.find((b) => b.text.startsWith('Links'))!.blockId)
    const here = blocks.find((b) => b.text.startsWith('See'))!
    expect(links.map(({ label, targetSectionId, targetBlockId, resolved }) => ({ label, targetSectionId, targetBlockId, resolved }))).toEqual([
      { label: 'the listing', targetSectionId: code.sectionId, targetBlockId: code.blockId, resolved: true },
      { label: 'chapter one', targetSectionId: sections[0]!.sectionId, targetBlockId: undefined, resolved: true },
      { label: 'here', targetSectionId: here.sectionId, targetBlockId: here.blockId, resolved: true },
      { label: 'gone', targetSectionId: undefined, targetBlockId: undefined, resolved: false },
      { label: 'up and back', targetSectionId: sections[1]!.sectionId, targetBlockId: undefined, resolved: true },
    ])
  })

  test('textual references resolve through labels and section numbers; the rest stay unresolved', async () => {
    const { sections, blocks, crossRefs } = await book()
    const from = blocks.find((b) => b.text.startsWith('See'))!.blockId
    const byKind = (k: string) => blocks.find((b) => b.kind === k)!
    const refs = crossRefs.filter((r) => r.fromBlockId === from)
    expect(refs.map(({ label, targetBlockId, targetSectionId, resolved }) => [label, targetBlockId ?? targetSectionId ?? null, resolved])).toEqual([
      ['Listing 1.1', byKind('code').blockId, true],
      ['Fig. 1.3', byKind('figure').blockId, true],
      ['Table 1.1', byKind('table').blockId, true],
      ['Section 1.2', sections[1]!.sectionId, true],
      ['Chapter 1', sections[0]!.sectionId, true],
      ['Figure 9.9', null, false],
      ['Appendix 3', null, false],
    ])
  })

  test('no self-references from captions; a linked label is not counted again; one ref per label per block', async () => {
    const { blocks, crossRefs } = await book()
    const captionIds = new Set(blocks.filter((b) => /^(Listing|Table|Figure) 1/.test(b.text)).map((b) => b.blockId))
    expect(crossRefs.filter((r) => captionIds.has(r.fromBlockId))).toEqual([])
    const last = blocks.find((b) => b.text.startsWith('Linked'))!.blockId
    expect(crossRefs.filter((r) => r.fromBlockId === last).map((r) => [r.kind, r.label])).toEqual([['link', 'Listing 1.1']])
  })

  test('code blocks are not scanned for textual references', async () => {
    const { crossRefs } = await indexDocs(['<pre>Table 1 = {}</pre>'])
    expect(crossRefs).toEqual([])
  })
})

test('idle slices: work stops when the deadline runs out and resumes on the next callback', async () => {
  let calls = 0
  function* work() {
    for (let i = 0; i < 5; i++) yield
    return 'done'
  }
  const result = await runInSlices(work(), (run) => {
    calls++
    run({ timeRemaining: () => 0 })
  })
  expect(result).toBe('done')
  expect(calls).toBe(6)
})

describe('getSectionAt (§14)', () => {
  test('binary search over cfiStart within the spine item', async () => {
    const { sections } = await indexDocs([
      '<p>pre</p><h1 id="a">A</h1><p>a</p><h2>B</h2><p>b</p>',
      '<h1>C</h1><p>c</p>',
    ])
    const [pre, a, b, c] = sections
    expect(getSectionAt(sections, 'epubcfi(/6/2!/4/2/1:0)')).toBe(pre)
    expect(getSectionAt(sections, 'epubcfi(/6/2!/4/4[a]/1:0)')).toBe(a)
    expect(getSectionAt(sections, 'epubcfi(/6/2!/4/6/1:0)')).toBe(a)
    expect(getSectionAt(sections, 'epubcfi(/6/2!/4/10/1:1)')).toBe(b)
    expect(getSectionAt(sections, 'epubcfi(/6/2!/4/10,/1:0,/1:1)')).toBe(b)
    expect(getSectionAt(sections, 'epubcfi(/6/4!/4/1:0)')).toBe(c) // before the first heading of its spine item
    expect(getSectionAt(sections, 'epubcfi(/6/4!/4/4/1:0)')).toBe(c)
    expect(getSectionAt(sections, 'epubcfi(/6/8!/4/2)')).toBeNull()
  })
})

describe('getSectionForPage (ADR 0053)', () => {
  const sections = [2, 4, 8].map((offset, ordinal) =>
    make.sectionNode({
      sectionId: ['a', 'b', 'c'][ordinal],
      spineIndex: 0,
      ordinal,
      cfiStart: `epubcfi(/6/2!/4/${offset})`,
    }),
  )
  test.each([
    ['/4/2/1:10', '/4/6', 'b'],
    ['/4/2/1:10', '/4/8/1:3', 'c'],
    ['/4/4/1:2', '/4/6', 'b'],
    ['/4/4', '/4/6', 'b'],
    ['/4/2/1:10', '/4/4', 'b'],
  ])('page %s to %s belongs to %s', (start, end, sectionId) => {
    expect(
      getSectionForPage(
        sections,
        `epubcfi(/6/2!${start})`,
        `epubcfi(/6/2!${end})`,
      )?.sectionId,
    ).toBe(sectionId)
  })
  test('without an end, uses the section containing the page start', () => {
    const start = 'epubcfi(/6/2!/4/2/1:10)'
    expect(getSectionForPage(sections, start)).toBe(
      getSectionAt(sections, start),
    )
  })
  test('does not choose a later spine item before its first heading', () => {
    const next = make.sectionNode({
      spineIndex: 1,
      ordinal: 3,
      cfiStart: 'epubcfi(/6/4!/4/4)',
    })
    expect(
      getSectionForPage(
        [...sections, next],
        'epubcfi(/6/2!/4/8/1:3)',
        'epubcfi(/6/4!/4/2)',
      ),
    ).toBe(sections[2])
  })
})

test('lexical index: only earlier ordinals, folded text, top 3 by default', async () => {
  const { sections, blocks } = await indexDocs([
    '<h1>A</h1><p>The ﬁrst quorum rule.</p><p>A quorum is a majority.</p><h1>B</h1><p>Quorum again.</p><p>quorum</p><p>quorum quorum</p><p>quorum!</p>',
  ])
  const index = buildLexicalIndex(blocks, sections)
  expect(index.search('quorum', { beforeOrdinal: 1 }).map((h) => h.ordinal)).toEqual([0, 0])
  expect(index.search('first', { beforeOrdinal: 1 })).toMatchObject([{ blockId: blocks[0]!.blockId, sectionId: sections[0]!.sectionId }])
  expect(index.search('quorum', { beforeOrdinal: 2 })).toHaveLength(3)
  expect(index.search('quorum', { beforeOrdinal: 0 })).toEqual([])
})

test('built records satisfy the @illus/core schemas', async () => {
  const repos = createMemoryRepos() // validates with Zod on write
  const { sections, blocks, crossRefs } = await indexDocs([`<h1>1 A</h1><p>See Listing 1.</p><pre class="language-go">x</pre>${prose(7000)}`])
  await repos.sections.bulkPut(sections)
  await repos.blocks.bulkPut(blocks)
  await repos.crossRefs.bulkAdd(crossRefs)
})
