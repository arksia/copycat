import type {
  CompletionDebugInfo,
  CompletionError,
  CompletionEventStats,
  CompletionRequest,
  CompletionResponse,
  KnowledgeChunk,
  KnowledgeChunkEmbedding,
  KnowledgeDeleteResult,
  KnowledgeImportRequest,
  KnowledgeImportResult,
  RuntimeMessage,
} from '~/types'
import {
  buildCompletionCacheKey,
  CompletionMemoryCache,
  DEFAULT_COMPLETION_CACHE_TTL_MS,
} from '~/utils/completion/cache'
import { openSettingsPage } from '~/utils/core/runtime'
import { getPersistedCompletion, putPersistedCompletion } from '~/utils/db/repositories/completions'
import {
  getCompletionEventStats,
  listRecentCompletionEventsByHost,
  putCompletionEvent,
} from '~/utils/db/repositories/events'
import {
  listKnowledgeChunksByDocumentIds,
  deleteKnowledgeDocument,
  listKnowledgeDocuments,
  putKnowledgeChunks,
  putKnowledgeDocument,
  searchKnowledgeChunks,
} from '~/utils/db/repositories/knowledge'
import { buildCompletionDebugInfo } from '~/utils/completion/debug'
import { buildSoulContext } from '~/utils/completion/prompt'
import { resolveKnowledgeRetrievalBudget } from '~/utils/knowledge-budget'
import { resolveSemanticSimilarity } from '~/utils/knowledge/retriever'
import {
  buildKnowledgeContext,
  buildKnowledgeSearchQuery,
} from '~/utils/knowledge/prompt'
import {
  buildKnowledgeDocumentId,
  buildKnowledgeDocumentRecord,
  computeKnowledgeChecksum,
} from '~/utils/knowledge/import'
import { buildKnowledgeDocumentEmbedding } from '~/utils/knowledge/embedding'
import { completeOnce, completeOnceDetailed } from '~/utils/completion/client'
import { loadSettings, saveSettings } from '~/utils/settings'
import { deriveCompletionQualitySignal } from '~/utils/completion/telemetry'

