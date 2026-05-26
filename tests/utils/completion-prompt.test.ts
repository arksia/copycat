import type { Settings } from '~/types'
import { describe, expect, it } from 'vitest'
import { buildSoulContext, buildSoulProjection } from '~/soul'
import {
  buildCompletionUserPrompt,
} from '~/utils/completion/prompt'

const baseSoulSettings: Settings['soul'] = {
  enabled: true,
  profile: {
    identity: '用户主要在做浏览器插件和 AI 输入体验。',
    style: '表达直接，偏中文技术写作。',
    preferences: '优先给结论，再展开必要细节。',
    avoidances: '不要套话，不要营销语气。',
    terms: 'ghost text、semantic recall、rerank',
    notes: '默认更关注工程取舍和实际可落地方案。',
  },
}

describe('buildSoulContext', () => {
  it('projects explicit soul fields into layered prompt blocks with application rules', () => {
    expect(buildSoulContext({
      enabled: true,
      explicit: baseSoulSettings.profile,
    })).toBe(
      '[Role Context]\n'
      + '用户主要在做浏览器插件和 AI 输入体验。\n\n'
      + '[Writing Preferences]\n'
      + '- 表达直接，偏中文技术写作。\n'
      + '- 优先给结论，再展开必要细节。\n\n'
      + '[Hard Constraints]\n'
      + '- 不要套话，不要营销语气。\n\n'
      + '[Preferred Terms]\n'
      + '- ghost text、semantic recall、rerank\n\n'
      + '[Additional Notes]\n'
      + '默认更关注工程取舍和实际可落地方案。\n\n'
      + '[Application Rules]\n'
      + '- Apply these Soul cues only when they are naturally relevant to the current prefix.\n'
      + '- Prefer influencing wording, structure, and terminology choices instead of restating these cues.\n'
      + '- If Soul conflicts with the current user intent, follow the current user intent.',
    )
  })

  it('returns an empty string when soul is disabled or all fields are empty', () => {
    expect(buildSoulContext({
      enabled: false,
      explicit: baseSoulSettings.profile,
    })).toBe('')

    expect(buildSoulContext({
      enabled: true,
      explicit: {
        identity: '',
        style: '',
        preferences: '',
        avoidances: '',
        terms: '',
        notes: '',
      },
    })).toBe('')
  })

  it('splits multi-line textarea fields into multiple list items', () => {
    expect(buildSoulContext({
      enabled: true,
      explicit: {
        identity: '',
        style: '表达直接\n少废话',
        preferences: '先给结论',
        avoidances: '不要套话\n不要营销语气',
        terms: 'ghost text\nsemantic recall',
        notes: '',
      },
    })).toContain(
      '[Writing Preferences]\n- 表达直接\n- 少废话\n- 先给结论\n\n'
      + '[Hard Constraints]\n- 不要套话\n- 不要营销语气\n\n'
      + '[Preferred Terms]\n- ghost text\n- semantic recall',
    )
  })

  it('preserves hard constraints before trimming low-priority notes', () => {
    const soulContext = buildSoulContext({
      enabled: true,
      explicit: {
        identity: '用户主要在做浏览器插件和 AI 输入体验。',
        style: '',
        preferences: '',
        avoidances: '不要套话，不要营销语气。',
        terms: '',
        notes: Array.from({ length: 120 }, (_, index) => `额外备注 ${index + 1}：保持内容尽量具体。`).join('\n'),
      },
    })

    expect(soulContext).toContain('[Hard Constraints]\n- 不要套话，不要营销语气。')
    expect(soulContext).toContain('[Additional Notes]\n')
    expect(soulContext).not.toContain('额外备注 120：保持内容尽量具体。')
  })

  it('keeps a stable output order after budget selection', () => {
    const soulContext = buildSoulContext({
      enabled: true,
      explicit: {
        identity: '资深工程师',
        style: '表达直接',
        preferences: '先给结论',
        avoidances: '不要套话',
        terms: 'ghost text',
        notes: Array.from({ length: 80 }, (_, index) => `补充说明 ${index + 1}`).join('\n'),
      },
    })

    expect(soulContext.indexOf('[Writing Preferences]')).toBeGreaterThan(soulContext.indexOf('[Role Context]'))
    expect(soulContext.indexOf('[Hard Constraints]')).toBeGreaterThan(soulContext.indexOf('[Writing Preferences]'))
    expect(soulContext.indexOf('[Preferred Terms]')).toBeGreaterThan(soulContext.indexOf('[Hard Constraints]'))
    expect(soulContext.indexOf('[Application Rules]')).toBeGreaterThan(soulContext.indexOf('[Preferred Terms]'))
  })

  it('always retains application rules when soul content is truncated', () => {
    const soulContext = buildSoulContext({
      enabled: true,
      explicit: {
        identity: '用户主要在做浏览器插件和 AI 输入体验。',
        style: '表达直接',
        preferences: '先给结论',
        avoidances: '不要套话',
        terms: 'ghost text',
        notes: Array.from({ length: 200 }, () => '这是一段很长的附加说明，用来触发 Soul 预算裁剪。').join('\n'),
      },
    })

    expect(soulContext).toContain('[Application Rules]')
    expect(soulContext).toContain('- If Soul conflicts with the current user intent, follow the current user intent.')
  })

  it('returns budget metadata for included, dropped, and trimmed soul blocks', () => {
    const projection = buildSoulProjection({
      enabled: true,
      explicit: {
        identity: '用户主要在做浏览器插件和 AI 输入体验。',
        style: '表达直接',
        preferences: '先给结论',
        avoidances: '不要套话',
        terms: 'ghost text',
        notes: Array.from({ length: 120 }, (_, index) => `额外备注 ${index + 1}：保持内容尽量具体。`).join('\n'),
      },
    })

    expect(projection.meta.totalChars).toBe(1200)
    expect(projection.meta.reservedChars).toBeGreaterThan(0)
    expect(projection.meta.usedChars).toBe(projection.context.length)
    expect(projection.meta.truncated).toBe(true)
    expect(projection.meta.includedBlocks).toContain('Hard Constraints')
    expect(projection.meta.includedBlocks).toContain('Application Rules')
    expect(projection.meta.trimmedBlocks).toContainEqual({
      label: 'Additional Notes',
      wasDropped: false,
    })
  })

  it('includes learned soul blocks after explicit soul blocks', () => {
    const context = buildSoulContext({
      enabled: true,
      explicit: {
        identity: '用户主要在做浏览器插件和 AI 输入体验。',
        style: '',
        preferences: '先给结论',
        avoidances: '',
        terms: '',
        notes: '',
      },
      learned: {
        preferences: ['Lead with the answer when it fits naturally.'],
        avoidances: ['Avoid hype, promotional language, and exaggerated claims.'],
        terms: ['rag'],
      },
    })

    expect(context).toContain('[Learned Preferences]\n- Lead with the answer when it fits naturally.')
    expect(context).toContain('[Learned Avoidances]\n- Avoid hype, promotional language, and exaggerated claims.')
    expect(context).toContain('[Learned Terms]\n- rag')
  })
})

describe('buildCompletionUserPrompt', () => {
  it('injects soul before knowledge and prefix blocks', () => {
    const soulContext = buildSoulContext({
      enabled: true,
      explicit: baseSoulSettings.profile,
    })

    expect(buildCompletionUserPrompt({
      prefix: '我想开发一个博客系统',
      context: '[Copycat Notes]\n支持知识库召回',
      soulContext,
    })).toContain(
      `[Soul]\n${soulContext}\n\n[Knowledge]\n[Copycat Notes]\n支持知识库召回\n\n[Prefix]\n我想开发一个博客系统`,
    )
  })

  it('tells the model to emit the skip sentinel for complete prefixes', () => {
    expect(buildCompletionUserPrompt({
      prefix: '你觉得这个方案怎么样？',
    })).toContain(
      'If it is already complete, output EXACTLY __COPYCAT_SKIP__.',
    )
  })

  it('tells the model not to skip needed leading punctuation', () => {
    expect(buildCompletionUserPrompt({
      prefix: '我觉得这个方案',
    })).toContain(
      'If the natural next character is punctuation, start with that punctuation instead of skipping it.',
    )
  })
})
