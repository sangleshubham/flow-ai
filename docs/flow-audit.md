# Flow audit (W0)

Findings about the Flow fork that every later workstream needs before touching `apps/reader` (spec §14 "W0 audit"). Audited at `main` = `2ad6382` (Flow `36f3cc7` plus the build kit), 2026-10-09. Paths are relative to the repo root; line numbers refer to that commit.

## Summary

| Question | Answer |
| --- | --- |
| Pane/grid registration | No pane registry. Layout is a hand-written `SplitView` of four fixed children; the book area is a `SplitView` of tab groups. The Illustrate pane is a fifth `SplitView` child (details below). |
| epub.js `Book` / `Rendition` | Vendored fork `@flow/epubjs` 0.3.93 (`packages/epubjs`). Created in `BookTab.render()` (`apps/reader/src/models/reader.ts:331`), reached through the Valtio singleton `reader` (`reader.focusedBookTab.epub` / `.rendition`, also `window.reader`). |
| Router | **Pages Router**, Next.js **12.3.4** (no App Router exists in 12). `/api/llm` → `apps/reader/src/pages/api/llm.ts`; `/auth/chatgpt/*` → `apps/reader/src/pages/api/auth/chatgpt/[action].ts` behind a `rewrites()` entry. |
| State library | **Valtio 1.6.0** (reader model) and **Recoil 0.7.6** (UI atoms), plus `use-local-storage-state` and SWR. Use Valtio for the pane store; Zustand is not needed. |
| IndexedDB layer | **Dexie 3.2.2**, database `re-reader` (`apps/reader/src/db.ts`). `@illus/store` opens its own database `illus`. |
| Theme system | Material You tokens generated at runtime from a source colour: CSS variables `--md-sys-color-*`, `--md-ref-palette-*`, `--md-sys-typescale-*`; dark mode is the `dark` class on `<html>`. |
| Service worker / PWA | `next-pwa` 5.6.0 with the default Workbox runtime caching, also in dev. It caches same-origin GETs, which would include `/auth/chatgpt/callback`. |
| `.env.local` | Loaded by Next.js from `apps/reader/.env.local`; docker-compose passes the same file at runtime. Not excluded from the Docker build context. |
| Docker build | Three-stage `node:18-alpine` build with `turbo prune`. **Expected to fail today** (unpinned `turbo` 2.x versus `--scope` and the `pipeline` key) and it never copies `public/`. |
| CSP (§17) | Flow and epub.js render under the §17 policy, but four exceptions are needed (`blob:` for EPUB stylesheets and for cover extraction, fonts, media), plus moving two inline scripts. Tested in Chrome; see [ADR 0001](adr/0001-csp-exceptions.md). |

Other blocking findings: `main` did not build (fixed by W0, below); Flow sets `allowScriptedContent: true`; Next.js 12.3.4 has critical advisories that affect a middleware-based auth gate ([ADR 0005](adr/0005-nextjs-12-security.md), accepted: 12.3.7 by W11, Tailscale-only); Flow's production Sentry config sends errors to the upstream author's Sentry project (Sentry, Dropbox sync and remote-URL import are removed by W11 in wave 2, §12).

## 1. Pane and grid system

There is **no pane-type registry**. `GridView` (`apps/reader/src/components/base/GridView.tsx`) is an empty stub.

