import type {
  CompletionError,
  CompletionEventStats,
  CompletionRequest,
  CompletionResponse,
  KnowledgeChunk,
  KnowledgeDeleteResult,
  KnowledgeImportRequest,
  KnowledgeImportResult,
  RuntimeMessage,
} from '~/types'
import {
  buildCompletionCacheKey,
  CompletionMemoryCache,
  DEFAULT_COMPLETION_CACHE_TTL_MS,
} from '~/utils/completion-cache'
import { getPersistedCompletion, putPersistedCompletion } from '~/utils/db/repositories/completions'
import {
  getCompletionEventStats,
  listRecentCompletionEventsByHost,
  putCompletionEvent,
} from '~/utils/db/repositories/events'
import {
  deleteKnowledgeDocument,
  listKnowledgeDocuments,
  putKnowledgeChunks,
  putKnowledgeDocument,
  searchKnowledgeChunks,
} from '~/utils/db/repositories/knowledge'
import { buildCompletionDebugInfo } from '~/utils/debug'
import {
  buildKnowledgeContext,
  buildKnowledgeSearchQuery,
} from '~/utils/knowledge/context'
import {
  buildKnowledgeDocumentId,
  buildKnowledgeDocumentRecord,
  computeKnowledgeChecksum,
} from '~/utils/knowledge/import'
import { completeOnce, completeOnceDetailed } from '~/utils/llm'
import { openSettingsPage } from '~/utils/open-settings'
import { loadSettings, saveSettings } from '~/utils/settings'

export default defineBackground(() => {
  const defaultKnowledgeBaseId = 'default'
  const knowledgeContextMaxChars = 900
  const knowledgeTopK = 2
  let creatingOffscreenDocument: Promise<void> | null = null
  const inFlight = new Map<string, AbortController>()
  const requestSignalKeys = new Map<string, string>()
  const completionCache = new CompletionMemoryCache()

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
    }
    return false
  })

  async function handleCompletion(req: CompletionRequest): Promise<CompletionResponse> {
    if (req.signalKey !== undefined && req.signalKey.length > 0) {
      cancelBySignalKey(req.signalKey)
    }
    else {
      cancel(req.id)
    }

    const settings = await loadSettings()
    if (!settings.enabled) {
      return emptyResponse(req.id, settings.provider, settings.model)
    }
    if (!settings.baseUrl) {
      throw new Error('Missing base URL. Please open the settings page to configure Copycat.')
    }

    const knowledgeResolution = await resolveCompletionKnowledge(req, settings.minPrefixChars)
    const completionContext = mergeCompletionContext(req.context, knowledgeResolution.context)
    const cacheKey = buildCompletionCacheKey({
      provider: settings.provider,
      model: settings.model,
      prefix: req.prefix,
      suffix: req.suffix,
      context: completionContext,
    })
    const cached = completionCache.get(cacheKey)
    if (cached !== null && !req.debug) {
      return {
        id: req.id,
        completion: cached,
        latencyMs: 0,
        provider: settings.provider,
        model: settings.model,
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
        }
      }
    }

    const controller = new AbortController()
    inFlight.set(req.id, controller)
    if (req.signalKey !== undefined && req.signalKey.length > 0) {
      requestSignalKeys.set(req.signalKey, req.id)
    }

    const start = performance.now()
    try {
      const telemetryStats = req.debug
        ? await getCompletionEventStats('playground')
        : null
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
      return {
        id: req.id,
        completion,
        latencyMs: Math.round(performance.now() - start),
        provider: settings.provider,
        model: settings.model,
        debug: buildCompletionDebugInfo(detailed.debug, {
          knowledgeResolution,
          telemetry: telemetryStats === null
            ? undefined
            : {
                host: 'playground',
                stats: telemetryStats,
              },
        }),
      }
    }
    catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        return emptyResponse(req.id, settings.provider, settings.model)
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

  function emptyResponse(id: string, provider: CompletionResponse['provider'], model: string) {
    return { id, completion: '', latencyMs: 0, provider, model }
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

    await putKnowledgeDocument(document)
    await putKnowledgeChunks(finalChunks)

    return {
      chunkCount: finalChunks.length,
      document,
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
    type: 'knowledge/process-markdown'
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
  ): Promise<{
    chunks: KnowledgeChunk[]
    context?: string
    query?: string
  }> {
    if (req.prefix.trim().length < minPrefixChars) {
      return { chunks: [] }
    }

    try {
      const query = buildKnowledgeSearchQuery(req.prefix)
      if (query.length === 0) {
        return { chunks: [] }
      }

      const chunks = await searchKnowledgeChunks({
        kbId: defaultKnowledgeBaseId,
        query,
        topK: knowledgeTopK,
      })
      const packedKnowledge = buildKnowledgeContext({
        chunks,
        maxChars: knowledgeContextMaxChars,
        maxChunks: knowledgeTopK,
      })

      if (packedKnowledge.length > 0) {
        return {
          chunks,
          context: packedKnowledge,
          query,
        }
      }
    }
    catch (error) {
      console.warn('[copycat] knowledge retrieval skipped', error)
    }

    return { chunks: [] }
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
})
