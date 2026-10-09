// §6 step 6 (block classification, first match wins) and step 7 (labels), on jsdom documents.
import { describe, expect, test } from 'vitest'

import { indexDocs, kinds } from './helpers.ts'

describe('code', () => {
  test.each([
    ['<pre>x = 1</pre>', undefined],
    ['<pre><code class="language-python">x = 1</code></pre>', 'python'],
    ['<div class="programlisting">x = 1</div>', undefined],
    ['<div class="listing"><pre class="brush: go">x := 1</pre></div>', 'go'],
    ['<div data-type="programlisting"><code class="lang-shell">ls</code></div>', 'shell'],
    ['<pre class="highlight-js">let x</pre>', 'js'],
    ['<pre class="brush:rust">let x</pre>', 'rust'],
  ])('%s', async (body, langHint) => {
    const { blocks } = await indexDocs([body])
    expect(blocks).toHaveLength(1)
    expect(blocks[0]!.kind).toBe('code')
    expect(blocks[0]!.code?.langHint).toBe(langHint)
  })

  test('source keeps indentation, text collapses it', async () => {
    const { blocks } = await indexDocs(['<pre>\ndef f():\n    return 1\n</pre>'])
    expect(blocks[0]!.code?.source).toBe('def f():\n    return 1')
    expect(blocks[0]!.text).toBe('def f(): return 1')
  })
})

describe('figure', () => {
  test('figure > img + figcaption', async () => {
    const { blocks } = await indexDocs(['<figure id="f"><img src="a.png" alt="Alt"/><figcaption>Figure 2.1 A cluster</figcaption></figure>'])
    expect(blocks).toMatchObject([
      { kind: 'figure', text: 'Figure 2.1 A cluster', label: 'Figure 2.1', figure: { caption: 'Figure 2.1 A cluster', alt: 'Alt', imgHref: 'a.png' } },
    ])
  })
  test('img followed by p.caption is one figure', async () => {
    const { blocks } = await indexDocs(['<p>Before.</p><img src="b.png" alt="Log"/><p class="caption">Fig. 2.2 A log</p><p>After.</p>'])
    expect(blocks.map((b) => [b.kind, b.text, b.label])).toEqual([
      ['paragraph', 'Before.', undefined],
      ['figure', 'Fig. 2.2 A log', 'Fig. 2.2'],
      ['paragraph', 'After.', undefined],
    ])
    expect(blocks[1]!.figure).toEqual({ caption: 'Fig. 2.2 A log', alt: 'Log', imgHref: 'b.png' })
  })
  test('img wrapped in a div, then a caption', async () => {
    expect(await kinds('<div><img src="c.png"/></div><p class="caption">Figure 1 Wrapped</p>')).toEqual([['figure', 'Figure 1 Wrapped']])
  })
  test('img without a caption is skipped (no text)', async () => {
    expect(await kinds('<p><img src="c.png"/></p><p>Text.</p>')).toEqual([['paragraph', 'Text.']])
  })
})

test('table rows are text cells; <caption> gives the label', async () => {
  const { blocks } = await indexDocs([
    '<table><caption>Table 2.4 Ops</caption><thead><tr><th>A</th><th>B</th></tr></thead><tbody><tr><td>1</td><td> 2 </td></tr></tbody></table>',
  ])
  expect(blocks[0]).toMatchObject({ kind: 'table', label: 'Table 2.4', text: 'Table 2.4 Ops A B 1 2', table: { rows: [['A', 'B'], ['1', '2']] } })
  expect(blocks[0]!.table!.html).toContain('<caption>Table 2.4 Ops</caption>')
})

test('MathML block takes TeX from the annotation, which is not part of the text', async () => {
  const { blocks } = await indexDocs([
    '<math xmlns="http://www.w3.org/1998/Math/MathML" display="block"><semantics><mrow><mi>a</mi><mo>=</mo><mi>b</mi></mrow><annotation encoding="application/x-tex">a = b</annotation></semantics></math>',
  ])
  expect(blocks[0]).toMatchObject({ kind: 'math', text: 'a=b', math: { tex: 'a = b' } })
  expect(blocks[0]!.math!.mathml).toContain('<mi>a</mi>')
})

test('inline MathML stays inside its paragraph', async () => {
  expect(await kinds('<p>Needs <math xmlns="http://www.w3.org/1998/Math/MathML"><mi>q</mi></math> votes.</p>')).toEqual([
    ['paragraph', 'Needs q votes.'],
  ])
})