- `apps/reader/src/components/Layout.tsx:41`: `Layout` renders one `SplitView` with fixed children: `ActivityBar` (desktop), `NavigationBar` (mobile), `SideBar`, and `Reader` (wraps the page component). Each child calls `useSplitViewItem(key, { preferredSize, minSize, maxSize, visible })` to register with the split view.
- `apps/reader/src/components/base/SplitView.tsx`: `SplitView` lays children out in a flex row with a draggable `Sash` between neighbours. Sizes live in each item's `useSize` state (px), not persisted. A sash only works when both neighbours are `visible` and have `minSize !== maxSize`.
- The left sidebar "viewlets" (TOC, search, annotations, images, timeline, typography, theme) are registered by the `viewActions` array (`Layout.tsx:77`) and selected through the Recoil atom `actionState` (`apps/reader/src/hooks/useAction.ts`, type `Action`).
- Book tabs: `apps/reader/src/components/Reader.tsx:67` `ReaderGridView` renders a `SplitView` with one `ReaderGroup` per `reader.groups` entry; each group shows tabs (`BookTab` → `BookPane`, `PageTab` → a page component such as Settings).
- `apps/reader/src/components/base/PaneView.tsx` is a vertical collapsible pane list used inside viewlets; it is not a layout slot.

**Recommendation for W9.** Add the Illustrate pane as a fifth child of the `Layout` `SplitView`, after `Reader`, with `useSplitViewItem(IllustratePane, { preferredSize: 0.4 × window width, minSize: 280, visible: open })`. Toggle `open` from a Valtio store bound to `Alt+I`. This is the "fixed right-hand panel" fallback named in §22, and it needs only a few lines in `Layout.tsx`. A viewlet in the left `SideBar` is too narrow; a `PageTab` would compete with book tabs.

## 2. epub.js `Book` and `Rendition`

- Flow does **not** use the npm `epubjs`. It vendors a fork as the workspace package `@flow/epubjs` 0.3.93 (`packages/epubjs`, source `src/`, types `types/`), transpiled by `next-transpile-modules` (`apps/reader/next.config.js:10`). **Use `@flow/epubjs` (workspace:\*) in `@illus/book-index` and `@illus/reader-bridge`** so the Book and Rendition types match Flow's instances ([ADR 0002](adr/0002-package-boundaries-and-toolchain.md)).
- Creation: `fileToEpub(file)` → `ePub(arrayBuffer)` (`apps/reader/src/file.ts:9`). `BookTab.render(el)` (`apps/reader/src/models/reader.ts:331`) loads the stored `File` from Dexie, creates `this.epub`, and calls `this.epub.renderTo(el, { width: '100%', height: '100%', allowScriptedContent: true })` (lines 362–368).
- Access: `reader` is a Valtio proxy singleton (`reader.ts:583`), also on `window.reader`. Current book: `reader.focusedBookTab` → `.epub` (Book), `.rendition`, `.section` (current spine `Section`, set on `rendered`), `.sections` (all spine items, loaded with `s.load(epub.load.bind(epub))` at lines 344–361), `.nav`, `.iframe`, `.view` (`rendition.manager.views._views[0]`), and `.rangeToCfi(range)` (`view.contents.cfiFromRange`).
- Events already wired (lines 379–427): `relocated` (pushes to `tab.timeline`, saves `cfi` and `percentage`), `rendered`, `attached`, `started`, `displayed`, `selected`, `removed`, plus `rendition.hooks.render`. The bridge adds its own `rendition.on('relocated', …)` listener and must call `rendition.off` on cleanup.
- Annotations: Flow draws its own highlights with `rendition.annotations` in `apps/reader/src/components/Annotation.tsx`. Bridge highlights should use a distinct class (`illus-evidence`, `illus-step`) so they never collide.
- Rendering: epub.js puts each section in an `<iframe sandbox="allow-same-origin">` filled through **`srcdoc`** (`packages/epubjs/src/managers/views/iframe.js:104–147`, `:412`). Archived EPUB resources (images, CSS, fonts) are replaced with **`blob:` URLs** (`packages/epubjs/src/book.js:493`, `resources.js:122`).
- **Security finding:** Flow passes `allowScriptedContent: true`, which adds `allow-scripts` to the sandbox. §17 requires `false`; W9 owns the change (`reader.ts:366`). The §17 CSP already blocks the inline script in the synthetic EPUB's `ch04.xhtml` (verified), but the flag should still be off.
- Book identity: Flow's `BookRecord.id` is a random UUID (`apps/reader/src/file.ts:48`). The bridge computes `bookId = sha256(bytes)[0..16]` from the stored `File` (`db.files.get(tab.book.id)`) with `makeBookId` from `@illus/core`.

