import { describe, expect, it } from 'vitest'
import { buildChatCompletionBody, resolveThinkingControlMode } from '~/utils/completion/client'

describe('buildChatCompletionBody', () => {
  it('adds reasoning_effort none for supported OpenAI GPT-5 models', () => {
    expect(buildChatCompletionBody({
      provider: 'openai',
      baseUrl: 'https://api.openai.com/v1',
      model: 'gpt-5-mini',
      systemPrompt: 'system',
      userPrompt: 'user',
      thinkingControlMode: 'auto',
      temperature: 0.2,
      maxTokens: 48,
    })).toMatchObject({
      reasoning_effort: 'none',
    })
  })

  it('adds DeepSeek thinking disabled control', () => {
    expect(buildChatCompletionBody({
      provider: 'deepseek',
      baseUrl: 'https://api.deepseek.com/v1',
      model: 'deepseek-chat',
      systemPrompt: 'system',
      userPrompt: 'user',
      thinkingControlMode: 'auto',
      temperature: 0.2,
      maxTokens: 48,
    })).toMatchObject({
      thinking: {
        type: 'disabled',
      },
    })
  })

  it('adds MiniMax thinking disabled control even through the openai provider path', () => {
    expect(buildChatCompletionBody({
      provider: 'openai',
      baseUrl: 'https://api.minimax.io/v1',
      model: 'MiniMax-M3',
      systemPrompt: 'system',
      userPrompt: 'user',
      thinkingControlMode: 'auto',
      temperature: 0.2,
      maxTokens: 48,
    })).toMatchObject({
      thinking: {
        type: 'disabled',
      },
    })
  })

  it('does not add thinking controls when the toggle is off', () => {
    expect(buildChatCompletionBody({
      provider: 'openai',
      baseUrl: 'https://api.openai.com/v1',
      model: 'gpt-5-mini',
      systemPrompt: 'system',
      userPrompt: 'user',
      thinkingControlMode: 'reasoning_effort_none',
      temperature: 0.2,
      maxTokens: 48,
    })).toHaveProperty('reasoning_effort', 'none')
  })

  it('returns none internally when auto cannot determine a supported disable strategy', () => {
    expect(resolveThinkingControlMode({
      provider: 'custom',
      baseUrl: 'https://example.com/v1',
      model: 'custom-model',
      mode: 'auto',
    })).toBe('none')
  })

  it('does not add unsupported controls for generic models', () => {
    expect(buildChatCompletionBody({
      provider: 'groq',
      baseUrl: 'https://api.groq.com/openai/v1',
      model: 'llama-3.1-8b-instant',
      systemPrompt: 'system',
      userPrompt: 'user',
      thinkingControlMode: 'auto',
      temperature: 0.2,
      maxTokens: 48,
    })).not.toHaveProperty('reasoning_effort')
  })

  it('resolves auto mode from host before falling back to model prefixes', () => {
    expect(resolveThinkingControlMode({
      provider: 'custom',
      baseUrl: 'https://api.minimax.io/v1',
      model: 'custom-name',
      mode: 'auto',
    })).toBe('thinking_disabled')
  })
})
