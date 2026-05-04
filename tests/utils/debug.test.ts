import type { CompletionDebugInfo, CompletionEventStats } from '~/types'
import { describe, expect, it } from 'vitest'
import { buildCompletionDebugInfo } from '~/utils/debug'

describe('buildCompletionDebugInfo', () => {
  it('attaches knowledge and telemetry details to an existing debug payload', () => {
    const baseDebug: CompletionDebugInfo = {
      rawCompletion: '，并支持评论。',
      sanitizedCompletion: '，并支持评论。',
      rawChoice: '{"message":{"content":"，并支持评论。"}}',
      cacheHit: false,
      requestBody: {
        systemPrompt: 'system',
        userPrompt: 'user',
      },
    }
    const telemetry: CompletionEventStats = {
      total: 12,
      accepted: 7,
      rejected: 3,
      ignored: 2,
      acceptanceRate: 0.58,
      averageLatencyMs: 143,
    }

    expect(buildCompletionDebugInfo(baseDebug, {
      appliedStrategy: {
        requestStage: 'enhanced',
        shouldRunEnhancedStage: false,
        telemetryWindowSize: 20,
        knowledgeBudget: {
          topK: 3,
          maxChars: 1200,
        },
      },
      knowledgeResolution: {
        query: '虚拟列表',
        context: '[Knowledge]\n虚拟列表适合处理长列表渲染。',
        chunks: [
          {
            id: 'chunk-1',
            kbId: 'default',
            docId: 'doc-1',
            text: '虚拟列表适合处理长列表渲染。',
            keywords: ['虚拟列表'],
            metadata: {
              charCount: 16,
              sourceName: 'Virtual List Notes',
              tokenCount: 10,
            },
          },
        ],
      },
      telemetry: {
        host: 'chatgpt.com',
        stats: telemetry,
      },
    })).toEqual({
      ...baseDebug,
      appliedStrategy: {
        requestStage: 'enhanced',
        shouldRunEnhancedStage: false,
        telemetryWindowSize: 20,
        knowledgeBudget: {
          topK: 3,
          maxChars: 1200,
        },
      },
      knowledgeQuery: '虚拟列表',
      knowledgeContext: '[Knowledge]\n虚拟列表适合处理长列表渲染。',
      knowledgeChunks: [
        {
          id: 'chunk-1',
          sourceName: 'Virtual List Notes',
          text: '虚拟列表适合处理长列表渲染。',
        },
      ],
      telemetry: {
        host: 'chatgpt.com',
        stats: telemetry,
        qualitySignal: {
          band: 'mixed',
          shouldBoostKnowledge: false,
          reason: 'Recent completions are inconsistent and may need closer review.',
        },
      },
    })
  })

  it('returns undefined when the base debug payload is absent', () => {
    expect(buildCompletionDebugInfo(undefined, {
      appliedStrategy: {
        requestStage: 'fast',
        shouldRunEnhancedStage: true,
        telemetryWindowSize: 20,
        knowledgeBudget: {
          topK: 2,
          maxChars: 900,
        },
      },
      knowledgeResolution: {
        chunks: [],
      },
    })).toBeUndefined()
  })
})
