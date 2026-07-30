// Prompt files `docs/prompts/<role>.md`, imported as raw text at build time (spec §9 "Prompt files") via
// the `asset/source` webpack rule in next.config.js. Safe for the browser too: the client needs each
// role's `version`, the server needs the system prompt.
type RequireContext = { keys(): string[]; (key: string): string }

const ctx = (require as unknown as { context(dir: string, deep: boolean, re: RegExp): RequireContext }).context(
  '../../../../../docs/prompts',
  false,
  /^\.\/[a-z.-]+\.md$/,
)

/** File name (`planner.md`) → raw text. `README.md` is included and ignored by the registry. */
export const PROMPT_FILES: Record<string, string> = Object.fromEntries(ctx.keys().map((k) => [k.slice(2), ctx(k)]))
