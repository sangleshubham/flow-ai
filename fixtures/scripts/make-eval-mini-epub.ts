// Builds fixtures/books/eval/eval-mini.epub from the `eval-mini` sections W10 wrote for the eval harness
// (evals/src/books/eval-mini.ts, original CC0 text). One spine item per section, a single h1 each, so the
// indexer yields exactly those sections and blocks. Deterministic: same input → byte-identical file.
//
//   pnpm fixtures:epub            (builds this and synthetic.epub)
//
// It lives in a subfolder so @illus/book-index's per-book snapshot test (fixtures/books/*.epub) does not
// pick it up; fixtures/scripts/test/eval-mini.test.ts indexes it instead.
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { EVAL_MINI_SECTIONS } from '../../evals/src/books/eval-mini.ts'

import { zipEpub } from './zip-epub.ts'

export const EVAL_MINI_EPUB = resolve(dirname(fileURLToPath(import.meta.url)), '../books/eval/eval-mini.epub')

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

const xhtml = (title: string, body: string) => `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" lang="en" xml:lang="en">
<head>
  <meta charset="UTF-8"/>
  <title>${esc(title)}</title>
</head>
<body>
${body}
</body>
</html>
`

function blockHtml(kind: string, text: string): string {
  if (kind === 'paragraph') return `<p>${esc(text)}</p>`
  if (kind === 'code') return `<pre><code class="language-python">${esc(text)}</code></pre>`
  throw new Error(`eval-mini block kind ${kind} has no EPUB mapping yet`)
}

export function evalMiniFiles(): Record<string, string> {
  const files: Record<string, string> = {}
  const items = EVAL_MINI_SECTIONS.map((s, i) => ({ id: `s${i + 1}`, href: `s${i + 1}.xhtml`, title: s.title }))

  EVAL_MINI_SECTIONS.forEach((s, i) => {
    const body = [`<section epub:type="chapter" id="${items[i]!.id}">`, `<h1>${esc(s.title)}</h1>`, ...s.blocks.map((b) => blockHtml(b.kind, b.text)), '</section>']
    files[`OEBPS/${items[i]!.href}`] = xhtml(s.title, body.join('\n'))
  })

  files['OEBPS/nav.xhtml'] = xhtml(
    'Contents',
    `<nav epub:type="toc" id="toc"><h1>Contents</h1><ol>
${items.map((it) => `  <li><a href="${it.href}">${esc(it.title)}</a></li>`).join('\n')}
</ol></nav>`,
  )

  files['OEBPS/toc.ncx'] = `<?xml version="1.0" encoding="UTF-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
<head><meta name="dtb:uid" content="urn:uuid:illus-eval-mini-0001"/></head>
<docTitle><text>Illustrated Reader Eval Mini</text></docTitle>
<navMap>
${items.map((it, i) => `<navPoint id="np${i + 1}" playOrder="${i + 1}"><navLabel><text>${esc(it.title)}</text></navLabel><content src="${it.href}"/></navPoint>`).join('\n')}
</navMap>
</ncx>
`

  files['OEBPS/content.opf'] = `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="uid">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="uid">urn:uuid:illus-eval-mini-0001</dc:identifier>
    <dc:title>Illustrated Reader Eval Mini</dc:title>
    <dc:creator>AI Illustrated Reader contributors</dc:creator>
    <dc:language>en</dc:language>
    <dc:rights>CC0 1.0</dc:rights>
    <meta property="dcterms:modified">2026-01-01T00:00:00Z</meta>
  </metadata>
  <manifest>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    <item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>
${items.map((it) => `    <item id="${it.id}" href="${it.href}" media-type="application/xhtml+xml"/>`).join('\n')}
  </manifest>
  <spine toc="ncx">
${items.map((it) => `    <itemref idref="${it.id}"/>`).join('\n')}
  </spine>
</package>
`

  files['META-INF/container.xml'] = `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>
`
  return files
}

export const buildEvalMiniEpub = () => zipEpub(evalMiniFiles())

if (import.meta.main) {
  const bytes = await buildEvalMiniEpub()
  mkdirSync(dirname(EVAL_MINI_EPUB), { recursive: true })
  writeFileSync(EVAL_MINI_EPUB, bytes)
  console.log(`wrote ${EVAL_MINI_EPUB} (${bytes.length} bytes)`)
}
