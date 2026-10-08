// Builds fixtures/books/synthetic.epub: a small, original (CC0) EPUB 3 that exercises every edge case of
// spec §18 and the indexing rules of §6. Deterministic: same script → byte-identical file.
//
//   pnpm fixtures:epub            (= node fixtures/scripts/make-synthetic-epub.ts)
//
// Edge cases (see fixtures/README.md for where each one lives):
//   no headings · MathML with TeX annotations · tables · captioned listings · internal links ·
//   textual cross-references (resolvable and not) · footnotes · oversized sections (with and without h5) ·
//   empty headings · tiny section · epub:type sections · figures (figcaption and p.caption) · lists · asides ·
//   soft hyphens, ligatures and smart quotes · language-* code classes · scripted content · a linked stylesheet
import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import JSZip from 'jszip'

const OUT = resolve(dirname(fileURLToPath(import.meta.url)), '../books/synthetic.epub')
const DATE = new Date('2026-01-01T00:00:00Z')
const MODIFIED = '2026-01-01T00:00:00Z'

// 1×1 transparent PNG.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
)

const xhtml = (title: string, body: string, extraNs = '') => `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"${extraNs} lang="en" xml:lang="en">
<head>
  <meta charset="UTF-8"/>
  <title>${title}</title>
  <link rel="stylesheet" type="text/css" href="style.css"/>
</head>
<body>
${body}
</body>
</html>
`

// Deterministic filler prose for the oversized sections (original text).
const SENTENCES = [
  'A replicated log keeps every server in agreement about the order of commands.',
  'Each server applies committed commands to its state machine in log order.',
  'The leader sends heartbeats so that followers know it is still alive.',
  'When a follower misses heartbeats it starts an election for a new term.',
  'Terms act as a logical clock that orders leaders over time.',
  'A log entry carries the term in which the leader received it.',
  'Followers reject entries that do not match the previous index and term.',
  'Snapshots compact the log once its prefix has been applied everywhere.',
]
function prose(chars: number, seed: number): string {
  const paras: string[] = []
  let total = 0
  let i = seed
  while (total < chars) {
    const para = Array.from({ length: 6 }, () => SENTENCES[i++ % SENTENCES.length]).join(' ')
    paras.push(`<p>${para}</p>`)
    total += para.length
  }
  return paras.join('\n')
}

const files: Record<string, string> = {}

files['OEBPS/style.css'] = `body { font-family: serif; line-height: 1.5; }
pre { font-family: monospace; white-space: pre-wrap; }
.note { border-left: 3px solid #888; padding-left: 0.5em; }
.caption { font-style: italic; }
`

// ---------------------------------------------------------------- front matter: no headings at all
files['OEBPS/front.xhtml'] = xhtml(
  'Preface',
  `<p>This synthetic book exists to test an EPUB indexer. It has no headings on this page, so its section title must come from the table of contents.</p>
<p>Everything in it is original text released under CC0.</p>`,
)

// ---------------------------------------------------------------- chapter 1: lists, tables, listings, asides, footnotes
files['OEBPS/ch01.xhtml'] = xhtml(
  'Chapter 1 Basics',
  `<h1 id="ch1">Chapter 1 Basics</h1>
<p>This chapter introduces the “basic” building blocks. It uses soft hy­phens, the ﬁrst ligature and the ﬂow ligature on purpose.</p>

<h2 id="s1-1">1.1 Lists and Tables</h2>
<p>A server can be in three states:</p>
<ul><li>follower</li><li>candidate</li><li>leader</li></ul>
<ol><li>Receive a request.</li><li>Append it to the log.</li><li>Replicate it.</li></ol>
<dl><dt>Term</dt><dd>A monotonically increasing election number.</dd></dl>
<p class="caption">Table 1.1 Message types</p>
<table id="table-1-1">
  <thead><tr><th>Message</th><th>Sender</th><th>Purpose</th></tr></thead>
  <tbody>
    <tr><td>RequestVote</td><td>candidate</td><td>ask for a vote</td></tr>
    <tr><td>AppendEntries</td><td>leader</td><td>replicate entries and send heartbeats</td></tr>
  </tbody>
</table>

<h2 id="s1-2">1.2 Code</h2>
<p>The search in Listing 1.1 halves the range on every step.<a epub:type="noteref" href="#fn1" id="fnref1">1</a></p>
<p class="caption" id="listing-1-1">Listing 1.1 Binary search</p>
<pre class="programlisting"><code class="language-python">def binary_search(items, target):
    lo, hi = 0, len(items) - 1
    while lo &lt;= hi:
        mid = (lo + hi) // 2
        if items[mid] == target:
            return mid
        if items[mid] &lt; target:
            lo = mid + 1
        else:
            hi = mid - 1
    return -1</code></pre>
<div class="listing" data-type="programlisting"><pre class="brush: go">func add(a, b int) int {
	return a + b
}</pre></div>
<p>Run the program from a shell:</p>
<pre><code class="lang-shell">python search.py</code></pre>
<aside class="note"><p>Note: the loop invariant is that the target, if present, lies between lo and hi.</p></aside>
<blockquote><p>Simplicity is a prerequisite for reliability.</p></blockquote>
<div class="warning"><p>Warning: integer overflow is not an issue in Python.</p></div>
<aside epub:type="footnote" id="fn1"><p><a href="#fnref1">1.</a> Halving gives a logarithmic number of steps.</p></aside>`,
)