## 3. Router, API routes, middleware

- **Pages Router** only: `apps/reader/src/pages/` with `pageExtensions: ['ts', 'tsx']` (`next.config.js:38`). Existing API routes: `pages/api/callback/[provider].ts`, `pages/api/refresh.ts`, `pages/api/utils.ts` (Dropbox OAuth).
- `/api/llm` → `apps/reader/src/pages/api/llm.ts`. To stream, set `export const config = { api: { bodyParser: { sizeLimit: '4mb' } } }`; critic images are base64.
- `/auth/chatgpt/*`: Pages Router serves API routes only under `/api`. Implement `apps/reader/src/pages/api/auth/chatgpt/[action].ts` (`start`, `callback`, `signout`) and add to `next.config.js`:
  `async rewrites() { return [{ source: '/auth/chatgpt/:action', destination: '/api/auth/chatgpt/:action', locale: false }] }`.
  `locale: false` is required because Flow enables i18n (`next.config.js:42`, locales `en-US`, `zh-CN`, `ja-JP`, `de-DE`). Without it, rewrites get locale-prefixed. The registered callback stays `${ILLUS_PUBLIC_URL}/auth/chatgpt/callback` as §9 requires. Next.js 12 has no route-handler alternative.
- Middleware: Next.js 12.3 supports `apps/reader/src/middleware.ts` (with a `src/` directory) and `export const config = { matcher: [...] }`. See [ADR 0005](adr/0005-nextjs-12-security.md) before relying on it: the API route must also check the session itself.
- `/login` page → `apps/reader/src/pages/login.tsx`. With i18n it is also reachable at `/<locale>/login`; the middleware matcher must handle both.
- Pages are statically rendered (`○` in `next build`); `_app.tsx` wraps everything in `ErrorBoundary` (Sentry), `LiteralProvider`, `RecoilRoot`, `Theme`, `Layout`.

## 4. State management

- **Valtio 1.6.0**: the reader model (`apps/reader/src/models/reader.ts`): `reader`, `Group`, `BookTab`, `useReaderSnapshot()`. Non-serialisable objects (epub, rendition, iframe) are wrapped in `ref()`.
- **Recoil 0.7.6**: small UI atoms (`apps/reader/src/state.ts` `navbarState`, `settingsState` persisted to `localStorage['settings']`; `hooks/useAction.ts`; `hooks/theme/useTheme.ts`). Recoil is unmaintained upstream.
- `use-local-storage-state` (colour scheme), SWR (`hooks/remote/useRemote.ts`, Dropbox), `dexie-react-hooks` `useLiveQuery` (library page).
- **Recommendation:** the pane and `SectionJob` store uses **Valtio** (already a dependency, usable outside React like Zustand). Do not add Zustand (§19 lists it only "if Flow has no state library"). Settings that must persist go to the `settings` store in `@illus/store`, not to Recoil or localStorage.

## 5. IndexedDB layer

- **Dexie 3.2.2** with `dexie-react-hooks` 1.1.1. `apps/reader/src/db.ts`: `class DB extends Dexie`, database name **`re-reader`**, schema version 5, tables `files` (`id`, the EPUB `File`), `covers` (`id`, data-URL cover), `books` (`BookRecord`: metadata, cfi, percentage, definitions, annotations, typography).
- `db` is `null` on the server (`IS_SERVER`).
- **Decision for W2:** `@illus/store` opens a separate Dexie database **`illus`** (§5) and never touches `re-reader`. It pins `dexie` 4.4.6 (see `docs/dependencies.md`). The two Dexie copies are independent; upgrading Flow's own Dexie is out of scope. Read the EPUB bytes for hashing from `re-reader.files` through the bridge only.

