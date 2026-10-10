// Public API of @illus/context (§7). Owner: W3. DOM-free. Nothing else may be imported from outside this package.
export {
  CONTEXT_VERSION,
  DEFINITION_TOKENS,
  REFERENCE_TOKENS,
  SLOT_CAPS,
  SLOT_NAMES,
  SUBSECTION_TOKENS,
  packContext,
} from './pack.ts'
export type {
  ContextRepo,
  LexicalSearch,
  PackInput,
  PackedContext,
  SlotName,
} from './pack.ts'
export {
  attrs,
  clipTokens,
  escapeAttr,
  escapeText,
  estimateTokens,
  renderBlock,
  renderSection,
  sectionPath,
} from './format.ts'
