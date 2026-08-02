// Shared by the fixture EPUB builders: deterministic OCF zip (mimetype first and stored, fixed dates)
// with a self-check that every manifest item of `OEBPS/content.opf` is in the archive.
import assert from 'node:assert/strict'

import JSZip from 'jszip'

const DATE = new Date('2026-01-01T00:00:00Z')

/** Zips `files` (text) and `binaries` into an EPUB; same input → byte-identical output. */
export async function zipEpub(
  files: Record<string, string>,
  binaries: Record<string, Uint8Array> = {},
): Promise<Uint8Array> {
  const zip = new JSZip()
  zip.file('mimetype', 'application/epub+zip', { compression: 'STORE', date: DATE, createFolders: false })
  for (const name of Object.keys(files).sort()) zip.file(name, files[name]!, { date: DATE, createFolders: false })
  for (const [name, data] of Object.entries(binaries)) zip.file(name, data, { date: DATE, binary: true, createFolders: false })

  const bytes = await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE', compressionOptions: { level: 9 } })

  // Self-check: OCF requires `mimetype` as the first, uncompressed entry (local header at offset 0).
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  assert.equal(view.getUint32(0, true), 0x04034b50, 'zip local header')
  assert.equal(view.getUint16(8, true), 0, 'mimetype stored, not deflated')
  assert.equal(new TextDecoder().decode(bytes.subarray(30, 38)), 'mimetype')
  const reread = await JSZip.loadAsync(bytes)
  for (const [id, href] of [...files['OEBPS/content.opf']!.matchAll(/id="([^"]+)" href="([^"]+)"/g)].map((m) => [m[1], m[2]]))
    assert.ok(reread.file(`OEBPS/${href}`), `manifest item ${id} → ${href} is in the zip`)
  return bytes
}
