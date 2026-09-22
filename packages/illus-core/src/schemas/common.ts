import { z } from 'zod'

/** Counts whitespace-separated words, used by the word limits in spec §5 and §8. */
export function wordCount(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length
}

/** A string limited to `max` words (e.g. evidence quotes ≤ 30 words, §5). */
export function maxWords(max: number) {
  return z
    .string()
    .min(1)
    .refine((s) => wordCount(s) <= max, { message: `must be at most ${max} words` })
    .describe(`At most ${max} words.`)
}

/**
 * Id of an element inside one IR (node, edge, message, state, class…). Model-generated, so it is
 * constrained to a short slug that is safe as a Mermaid id and as a `data-ir-id` value (§10, §13).
 */
export const IrId = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,47}$/, 'must be a slug of 1–48 [A-Za-z0-9_-]')
export type IrId = z.infer<typeof IrId>

/** Display label: at most 40 characters, using the book's own terms (§8). */
export const Label = z.string().min(1).max(40)
export type Label = z.infer<typeof Label>

/** SHA-256 as 64 lowercase hex characters. */
export const Sha256Hex = z.string().regex(/^[0-9a-f]{64}$/, 'must be a lowercase SHA-256 hex digest')
export type Sha256Hex = z.infer<typeof Sha256Hex>

/** Milliseconds since the Unix epoch. */
export const Timestamp = z.number().int().nonnegative()
export type Timestamp = z.infer<typeof Timestamp>

/**
 * Evidence: a verbatim quote of at most 30 words from one block, justifying one IR element (§5, §16).
 * `start`/`end` are filled by the grounding matcher (offsets into the block's text); `fuzzy` is set when
 * the match needed the Levenshtein fallback (§16 step 4).
 */
export const Evidence = z.object({
  blockId: z.string().min(1),
  quote: maxWords(30),
  start: z.number().int().nonnegative().optional(),
  end: z.number().int().nonnegative().optional(),
  fuzzy: z.boolean().optional(),
})
export type Evidence = z.infer<typeof Evidence>

/** Reasoning effort sent on every model call. v1 allows only these three (§9). */
export const ReasoningEffort = z.enum(['low', 'medium', 'high'])
export type ReasoningEffort = z.infer<typeof ReasoningEffort>

/** Model tier a role runs on (§9). */
export const Tier = z.enum(['fast', 'standard', 'deep'])
export type Tier = z.infer<typeof Tier>

/** Which model and prompt version produced a record (`indexedWith`, `createdWith`, §5). */
export const ProducedWith = z.object({
  model: z.string().min(1),
  promptVersion: z.string().min(1),
})
export type ProducedWith = z.infer<typeof ProducedWith>
