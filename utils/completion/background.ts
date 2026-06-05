import type {
  CompletionDebugInfo,
  CompletionRequest,
  CompletionResponse,
  KnowledgeChunkEmbedding,
  ObservedSoulProfile,
} from '~/types'
import {
  mergeCompletionContext,
  resolveCompletionKnowledge,
  resolveKnowledgeRetrievalBudget,
} from '~/knowledge'
import {
  buildSoulProjection,
  distillSoulSignals,
  getSoulObservedSignalSnapshot,
  listMatureSoulObservedSignals,
} from '~/soul'
import { loadSettings } from '~/utils/settings'
import { getPersistedCompletion, putPersistedCompletion } from '~/utils/storage/repositories/completions'
import { getCompletionEventStats } from '~/utils/storage/repositories/events'
import {
  buildCompletionCacheKey,
  CompletionMemoryCache,
  DEFAULT_COMPLETION_CACHE_TTL_MS,
} from './cache'
import { completeOnce, completeOnceDetailed } from './client'
import { buildCompletionDebugInfo } from './debug'
import { deriveCompletionQualitySignal } from './telemetry'

interface QueryEmbeddingMeta {
  backend: KnowledgeChunkEmbedding['backend']
  latencyMs: number
  model: string
  queryEmbedding: number[]
}

export interface BackgroundCompletionService {
  cancel: (id: string) => void
  cancelBySignalKey: (signalKey: string) => void
  handleCompletion: (req: CompletionRequest) => Promise<CompletionResponse>
}

