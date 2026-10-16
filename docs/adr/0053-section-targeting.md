# 0053 — Section targeting for TOC clicks and mid-page headings

- Status: accepted
- Date: 2026-10-16
- Workstream: W1/W9
- Spec sections: §14

## Context

[Spec §14](../spec.md) resolves the active section from `location.start.cfi`. A page can contain the end of one section and headings for later sections, so this selects the previous section after navigating to a heading mid-page. Selecting only the last heading would also lose a TOC choice when two headings share a page.

## Decision

Use the visible page range. The last section whose heading starts within `start < cfiStart <= end` wins; otherwise use the section containing the page start. When `end.cfi` is absent, keep the existing start-only resolution.

An explicit CFI navigation target takes precedence while its CFI lies on the visible page, including either boundary. `ManagedReaderBridge.setTarget` records the target; bridge `scrollTo` records it before displaying. Flow's reader model announces CFI navigation before display through the rendition's `illus:navigate` event. Href-only navigation continues to use the page rule.

Keep an unseen target pending through intermediate relocations. Once seen, discard it on the first relocation that no longer contains it. Returning to that page then uses the page rule. Continue resolving `mergedInto`, debouncing 400 ms and suppressing repeated section IDs; setting a target resets suppression so a deliberate repeated selection is published.

## Consequences

`@illus/book-index` adds `getSectionForPage`. The bridge consumes both location CFIs and owns the navigation event listener, removing it on disposal. Only its managed interface gains `setTarget`; the frozen core `ReaderBridge` port stays unchanged. Flow's reader model emits the event before epub.js can emit `relocated`.

Synthetic tests cover page boundaries, multiple headings, missing page ends, target arrival, leaving and returning, synchronous display relocation, and listener cleanup. Private-book manual checks remain for Shubham after rebuilding.
