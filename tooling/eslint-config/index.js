// Shared ESLint flat config for every @illus/* package (spec §4 "Package rules").
// Each package re-exports it from its own eslint.config.js.
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import boundaries from 'eslint-plugin-boundaries'
import tseslint from 'typescript-eslint'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..')

// One element type per package. Patterns are relative to the repo root.
const PACKAGES = {
  core: 'packages/illus-core',
  'book-index': 'packages/illus-book-index',
  concepts: 'packages/illus-concepts',
  context: 'packages/illus-context',
  llm: 'packages/illus-llm',
  pipeline: 'packages/illus-pipeline',
  render: 'packages/illus-render',
  anim: 'packages/illus-anim',
  tracer: 'packages/illus-tracer',
  store: 'packages/illus-store',
  'reader-bridge': 'packages/illus-reader-bridge',
  evals: 'evals',
}

// Which packages each package may import (spec §4 dependency direction, ADR 0002).
// `flow-epubjs` is Flow's vendored epub.js workspace package. Nothing may import `app`.
export const ALLOWED = {
  core: [],
  'book-index': ['core', 'flow-epubjs'],
  context: ['core'],
  store: ['core'],
  llm: ['core'],
  concepts: ['core', 'context', 'llm', 'store', 'render', 'anim'],
  pipeline: ['core', 'context', 'llm', 'store', 'concepts', 'book-index'],
  render: ['core'],
  anim: ['core', 'render'],
  tracer: ['core', 'render', 'anim'],
  'reader-bridge': ['core', 'flow-epubjs'],
  evals: Object.keys(PACKAGES).filter((p) => p !== 'evals'),
}

// Public entry points: a package is imported only through these files (no deep imports).
const ENTRY_POINTS = '{src/index.ts,src/testing/index.ts,src/flags/index.ts}'

// DOM-free packages run under plain Node (spec §4); browser globals are banned there.
const DOM_GLOBALS = [
  'window',
  'document',
  'navigator',
  'localStorage',
  'sessionStorage',
  'indexedDB',
  'location',
  'HTMLElement',
  'Element',
  'Node',
  'DOMParser',
  'requestAnimationFrame',
  'requestIdleCallback',
  'getComputedStyle',
]

const elements = [
  ...Object.entries(PACKAGES).map(([type, path]) => ({
    type,
    pattern: path,
  })),
  { type: 'flow-epubjs', pattern: 'packages/epubjs' },
  { type: 'app', pattern: 'apps/*' },
]

const policies = [
  // 1. Cross-package imports follow the dependency matrix.
  ...Object.entries(ALLOWED).map(([type, deps]) => ({
    from: { element: { type } },
    allow: { to: { element: { type: deps } } },
  })),
  // 2. Cross-package imports must land on a public entry point.
  {
    from: { element: { type: '*' } },
    disallow: {
      to: { element: { type: Object.keys(PACKAGES), fileInternalPath: `!${ENTRY_POINTS}` } },
    },
  },
  // 3. Anything inside a package may import anything else in the same package (last match wins).
  ...Object.keys(PACKAGES).map((type) => ({
    from: { element: { type } },
    allow: { to: { element: { type } } },
  })),
]

export default tseslint.config(
  { ignores: ['**/node_modules/**', '**/dist/**', '**/.turbo/**', '**/coverage/**'] },
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx,js,mjs}'],
    plugins: { boundaries },
    settings: {
      'boundaries/root-path': ROOT,
      'boundaries/elements': elements,
      'boundaries/include': ['packages/**/*', 'evals/**/*', 'apps/**/*'],
      'import/resolver': {
        node: { extensions: ['.ts', '.tsx', '.js', '.mjs', '.json'] },
      },
    },
    rules: {
      'boundaries/dependencies': ['error', { default: 'disallow', policies }],
      // Package-specifier deep imports resolve through node_modules symlinks, which the boundaries plugin
      // treats as external, so they are banned by name: only the declared entry points are public.
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              regex: '^@illus/(?!core/(testing|flags)$)[^/]+/.+',
              message: 'No deep imports: import the package entry point (spec §4).',
            },
          ],
        },
      ],
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', ignoreRestSiblings: true },
      ],
      '@typescript-eslint/consistent-type-imports': 'error',
    },
  },
  {
    // Named exports only (spec §4); React components consumed by next/dynamic may use .tsx defaults.
    files: ['**/src/**/*.ts'],
    rules: {
      'no-restricted-syntax': [
        'error',
        { selector: 'ExportDefaultDeclaration', message: 'Use named exports (spec §4).' },
      ],
    },
  },
)

/** Extra rules for DOM-free packages (@illus/core, @illus/context): `export default [...config, ...domFree]`. */
export const domFree = [
  {
    files: ['src/**/*.ts'],
    rules: {
      'no-restricted-globals': [
        'error',
        ...DOM_GLOBALS.map((name) => ({ name, message: 'This package is DOM-free (spec §4).' })),
      ],
    },
  },
]
