// The live runner (`pnpm eval --live`, Shubham only): runs the real pipeline in Node on each case's
// book, with the gateway in-process (the same `@illus/llm/server` the reader uses, signed in through
// the reader's token store), and turns what happened into a CaseRun. The gateway is built per effort
// override, so the §9 effort sweep needs no server restarts. With ILLUS_LLM_MODE=replay the same runner
// serves fixtures, which is how it is tested.
import { randomBytes } from 'node:crypto'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { createConceptPass } from '@illus/concepts'
import { LlmError, resolveFlags } from '@illus/core'
import type {
  IllusRepos,
  LlmCall,
  PlanItem,
  RoleName,
  SectionNode,
  VisualPlan,
  VisualRecord,
} from '@illus/core'
import { buildSmallBook, createMemoryRepos } from '@illus/core/testing'
import {
  createLlmClient,
  createPromptRegistry,
  loadModelsConfig,
} from '@illus/llm'
import type { LlmTransport } from '@illus/llm'
import { createIllusServer } from '@illus/llm/server'
import { createPipeline } from '@illus/pipeline'
import type { SectionJobEvents } from '@illus/pipeline'
import { templateRegistry } from '@illus/render/templates'

import { EVAL_MINI_BOOK_ID } from './books/eval-mini.ts'
import { indexEpub } from './books/index-epub.ts'
import type { CaseRun, EvalCase, RunCall, RunVisual } from './case.ts'
import type { CaseRunner, RunOptions } from './runner.ts'

export interface LiveRunnerOptions {
  /** Repository root (fixtures/books, docs/prompts). */
  root: string
  /** The reader's server environment (ILLUS_LLM_MODE, ILLUS_DATA_DIR, ILLUS_TOKEN_ENC_KEY, ILLUS_PUBLIC_URL, ILLUS_MODELS_JSON…). */
  env: Record<string, string | undefined>
  /** Feature flags for the run (default: templates and animations on; critic off: it needs a browser). */
  flags?: Parameters<typeof resolveFlags>[0]
}

interface Book {
  bookId: string
  repos: IllusRepos
  sections: SectionNode[]
  lexical?: Parameters<typeof createPipeline>[0]['lexical']
  indexed?: Promise<void>
}

interface Recorded {
  role: RoleName
  data: unknown
  planItemId: string | undefined
  call?: RunCall
}

/** Wraps an LlmCall and records every answer (schema failures as an unparseable attempt). */
function recording(llm: LlmCall, log: Recorded[]): LlmCall {
  return {
    async call(role, ctx, opts) {
      const planItemId = /<plan_item id="([^"]+)"/.exec(ctx.body)?.[1]
      const started = Date.now()
      try {
        const res = await llm.call(role, ctx, opts)
        log.push({
          role,
          data: res.data,
          planItemId,
          call: {
            role,
            model: res.model,
            effort: res.effort,
            inputTokens: res.usage.input,
            outputTokens: res.usage.output,
            latencyMs: res.latencyMs || Date.now() - started,
          },
        })
        return res
      } catch (e) {
        if (e instanceof LlmError && e.code === 'schema')
          log.push({ role, data: { invalid: e.message }, planItemId })
        throw e
      }
    },
  }
}

