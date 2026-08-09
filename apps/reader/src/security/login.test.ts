import { describe, expect, it } from 'vitest'

import { passwordMatches, safeNext } from './login'

describe('safeNext', () => {
  it.each([
    ['/', '/'],
    ['/_?x=1', '/_?x=1'],
    ['//evil.example', '/'],
    ['/\\evil.example', '/'],
    ['https://evil.example', '/'],
    ['javascript:alert(1)', '/'],
    [undefined, '/'],
    [['/a', '/b'], '/'],
  ])('%s → %s', (input, out) => expect(safeNext(input)).toBe(out))
})

describe('passwordMatches', () => {
  const pw = 'correct horse battery staple'
  it('accepts only the configured password', () => {
    expect(passwordMatches(pw, pw)).toBe(true)
    expect(passwordMatches('wrong', pw)).toBe(false)
    expect(passwordMatches(`${pw} `, pw)).toBe(false)
    expect(passwordMatches(undefined, pw)).toBe(false)
  })
  it('refuses everything when the configured password is missing or shorter than 16 characters', () => {
    expect(passwordMatches('short', 'short')).toBe(false)
    expect(passwordMatches('', '')).toBe(false)
    expect(passwordMatches('anything', undefined)).toBe(false)
  })
})
