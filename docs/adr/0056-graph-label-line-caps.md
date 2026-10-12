# 0056 — Graph node labels wrap to 4 lines and sublabels to 3

- Status: accepted
- Date: 2026-10-17
- Workstream: W4
- Spec sections: §10

## Context

§10 caps a graph node at 2 label lines plus 1 sublabel line. In practice the planner writes sublabels such as "timeout to detect a failed leader", so nodes rendered as "timeout to detect…" and "most up-to-date…": the reader could not see the point of the step without hovering or reading the evidence.

## Decision

`packages/illus-render/src/graph/measure.ts` wraps labels at 22 characters to at most `LABEL_LINES = 4` lines and sublabels to at most `SUBLABEL_LINES = 3` lines; node height grows with the line count. IR labels are at most 40 characters (`Label` in `@illus/core`), which never needs more than 3 lines at 22, so valid labels are no longer cut; text past the caps would still end in `…`. Every node label also carries an SVG `<title>` with the full label and sublabel.

## Consequences

Nodes with long text are taller, so graphs get longer; ELK lays them out from the measured sizes as before. Timeline labels keep their own 2-line cap. `NodeText.sublabel` became `NodeText.sublines` (internal to `@illus/render`).
