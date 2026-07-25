# 0001 — CSP exceptions needed by Flow and epub.js

- Status: proposed (needs Shubham's approval)
- Date: 2026-10-09
- Workstream: W0 (implemented by W11)
- Spec sections: §17, §10, §12, §19

## Context

§17 asks W0 to confirm that the app CSP does not break Flow or epub.js and to record any exceptions. W0 served the production build of Flow behind a proxy adding the §17 policy, imported `fixtures/books/synthetic.epub` in headless Chrome and collected every `securitypolicyviolation` (details in `docs/flow-audit.md` §10). epub.js renders sections in `srcdoc` iframes, which inherit the parent policy, and turns archived resources into `blob:` URLs.

Under the §17 policy:

- book stylesheets (`blob:`) are blocked → book CSS is lost;
- `fetch(blob:…)` used to extract covers is blocked → covers are missing;
- two inline scripts in `apps/reader/src/pages/_document.tsx` are blocked → dark-mode flash on load;
- Dropbox sync calls are blocked;
- the EPUB's inline script is blocked (desired).

Embedded EPUB fonts and media also resolve to `blob:` and fall back to `default-src 'self'`.

## Decision

Proposed production policy (the "amended" policy, verified with the same run: covers and book CSS work):

```
default-src 'self';
script-src 'self' 'wasm-unsafe-eval';
worker-src 'self' blob:;
connect-src 'self' blob:;
img-src 'self' data: blob:;
style-src 'self' 'unsafe-inline' blob:;
font-src 'self' blob: data:;
media-src 'self' blob:;
frame-src 'self' blob:;
object-src 'none'; base-uri 'self';
```

Plus:

1. Move the two `_document.tsx` inline scripts into a static `public/theme-init.js` loaded with `<script src>` (or allow their `sha256-` hashes). Owner: W11.
2. Development builds add `'unsafe-eval'` to `script-src` (React Refresh); production never does. Owner: W11.
3. Dropbox sync, remote-URL import (`fetchBook`), GTM and Sentry stay blocked: connect-src remains same-origin. Shubham can re-enable Dropbox by adding `https://api.dropboxapi.com https://content.dropboxapi.com` (open question).
4. Charts must not need `'unsafe-eval'`. Vega's default expression compiler uses `new Function`; W4 must render with the CSP-safe `vega-interpreter` (`ast: true`, `expr: expressionInterpreter`). **Dependency request:** add `vega-interpreter` 2.3.2 to §19 (same Vega org and licence, published 2026-08-14).
5. `allowScriptedContent` stays `false` in epub.js (W9); the CSP is the second line of defence, not the first.
6. Suggested addition: `frame-ancestors 'self'` (clickjacking), except on `/illus-sandbox.html`, which keeps its own §17 policy.

## Consequences

- W11 implements the header in `next.config.js` (`headers()`), covering pages, `/api/*`, `/pyodide/*` and worker scripts, and re-runs this check in E2E.
- W4 adds `vega-interpreter` once approved; W7 verifies Pyodide under `'wasm-unsafe-eval'` only.
- `blob:` in `style-src`/`connect-src` widens the policy slightly. `blob:` URLs can only be minted by same-origin script, which `script-src 'self'` already constrains.
