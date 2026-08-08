// IR → visual spec compilers (§8 stage 3). Owner: W3.
//
// Contracts v1.1 (ADR 0008, decision 6): the IR → engine compilers (`toMermaid`, `toVegaLite`,
// `graphLayoutInput`, `markTexTerms`, `layoutTimeline`) live in `@illus/render`; this module does not
// duplicate them. `VisualRecord.spec` holds `null` for IR kinds. What stays here is the version that
// enters every visual cache key (§5): bump it when the IR a record stores, or how a stored record is
// interpreted, changes.

/** `COMPILER_VERSION` of the visual cache key (§5). */
export const COMPILER_VERSION = 1