## 6. Theme system and CSS variables

- Source colour (default `#0ea5e9`, `hooks/theme/useSourceColor.ts`) → `themeFromSourceColor` (`@material/material-color-utilities`) → `components/Theme.tsx` injects `<style id="theme">` defining:
  - `--md-ref-palette-{primary,secondary,tertiary,error,neutral,neutral-variant}{50,60,70,80}`
  - `--md-sys-color-*` for light (`:root, .light`) and dark (`:root.dark`): `primary`, `on-primary`, `primary-container`, `surface`, `on-surface`, `surface-variant`, `on-surface-variant`, `outline`, `outline-variant`, `background`, `on-background`, `inverse-*`, `error`, …
  - Values are **space-separated RGB triples** (`14 165 233`), used as `rgb(var(--md-sys-color-primary))` or `rgb(var(...) / 0.5)`.
- Typography and state tokens from the Tailwind preset `packages/tailwind/src/*.js`: `--md-sys-typescale-<role>-<size>-{family,size,line-height,weight,tracking}` (family `Roboto`), `--md-sys-elevation-level1..5`, `--md-sys-state-*-opacity`.
- Dark mode: `hooks/theme/useColorScheme.ts` toggles the `dark` class on `<html>` (localStorage `literal-color-scheme`: `light|dark|system`). Tailwind `darkMode: 'class'`. Dark page background is hard-coded `#24292e` (`_document.tsx`, `useBackground.ts`). The book iframe text colour is overridden in `Reader.tsx` (`rendition.themes.override('color', dark ? '#bfc8ca' : '#3f484a')`). Evidence selection colour in the book: `rgba(3, 102, 214, 0.2)` (`apps/reader/src/styles.ts`).
- **Proposed `--illus-*` mapping (W4/W9):** `--illus-bg: rgb(var(--md-sys-color-surface))`, `--illus-fg: rgb(var(--md-sys-color-on-surface))`, `--illus-muted: rgb(var(--md-sys-color-on-surface-variant))`, `--illus-line: rgb(var(--md-sys-color-outline-variant))`, `--illus-accent: rgb(var(--md-sys-color-primary))`, `--illus-new: rgb(var(--md-sys-color-tertiary))`, `--illus-earlier: rgb(var(--md-sys-color-outline))`, `--illus-highlight: rgb(var(--md-sys-color-primary) / 0.2)`, `--illus-font: var(--md-sys-typescale-body-medium-family)`, `--illus-mono: ui-monospace, SFMono-Regular, Menlo, monospace`. The bridge reads the computed values for `ThemeTokens` and watches the `dark` class with a `MutationObserver` for `onThemeChange`.

## 7. Service worker and PWA

- `next-pwa` 5.6.0: `withPWA({ dest: 'public' })` (`next.config.js:7`). Not disabled in dev. It generates `public/sw.js` and `public/workbox-*.js` at build time (git-ignored) and auto-registers through a script injected into `main.js`. `skipWaiting: true`.
- Default runtime caching (`next-pwa/cache.js`): Google Fonts, static fonts, images, JS, CSS (StaleWhileRevalidate); `/_next/data` JSON; same-origin `GET /api/*` NetworkFirst for 24 h **except `/api/auth/*`**; **every other same-origin GET NetworkFirst ("others", 24 h)**; cross-origin NetworkFirst for 1 h.
- Consequences:
  - `/api/llm` is a POST, so it is never cached. Good.
  - `/auth/chatgpt/callback?code=…`, `/auth/chatgpt/start` and `/login` are same-origin GETs and fall under "others". **W11 must pass a custom `runtimeCaching`** that excludes `/auth/`, `/login` and `/api/` entirely, and should set `disable: process.env.NODE_ENV === 'development'`.
  - Pyodide assets (`/pyodide/*`, §12) would be cached by the JS/"others" rules. W7 may want an explicit CacheFirst rule keyed on the pinned Pyodide version (the §22 load-time mitigation).
  - The HTML sandbox page `/illus-sandbox.html` is cached like any page. Harmless, but its CSP header must survive (W11).

