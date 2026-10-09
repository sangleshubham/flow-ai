import { defineConfig } from 'vitest/config'

// epub.js needs a DOM: the same jsdom setup as @illus/book-index's fixture test.
export default defineConfig({ test: { environment: 'jsdom', include: ['test/**/*.test.ts'] } })
