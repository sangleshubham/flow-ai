# 0051 — `/api/llm` keep-alive for slow model calls

- Status: accepted
- Date: 2026-10-16
- Workstream: W2
- Spec sections: §9

## Context

The [§9 gateway](../spec.md#9-llm-gateway-and-prompt-library) accumulates the model stream before sending final JSON from [`/api/llm`](../../apps/reader/src/pages/api/llm/index.ts). A request can take up to three 180-second attempts without sending any response bytes.

The deployment investigation on 2026-10-16 found that Nginx Proxy Manager sets `proxy_read_timeout 90s` in `/etc/nginx/nginx.conf`, with no override in the Flow host's `/data/nginx/proxy_host/6.conf`. Its `/data/logs/proxy-host-6_error.log` contained 113 `upstream timed out (110) while reading response header from upstream` errors for `POST /api/llm`, at the 90-second boundary. The browser receives an HTML 504 instead of the gateway's JSON error.

## Decision

Keep the gateway's original HTTP status and JSON body when it settles within 10 seconds. Otherwise flush HTTP 200 JSON headers and one space after 10 seconds, then one space every 15 seconds until the final JSON body arrives. In this slow path, errors return HTTP 200 with the original `ok: false`, `code` and message in the body, superseding the gateway's HTTP error status. This is the §9 transport exception; the response schema is unchanged.

Set `Cache-Control: no-store, no-transform` on the route. Next 12's bundled compression middleware honours `no-transform`, allowing small heartbeat writes to leave promptly without disabling compression globally. Reverse-proxy buffering and timeout configuration are documented separately in deployment guidance.

Keep the route's existing close listener and upstream `AbortController` semantics. Stop timers on response close and settlement, never write after close, and propagate rejected gateway promises without replacing their error. Do not add a browser retry: it would spend another plan request.

## Consequences

The existing `httpTransport` parses the final body regardless of HTTP status, and leading spaces are valid JSON whitespace, so the client and frozen contracts need no change. HTTP-status-only monitoring will see 200 for slow errors; callers must read the JSON outcome.

Fake-timer tests cover the fast status, heartbeat timing, JSON parsing, slow errors, rejected promises and disconnected responses. Replay browser tests exercise the original fast path. Shubham's post-deployment check is to open a fresh section and confirm the proxy error log stops gaining `/api/llm` upstream timeout entries.