test.each(['<ul><li>a</li><li>b</li></ul>', '<ol><li>a</li><li>b</li></ol>', '<dl><dt>a</dt><dd>b</dd></dl>'])('list %s', async (body) => {
  expect(await kinds(body)).toEqual([['list', 'a b']])
})

test.each([
  '<aside><p>x</p></aside>',
  '<blockquote><p>x</p></blockquote>',
  '<div class="note"><p>x</p></div>',
  '<div class="tip"><p>x</p></div>',
  '<div class="warning"><p>x</p></div>',
  '<div class="sidebar"><p>x</p></div>',
  '<div epub:type="footnote"><p>x</p></div>',
])('aside %s', async (body) => {
  expect(await kinds(body)).toEqual([['aside', 'x']])
})

describe('paragraphs and skipping', () => {
  test('everything else with text is a paragraph; nav, script, style and empty nodes are skipped', async () => {
    expect(
      await kinds(
        '<nav><ol><li>toc</li></ol></nav><p>One <em>two</em>.</p><p>  </p><div>Three</div><script>x()</script><style>p{}</style><hr/>',
      ),
    ).toEqual([
      ['paragraph', 'One two.'],
      ['paragraph', 'Three'],
    ])
  })
  test('loose text between blocks becomes its own paragraph', async () => {
    expect(await kinds('<div><p>A.</p>loose <b>text</b><p>B.</p></div>')).toEqual([
      ['paragraph', 'A.'],
      ['paragraph', 'loose text'],
      ['paragraph', 'B.'],
    ])
  })
  test('footnote back-links are not part of the text', async () => {
    const body =
      '<p>Claim.<a epub:type="noteref" href="#fn1" id="r1">1</a></p><aside epub:type="footnote" id="fn1"><p><a href="#r1">1.</a> The note.</p></aside>'
    expect(await kinds(body)).toEqual([
      ['paragraph', 'Claim.1'],
      ['aside', 'The note.'],
    ])
  })
})

describe('first match wins', () => {
  test('a pre with a note class is code', async () => {
    expect((await kinds('<pre class="note">x</pre>'))[0]![0]).toBe('code')
  })
  test('an aside holding a listing is one aside', async () => {
    expect(await kinds('<aside><pre>x</pre></aside>')).toEqual([['aside', 'x']])
  })
  test('a figure holding a table is a figure', async () => {
    expect((await kinds('<figure><table><tr><td>x</td></tr></table></figure>'))[0]![0]).toBe('figure')
  })
})

describe('listing and table captions (§6 step 7)', () => {
  test('caption before a pre labels it; the caption stays a paragraph', async () => {
    const { blocks } = await indexDocs(['<p class="caption">Listing 1.1 Binary search</p><pre>code</pre>'])
    expect(blocks.map((b) => [b.kind, b.label])).toEqual([
      ['paragraph', undefined],
      ['code', 'Listing 1.1'],
    ])
  })
  test('caption after a pre labels it', async () => {
    const { blocks } = await indexDocs(['<pre>code</pre><p>Example 3.2 Hello world</p>'])
    expect(blocks[0]!.label).toBe('Example 3.2')
  })
  test('a caption two siblings away does not attach', async () => {
    const { blocks } = await indexDocs(['<p class="caption">Listing 1.1 X</p><p>Gap paragraph.</p><pre>code</pre>'])
    expect(blocks[2]!.label).toBeUndefined()
    expect(blocks[0]!.label).toBe('Listing 1.1') // orphan caption keeps its own label
  })
  test('a long paragraph starting with "Listing" is not a caption', async () => {
    const { blocks } = await indexDocs([
      '<p>Listing 1.1 shows the loop that we will now walk through line by line, explaining each of its parts.</p><pre>code</pre>',
    ])
    expect(blocks[1]!.label).toBeUndefined()
  })
  test('table caption paragraph labels the table, a Listing caption does not', async () => {
    const t = await indexDocs(['<p class="caption">Table 1.1 Types</p><table><tr><td>a</td></tr></table>'])
    expect(t.blocks[1]!.label).toBe('Table 1.1')
    const l = await indexDocs(['<p class="caption">Listing 1.1 Types</p><table><tr><td>a</td></tr></table>'])
    expect(l.blocks[1]!.label).toBeUndefined()
  })
})
