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
  SoulLearningLogEntry,
} from '~/types'
import {
  deleteKnowledgeDocument,
  importMarkdownKnowledge,
  listKnowledgeDocuments,
  searchKnowledgeChunks,
} from '~/knowledge'
import {
  appendSoulLearningLogToConfiguredDirectory,
  runSoulLearning,
  summarizeSoulLearningEvents,
  syncSoulMarkdownToConfiguredDirectory,
  shouldRunSoulLearning,
} from '~/soul'
import {
  createBackgroundCompletionService,
} from '~/utils/completion/background'
import { openSettingsPage } from '~/utils/runtime'
import { loadSettings, onSettingsChanged, saveSettings } from '~/utils/settings'
import {
  getCompletionEventStats,
  listRecentCompletionEvents,
  listRecentCompletionEventsByHost,
  putCompletionEvent,
} from '~/utils/storage/repositories/events'

export default defineBackground(() => {
  const soulLearningAlarmName = 'copycat:soul-learning'
  const defaultKnowledgeBaseId = 'default'
  const knowledgeContextMaxChars = 900
  const knowledgeTopK = 2
  const knowledgeDocumentTopK = 3
  const semanticQueryCacheTtlMs = 30_000
  const telemetryWindowSize = 20
  const soulLearningIdleDelayMinutes = 3
  const soulLearningCooldownMs = 30 * 60 * 1000
  const soulLearningWindowSize = 24
  let creatingOffscreenDocument: Promise<void> | null = null
  let lastSoulLearningRunAt = 0
  let runningSoulLearning: Promise<void> | null = null
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

  onSettingsChanged((settings) => {
    void syncSoulMarkdownToConfiguredDirectory(settings.soul.text).catch((error: unknown) => {
      console.warn('[copycat] failed to sync Soul markdown after settings change', error)
    })
  })

  chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name !== soulLearningAlarmName) {
      return
    }
    void maybeRunSoulLearning().catch((error: unknown) => {
      console.warn('[copycat] failed to run scheduled Soul learning', error)
    })
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
        void persistCompletionEventAndMaybeLearn(message.payload)
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

      case 'soul/export/sync':
        void loadSettings()
          .then(settings => syncSoulMarkdownToConfiguredDirectory(settings.soul.text))
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

  async function persistCompletionEventAndMaybeLearn(event: CompletionEvent): Promise<void> {
    try {
      await putCompletionEvent(event)
    }
    catch (error) {
      console.warn('[copycat] failed to persist completion event', error)
      return
    }

    await scheduleSoulLearning().catch((error: unknown) => {
      console.warn('[copycat] failed to schedule Soul learning', error)
    })
  }

  async function scheduleSoulLearning(): Promise<void> {
    const settings = await loadSettings()
    if (!settings.soul.learningEnabled || !settings.baseUrl || !settings.model) {
      return
    }

    await chrome.alarms.create(soulLearningAlarmName, {
      delayInMinutes: soulLearningIdleDelayMinutes,
    })
  }

  async function maybeRunSoulLearning(): Promise<void> {
    if (runningSoulLearning !== null) {
      return
    }

    const settings = await loadSettings()
    if (!settings.soul.learningEnabled || !settings.baseUrl || !settings.model) {
      return
    }

    const events = await listRecentCompletionEvents(soulLearningWindowSize)
    const now = Date.now()
    const previousRunAt = lastSoulLearningRunAt
    const sampleSummary = summarizeSoulLearningEvents(events)
    const freshEventCount = events.filter(event => event.timestamp > previousRunAt).length
    if (!shouldRunSoulLearning({
      cooldownMs: soulLearningCooldownMs,
      events,
      lastRunAt: previousRunAt,
      now,
    })) {
      return
    }

    lastSoulLearningRunAt = now
    runningSoulLearning = runSoulLearning({
      currentSoulText: settings.soul.text,
      events,
      settings,
    })
      .then(async (result) => {
        if (result === null) {
          return
        }

        if (result.shouldUpdate === true) {
          await saveSettings({
            soul: {
              text: result.nextSoulText,
            },
          })
        }

        const logEntry: SoulLearningLogEntry = {
          acceptedCount: sampleSummary.acceptedCount,
          droppedCounts: sampleSummary.droppedCounts,
          freshEventCount,
          reason: result.reason,
          rejectedCount: sampleSummary.rejectedCount,
          selectedEventCount: sampleSummary.selectedEventCount,
          timestamp: new Date(now).toISOString(),
          trigger: 'accepted_rejected_threshold',
          updated: result.shouldUpdate,
        }

        await appendSoulLearningLogToConfiguredDirectory(logEntry)
      })
      .catch((error: unknown) => {
        console.warn('[copycat] failed to run Soul learning', error)
      })
      .finally(() => {
        runningSoulLearning = null
      })

    await runningSoulLearning
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
      processMarkdown: async payload =>
        sendOffscreenMessage({
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
