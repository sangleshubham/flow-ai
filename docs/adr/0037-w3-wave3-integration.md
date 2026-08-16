# 0037 — W3 wave 3 trace routing and browser replay integration

- Status: accepted (within the wave 3 integration assignment)
- Date: 2026-10-09
- Workstream: W3
- Spec sections: §9, §11, §12, §15, §16

## Context

The initial trace route stored every runner response as `executed`, including translations that explicitly cannot run. W7 now publishes a structural `TraceFallbackError` with `code`, `route`, `reason`, `translation`, and `repairs`. Frozen `TraceRunner` already accepts an optional abort signal and returns real execution scenarios.

The existing synthetic replay fixtures represent a completed concept pass. W9 also needs fixtures for the exact context state used by a freshly opened browser book. Replay keys must continue matching the full role/version/model/prefix/body hash.

## Decision

- Keep frozen core ports unchanged. W3 detects W7's structural failure without importing the tracer package. Configure W7's runner **without its optional fixer**: the pipeline owns at most two `trace-fixer` calls through its existing limited, logged LLM client. Honor an already-consumed runner repair count. Record the latest repaired translation, all role model/effort/prompt provenance, and token usage.
- Pass the section job signal to the worker and fixer. Navigation prevents queued repairs and further fallback requests. Successful executions alone enter the executed trace store; empty results or scenarios with execution errors fail the item.
- Reject selected code outside `packed.usedBlockIds` or blocks that are not code listings before any translator request. Supply the entire allowed selected listing in an escaped `<trace_source block_id="..." lang="...">` tag to translator and fixer, retaining original indentation. The source is never merely used for a cache hash.
- A nontraceable concurrency translation becomes a grounded, validated timeline. Unsupported I/O/network/file/UI code fails with `trace-unsupported` and its reason. Persistent execution failure becomes a grounded template selected from the translator's visualization hints and an animator walkthrough. If templates, animations, or the hint are unavailable, fail explicitly instead of inventing a template.
- Preserve the original trace plan item and translator-based visual key for routed fallbacks, so repeat requests hit the same visual cache. Fallback records use the actual IR kind, no executed trace key, and `spec: null` per ADR 0008. A stable validation warning `{ code: 'trace-simulated', message: reason }` supplies W9's simulated badge and failure explanation.
- Animation validation is injected as `(ir, animation, { blocks }) => ValidationIssue[]`. This additive third argument carries only the packed context's permitted blocks; existing two-argument callbacks remain compatible. W9 passes this exact map to W6's grounding validator, because using all indexed book blocks would admit evidence from later or unrelated sections. No new core context port is needed.
- Browser fixtures are generated from synthetic.epub only, using its actual indexing and packing path. Keep distinct fixture profiles while preserving exact replay matching. Regeneration removes only the profile's own generated files and preserves fixtures owned by other profiles/workstreams.

## Consequences

W9 must inspect the `trace-simulated` validation issue to label fallback visuals. W7 retains ownership of its translator/fixer prompts and worker. W3 owns request accounting and routing. No live model calls, dependency changes, new core schema fields, or cross-workstream runtime imports are introduced.
