import { copyFile, mkdir } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const target = resolve(packageRoot, '../..', 'apps/reader/public')
const pyodide = dirname(require.resolve('pyodide/package.json'))
await mkdir(resolve(target, 'pyodide'), { recursive: true })
for (const asset of [
  'pyodide.mjs',
  'pyodide.asm.mjs',
  'pyodide.asm.wasm',
  'python_stdlib.zip',
  'pyodide-lock.json',
]) {
  await copyFile(resolve(pyodide, asset), resolve(target, 'pyodide', asset))
}
await copyFile(
  resolve(packageRoot, 'src/worker.mjs'),
  resolve(target, 'illus-trace-worker.mjs'),
)
await copyFile(
  resolve(packageRoot, 'src/tracer.py'),
  resolve(target, 'illus-tracer.py'),
)
await copyFile(
  require.resolve('comlink/dist/esm/comlink.mjs'),
  resolve(target, 'illus-comlink.mjs'),
)
console.log('Self-hosted Pyodide trace assets copied to apps/reader/public')
