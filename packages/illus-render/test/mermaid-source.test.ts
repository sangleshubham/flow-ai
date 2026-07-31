// @vitest-environment jsdom
import mermaid from 'mermaid'
import { make, Q } from '@illus/core/testing'
import { describe, expect, it } from 'vitest'

import { plain, seqText, toMermaid } from '../src/mermaid/source.ts'

const EVIL = '<img src=x onerror=alert(1)>; end "q" {x}'

describe('escaping', () => {
  it('seqText turns grammar characters into entity codes', () => {
    expect(seqText('a: b; #c <d>')).toBe('a#58; b#59; #35;c #60;d#62;')
  })
  it('plain swaps statement separators, quotes and braces for look-alikes', () => {
    const out = plain(EVIL)
    expect(out).not.toMatch(/[;"{}]/)
    expect(out).toContain('end')
  })
})

describe('toMermaid', () => {
  it('sequence: aliases participants and maps message kinds to arrows', () => {
    const { source, aliases } = toMermaid(make.sequenceIR())
    expect(aliases).toEqual({ n0: 'client', n1: 'leader', n2: 'follower' })
    expect(source).toBe(
      [
        'sequenceDiagram',
        '  participant n0 as Client',
        '  participant n1 as Leader',
        '  participant n2 as Follower',
        '  n0->>n1: request',
        '  n1-)n2: AppendEntries',
        '  n2-->>n1: success',
      ].join('\n'),
    )
  })

  it('state: transitions first, then start and final arrows', () => {
    const { source } = toMermaid(make.stateIR({ final: ['leader'] }))
    expect(source.split('\n').slice(4)).toEqual([
      '  n0 --> n1 : no heartbeat',
      '  n1 --> n2 : majority of votes',
      '  [*] --> n0',
      '  n2 --> [*]',
    ])
  })

  it('class: members, stereotypes, cardinalities and arrow direction', () => {
    const ir = make.classIR({
      classes: [
        { ...make.classIR().classes[0]!, stereotype: 'interface' },
        make.classIR().classes[1]!,
      ],
      relations: [
        ...make.classIR().relations,
        { id: 'r2', from: 'LogEntry', to: 'Log', kind: 'inheritance', evidence: Q.serverStores },
      ],
    })
    const { source } = toMermaid(ir)
    expect(source).toContain('  class n0["Log"] {\n    <<interface>>\n    commitIndex: int\n    -advanceCommit(matchIndex []int)\n  }')
    expect(source).toContain('  n0 "1" *-- "0..*" n1')
    expect(source).toContain('  n0 <|-- n1')
  })

  it('er: crow-foot cardinalities, identifying lines, placeholder types', () => {
    const { source } = toMermaid(make.erIR())
    expect(source).toContain('  n1["LogEntry"] {\n    int term\n    string command\n  }')
    expect(source).toContain('  n0 ||..o{ n1 : "stores"')
    const untyped = toMermaid(
      make.erIR({ entities: [{ id: 'a', label: 'A', attributes: [{ name: 'created at', evidence: Q.entryFields }], evidence: Q.entryFields }], relationships: [] }),
    )
    expect(untyped.source).toContain('    _ created_at')
  })

  it('every kind parses with mermaid.parse, including hostile labels', async () => {
    const irs = [
      make.sequenceIR(),
      make.stateIR(),
      make.classIR(),
      make.erIR(),
      make.sequenceIR({ participants: make.sequenceIR().participants.map((p) => ({ ...p, label: EVIL.slice(0, 40) })) }),
      make.stateIR({ states: make.stateIR().states.map((s) => ({ ...s, label: EVIL.slice(0, 40) })) }),
      make.classIR({ title: 'x', classes: make.classIR().classes.map((c) => ({ ...c, label: EVIL.slice(0, 40) })) }),
      make.erIR({ relationships: make.erIR().relationships.map((r) => ({ ...r, label: EVIL.slice(0, 40) })) }),
    ]
    for (const ir of irs) await expect(mermaid.parse(toMermaid(ir).source)).resolves.toBeTruthy()
    // The parser really validates: raw hyphenated ids (why aliases exist) are rejected.
    await expect(mermaid.parse('stateDiagram-v2\n  a-b --> c : go')).rejects.toThrow()
  })
})
