# 0041 — Stale extractor.template fixture fails W5's array schema

- Status: proposed (contract-change request to W3)
- Date: 2026-10-09
- Workstream: W2 (request to W3)
- Spec sections: §8, §9, §16

## Context

The reader's `/api/llm` gateway now receives W5's `templateRegistry` (ADR 0040) and validates
`TemplateIR.props` against the schema for the requested `templateId`. The repository fixture
`fixtures/llm/extractor.template/b3e81e81….json` (written from
`packages/illus-pipeline/test/fixtures/synthetic-calls.ts`) carries array props
`{ name, cells: [], pointers }`. W5's `array` schema requires `values: Val[]` (1–16 items), so the
gateway returns `422 schema` with an issue at `props.values` when this fixture is replayed.

## Decision

W2 does not loosen validation. `apps/reader/src/server/llm/template-server.test.ts` asserts the
rejection explicitly. W3 is asked to regenerate the synthetic `extractor.template` fixture (and its
source in `synthetic-calls.ts`) against W5's `array` schema, e.g. `props: { values: [...], pointers }`
with evidence paths that exist in the new props.

## Consequences

- Until W3 updates it, replaying that fixture through the real reader server yields a `schema`
  error for the template step (pipeline/e2e paths that rely on it will show the error state).
- After the update, flip the W2 test to expect `200` with the fixture data.