export function createBackgroundCompletionService(args: {
  defaultKnowledgeBaseId: string
  knowledgeContextMaxChars: number
  knowledgeDocumentTopK: number
  knowledgeTopK: number
  telemetryWindowSize: number
  resolveSemanticQueryEmbedding: (
    query: string,
    embeddedChunkCount: number,
  ) => Promise<{
    meta?: QueryEmbeddingMeta
    state: 'cache_hit' | 'computed' | 'skipped'
  } | undefined>
}): BackgroundCompletionService {
  const inFlight = new Map<string, AbortController>()
  const requestSignalKeys = new Map<string, string>()
  const completionCache = new CompletionMemoryCache()

  async function handleCompletion(req: CompletionRequest): Promise<CompletionResponse> {
    const requestStart = performance.now()
    const requestStage = req.stage ?? 'fast'
    if (req.signalKey !== undefined && req.signalKey.length > 0) {
      cancelBySignalKey(req.signalKey)
    }
    else {
      cancel(req.id)
    }

    const settingsStart = performance.now()
    const settings = await loadSettings()
    const settingsMs = Math.round(performance.now() - settingsStart)
    if (!settings.enabled) {
      return emptyResponse(req.id, settings.provider, settings.model, requestStage)
    }
    if (!settings.baseUrl) {
      throw new Error('Missing base URL. Please open the settings page to configure Copycat.')
    }

    const telemetryHost = resolveTelemetryHostFromRequest(req)
    const telemetryStart = performance.now()
    const telemetryStats
      = telemetryHost !== null && telemetryHost.length > 0
        ? await getCompletionEventStats(telemetryHost, args.telemetryWindowSize)
        : null
    const matureSoulSignals = settings.soul.enabled
      ? await listMatureSoulObservedSignals(8)
      : []
    const distilledSoul = distillSoulSignals(matureSoulSignals)
    const soulSignals = req.debug && settings.soul.enabled
      ? await getSoulObservedSignalSnapshot({
          limit: 8,
          matureOnly: true,
        })
      : undefined
    const telemetryMs = Math.round(performance.now() - telemetryStart)
    const qualitySignal = telemetryStats === null ? undefined : deriveCompletionQualitySignal(telemetryStats)
    const shouldRunEnhancedStage = requestStage === 'fast' && qualitySignal?.shouldBoostKnowledge === true
    const knowledgeBudget = requestStage === 'enhanced'
      ? resolveKnowledgeRetrievalBudget({
          baseTopK: args.knowledgeTopK,
          baseMaxChars: args.knowledgeContextMaxChars,
          qualitySignal,
        })
      : {
          topK: args.knowledgeTopK,
          maxChars: args.knowledgeContextMaxChars,
        }
    const knowledgeStart = performance.now()
    const knowledgeResolution = await resolveCompletionKnowledge({
      budget: knowledgeBudget,
      defaultKnowledgeBaseId: args.defaultKnowledgeBaseId,
      knowledgeDocumentTopK: args.knowledgeDocumentTopK,
      minPrefixChars: settings.minPrefixChars,
      prefix: req.prefix,
      resolveSemanticQueryEmbedding: args.resolveSemanticQueryEmbedding,
    })
    const knowledgeMs = Math.round(performance.now() - knowledgeStart)
    const completionContext = mergeCompletionContext(req.context, knowledgeResolution.context)
    const soulProjection = resolveRuntimeSoulProjection({
      enabled: settings.soul.enabled,
      text: settings.soul.text,
      observedProfile: distilledSoul.profile,
    })
    const soulContext = soulProjection.context
    const cacheKey = buildCompletionCacheKey({
      provider: settings.provider,
      model: settings.model,
      prefix: req.prefix,
      suffix: req.suffix,
      context: completionContext,
      soulContext,
    })
    const cached = completionCache.get(cacheKey)
    if (cached !== null && !req.debug) {
      return {
        id: req.id,
        completion: cached,
        skipped: false,
        latencyMs: 0,
        provider: settings.provider,
        model: settings.model,
        stage: requestStage,
        shouldRunEnhancedStage,
      }
    }
    if (!req.debug) {
      const persisted = await getPersistedCompletion(cacheKey)
      if (persisted !== null) {
        completionCache.set(cacheKey, persisted)
        return {
          id: req.id,
          completion: persisted,
          skipped: false,
          latencyMs: 0,
          provider: settings.provider,
          model: settings.model,
          stage: requestStage,
          shouldRunEnhancedStage,
        }
      }
    }

    const controller = new AbortController()
    inFlight.set(req.id, controller)
    if (req.signalKey !== undefined && req.signalKey.length > 0) {
      requestSignalKeys.set(req.signalKey, req.id)
    }

    const llmStart = performance.now()
    try {
      const detailed = req.debug
        ? await completeOnceDetailed({
            prefix: req.prefix,
            suffix: req.suffix,
            context: completionContext,
            soulContext,
            settings,
            signal: controller.signal,
          })
        : {
            completion: await completeOnce({
              prefix: req.prefix,
              suffix: req.suffix,
              context: completionContext,
              soulContext,
              settings,
              signal: controller.signal,
            }),
            skipped: false,
            debug: undefined,
          }
      const completion = detailed.completion
      if (completion) {
        completionCache.set(cacheKey, completion)
        void putPersistedCompletion({
          key: cacheKey,
          value: completion,
          expiresAt: Date.now() + DEFAULT_COMPLETION_CACHE_TTL_MS,
          updatedAt: Date.now(),
        }).catch((error: unknown) => {
          console.warn('[copycat] failed to persist completion cache', error)
        })
      }
      const llmMs = Math.round(performance.now() - llmStart)
      const totalMs = Math.round(performance.now() - requestStart)
      const timings = {
        totalMs,
        settingsMs,
        telemetryMs,
        knowledgeMs,
        llmMs,
      }

      logDevCompletionTimings({
        id: req.id,
        stage: requestStage,
        prefixLength: req.prefix.length,
        timings: {
          ...timings,
          knowledge: knowledgeResolution.timings,
        },
        recallStrategy: knowledgeResolution.recall?.strategy,
        rerankStrategy: knowledgeResolution.rerank?.strategy,
      })

      return {
        id: req.id,
        completion,
        skipped: detailed.skipped,
        latencyMs: llmMs,
        provider: settings.provider,
        model: settings.model,
        stage: requestStage,
        shouldRunEnhancedStage: shouldRunEnhancedStage && !detailed.skipped,
        debug: buildCompletionDebugInfo(detailed.debug, {
          appliedStrategy: {
            requestStage,
            shouldRunEnhancedStage: shouldRunEnhancedStage && !detailed.skipped,
            telemetryWindowSize: args.telemetryWindowSize,
            knowledgeBudget,
          },
          timings,
          knowledgeResolution,
          soul: {
            context: soulContext,
            enabled: settings.soul.enabled,
            budget: soulProjection.meta,
            pinnedContext: buildSoulProjection({
              enabled: settings.soul.enabled,
              text: settings.soul.text,
            }).context,
            observedContext: buildSoulProjection({
              enabled: settings.soul.enabled,
              text: '',
              observed: distilledSoul.profile,
            }).context,
            observedProfile: distilledSoul.profile,
            observedSignalCount: matureSoulSignals.length,
          },
          soulSignals: soulSignals === undefined
            ? undefined
            : {
                triggered: true,
                totalCount: soulSignals.totalCount,
                matureCount: soulSignals.matureCount,
                signals: soulSignals.signals.map(signal => ({
                  id: signal.id,
                  kind: signal.kind,
                  value: signal.value,
                  confidence: signal.confidence,
                  count: signal.count,
                  acceptedCount: signal.acceptedCount,
                  rejectedCount: signal.rejectedCount,
                  ignoredCount: signal.ignoredCount,
                  distinctContextCount: signal.distinctContextCount,
                  evidence: signal.evidence,
                })),
              },
          telemetry: telemetryStats === null
            ? undefined
            : {
                host: telemetryHost ?? 'unknown',
                stats: telemetryStats,
              },
        }),
      }
    }
    catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        return emptyResponse(req.id, settings.provider, settings.model, requestStage)
      }
      throw error
    }
    finally {
      clearRequest(req.id, req.signalKey)
    }
  }

  function cancel(id: string) {
    const ctrl = inFlight.get(id)
    if (ctrl) {
      ctrl.abort()
    }
    clearRequest(id)
  }

  function cancelBySignalKey(signalKey: string) {
    const requestId = requestSignalKeys.get(signalKey)
    if (requestId === undefined)
      return
    cancel(requestId)
  }

  function clearRequest(id: string, signalKey?: string) {
    inFlight.delete(id)
    if (signalKey !== undefined && signalKey.length > 0) {
      const activeId = requestSignalKeys.get(signalKey)
      if (activeId === id) {
        requestSignalKeys.delete(signalKey)
      }
      return
    }
    for (const [key, value] of requestSignalKeys.entries()) {
      if (value === id) {
        requestSignalKeys.delete(key)
      }
    }
  }

  return {
    cancel,
    cancelBySignalKey,
    handleCompletion,
  }
}

