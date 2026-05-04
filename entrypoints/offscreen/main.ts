import { chunkKnowledgeDocument } from '~/utils/knowledge/chunker'
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

chrome.runtime.onMessage.addListener((
  message: OffscreenKnowledgeProcessRequest,
  _sender,
  sendResponse,
) => {
  if (message.target !== 'offscreen' || message.type !== 'knowledge/process-markdown') {
    return false
  }

  try {
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
