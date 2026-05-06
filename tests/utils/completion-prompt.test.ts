import type { Settings } from '~/types'
import { describe, expect, it } from 'vitest'
import {
  buildCompletionUserPrompt,
  buildSoulContext,
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
  it('projects soul fields into layered prompt blocks with application rules', () => {
    expect(buildSoulContext(baseSoulSettings)).toBe(
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
      ...baseSoulSettings,
      enabled: false,
    })).toBe('')

    expect(buildSoulContext({
      enabled: true,
      profile: {
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
      profile: {
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
})

describe('buildCompletionUserPrompt', () => {
  it('injects soul before knowledge and prefix blocks', () => {
    const soulContext = buildSoulContext(baseSoulSettings)

    expect(buildCompletionUserPrompt({
      prefix: '我想开发一个博客系统',
      context: '[Copycat Notes]\n支持知识库召回',
      soulContext,
    })).toContain(
      `[Soul]\n${soulContext}\n\n[Knowledge]\n[Copycat Notes]\n支持知识库召回\n\n[Prefix]\n我想开发一个博客系统`,
    )
  })
})
