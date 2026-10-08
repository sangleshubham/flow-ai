// Proves the lint rules fail on deliberate violations (W0 "done when"). Each case lints a virtual file
// inside a real package with that package's own eslint.config.js.
import assert from 'node:assert/strict'
import { dirname, resolve } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

import { ESLint } from 'eslint'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')

async function lint(pkg, code) {
  const cwd = resolve(ROOT, 'packages', pkg)
  const eslint = new ESLint({ cwd })
  const [result] = await eslint.lintText(code, { filePath: resolve(cwd, 'src/__lint_probe__.ts') })
  return result.messages.map((m) => m.ruleId ?? m.message)
}

const cases = [
  // [package, code, expected rule or null for "clean"]
  ['illus-render', "import { IR } from '@illus/core'\nexport const x = IR\n", null],
  ['illus-anim', "import * as r from '../../illus-render/src/index.ts'\nexport const x = r\n", null],
  ['illus-core', "import * as r from '../../illus-render/src/index.ts'\nexport const x = r\n", 'boundaries/dependencies'],
  ['illus-render', "import * as a from '../../illus-anim/src/index.ts'\nexport const x = a\n", 'boundaries/dependencies'],
  ['illus-store', "import { slugify } from '../../illus-core/src/ids/index.ts'\nexport const x = slugify\n", 'boundaries/dependencies'],
  ['illus-render', "import { slugify } from '@illus/core/src/ids/index.ts'\nexport const x = slugify\n", 'no-restricted-imports'],
  ['illus-render', "import { make } from '@illus/core/testing'\nexport const x = make\n", null],
  ['illus-core', "import * as u from '../../../apps/reader/src/utils.ts'\nexport const x = u\n", 'boundaries/dependencies'],
  ['illus-core', 'export const w = document.title\n', 'no-restricted-globals'],
  ['illus-context', 'export const w = window.innerWidth\n', 'no-restricted-globals'],
  ['illus-core', 'export default 1\n', 'no-restricted-syntax'],
]

for (const [pkg, code, rule] of cases) {
  test(`${pkg}: ${code.split('\n')[0]} → ${rule ?? 'clean'}`, async () => {
    const rules = await lint(pkg, code)
    if (rule === null) assert.deepEqual(rules, [])
    else assert.ok(rules.includes(rule), `expected ${rule}, got ${JSON.stringify(rules)}`)
  })
}
