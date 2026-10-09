// Minimal session hook for API routes until W11 hardens the gate (spec §17, ADR 0005: every API route
// checks the session itself; middleware is only a convenience redirect).
import type { IncomingMessage } from 'http'

import type { SessionClaims } from '@illus/llm/server'

import { getIllusServer } from '../llm'

/** The verified app session of a request, or null. */
export async function getSession(req: IncomingMessage): Promise<SessionClaims | null> {
  return (await getIllusServer()).sessions.verify(req.headers.cookie)
}