## 8. Environment and `.env.local`

- Next.js loads `apps/reader/.env`, `.env.local`, `.env.<mode>` and `.env.<mode>.local` from the app directory (built-in `@next/env`). `apps/reader/.env.local.example` lists `NEXT_PUBLIC_DROPBOX_CLIENT_ID`, `DROPBOX_CLIENT_SECRET`, `NEXT_PUBLIC_WEBSITE_URL`. Variables also read: `NEXT_PUBLIC_GTM_ID` (`_document.tsx`), `SENTRY_DSN` / `NEXT_PUBLIC_SENTRY_DSN` (`sentry.*.config.js`), `ANALYZE`, `DOCKER`, `NODE_ENV` (`next.config.js`).
- `NEXT_PUBLIC_*` values are inlined at build time; every `ILLUS_*` variable (§9) must stay without that prefix so it is server-only.
- `.env.local` is git-ignored (root `.gitignore`, re-asserted by W0). `docker-compose.yml` passes `./apps/reader/.env.local` as `env_file` at runtime.
- **Risk (W11):** `.dockerignore` does not exclude `.env*`, so `COPY . .` in the builder stage copies `apps/reader/.env.local` into an image layer. Add `**/.env*` (keeping `.env.local.example` if wanted) to `.dockerignore`.
- **Privacy (W11):** `sentry.client.config.js` and `sentry.server.config.js` fall back to a hard-coded DSN of the upstream Flow project (`o955619.ingest.sentry.io`). Non-Docker production builds (`withSentryConfig`) would send errors there. Remove the fallback or disable Sentry.

## 9. Docker build

- `Dockerfile`, three stages on `node:18-alpine`. Builder runs `yarn global add turbo` (unpinned) and `turbo prune --scope=@flow/reader --docker`. Installer runs `corepack enable` and `pnpm i --frozen-lockfile`, then `DOCKER=1 pnpm -F reader build` (`output: 'standalone'`, `outputFileTracingRoot` = repo root). Runner copies `next.config.js`, `package.json`, `.next/standalone` and `.next/static`, then `CMD node apps/reader/server.js` (port 3000; `docker-compose.yml` maps `3000:3000`).
- Problems for W11 (not executed by W0; the image was not built):
  1. **Unpinned turbo resolves to 2.x**, which rejects `--scope` (use `turbo prune @flow/reader --docker`) and rejects the `pipeline` key in `turbo.json`, which turbo 2 renamed to `tasks`. The repo pins turbo 1.11.3; use `pnpm dlx turbo@1.11.3` or upgrade turbo deliberately.
  2. **`public/` is never copied** into the runner. The Next standalone server does not serve it, so the PWA manifest, icons, `sw.js`, and later `/illus-sandbox.html` and `/pyodide/*` would 404. Add `COPY --from=installer /app/apps/reader/public ./apps/reader/public`.
  3. Node 18 is end-of-life; D11 says Node 24. Mermaid 11+, Vitest 4, `openai` 7 and jsdom 30 need Node ≥ 22. **Next.js 12.3.4 builds on Node 24**: verified locally with `DOCKER=1 pnpm -F @flow/reader build` after the fix below.
  4. `packageManager` is now `pnpm@10.34.5` (W0); corepack picks it up.
  5. `.env.local` leaks into the build context (§8).
- **Fixed by W0:** `main` did not build at all. `next build` failed type-checking on `apps/reader/src/components/pages/settings.tsx:12` (`@flow/reader/locales` resolved into `src/`; introduced by Flow commit `36f3cc7`). W0 added `"@flow/reader/locales": ["apps/reader/locales"]` to the root `tsconfig.json` `paths`. `tsc` and webpack both prefer the exact match, and the build now succeeds.

