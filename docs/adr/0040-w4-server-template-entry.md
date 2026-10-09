# 0040 — Public template entry for server validation

- Status: accepted
- Date: 2026-10-09
- Workstream: W4
- Spec sections: §3, §4, §8, §9, §10

## Context

The LLM gateway must validate `extractor.template` props using the same W5 schemas as the
browser. Importing `@illus/render` also imports the visual dispatcher and browser engines,
including Vega and Mermaid. Flow's TypeScript resolver uses `moduleResolution: node` and
does not resolve package subpaths from `exports` alone.

## Decision

Publish the additive public `@illus/render/templates` entry in package exports, backed by a
physical root `templates.ts` shim that re-exports the existing W5 template API. This is an
explicit public subpath exception to the §4 single-barrel rule, rather than a consumer deep
import. Keep W5 schemas, components and the browser root API unchanged.

The registry includes ordinary React definitions and inert graph layout helpers. Module
evaluation and props/invariant validation access no DOM globals, initialise no rendering
engine, and load or construct no layout worker. Server consumers use schemas and invariants;
they do not invoke layout or components. The server may register this schema capability
statically; the browser feature flag continues to gate generation and rendering.

## Consequences

W2 and W9 can import the registry through a stable public entry with both TypeScript resolver
modes. Tests exercise the entry under Node, validate every template example, reject malformed
and semantically invalid props, and fail if VisualView, Mermaid, Vega or the worker module is
loaded. No dependency versions, template schemas or runtime flags change.
