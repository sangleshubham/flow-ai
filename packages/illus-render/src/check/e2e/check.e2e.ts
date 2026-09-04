import { expect, test } from '@playwright/test'

test.beforeEach(async ({ page }) => {
  await page.goto('/index.html')
  await expect(page.locator('body')).toHaveAttribute('data-ready', 'true', { timeout: 30_000 })
})

test('a factory graph renders clean and yields a 2× PNG capped at 900 px', async ({ page }) => {
  const r = await page.evaluate(async () => {
    const out = await window.__check.review(window.__check.make.graphIR())
    const img = new Image()
    img.src = `data:image/png;base64,${out.pngBase64}`
    await img.decode()
    return { codes: out.issues.map((i) => i.code), width: img.naturalWidth }
  })
  expect(r.codes).toEqual([])
  expect(r.width).toBeGreaterThan(100)
  expect(r.width).toBeLessThanOrEqual(1800)
})

test('two long LR chains are flagged for their aspect ratio and pass laid out TB', async ({ page }) => {
  const codes = await page.evaluate(async () => {
    const base = window.__check.make.graphIR()
    const ev = base.nodes[0]!.evidence
    const nodes = Array.from({ length: 12 }, (_, i) => ({ id: `n${i}`, label: `Step ${i}`, shape: 'box' as const, evidence: ev }))
    // Chains n0→…→n5 and n6→…→n11.
    const edges = nodes.flatMap((n, i) => (i % 6 === 5 ? [] : [{ id: `e${i}`, from: n.id, to: `n${i + 1}`, style: 'solid' as const, evidence: ev }]))
    const ir = { ...base, direction: 'LR' as const, nodes, edges, groups: [] }
    const lr = await window.__check.review(ir)
    const tb = await window.__check.review({ ...ir, direction: 'TB' as const })
    return { lr: lr.issues.map((i) => i.code), tb: tb.issues.map((i) => i.code) }
  })
  expect(codes.lr).toContain('aspect-ratio')
  expect(codes.tb).not.toContain('aspect-ratio')
})

test('measures real label boxes, node shapes and edge paths', async ({ page }) => {
  const geo = await page.evaluate(async () => {
    const host = document.createElement('div')
    host.innerHTML = `<svg width="300" height="100" viewBox="0 0 300 100">
      <g data-ir-id="a" data-target="node:a"><rect class="illus-shape" x="0" y="0" width="60" height="30"/><text x="5" y="20" font-size="14">A much too long label</text></g>
      <g data-ir-id="b" data-target="node:b"><rect class="illus-shape" x="200" y="0" width="80" height="30"/><text x="205" y="20" font-size="14">B</text></g>
      <g data-ir-id="e1" data-target="edge:e1"><path class="illus-edge-line" d="M60 15 L200 15"/></g>
    </svg>`
    document.body.append(host)
    const { issues, geometry } = window.__check.checkRender(host)
    return { codes: issues.map((i) => [i.code, i.elementId]), edge: geometry!.edges[0]!.points.length, labels: geometry!.labels.length }
  })
  expect(geo.codes).toEqual([['text-overflow', 'a']])
  expect(geo.edge).toBeGreaterThan(10)
  expect(geo.labels).toBe(2)
})
