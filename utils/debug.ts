import type {
  CompletionDebugInfo,
  CompletionEventStats,
  CompletionResponse,
  KnowledgeChunk,
} from '~/types'
import { deriveCompletionQualitySignal } from './quality-signal'

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
    knowledgeBudget: {
      topK: number
      maxChars: number
    }
  }
  knowledgeResolution: {
    chunks: KnowledgeChunk[]
    context?: string
    query?: string
  }
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
    knowledgeChunks: args.knowledgeResolution.chunks.map(chunk => ({
      id: chunk.id,
      sourceName: chunk.metadata.sourceName,
      text: chunk.text,
    })),
    knowledgeContext: args.knowledgeResolution.context,
    knowledgeQuery: args.knowledgeResolution.query,
    telemetry: args.telemetry === undefined
      ? undefined
      : {
          ...args.telemetry,
          qualitySignal: deriveCompletionQualitySignal(args.telemetry.stats),
        },
  }
}