// ---------------------------------------------------------------- chapter 2: math, figures, links, cross-refs, empty and tiny headings
files['OEBPS/ch02.xhtml'] = xhtml(
  'Chapter 2 Math and Figures',
  `<section epub:type="chapter" id="ch2">
<h1>Chapter 2 Math and Figures</h1>
<p>As we saw in Chapter 1, the search halves its range; see Section 1.2 and <a href="ch01.xhtml#listing-1-1">Listing 1.1</a>.</p>

<section epub:type="subchapter">
<h2 id="s2-1">2.1 Formulas</h2>
<p>The number of steps of the search in Listing 1.1 is bounded by the formula below.</p>
<math xmlns="http://www.w3.org/1998/Math/MathML" display="block">
  <semantics>
    <mrow><mi>steps</mi><mo>=</mo><mrow><mo>⌊</mo><msub><mi>log</mi><mn>2</mn></msub><mi>n</mi><mo>⌋</mo></mrow><mo>+</mo><mn>1</mn></mrow>
    <annotation encoding="application/x-tex">\\text{steps} = \\lfloor \\log_2 n \\rfloor + 1</annotation>
  </semantics>
</math>
<p>Here n is the number of items. A quorum needs <math xmlns="http://www.w3.org/1998/Math/MathML"><mi>q</mi><mo>&gt;</mo><mfrac><mi>n</mi><mn>2</mn></mfrac></math> votes.</p>
</section>

<section epub:type="subchapter">
<h2 id="s2-2">2.2 Figures</h2>
<figure id="figure-2-1">
  <img src="images/pixel.png" alt="A cluster of three servers"/>
  <figcaption>Figure 2.1 A cluster of three servers</figcaption>
</figure>
<img src="images/pixel.png" alt="A log with five entries"/>
<p class="caption">Figure 2.2 A log with five entries</p>
<p>Figure 2.1 shows the cluster and Table 1.1 lists its messages. Figure 9.9 does not exist and must stay unresolved.</p>
<p>The <a href="#s2-1">formulas section</a> and <a href="ch01.xhtml#table-1-1">the message table</a> are internal links.</p>
</section>

<h2></h2>
<p>This paragraph follows an empty heading.</p>

<h2> <a id="anchor-only"></a> </h2>
<p>This paragraph follows a heading that contains only an anchor.</p>

<h2 id="s2-3">2.3 A Tiny Section</h2>
<h3 id="s2-3-1">2.3.1 Straight Into a Subheading</h3>
<p>The parent heading above has no text of its own, so it should be merged into this subsection for generation.</p>
</section>`,
)

// ---------------------------------------------------------------- chapter 3: oversized sections
files['OEBPS/ch03.xhtml'] = xhtml(
  'Chapter 3 Long Sections',
  `<h1 id="ch3">Chapter 3 Long Sections</h1>
<h2 id="s3-1">3.1 An Oversized Section Without Subheadings</h2>
${prose(26_000, 0)}
<h2 id="s3-2">3.2 An Oversized Section With h5 Subheadings</h2>
<h5>Part one</h5>
${prose(9_000, 1)}
<h5>Part two</h5>
${prose(9_000, 2)}
<h5>Part three</h5>
${prose(9_000, 3)}`,
)

// ---------------------------------------------------------------- chapter 4: scripted content (must never run)
files['OEBPS/ch04.xhtml'] = xhtml(
  'Chapter 4 Scripted Content',
  `<h1 id="ch4">Chapter 4 Scripted Content</h1>
<p id="script-target">If this sentence changes, a script inside the book ran.</p>
<script type="text/javascript">document.getElementById('script-target').textContent = 'SCRIPT RAN';</script>`,
)

