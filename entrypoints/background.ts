import type {
  CompletionError,
  CompletionEvent,
  CompletionEventStats,
  KnowledgeChunk,
  KnowledgeChunkEmbedding,
  KnowledgeDeleteResult,
  KnowledgeDocument,
  KnowledgeImportRequest,
  KnowledgeImportResult,
  RuntimeMessage,
} from '~/types'
import {
  createBackgroundCompletionService,
} from '~/utils/completion/background'
import { openSettingsPage } from '~/utils/runtime'
import {
  getCompletionEventStats,
  listRecentCompletionEventsByHost,
  putCompletionEvent,
} from '~/utils/storage/repositories/events'
import {
  getSoulObservedSignalSnapshot,
  deriveSoulObservedSignals,
  upsertSoulObservedSignal,
} from '~/soul'
import {
  deleteKnowledgeDocument,
  importMarkdownKnowledge,
  listKnowledgeDocuments,
  searchKnowledgeChunks,
} from '~/knowledge'
import { loadSettings, saveSettings } from '~/utils/settings'

export default defineBackground(() => {
  const defaultKnowledgeBaseId = 'default'
  const knowledgeContextMaxChars = 900
  const knowledgeTopK = 2
  const knowledgeDocumentTopK = 3
  const semanticQueryCacheTtlMs = 30_000
  const telemetryWindowSize = 20
  let creatingOffscreenDocument: Promise<void> | null = null
  const semanticQueryEmbeddingCache = new Map<string, {
    expiresAt: number
    result: {
      backend: KnowledgeChunkEmbedding['backend']
      latencyMs: number
      model: string
      queryEmbedding: number[]
    }
  }>()
  const completionService = createBackgroundCompletionService({
    defaultKnowledgeBaseId,
    knowledgeContextMaxChars,
    knowledgeDocumentTopK,
    knowledgeTopK,
    telemetryWindowSize,
    resolveSemanticQueryEmbedding,
  })

  chrome.runtime.onInstalled.addListener((details) => {
    if (details.reason === 'install') {
      void openSettingsPage()
    }
  })

  chrome.runtime.onMessage.addListener((message: RuntimeMessage, _sender, sendResponse) => {
    switch (message.type) {
      case 'completion/request':
        completionService.handleCompletion(message.payload)
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
        completionService.cancel(message.payload.id)
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
        void persistSoulObservedSignals(message.payload).catch((error: unknown) => {
          console.warn('[copycat] failed to persist Soul observed signals', error)
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

      case 'soul/signals':
        void getSoulObservedSignalSnapshot({
          limit: message.payload.limit,
          matureOnly: message.payload.matureOnly,
        })
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
          .then((result: KnowledgeDocument[]) => sendResponse({ ok: true, data: result }))
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

  async function persistSoulObservedSignals(event: CompletionEvent): Promise<void> {
    const tags = deriveSoulObservedSignals({ event })

    for (const tag of tags) {
      await upsertSoulObservedSignal(tag)
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

    return importMarkdownKnowledge({
      embedChunks: embedKnowledgeChunks,
      processMarkdown: payload => sendOffscreenMessage({
        payload,
        target: 'offscreen',
        type: 'knowledge/process-markdown',
      }),
      request,
    })
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

})
