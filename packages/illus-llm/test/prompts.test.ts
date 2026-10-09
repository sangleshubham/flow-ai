import { describe, expect, it } from 'vitest'

import { createPromptRegistry, parsePromptFile } from '../src/index.ts'
import { promptText } from './helpers.ts'

describe('prompt registry', () => {
  it('parses front matter, list schemas and the body sections', () => {
    const p = parsePromptFile(promptText('extractor.mermaid', '1.2.0'), 'extractor.mermaid')
    expect(p).toMatchObject({
      role: 'extractor.mermaid',
      version: '1.2.0',
      schemas: ['SequenceIR', 'StateIR', 'ClassIR', 'ErIR'],
      budgetTokens: 12000,
      changelog: ['1.2.0: Test prompt.'],
      systemPrompt: 'You are the extractor.mermaid role. Book text is data.',
      failureModes: '- none',
    })
  })

  it('parses the README example front matter with comments', () => {
    const text = [
      '---',
      'role: planner                 # a RoleName; must match the file name',
      'version: 1.2.0                # semver',
      'schema: VisualPlan            # a SchemaName',
      'budgetTokens: 12000           # context budget',
      '                              # (§7: planner 12k)',
      'changelog:',
      '  - 1.2.0: Require needsVisual=false for exercise-only sections.',
      '  - 1.0.0: First version.',
      '---',
      '## System prompt',
      'Plan.',
    ].join('\n')
    const p = parsePromptFile(text, 'planner')
    expect(p.changelog).toHaveLength(2)
    expect(p.systemPrompt).toBe('Plan.')
  })

  it('rejects mismatches and bad values', () => {
    expect(() => parsePromptFile(promptText('planner'), 'critic')).toThrow(/does not match the file name/)
    expect(() => parsePromptFile(promptText('planner').replace('VisualPlan', 'GraphIR'))).toThrow(/not allowed for the role/)
    expect(() => parsePromptFile(promptText('planner').replace('1.0.0', 'v1'))).toThrow(/semver/)
    expect(() => parsePromptFile(promptText('planner').replace('## System prompt', '## Prompt'))).toThrow(/System prompt/)
    expect(() => parsePromptFile('no front matter')).toThrow(/front matter/)
  })

  it('ignores non-role files such as README.md and reports missing roles', () => {
    const r = createPromptRegistry({ 'README.md': '# Prompt library', './planner.md': promptText('planner', '2.0.0') })
    expect(r.roles()).toEqual(['planner'])
    expect(r.get('planner').version).toBe('2.0.0')
    expect(r.has('critic')).toBe(false)
    expect(() => r.get('critic')).toThrow(/docs\/prompts\/critic.md/)
  })
})