export function liveRunner(o: LiveRunnerOptions): CaseRunner {
  const files = Object.fromEntries(
    readdirSync(join(o.root, 'docs/prompts'))
      .filter((f) => f.endsWith('.md'))
      .map((f) => [f, readFileSync(join(o.root, 'docs/prompts', f), 'utf8')]),
  )
  const prompts = createPromptRegistry(files)
  const baseModels = loadModelsConfig(o.env.ILLUS_MODELS_JSON)
  const flags = resolveFlags(o.flags ?? { templates: true, animations: true })
  const transports = new Map<string, Promise<LlmTransport>>()
  const books = new Map<string, Promise<Book>>()

  /** The in-process gateway for one effort override (§9 sweep). */
  const transportFor = (overrides: RunOptions['effortOverrides'] = {}) => {
    const key = JSON.stringify(overrides)
    if (!transports.has(key)) {
      const models = {
        ...baseModels,
        efforts: { ...baseModels.efforts, ...overrides },
      }
      transports.set(
        key,
        // The eval never issues session cookies; a throwaway secret satisfies the server's check.
        createIllusServer(
          {
            ILLUS_SESSION_SECRET: randomBytes(32).toString('hex'),
            ...o.env,
            ILLUS_MODELS_JSON: JSON.stringify(models),
          },
          { prompts, templates: templateRegistry },
        ).then(
          (server) => async (req, signal) =>
            (
              await server.gateway.handle(req, {
                session: true,
                ...(signal && { signal }),
              })
            ).body,
        ),
      )
    }
    return transports.get(key)!
  }

  const loadBook = (ref: string): Promise<Book> => {
    if (!books.has(ref))
      books.set(
        ref,
        (async (): Promise<Book> => {
          if (ref === 'small-book') {
            const b = await buildSmallBook()
            const repos = createMemoryRepos()
            await repos.books.put(b.book)
            await repos.sections.bulkPut(b.sections)
            await repos.blocks.bulkPut(b.blocks)
            await repos.crossRefs.bulkAdd(b.crossRefs)
            return { bookId: b.book.bookId, repos, sections: b.sections }
          }
          const file =
            ref === 'synthetic'
              ? join(o.root, 'fixtures/books/synthetic.epub')
              : ref === 'eval-mini'
              ? join(o.root, 'fixtures/books/eval/eval-mini.epub')
              : join(
                  o.root,
                  'fixtures/books/private',
                  ref.slice('private:'.length),
                )
          if (!existsSync(file)) throw new Error(`book not found: ${file}`)
          const b = await indexEpub(
            file,
            ref === 'eval-mini' ? { bookId: EVAL_MINI_BOOK_ID } : {},
          )
          return {
            bookId: b.bookId,
            repos: b.repos,
            sections: b.sections,
            lexical: b.lexical,
          }
        })(),
      )
    return books.get(ref)!
  }

  return async (c: EvalCase, opts: RunOptions): Promise<CaseRun | null> => {
    const book = await loadBook(c.bookRef).catch((e: unknown) => {
      if (c.bookRef.startsWith('private:')) return null
      throw e
    })
    if (!book) return null
    const index = book.sections.findIndex((s) => s.sectionId === c.sectionId)
    if (index < 0) {
      if (c.bookRef.startsWith('private:')) return null
      throw new Error(`${c.id}: section ${c.sectionId} is not in ${c.bookRef}`)
    }

    const log: Recorded[] = []
    const transport = await transportFor(opts.effortOverrides)
    const llm = recording(createLlmClient({ transport, prompts }), log)
    // The concept pass runs once per book (with the first run's efforts); its calls count for the first case.
    book.indexed ??= createConceptPass({
      bookId: book.bookId,
      repos: book.repos,
      llm,
    })
      .start()
      .then((p) => {
        if (p.error) throw p.error
      })
    await book.indexed
    const models = {
      ...baseModels,
      efforts: { ...baseModels.efforts, ...opts.effortOverrides },
    }
    const pipeline = createPipeline({
      repos: book.repos,
      llm,
      prompts,
      models,
      flags,
      templates: templateRegistry,
      ...(book.lexical && { lexical: book.lexical }),
    })

    const started = Date.now()
    const job = pipeline.requestSection(c.sectionId)
    let plan: VisualPlan | undefined
    let noVisual = false
    let error: string | undefined
    const ready: SectionJobEvents['item-ready'][] = []
    const failed = new Map<string, string>()
    job.on('item-failed', (e) =>
      failed.set(e.planItemId, `${e.code}: ${e.message}`),
    )
    job.on('plan', (e) => (plan = e.plan))
    job.on('no-visual', () => (noVisual = true))
    job.on('item-ready', (e) => ready.push(e))
    job.on('error', (e) => (error = `${e.code}: ${e.message}`))
    await job.finished
    if (error?.startsWith('plan-limit'))
      throw new Error(`stopped by the plan limit: ${error}`)

    const planAttempts = log
      .filter((r) => r.role === 'planner')
      .map((r) => r.data)
    if (!planAttempts.length)
      planAttempts.push(plan ?? { error: error ?? 'no plan' })
    const records = new Map<string, VisualRecord>(
      ready.map((e) => [e.planItemId, e.record]),
    )
    const visuals: RunVisual[] = (plan?.items ?? []).map((item: PlanItem) => {
      const record = records.get(item.planItemId)
      const attempts = log
        .filter(
          (r) =>
            r.planItemId === item.planItemId &&
            (r.role.startsWith('extractor.') ||
              r.role === 'html-fallback' ||
              r.role === 'repair'),
        )
        .map((r) => r.data)
      if (!attempts.length && record?.ir) attempts.push(record.ir)
      return {
        planItemId: item.planItemId,
        kind: record?.kind ?? item.kind,
        attempts: item.kind === 'trace' ? [] : attempts,
        ...(record?.critic && { critic: record.critic }),
        ...(failed.has(item.planItemId) && {
          failure: failed.get(item.planItemId),
        }),
      }
    })
    const concepts = await book.repos.concepts.listByBook(book.bookId)
    const blocks = (
      await Promise.all(
        book.sections
          .slice(0, index + 1)
          .map((s) => book.repos.blocks.listBySection(s.sectionId)),
      )
    ).flat()
    return {
      caseId: c.id,
      source: 'recorded',
      blocks: blocks.map((b) => ({
        blockId: b.blockId,
        kind: b.kind,
        text: b.text,
      })),
      aliases: Object.fromEntries(
        concepts.map((k) => [k.canonical, k.aliases]),
      ),
      planAttempts,
      visuals,
      calls: log.flatMap((r) => r.call ?? []),
      path: noVisual
        ? 'no-visual'
        : ready.length && ready.every((e) => e.fromCache)
        ? 'cache-hit'
        : visuals.some((v) => v.kind === 'trace')
        ? 'trace'
        : ready.some((e) => e.record.animation)
        ? 'animated'
        : 'static',
      latencyMs: Date.now() - started,
      // Node has no Pyodide worker and no renderer: traces and the critic are measured in the reader.
      unsupported: ['trace', 'critic'],
    }
  }
}
