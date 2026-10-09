// `pnpm illus:export-feedback <cache.json>… [--book-ref private:<file>] [--out dir]` (§16 L6).
// Reads cache files exported from the reader (Settings → Illustrate → Export cache) and writes one
// regression case per thumbs-down or "This is wrong" report: open books into evals/regressions/,
// private books into evals/regressions/private/ (git-ignored). Existing cases are kept, never overwritten.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'

import { feedbackCases } from './feedback.ts'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: { 'book-ref': { type: 'string' }, out: { type: 'string', default: join(ROOT, 'regressions') } },
})
if (!positionals.length) {
  console.error('usage: pnpm illus:export-feedback <cache.json>… [--book-ref private:<file>] [--out dir]')
  process.exit(2)
}

let written = 0
let kept = 0
for (const file of positionals) {
  const raw: unknown = JSON.parse(readFileSync(resolve(file), 'utf8'))
  const cases = await feedbackCases(raw, values['book-ref'] ? { bookRef: values['book-ref'] } : {})
  for (const { case: c, private: priv } of cases) {
    const dir = priv ? join(values.out, 'private') : values.out
    const target = join(dir, `${c.id}.json`)
    if (existsSync(target)) {
      kept++
      continue
    }
    mkdirSync(dir, { recursive: true })
    writeFileSync(target, `${JSON.stringify(c, null, 2)}\n`)
    written++
    console.log(`wrote ${target}`)
  }
}
console.log(`${written} new regression case(s), ${kept} already present.`)