// ---------------------------------------------------------------- navigation
const toc: [string, string, [string, string][]][] = [
  ['front.xhtml', 'Preface', []],
  ['ch01.xhtml#ch1', 'Chapter 1 Basics', [['ch01.xhtml#s1-1', '1.1 Lists and Tables'], ['ch01.xhtml#s1-2', '1.2 Code']]],
  [
    'ch02.xhtml',
    'Chapter 2 Math and Figures',
    [['ch02.xhtml#s2-1', '2.1 Formulas'], ['ch02.xhtml#s2-2', '2.2 Figures'], ['ch02.xhtml#s2-3', '2.3 A Tiny Section']],
  ],
  [
    'ch03.xhtml#ch3',
    'Chapter 3 Long Sections',
    [['ch03.xhtml#s3-1', '3.1 An Oversized Section Without Subheadings'], ['ch03.xhtml#s3-2', '3.2 An Oversized Section With h5 Subheadings']],
  ],
  ['ch04.xhtml#ch4', 'Chapter 4 Scripted Content', []],
]

files['OEBPS/nav.xhtml'] = xhtml(
  'Contents',
  `<nav epub:type="toc" id="toc"><h1>Contents</h1><ol>
${toc
  .map(
    ([href, label, kids]) =>
      `  <li><a href="${href}">${label}</a>${kids.length ? `<ol>${kids.map(([h, l]) => `<li><a href="${h}">${l}</a></li>`).join('')}</ol>` : ''}</li>`,
  )
  .join('\n')}
</ol></nav>`,
)

let playOrder = 0
files['OEBPS/toc.ncx'] = `<?xml version="1.0" encoding="UTF-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
<head><meta name="dtb:uid" content="urn:uuid:illus-synthetic-0001"/></head>
<docTitle><text>Illustrated Reader Synthetic Fixture</text></docTitle>
<navMap>
${toc
  .map(
    ([href, label, kids]) =>
      `<navPoint id="np${++playOrder}" playOrder="${playOrder}"><navLabel><text>${label}</text></navLabel><content src="${href}"/>${kids
        .map(([h, l]) => `<navPoint id="np${++playOrder}" playOrder="${playOrder}"><navLabel><text>${l}</text></navLabel><content src="${h}"/></navPoint>`)
        .join('')}</navPoint>`,
  )
  .join('\n')}
</navMap>
</ncx>
`

const spine = ['front', 'ch01', 'ch02', 'ch03', 'ch04']
files['OEBPS/content.opf'] = `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="uid">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="uid">urn:uuid:illus-synthetic-0001</dc:identifier>
    <dc:title>Illustrated Reader Synthetic Fixture</dc:title>
    <dc:creator>AI Illustrated Reader contributors</dc:creator>
    <dc:language>en</dc:language>
    <dc:rights>CC0 1.0</dc:rights>
    <meta property="dcterms:modified">${MODIFIED}</meta>
  </metadata>
  <manifest>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    <item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>
    <item id="css" href="style.css" media-type="text/css"/>
    <item id="pixel" href="images/pixel.png" media-type="image/png"/>
    <item id="front" href="front.xhtml" media-type="application/xhtml+xml"/>
    <item id="ch01" href="ch01.xhtml" media-type="application/xhtml+xml"/>
    <item id="ch02" href="ch02.xhtml" media-type="application/xhtml+xml" properties="mathml"/>
    <item id="ch03" href="ch03.xhtml" media-type="application/xhtml+xml"/>
    <item id="ch04" href="ch04.xhtml" media-type="application/xhtml+xml" properties="scripted"/>
  </manifest>
  <spine toc="ncx">
${spine.map((id) => `    <itemref idref="${id}"/>`).join('\n')}
  </spine>
</package>
`

files['META-INF/container.xml'] = `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>
`

// ---------------------------------------------------------------- zip (mimetype first, stored)
const zip = new JSZip()
zip.file('mimetype', 'application/epub+zip', { compression: 'STORE', date: DATE, createFolders: false })
for (const name of Object.keys(files).sort()) zip.file(name, files[name]!, { date: DATE, createFolders: false })
zip.file('OEBPS/images/pixel.png', PNG, { date: DATE, binary: true, createFolders: false })

const bytes = await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE', compressionOptions: { level: 9 } })

// Self-check: OCF requires `mimetype` as the first, uncompressed entry (local header at offset 0).
const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
assert.equal(view.getUint32(0, true), 0x04034b50, 'zip local header')
assert.equal(view.getUint16(8, true), 0, 'mimetype stored, not deflated')
assert.equal(new TextDecoder().decode(bytes.subarray(30, 38)), 'mimetype')
const reread = await JSZip.loadAsync(bytes)
for (const [id, href] of [...files['OEBPS/content.opf']!.matchAll(/id="([^"]+)" href="([^"]+)"/g)].map((m) => [m[1], m[2]]))
  assert.ok(reread.file(`OEBPS/${href}`), `manifest item ${id} → ${href} is in the zip`)
assert.ok(prose(26_000, 0).length / 3.6 > 6000, 'section 3.1 is oversized (> 6,000 tokens)')

mkdirSync(dirname(OUT), { recursive: true })
writeFileSync(OUT, bytes)
console.log(`wrote ${OUT} (${bytes.length} bytes)`)
