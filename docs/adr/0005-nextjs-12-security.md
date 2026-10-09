# 0005 — Next.js 12.3.4 advisories and the auth gate

- Status: accepted (Shubham, after wave 1, 2026-10-09)
- Date: 2026-10-09
- Workstream: W0 (affects W11, W2, W9)
- Spec sections: §17, §2 D1, D6

## Context

Flow pins `next` 12.3.4. `pnpm audit` lists advisories against it that bear directly on §17's auth gate, which is Next.js middleware checking the session cookie:

| Advisory | Severity | Fixed in |
| --- | --- | --- |
| GHSA-f82v-jwr5-mffw: authorization bypass in middleware (`x-middleware-subrequest`) | critical | 12.3.5 |
| GHSA-36qx-fr4f-26g5: middleware/proxy bypass in Pages Router apps **using i18n** (Flow uses both) | high | 15.5.16 |
| GHSA-7gfc-8cq8-jh5f: authorization bypass | high | 14.2.15 |
| GHSA-2xp9-vwfh-vxw4: RCE in the Image Optimization API with AVIF | critical | 15.5.24 |
| Others: SSRF in rewrites, cache poisoning, DoS in image optimisation | moderate–high | 14.x–15.x |

The deployment is single-user and recommended behind Tailscale (§17), but the VPS option exposes it over HTTPS.

## Decision

Conservative interim measures (no framework upgrade in v1 without Shubham's decision):

1. **Defence in depth (W2, W11):** every API route and the `/auth/chatgpt/*` handlers verify the session themselves; middleware is only a convenience redirect for pages. §9 step 1 already asks `/api/llm` to check the cookie; keep that a hard requirement.
2. Upgrade `next` to **12.3.7** (2025-03-28, the last 12.3.x patch), which fixes the critical middleware bypass without a migration. Owner: W11.
3. Set `images: { unoptimized: true }`; Flow does not use `next/image`. Have Caddy strip `x-middleware-subrequest` from incoming requests. Owner: W11.
4. Recommend Tailscale-only access until (5) is decided.
5. **Open question:** migrate Flow to Next.js 15.5.x (with React 18.3/19, `transpilePackages` instead of `next-transpile-modules`, a maintained PWA plugin, Sentry 8+) as a separate workstream after M1, or accept the residual risk for a Tailscale-only deployment.

## Outcome (accepted 2026-10-09)

Shubham accepted measures 1–4 and settled the open question in 5:

- **W11 in wave 2** upgrades `next` to 12.3.7 and applies the interim measures: per-route session checks on every API and `/auth/chatgpt/*` handler, `images: { unoptimized: true }`, and Caddy stripping `x-middleware-subrequest`. W0 does not make these changes.
- **Access is Tailscale-only.** The VPS is not exposed on the public internet; W11 adds its own simple login gate (W11 writes the ADR amending §17).
- **The Next.js 15.5 migration is deferred to after M1**, as a separate workstream. Until then the residual advisories are accepted for the Tailscale-only deployment.

## Consequences

- W11's security tests must include a request with `x-middleware-subrequest` and an i18n-prefixed path (`/de-DE/...`) against a protected route, expecting 401 or a redirect.
- The Next.js advisories stay in the audit baseline (ADR 0004) until the upgrade.
