// Server singleton for /api/llm and /auth/chatgpt/* (spec §9). Built once per process from the
// ILLUS_* environment variables; configuration errors surface on the first request with a clear message
// and are retried on the next one.
import { createPromptRegistry } from '@illus/llm'
import { createIllusServer } from '@illus/llm/server'
import type { IllusServer } from '@illus/llm/server'

import { PROMPT_FILES } from './prompt-files'

let server: Promise<IllusServer> | undefined

export function getIllusServer(): Promise<IllusServer> {
  server ??= createIllusServer(process.env, { prompts: createPromptRegistry(PROMPT_FILES) }).catch((e: unknown) => {
    server = undefined
    throw e
  })
  return server
}
