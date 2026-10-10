// The part of jsdom's API the eval uses (jsdom ships no types; @types/jsdom is not a §19 dependency).
declare module 'jsdom' {
  export class JSDOM {
    constructor(html?: string, options?: { url?: string })
    readonly window: Window & typeof globalThis
  }
}
