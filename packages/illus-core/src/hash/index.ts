// SHA-256 via Web Crypto (browsers, workers, Node ≥ 19), with a node:crypto fallback for runtimes
// without a global Web Crypto.

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}

function toBytes(input: string | Uint8Array): Uint8Array<ArrayBuffer> {
  return (typeof input === 'string' ? new TextEncoder().encode(input) : new Uint8Array(input)) as Uint8Array<ArrayBuffer>
}

/** Node fallback. Exported for tests only; the package entry exports `sha256Hex` alone. */
export async function nodeSha256Hex(input: string | Uint8Array): Promise<string> {
  // Hidden from bundlers: only reached in runtimes without a global Web Crypto.
  const specifier = 'node:crypto'
  const { createHash } = (await import(/* webpackIgnore: true */ /* @vite-ignore */ specifier)) as {
    createHash(alg: string): { update(d: Uint8Array): { digest(): Uint8Array } }
  }
  return toHex(createHash('sha256').update(toBytes(input)).digest())
}

/** SHA-256 of UTF-8 text or raw bytes, as 64 lowercase hex characters. */
export async function sha256Hex(input: string | Uint8Array): Promise<string> {
  const subtle = globalThis.crypto?.subtle
  if (!subtle) return nodeSha256Hex(input)
  return toHex(new Uint8Array(await subtle.digest('SHA-256', toBytes(input))))
}