## 10. Content Security Policy (§17)

Tested in headless Google Chrome (Playwright), with the production build behind a proxy that added the policy. The script imported `fixtures/books/synthetic.epub`, opened the preface and chapters 1, 2 and 4, and collected `securitypolicyviolation` events from the app and the epub.js iframes.

| Observation under the §17 policy | Effect | Fix |
| --- | --- | --- |
| Book text renders in all chapters; srcdoc iframes inherit the parent CSP | OK | none |
| `style-src-elem` blocks `blob:` stylesheets inside `about:srcdoc` (epub.js rewrites EPUB CSS links to `blob:` URLs) | **Book CSS is lost** | add `blob:` to `style-src` |
| `connect-src` blocks `fetch(blob:…)` in `toDataUrl` (`apps/reader/src/file.ts:84`) when a cover is imported; `TypeError: Failed to fetch` | **Covers are missing** | add `blob:` to `connect-src` |
| `script-src-elem` blocks two inline scripts from `_document.tsx` (`PreventFlash`, `const background=…`) | Dark-mode flash on load; no functional loss | move both into a static `/theme-init.js`, or allow their `sha256-` hashes (W11) |
| `connect-src` blocks `api.dropboxapi.com` / `content.dropboxapi.com` (Flow's Dropbox sync polls on load) | Dropbox sync is off | product decision (open question); add the two origins only if sync is kept |
| `script-src-elem` blocks the EPUB's inline script (`ch04.xhtml`) | Desired | also set `allowScriptedContent: false` (W9) |
| No font in the fixture; EPUB `@font-face` URLs also become `blob:`, and `font-src` falls back to `default-src 'self'` | Embedded book fonts would be blocked | add `font-src 'self' blob: data:` |
| EPUB audio/video would use `blob:` under `media-src` → `default-src` | Media would be blocked | add `media-src 'self' blob:` |

With those exceptions (the "amended" policy in [ADR 0001](adr/0001-csp-exceptions.md)), the same run shows covers extracted, book CSS loaded, and only the Dropbox calls, the `_document` inline scripts and the book's own script blocked. Not testable yet (no code exists); each owner must verify:

- **Vega** compiles expressions with `new Function` unless the CSP-safe interpreter is used, so it is blocked without `'unsafe-eval'`. W4 needs `vega-interpreter` (`ast: true`, `expr: expressionInterpreter` in vega-embed). It is not in §19, so W0 requests it in ADR 0001.
- **Pyodide** needs `'wasm-unsafe-eval'` (present). Its worker gets the CSP from its own response headers, so `next.config` headers must cover `/pyodide/*` and worker scripts (W7, W11).
- **Next.js dev mode** (React Refresh, eval source maps) needs `'unsafe-eval'`, so apply the strict policy only in production or add `'unsafe-eval'` in dev (W11).
- **GTM** (only if `NEXT_PUBLIC_GTM_ID` is set) and **Sentry** need external origins; leave both unset or disabled.
- **Mermaid** (`securityLevel: 'strict'`), **KaTeX** and **elkjs** need nothing beyond `style-src 'unsafe-inline'` and `worker-src blob:` as far as their docs say; W4 confirms in its visual-regression runs.

## 11. Toolchain facts (for every workstream)

- Flow's own toolchain is old: TypeScript 4.6.3, ESLint 8.13 with `eslint-config-next` 12, Prettier 2.6, turbo 1.11.3, React 18.0.0 with `@types/react` 17. `apps/reader` has no `typecheck` script; `next build` type-checks it. `tsc` on `apps/reader` is clean with TS 4.6 and reports 3 new errors with TS 5.9 (`Layout.tsx:19`, `Theme.tsx:4` type-only imports under `isolatedModules`; `ImageView.tsx:10` deep instantiation).
- `@illus/*` packages use their own pinned TypeScript 5.9.3, ESLint 10 and Vitest 4 (`tsconfig.illus.json`, `tooling/eslint-config`); Flow keeps its versions ([ADR 0002](adr/0002-package-boundaries-and-toolchain.md)).
- **Done by W0 after wave 1** ([ADR 0009](adr/0009-reader-build-on-typescript-5.md), was planned for W9): root and `apps/reader` TypeScript are 5.9.3; `apps/reader/tsconfig.json` sets `allowImportingTsExtensions` and `target: es2022`; `apps/reader` uses `@types/react` 18.3.31, `@types/react-dom` 18.3.7 and `@types/node` 24.13.6; Flow's type errors under TS 5.9 and React 18 types are fixed; `apps/reader` has a `typecheck` script in the turbo gate and CI runs `next build`. Packages still have to be added to `next-transpile-modules` when the app imports them. Next 12's SWC cannot parse `satisfies` (or other TS ≥ 4.9 syntax) in `@illus` sources; lint bans `satisfies`. Packages declare `main`/`types` as `./src/index.ts`, so Flow's `moduleResolution: node` resolves them without `exports` support. React components in `@illus/render` and `@illus/anim` need `@types/react` 18 in `apps/reader`.
- The husky pre-commit hook (`.husky/pre-commit`, lint-staged) is not executable in this checkout, so it does not run. lint-staged's ESLint 8 step is scoped to Flow paths so it never lints `@illus` code with the wrong config.
- `@flow/epubjs`'s Karma suite (needs Chrome) is now `pnpm --filter @flow/epubjs test:karma`; it was renamed so `turbo run test` does not try to start Karma.

## 12. Flow features to remove (decided after wave 1)

Shubham's decision (2026-10-09): the deployment is single-user and Tailscale-only, so Flow's cloud features go. **W11 removes them in wave 2**; W0 only records the decision. Removing them shrinks the CSP `connect-src` (no Dropbox or Sentry origins, no arbitrary remote fetch) and stops third-party data flows.

| Feature | Code to remove (paths at `main` after wave 1) | Why |
| --- | --- | --- |
| Dropbox sync | `apps/reader/src/sync.ts`, `apps/reader/src/hooks/remote/` (`useRemote.ts`, `useSync.ts`), `apps/reader/src/dropbox.d.ts`, `apps/reader/src/pages/api/callback/[provider].ts`, `apps/reader/src/pages/api/refresh.ts`, `apps/reader/src/pages/api/utils.ts`, the sync part of `apps/reader/src/components/pages/settings.tsx`, the `dropbox` dependency, `NEXT_PUBLIC_DROPBOX_CLIENT_ID` / `DROPBOX_CLIENT_SECRET` in `apps/reader/.env.local.example` | Sends reading data to Dropbox; needs `api.dropboxapi.com` / `content.dropboxapi.com` in `connect-src` (§10 above) |
| Remote-URL import | `fetchBook` in `apps/reader/src/file.ts:89` and its callers in `apps/reader/src/pages/index.tsx` (`?url=` query on load and the "import from URL" field) | Fetches arbitrary origins (needs a wide `connect-src`) and lets a crafted link load a book |
| Sentry | `apps/reader/sentry.client.config.js`, `apps/reader/sentry.server.config.js`, `apps/reader/sentry.properties`, `withSentryConfig` in `apps/reader/next.config.js`, `ErrorBoundary` from `@sentry/nextjs` in `apps/reader/src/pages/_app.tsx`, `apps/reader/src/pages/_error.js`, the `@sentry/nextjs` dependency | Falls back to the upstream author's DSN (`o955619.ingest.sentry.io`, §8 above); errors would leave the machine |

Until W11 lands, the strict CSP blocks the Dropbox calls (harmless) and production builds still include the Sentry plugin.