export default defineBackground(() => {
  const defaultKnowledgeBaseId = 'default'
  const knowledgeContextMaxChars = 900
  const knowledgeTopK = 2
  const knowledgeDocumentTopK = 3
  const semanticQueryCacheTtlMs = 30_000
  const telemetryWindowSize = 20
  let creatingOffscreenDocument: Promise<void> | null = null
  const inFlight = new Map<string, AbortController>()
  const requestSignalKeys = new Map<string, string>()
  const completionCache = new CompletionMemoryCache()
  const semanticQueryEmbeddingCache = new Map<string, {
    expiresAt: number
    result: {
      backend: KnowledgeChunkEmbedding['backend']
      latencyMs: number
      model: string
      queryEmbedding: number[]
    }
  }>()

  chrome.runtime.onInstalled.addListener((details) => {
    if (details.reason === 'install') {
      void openSettingsPage()
    }
  })

  chrome.runtime.onMessage.addListener((message: RuntimeMessage, _sender, sendResponse) => {
    switch (message.type) {
      case 'completion/request':
        handleCompletion(message.payload)
          .then(res => sendResponse({ ok: true, data: res }))
          .catch((err: unknown) => {
            const payload: CompletionError = {
              id: message.payload.id,
              error: err instanceof Error ? err.message : String(err),
            }
            sendResponse({ ok: false, error: payload })
          })
        return true

      case 'completion/cancel':
        cancel(message.payload.id)
        sendResponse({ ok: true })
        return false

      case 'settings/get':
        void loadSettings()
          .then(s => sendResponse({ ok: true, data: s }))
          .catch((error: unknown) => {
            sendResponse({
              ok: false,
              error: {
                error: error instanceof Error ? error.message : String(error),
              },
            })
          })
        return true

      case 'settings/set':
        void saveSettings(message.payload)
          .then(s => sendResponse({ ok: true, data: s }))
          .catch((error: unknown) => {
            sendResponse({
              ok: false,
              error: {
                error: error instanceof Error ? error.message : String(error),
              },
            })
          })
        return true

      case 'completion/event':
        void putCompletionEvent(message.payload).catch((error: unknown) => {
          console.warn('[copycat] failed to persist completion event', error)
        })
        sendResponse({ ok: true })
        return false

      case 'completion/events/recent':
        void listRecentCompletionEventsByHost(message.payload.host, message.payload.limit)
          .then(result => sendResponse({ ok: true, data: result }))
          .catch((error: unknown) => {
            sendResponse({
              ok: false,
              error: {
                error: error instanceof Error ? error.message : String(error),
              },
            })
          })
        return true

      case 'completion/events/stats':
        void getCompletionEventStats(message.payload.host)
          .then((result: CompletionEventStats) => sendResponse({ ok: true, data: result }))
          .catch((error: unknown) => {
            sendResponse({
              ok: false,
              error: {
                error: error instanceof Error ? error.message : String(error),
              },
            })
          })
        return true

      case 'knowledge/delete':
        void handleKnowledgeDelete(message.payload)
          .then(result => sendResponse({ ok: true, data: result }))
          .catch((error: unknown) => {
            sendResponse({
              ok: false,
              error: {
                error: error instanceof Error ? error.message : String(error),
              },
            })
          })
        return true

      case 'knowledge/import':
        void importKnowledgeDocument(message.payload)
          .then(result => sendResponse({ ok: true, data: result }))
          .catch((error: unknown) => {
            sendResponse({
              ok: false,
              error: {
                error: error instanceof Error ? error.message : String(error),
              },
            })
          })
        return true

      case 'knowledge/list':
        void listKnowledgeDocuments(message.payload.kbId)
          .then(result => sendResponse({ ok: true, data: result }))
          .catch((error: unknown) => {
            sendResponse({
              ok: false,
              error: {
                error: error instanceof Error ? error.message : String(error),
              },
            })
          })
        return true

      case 'knowledge/search':
        void searchKnowledgeChunks(message.payload)
          .then(result => sendResponse({ ok: true, data: result.chunks }))
          .catch((error: unknown) => {
            sendResponse({
              ok: false,
              error: {
                error: error instanceof Error ? error.message : String(error),
              },
            })
          })
        return true
    }
    return false
  })

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
        ? await getCompletionEventStats(telemetryHost, telemetryWindowSize)
        : null
    const telemetryMs = Math.round(performance.now() - telemetryStart)
    const qualitySignal = telemetryStats === null ? undefined : deriveCompletionQualitySignal(telemetryStats)
    const shouldRunEnhancedStage = requestStage === 'fast' && qualitySignal?.shouldBoostKnowledge === true
    const knowledgeBudget = requestStage === 'enhanced'
      ? resolveKnowledgeRetrievalBudget({
          baseTopK: knowledgeTopK,
          baseMaxChars: knowledgeContextMaxChars,
          qualitySignal,
        })
      : {
          topK: knowledgeTopK,
          maxChars: knowledgeContextMaxChars,
        }
    const knowledgeStart = performance.now()
    const knowledgeResolution = await resolveCompletionKnowledge(
      req,
      settings.minPrefixChars,
      knowledgeBudget,
    )
    const knowledgeMs = Math.round(performance.now() - knowledgeStart)
    const completionContext = mergeCompletionContext(req.context, knowledgeResolution.context)
    const soulContext = buildSoulContext(settings.soul)
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
            settings,
            signal: controller.signal,
          })
        : {
            completion: await completeOnce({
              prefix: req.prefix,
              suffix: req.suffix,
              context: completionContext,
              settings,
              signal: controller.signal,
            }),
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
        latencyMs: llmMs,
        provider: settings.provider,
        model: settings.model,
        stage: requestStage,
        shouldRunEnhancedStage,
        debug: buildCompletionDebugInfo(detailed.debug, {
          appliedStrategy: {
            requestStage,
            shouldRunEnhancedStage,
            telemetryWindowSize,
            knowledgeBudget,
          },
          timings,
          knowledgeResolution,
          soul: {
            context: soulContext,
            enabled: settings.soul.enabled,
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

  function emptyResponse(
    id: string,
    provider: CompletionResponse['provider'],
    model: string,
    stage: CompletionResponse['stage'],
  ) {
    return {
      id,
      completion: '',
      latencyMs: 0,
      provider,
      model,
      stage,
      shouldRunEnhancedStage: false,
    }
  }

  async function handleKnowledgeDelete(args: {
    docId: string
    kbId: string
  }): Promise<KnowledgeDeleteResult> {
    const chunkCount = await deleteKnowledgeDocument(args)
    return {
      chunkCount,
      docId: args.docId,
    }
  }

  async function importKnowledgeDocument(
    request: KnowledgeImportRequest,
  ): Promise<KnowledgeImportResult> {
    if (request.sourceType !== 'markdown') {
      throw new Error('Only Markdown import is supported in this milestone.')
    }

    await ensureOffscreenDocument('offscreen.html')

    const checksum = await computeKnowledgeChecksum(request.rawContent)
    const provisionalDocId = buildKnowledgeDocumentId({
      checksum,
      kbId: request.kbId,
      title: request.title,
    })
    const processed = await sendOffscreenMessage<{
      chunks: KnowledgeChunk[]
      normalizedText: string
    }>({
      payload: {
        docId: provisionalDocId,
        kbId: request.kbId,
        rawContent: request.rawContent,
        sourceName: request.title,
      },
      target: 'offscreen',
      type: 'knowledge/process-markdown',
    })

    const normalizedChecksum = await computeKnowledgeChecksum(processed.normalizedText)
    const document = buildKnowledgeDocumentRecord({
      checksum: normalizedChecksum,
      chunkCount: processed.chunks.length,
      normalizedText: processed.normalizedText,
      request,
    })
    const finalChunks = processed.chunks.map((chunk, index) => ({
      ...chunk,
      id: `${document.id}:${index}`,
      docId: document.id,
      kbId: document.kbId,
    }))
    const embeddings = await embedKnowledgeChunks(finalChunks)
    const embeddedChunks = finalChunks.map((chunk, index) => ({
      ...chunk,
      embedding: embeddings[index],
    }))
    const embeddedDocument = {
      ...document,
      embedding: buildKnowledgeDocumentEmbedding(embeddings),
    }

    await putKnowledgeDocument(embeddedDocument)
    await putKnowledgeChunks(embeddedChunks)

    return {
      chunkCount: embeddedChunks.length,
      document: embeddedDocument,
    }
  }

  async function ensureOffscreenDocument(path: string): Promise<void> {
    const offscreenUrl = chrome.runtime.getURL(path)
    const contexts = await chrome.runtime.getContexts({
      contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT],
      documentUrls: [offscreenUrl],
    })

    if (contexts.length > 0) {
      return
    }

    if (creatingOffscreenDocument !== null) {
      await creatingOffscreenDocument
      return
    }

    creatingOffscreenDocument = chrome.offscreen.createDocument({
      url: path,
      reasons: [chrome.offscreen.Reason.DOM_PARSER],
      justification: 'Parse and chunk imported Markdown documents for local retrieval.',
    })

    try {
      await creatingOffscreenDocument
    }
    finally {
      creatingOffscreenDocument = null
    }
  }

  async function sendOffscreenMessage<T>(message: {
    payload: Record<string, unknown>
    target: 'offscreen'
    type: 'knowledge/embed-texts' | 'knowledge/process-markdown'
  }): Promise<T> {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(message, (response: {
        data?: T
        error?: { error?: string }
        ok?: boolean
      } | undefined) => {
        const runtimeError = chrome.runtime.lastError
        if (runtimeError) {
          reject(new Error(runtimeError.message))
          return
        }
        if (response?.ok) {
          resolve(response.data as T)
          return
        }
        reject(new Error(response?.error?.error ?? 'Offscreen processing failed'))
      })
    })
  }

  async function resolveCompletionKnowledge(
    req: CompletionRequest,
    minPrefixChars: number,
    budget: {
      topK: number
      maxChars: number
    },
  ): Promise<{
    chunks: KnowledgeChunk[]
    context?: string
    query?: string
    recall?: CompletionDebugInfo['knowledgeRecall']
    rerank?: CompletionDebugInfo['knowledgeRerank']
    timings?: NonNullable<CompletionDebugInfo['timings']>['knowledge']
  }> {
    const resolutionStart = performance.now()
    if (req.prefix.trim().length < minPrefixChars) {
      return {
        chunks: [],
        timings: {
          totalMs: Math.round(performance.now() - resolutionStart),
          loadChunksMs: 0,
          queryEmbeddingMs: 0,
          searchMs: 0,
          contextMs: 0,
          allChunkCount: 0,
          embeddedChunkCount: 0,
          semanticState: 'skipped',
        },
      }
    }

    try {
      const query = buildKnowledgeSearchQuery(req.prefix)
      if (query.length === 0) {
        return {
          chunks: [],
        timings: {
          totalMs: Math.round(performance.now() - resolutionStart),
          loadChunksMs: 0,
          queryEmbeddingMs: 0,
          searchMs: 0,
          contextMs: 0,
          allChunkCount: 0,
          embeddedChunkCount: 0,
          semanticState: 'skipped',
        },
      }
      }

      const loadChunksStart = performance.now()
      const documents = await listKnowledgeDocuments(defaultKnowledgeBaseId)
      const allChunkCount = documents.reduce(
        (total, document) => total + Number(document.metadata.chunkCount ?? 0),
        0,
      )
      const embeddedDocuments = documents.filter(document => {
        const embedding = document.embedding
        return embedding !== undefined && embedding.values.length > 0
      })
      const embeddedChunkCount = documents.reduce(
        (total, document) => {
          const embedding = document.embedding
          if (embedding === undefined || embedding.values.length === 0) {
            return total
          }
          return total + Number(document.metadata.chunkCount ?? 0)
        },
        0,
      )
      const loadChunksMs = Math.round(performance.now() - loadChunksStart)
      const queryEmbeddingStart = performance.now()
      const semanticResolution = await resolveSemanticQueryEmbedding(query, embeddedDocuments.length)
      const queryEmbeddingMs = Math.round(performance.now() - queryEmbeddingStart)
      const candidateDocIds = selectKnowledgeDocumentIds({
        documents: embeddedDocuments,
        limit: knowledgeDocumentTopK,
        queryEmbedding: semanticResolution?.meta?.queryEmbedding,
      })
      const candidateChunks = await listKnowledgeChunksByDocumentIds(candidateDocIds)

      const searchStart = performance.now()
      const result = await searchKnowledgeChunks({
        chunks: candidateChunks,
        kbId: defaultKnowledgeBaseId,
        query,
        topK: budget.topK,
        semanticMeta: semanticResolution?.meta,
      })
      const searchMs = Math.round(performance.now() - searchStart)
      const chunks = result.chunks
      const contextStart = performance.now()
      const packedKnowledge = buildKnowledgeContext({
        chunks,
        maxChars: budget.maxChars,
        maxChunks: budget.topK,
      })
      const contextMs = Math.round(performance.now() - contextStart)
      const timings = {
        totalMs: Math.round(performance.now() - resolutionStart),
        loadChunksMs,
        queryEmbeddingMs,
        searchMs,
        contextMs,
        allChunkCount,
        embeddedChunkCount,
        semanticState: semanticResolution?.state ?? 'skipped',
      }

      if (packedKnowledge.length > 0) {
        return {
          chunks,
          context: packedKnowledge,
          query,
          recall: result.recall,
          rerank: result.rerank,
          timings,
        }
      }

      return {
        chunks,
        query,
        recall: result.recall,
        rerank: result.rerank,
        timings,
      }
    }
    catch (error) {
      console.warn('[copycat] knowledge retrieval skipped', error)
    }

    return {
      chunks: [],
      timings: {
        totalMs: Math.round(performance.now() - resolutionStart),
        loadChunksMs: 0,
        queryEmbeddingMs: 0,
        searchMs: 0,
        contextMs: 0,
        allChunkCount: 0,
        embeddedChunkCount: 0,
        semanticState: 'skipped',
      },
    }
  }

  function mergeCompletionContext(
    baseContext: string | undefined,
    knowledgeContext: string | undefined,
  ): string | undefined {
    const parts = [baseContext, knowledgeContext]
      .filter((part): part is string => part !== undefined && part.trim().length > 0)
      .map(part => part.trim())

    return parts.length > 0 ? parts.join('\n\n') : undefined
  }

  function resolveTelemetryHostFromRequest(req: CompletionRequest): string | null {
    if (req.signalKey !== undefined && req.signalKey.length > 0 && req.signalKey.includes('::')) {
      return req.signalKey.split('::')[0] ?? null
    }
    return null
  }

  async function embedKnowledgeChunks(chunks: KnowledgeChunk[]): Promise<Array<KnowledgeChunkEmbedding | undefined>> {
    if (chunks.length === 0) {
      return []
    }

    try {
      const result = await sendOffscreenMessage<{
        backend: KnowledgeChunkEmbedding['backend']
        latencyMs: number
        model: string
        vectors: KnowledgeChunkEmbedding[]
      }>({
        payload: {
          texts: chunks.map(chunk => chunk.text),
        },
        target: 'offscreen',
        type: 'knowledge/embed-texts',
      })

      return result.vectors
    }
    catch (error) {
      console.warn('[copycat] knowledge chunk embedding skipped', error)
      return chunks.map(() => undefined)
    }
  }

  async function resolveSemanticQueryEmbedding(
    query: string,
    embeddedChunkCount: number,
  ): Promise<{
    meta?: {
      backend: KnowledgeChunkEmbedding['backend']
      latencyMs: number
      model: string
      queryEmbedding: number[]
    }
    state: 'cache_hit' | 'computed' | 'skipped'
  } | undefined> {
    try {
      if (embeddedChunkCount === 0) {
        return {
          state: 'skipped',
        }
      }

      const cached = semanticQueryEmbeddingCache.get(query)
      if (cached !== undefined) {
        if (cached.expiresAt > Date.now()) {
          return {
            meta: {
              ...cached.result,
              latencyMs: 0,
            },
            state: 'cache_hit',
          }
        }

        semanticQueryEmbeddingCache.delete(query)
      }

      const result = await sendOffscreenMessage<{
        backend: KnowledgeChunkEmbedding['backend']
        latencyMs: number
        model: string
        vectors: KnowledgeChunkEmbedding[]
      }>({
        payload: {
          texts: [query],
        },
        target: 'offscreen',
        type: 'knowledge/embed-texts',
      })

      const queryEmbedding = result.vectors[0]?.values
      if (queryEmbedding === undefined) {
        return undefined
      }

      const resolved = {
        backend: result.backend,
        latencyMs: result.latencyMs,
        model: result.model,
        queryEmbedding,
      }

      semanticQueryEmbeddingCache.set(query, {
        expiresAt: Date.now() + semanticQueryCacheTtlMs,
        result: resolved,
      })

      return {
        meta: resolved,
        state: 'computed',
      }
    }
    catch (error) {
      console.warn('[copycat] query embedding skipped', error)
      return {
        state: 'skipped',
      }
    }
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

    console.info('[copycat][timings]', {
      id: args.id,
      stage: args.stage,
      prefixLength: args.prefixLength,
      recallStrategy: args.recallStrategy ?? 'none',
      rerankStrategy: args.rerankStrategy ?? 'none',
      timings: args.timings,
    })
  }

  function selectKnowledgeDocumentIds(args: {
    documents: Array<Awaited<ReturnType<typeof listKnowledgeDocuments>>[number]>
    limit: number
    queryEmbedding?: number[]
  }): string[] {
    if (args.queryEmbedding === undefined) {
      return []
    }

    return args.documents
      .map((document) => {
        const score = resolveSemanticSimilarity(document.embedding?.values, args.queryEmbedding)
        return {
          document,
          score: score === null ? -1 : score,
        }
      })
      .filter(item => item.score > 0)
      .sort((left, right) => {
        if (right.score !== left.score) {
          return right.score - left.score
        }
        return right.document.updatedAt - left.document.updatedAt
      })
      .slice(0, args.limit)
      .map(item => item.document.id)
  }
})
