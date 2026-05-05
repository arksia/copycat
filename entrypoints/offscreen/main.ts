import { chunkKnowledgeDocument } from '~/utils/knowledge/chunker'
import {
  buildKnowledgeChunkEmbedding,
  embedKnowledgeTexts,
} from '~/utils/knowledge/embedding'
import { parseKnowledgeDocumentContent } from '~/utils/knowledge/normalize'

interface OffscreenKnowledgeProcessRequest {
  payload: {
    docId: string
    kbId: string
    rawContent: string
    sourceName: string
  }
  target: 'offscreen'
  type: 'knowledge/process-markdown'
}

interface OffscreenKnowledgeEmbedRequest {
  payload: {
    texts: string[]
  }
  target: 'offscreen'
  type: 'knowledge/embed-texts'
}

chrome.runtime.onMessage.addListener((
  message: OffscreenKnowledgeProcessRequest | OffscreenKnowledgeEmbedRequest,
  _sender,
  sendResponse,
) => {
  if (message.target !== 'offscreen') {
    return false
  }

  try {
    if (message.type === 'knowledge/embed-texts') {
      void handleKnowledgeEmbedding(message.payload.texts)
        .then(data => sendResponse({ ok: true, data }))
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

    if (message.type !== 'knowledge/process-markdown') {
      return false
    }

    const normalizedText = parseKnowledgeDocumentContent({
      rawContent: message.payload.rawContent,
      sourceType: 'markdown',
    })
    const chunks = chunkKnowledgeDocument({
      docId: message.payload.docId,
      kbId: message.payload.kbId,
      sourceName: message.payload.sourceName,
      text: normalizedText,
    })
    sendResponse({
      ok: true,
      data: {
        chunks,
        normalizedText,
      },
    })
  }
  catch (error) {
    sendResponse({
      ok: false,
      error: {
        error: error instanceof Error ? error.message : String(error),
      },
    })
  }

  return false
})

async function handleKnowledgeEmbedding(texts: string[]) {
  const result = await embedKnowledgeTexts(texts)

  return {
    backend: result.backend,
    latencyMs: result.latencyMs,
    model: result.model,
    vectors: result.values.map(values => buildKnowledgeChunkEmbedding({
      backend: result.backend,
      model: result.model,
      values,
      version: result.version,
    })),
  }
}
