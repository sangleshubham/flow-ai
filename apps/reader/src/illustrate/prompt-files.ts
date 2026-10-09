// Client uses the same exact prompt versions as the server; no tokens or server imports.
type RequireContext = { keys(): string[]; (key: string): string }
const ctx = (require as unknown as { context(dir: string, deep: boolean, re: RegExp): RequireContext }).context(
  '../../../../docs/prompts', false, /^\.\/[a-z.-]+\.md$/,
)
export const PROMPT_FILES: Record<string, string> = Object.fromEntries(ctx.keys().map((k) => [k.slice(2), ctx(k)]))
