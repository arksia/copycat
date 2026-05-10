import type { CompletionDebugInfo, CompletionEventStats } from '~/types'
import { describe, expect, it } from 'vitest'
import { buildCompletionDebugInfo } from '~/utils/completion/debug'

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
      timings: {
        totalMs: 320,
        settingsMs: 2,
        telemetryMs: 6,
        knowledgeMs: 38,
        llmMs: 274,
      },
      knowledgeResolution: {
        query: '虚拟列表',
        context: '[Knowledge]\n虚拟列表适合处理长列表渲染。',
        budgetMeta: {
          totalChars: 1200,
          usedChars: 32,
          truncated: true,
          includedChunkIds: ['chunk-1'],
          droppedChunkIds: ['chunk-2'],
          trimmedChunkIds: [],
        },
        recall: {
          strategy: 'semantic_index',
          queryTerms: ['虚拟列表', '滚动', '性能'],
          candidateCount: 4,
          returnedCount: 1,
        },
        rerank: {
          strategy: 'semantic_only_v1',
          semanticEnabled: false,
          semanticBackend: 'wasm',
          semanticModel: 'test-model',
          semanticQueryLatencyMs: 12,
          queryTerms: ['虚拟列表', '滚动', '性能'],
          rankedChunks: [
            {
              id: 'chunk-1',
              sourceName: 'Virtual List Notes',
              totalScore: 7,
              lexicalScore: 7,
              semanticScore: null,
              matchedTerms: 3,
              keywordHits: 2,
              textHits: 1,
              tokenCount: 10,
              charCount: 16,
            },
          ],
        },
        timings: {
          totalMs: 38,
          loadChunksMs: 9,
          queryEmbeddingMs: 15,
          searchMs: 11,
          contextMs: 3,
          allChunkCount: 4,
          embeddedChunkCount: 4,
          semanticState: 'computed',
        },
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
      soul: {
        context: '[Identity]\n工程师\n\n[Preferences]\n先给结论',
        enabled: true,
        budget: {
          totalChars: 1200,
          reservedChars: 240,
          usedChars: 34,
          truncated: false,
          includedBlocks: ['Role Context', 'Writing Preferences', 'Application Rules'],
          droppedBlocks: [],
          trimmedBlocks: [],
        },
      },
      soulSignals: {
        triggered: true,
        totalCount: 2,
        matureCount: 1,
        signals: [
          {
            id: 'signal-1',
            kind: 'preference',
            value: 'prefer-direct-tone',
            confidence: 0.43,
            count: 3,
            acceptedCount: 2,
            rejectedCount: 1,
            ignoredCount: 0,
            distinctContextCount: 2,
            evidence: {
              action: 'accepted',
              host: 'chatgpt.com',
              prefixPreview: '写结论先行的回复',
              suggestionPreview: '先给结论，再补充原因。',
              suggestionLengthBucket: 'short',
              openingStructure: 'answer-first',
              toneHints: ['direct'],
              termHits: [],
              timestamp: 100,
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
      timings: {
        totalMs: 320,
        settingsMs: 2,
        telemetryMs: 6,
        knowledgeMs: 38,
        llmMs: 274,
        knowledge: {
          totalMs: 38,
          loadChunksMs: 9,
          queryEmbeddingMs: 15,
          searchMs: 11,
          contextMs: 3,
          allChunkCount: 4,
          embeddedChunkCount: 4,
          semanticState: 'computed',
        },
      },
      knowledgeQuery: '虚拟列表',
      knowledgeRecall: {
        strategy: 'semantic_index',
        queryTerms: ['虚拟列表', '滚动', '性能'],
        candidateCount: 4,
        returnedCount: 1,
      },
      knowledgeRerank: {
        strategy: 'semantic_only_v1',
        semanticEnabled: false,
        semanticBackend: 'wasm',
        semanticModel: 'test-model',
        semanticQueryLatencyMs: 12,
        queryTerms: ['虚拟列表', '滚动', '性能'],
        rankedChunks: [
          {
            id: 'chunk-1',
            sourceName: 'Virtual List Notes',
            totalScore: 7,
            lexicalScore: 7,
            semanticScore: null,
            matchedTerms: 3,
            keywordHits: 2,
            textHits: 1,
            tokenCount: 10,
            charCount: 16,
          },
        ],
      },
      knowledgeContext: '[Knowledge]\n虚拟列表适合处理长列表渲染。',
      knowledgeBudgetMeta: {
        totalChars: 1200,
        usedChars: 32,
        truncated: true,
        includedChunkIds: ['chunk-1'],
        droppedChunkIds: ['chunk-2'],
        trimmedChunkIds: [],
      },
      promptLayers: {
        knowledge: {
          context: '[Knowledge]\n虚拟列表适合处理长列表渲染。',
          enabled: true,
          usedChars: '[Knowledge]\n虚拟列表适合处理长列表渲染。'.length,
          budget: {
            totalChars: 1200,
            usedChars: 32,
            truncated: true,
            includedChunkIds: ['chunk-1'],
            droppedChunkIds: ['chunk-2'],
            trimmedChunkIds: [],
          },
        },
        soul: {
          context: '[Identity]\n工程师\n\n[Preferences]\n先给结论',
          enabled: true,
          usedChars: 34,
          budget: {
            totalChars: 1200,
            reservedChars: 240,
            usedChars: 34,
            truncated: false,
            includedBlocks: ['Role Context', 'Writing Preferences', 'Application Rules'],
            droppedBlocks: [],
            trimmedBlocks: [],
          },
        },
      },
      soulContext: '[Identity]\n工程师\n\n[Preferences]\n先给结论',
      soulEnabled: true,
      soulConfigured: true,
      soulCharCount: 34,
      soulBudget: {
        totalChars: 1200,
        reservedChars: 240,
        usedChars: 34,
        truncated: false,
        includedBlocks: ['Role Context', 'Writing Preferences', 'Application Rules'],
        droppedBlocks: [],
        trimmedBlocks: [],
      },
      soulSignals: {
        triggered: true,
        totalCount: 2,
        matureCount: 1,
        signals: [
          {
            id: 'signal-1',
            kind: 'preference',
            value: 'prefer-direct-tone',
            confidence: 0.43,
            count: 3,
            acceptedCount: 2,
            rejectedCount: 1,
            ignoredCount: 0,
            distinctContextCount: 2,
            evidence: {
              action: 'accepted',
              host: 'chatgpt.com',
              prefixPreview: '写结论先行的回复',
              suggestionPreview: '先给结论，再补充原因。',
              suggestionLengthBucket: 'short',
              openingStructure: 'answer-first',
              toneHints: ['direct'],
              termHits: [],
              timestamp: 100,
            },
          },
        ],
      },
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
      timings: {
        totalMs: 0,
        settingsMs: 0,
        telemetryMs: 0,
        knowledgeMs: 0,
        llmMs: 0,
      },
      knowledgeResolution: {
        chunks: [],
      },
    })).toBeUndefined()
  })

  it('keeps soul configured state even when the projected context is empty', () => {
    const baseDebug: CompletionDebugInfo = {
      rawCompletion: '',
      sanitizedCompletion: '',
      rawChoice: '{}',
      cacheHit: false,
      requestBody: {
        systemPrompt: 'system',
        userPrompt: 'user',
      },
    }

    expect(buildCompletionDebugInfo(baseDebug, {
      appliedStrategy: {
        requestStage: 'fast',
        shouldRunEnhancedStage: false,
        telemetryWindowSize: 20,
        knowledgeBudget: {
          topK: 2,
          maxChars: 900,
        },
      },
      timings: {
        totalMs: 10,
        settingsMs: 1,
        telemetryMs: 0,
        knowledgeMs: 0,
        llmMs: 9,
      },
      knowledgeResolution: {
        chunks: [],
      },
      soul: {
        context: '',
        enabled: true,
        budget: {
          totalChars: 1200,
          reservedChars: 240,
          usedChars: 0,
          truncated: false,
          includedBlocks: [],
          droppedBlocks: [],
          trimmedBlocks: [],
        },
      },
    })).toMatchObject({
      soulContext: '',
      soulEnabled: false,
      soulConfigured: true,
      soulCharCount: 0,
      soulBudget: {
        totalChars: 1200,
        reservedChars: 240,
        usedChars: 0,
        truncated: false,
        includedBlocks: [],
        droppedBlocks: [],
        trimmedBlocks: [],
      },
      promptLayers: {
        soul: {
          context: '',
          enabled: false,
          usedChars: 0,
          budget: {
            totalChars: 1200,
            reservedChars: 240,
            usedChars: 0,
            truncated: false,
            includedBlocks: [],
            droppedBlocks: [],
            trimmedBlocks: [],
          },
        },
      },
    })
  })
})
