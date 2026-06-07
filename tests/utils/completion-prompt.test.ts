import { describe, expect, it } from 'vitest'
import { buildSoulContext, buildSoulProjection } from '~/soul'
import {
  buildCompletionUserPrompt,
} from '~/utils/completion/prompt'

const baseSoulText = [
  '用户主要在做浏览器插件和 AI 输入体验。',
  '表达直接，偏中文技术写作。',
  '优先给结论，再展开必要细节。',
  '不要套话，不要营销语气。',
  '常用术语：ghost text、semantic recall、rerank。',
].join('\n')

describe('buildSoulContext', () => {
  it('projects pinned soul text with application rules', () => {
    expect(buildSoulContext({
      enabled: true,
      text: baseSoulText,
    })).toBe(
      '[Pinned Soul]\n'
      + '用户主要在做浏览器插件和 AI 输入体验。\n'
      + '表达直接，偏中文技术写作。\n'
      + '优先给结论，再展开必要细节。\n'
      + '不要套话，不要营销语气。\n'
      + '常用术语：ghost text、semantic recall、rerank。\n\n'
      + '[Application Rules]\n'
      + '- Apply these Soul cues only when they are naturally relevant to the current prefix.\n'
      + '- Prefer influencing wording, structure, and terminology choices instead of restating these cues.\n'
      + '- If Soul conflicts with the current user intent, follow the current user intent.',
    )
  })

  it('returns an empty string when soul is disabled or empty', () => {
    expect(buildSoulContext({
      enabled: false,
      text: baseSoulText,
    })).toBe('')

    expect(buildSoulContext({
      enabled: true,
      text: '',
    })).toBe('')
  })

  it('preserves pinned soul text when the editable text is long', () => {
    const soulContext = buildSoulContext({
      enabled: true,
      text: Array.from({ length: 120 }, (_, index) => `固定 Soul ${index + 1}：保持内容尽量具体。`).join('\n'),
    })

    expect(soulContext).toContain('[Pinned Soul]\n固定 Soul 1：保持内容尽量具体。')
    expect(soulContext).not.toContain('固定 Soul 120：保持内容尽量具体。')
  })

  it('keeps a stable output order after budget selection', () => {
    const soulContext = buildSoulContext({
      enabled: true,
      text: '资深工程师\n表达直接',
    })

    expect(soulContext.indexOf('[Application Rules]')).toBeGreaterThan(soulContext.indexOf('[Pinned Soul]'))
  })

  it('always retains application rules when soul content is truncated', () => {
    const soulContext = buildSoulContext({
      enabled: true,
      text: Array.from({ length: 200 }).fill('这是一段很长的固定 Soul，用来触发预算裁剪。').join('\n'),
    })

    expect(soulContext).toContain('[Application Rules]')
    expect(soulContext).toContain('- If Soul conflicts with the current user intent, follow the current user intent.')
  })

  it('returns budget metadata for included, dropped, and trimmed soul blocks', () => {
    const projection = buildSoulProjection({
      enabled: true,
      text: Array.from({ length: 120 }, (_, index) => `固定 Soul ${index + 1}：保持内容尽量具体。`).join('\n'),
    })

    expect(projection.meta.totalChars).toBe(1200)
    expect(projection.meta.reservedChars).toBeGreaterThan(0)
    expect(projection.meta.usedChars).toBe(projection.context.length)
    expect(projection.meta.truncated).toBe(true)
    expect(projection.meta.includedBlocks).toContain('Pinned Soul')
    expect(projection.meta.includedBlocks).toContain('Application Rules')
    expect(projection.meta.trimmedBlocks).toContainEqual({
      label: 'Pinned Soul',
      wasDropped: false,
    })
  })
})

describe('buildCompletionUserPrompt', () => {
  it('injects soul before knowledge and prefix blocks', () => {
    const soulContext = buildSoulContext({
      enabled: true,
      text: baseSoulText,
    })

    expect(buildCompletionUserPrompt({
      prefix: '我想开发一个博客系统',
      context: '[Copycat Notes]\n支持知识库召回',
      soulContext,
    })).toContain(
      `[Soul]\n${soulContext}\n\n[Knowledge]\n[Copycat Notes]\n支持知识库召回\n\n[Prefix]\n我想开发一个博客系统`,
    )
  })

  it('only allows skip when continuation would turn into a reply', () => {
    expect(buildCompletionUserPrompt({
      prefix: '你觉得这个方案怎么样？',
    })).toContain(
      'Only output EXACTLY __COPYCAT_SKIP__ when you cannot continue naturally without turning the output into a reply instead of a continuation.',
    )
  })

  it('tells the model not to switch into assistant reply mode', () => {
    expect(buildCompletionUserPrompt({
      prefix: '你觉得这个方案怎么样？',
    })).toContain('Do not switch roles from continuing the writer\'s text to replying as an assistant.')
  })

  it('tells the model not to react to or evaluate the prefix', () => {
    expect(buildCompletionUserPrompt({
      prefix: '我觉得这个方案怎么样，如果我们还要',
    })).toContain('Do not answer, react to, evaluate, summarize, or give advice about the prefix.')
  })

  it('tells the model to keep needed leading connectors or punctuation', () => {
    expect(buildCompletionUserPrompt({
      prefix: '我觉得这个方案',
    })).toContain(
      'If continuation depends on a connector or punctuation mark, start with that connector or punctuation instead of omitting it.',
    )
  })

  it('keeps task-scoped continuation constraints in the user prompt', () => {
    expect(buildCompletionUserPrompt({
      prefix: '我觉得这个方案',
    })).toContain('Continue the prefix with ONE short, natural continuation in the SAME language as the prefix.')
    expect(buildCompletionUserPrompt({
      prefix: '我觉得这个方案',
    })).toContain('Your output must be directly appendable after the prefix as part of the SAME utterance.')
    expect(buildCompletionUserPrompt({
      prefix: '我觉得这个方案',
    })).toContain('Keep it short: a few words up to one sentence.')
  })
})
