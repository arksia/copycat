import type {
  CompletionDebugInfo,
  CompletionEventStats,
  CompletionResponse,
  KnowledgeChunk,
} from '~/types'
import { deriveCompletionQualitySignal } from './telemetry'

/**
 * Inputs required to build one structured completion debug payload.
 *
 * Use when:
 * - background code wants to enrich LLM debug output with retrieval metadata
 * - optional host telemetry should be exposed to debug-only surfaces
 *
 * Returns:
 * - the extra debug context merged around the base completion debug payload
 */
export interface BuildCompletionDebugInfoArgs {
  appliedStrategy: {
    requestStage: 'enhanced' | 'fast'
    shouldRunEnhancedStage: boolean
    telemetryWindowSize: number
    knowledgeBudget: {
      topK: number
      maxChars: number
    }
  }
  timings: NonNullable<CompletionDebugInfo['timings']>
  knowledgeResolution: {
    chunks: KnowledgeChunk[]
    context?: string
    budgetMeta?: CompletionDebugInfo['knowledgeBudgetMeta']
    query?: string
    recall?: CompletionDebugInfo['knowledgeRecall']
    rerank?: CompletionDebugInfo['knowledgeRerank']
    timings?: NonNullable<CompletionDebugInfo['timings']>['knowledge']
  }
  soul?: {
    context: string
    enabled: boolean
    budget?: CompletionDebugInfo['soulBudget']
  }
  soulSignals?: CompletionDebugInfo['soulSignals']
  telemetry?: {
    host: string
    stats: CompletionEventStats
  }
}

/**
 * Merges retrieval and local telemetry details into one debug payload.
 *
 * Use when:
 * - playground or future devtools need richer context around one completion request
 * - callers already have the base LLM debug payload and optional local diagnostics
 *
 * Expects:
 * - `debug` to come from the completion client when debug mode is enabled
 *
 * Returns:
 * - `undefined` when no base debug payload exists, otherwise an enriched debug object
 */
export function buildCompletionDebugInfo(
  debug: CompletionResponse['debug'],
  args: BuildCompletionDebugInfoArgs,
): CompletionDebugInfo | undefined {
  if (debug === undefined) {
    return undefined
  }

  return {
    ...debug,
    appliedStrategy: args.appliedStrategy,
    timings: {
      ...args.timings,
      knowledge: args.knowledgeResolution.timings,
    },
    knowledgeChunks: args.knowledgeResolution.chunks.map(chunk => ({
      id: chunk.id,
      sourceName: chunk.metadata.sourceName,
      text: chunk.text,
    })),
    soulContext: args.soul?.context ?? debug.soulContext,
    soulEnabled: (args.soul?.context ?? debug.soulContext ?? '').length > 0,
    soulConfigured: args.soul?.enabled ?? debug.soulConfigured,
    soulCharCount: (args.soul?.context ?? debug.soulContext ?? '').length,
    soulBudget: args.soul?.budget ?? debug.soulBudget,
    soulSignals: args.soulSignals ?? debug.soulSignals,
    knowledgeContext: args.knowledgeResolution.context,
    knowledgeBudgetMeta: args.knowledgeResolution.budgetMeta,
    promptLayers: {
      ...debug.promptLayers,
      ...(args.knowledgeResolution.context === undefined && args.knowledgeResolution.budgetMeta === undefined
        ? {}
        : {
            knowledge: {
              context: args.knowledgeResolution.context ?? '',
              enabled: (args.knowledgeResolution.context ?? '').length > 0,
              usedChars: (args.knowledgeResolution.context ?? '').length,
              budget: args.knowledgeResolution.budgetMeta,
            },
          }),
      ...(args.soul === undefined
        ? {}
        : {
            soul: {
              context: args.soul.context,
              enabled: args.soul.context.length > 0,
              usedChars: args.soul.context.length,
              budget: args.soul.budget,
            },
          }),
    },
    knowledgeQuery: args.knowledgeResolution.query,
    knowledgeRecall: args.knowledgeResolution.recall,
    knowledgeRerank: args.knowledgeResolution.rerank,
    telemetry: args.telemetry === undefined
      ? undefined
      : {
          ...args.telemetry,
          qualitySignal: deriveCompletionQualitySignal(args.telemetry.stats),
        },
  }
}