function resolveRuntimeSoulProjection(args: {
  enabled: boolean
  text: string
  observedProfile: ObservedSoulProfile
}) {
  return buildSoulProjection({
    enabled: args.enabled,
    text: args.text,
    observed: args.observedProfile,
  })
}

function emptyResponse(
  id: string,
  provider: CompletionResponse['provider'],
  model: string,
  stage: CompletionResponse['stage'],
) {
  return {
    id,
    completion: '',
    skipped: false,
    latencyMs: 0,
    provider,
    model,
    stage,
    shouldRunEnhancedStage: false,
  }
}

function resolveTelemetryHostFromRequest(req: CompletionRequest): string | null {
  if (req.signalKey !== undefined && req.signalKey.length > 0 && req.signalKey.includes('::')) {
    return req.signalKey.split('::')[0] ?? null
  }
  return null
}

function logDevCompletionTimings(args: {
  id: string
  stage: 'enhanced' | 'fast'
  prefixLength: number
  timings: NonNullable<CompletionDebugInfo['timings']>
  recallStrategy?: NonNullable<CompletionDebugInfo['knowledgeRecall']>['strategy']
  rerankStrategy?: NonNullable<CompletionDebugInfo['knowledgeRerank']>['strategy']
}) {
  if (!import.meta.env.DEV) {
    return
  }

  console.warn('[copycat][timings]', {
    id: args.id,
    stage: args.stage,
    prefixLength: args.prefixLength,
    recallStrategy: args.recallStrategy ?? 'none',
    rerankStrategy: args.rerankStrategy ?? 'none',
    timings: args.timings,
  })
}
