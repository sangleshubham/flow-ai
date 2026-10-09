import { describe, expect, it } from 'vitest'
import { quoteRange } from '../src/range.ts'

describe('quoteRange', () => {
  it('maps normalized quotes through inline nodes and NFKC expansions to original DOM offsets', () => {
    document.body.innerHTML = '<p>Before <em>“The ﬁrst</em> queue”\u00ad receives <b>work.</b> After</p>'
    const range = document.createRange()
    range.selectNodeContents(document.querySelector('p')!)
    const quote = quoteRange(range, '"the first queue" receives work.')!
    expect(quote.toString()).toBe('“The ﬁrst queue”\u00ad receives work.')
  })
  it('separates table cells and list items and excludes scripts', () => {
    document.body.innerHTML = '<table><tr><td>Leader sends</td><td>the request</td></tr></table><script>bad text</script>'
    const range = document.createRange()
    range.selectNodeContents(document.body)
    expect(quoteRange(range, 'Leader sends the request')?.startContainer.textContent).toBe('Leader sends')
    expect(quoteRange(range, 'bad text')).toBeNull()
  })
  it('stays within block boundaries when a quote repeats elsewhere', () => {
    document.body.innerHTML = '<p>the same passage</p><p>the same passage</p>'
    const range = document.createRange()
    range.selectNodeContents(document.querySelectorAll('p')[1]!)
    expect(quoteRange(range, 'the same passage')?.startContainer.parentElement).toBe(document.querySelectorAll('p')[1])
    expect(quoteRange(range, 'missing quotation')).toBeNull()
  })
})
