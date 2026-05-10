import type { KnowledgeBudgetMeta, KnowledgeChunk } from '~/types'

const KNOWLEDGE_SEGMENT_SEPARATOR = '\n\n'
const KNOWLEDGE_TRUNCATION_SUFFIX = '...'

export interface KnowledgeContextProjection {
  context: string
  meta: KnowledgeBudgetMeta
}

/**
 * Derives a lightweight retrieval query from the current completion prefix.
 *
 * Before:
 * - `"前面一大段背景。\n\n现在重点是虚拟列表的渲染性能"`
 *
 * After:
 * - `"现在重点是虚拟列表的渲染性能"`
 */
export function buildKnowledgeSearchQuery(prefix: string): string {
  const normalized = prefix.replace(/\r/g, '').trim()
  if (normalized.length === 0) {
    return ''
  }

  const paragraphs = normalized
    .split(/\n{2,}/)
    .map(part => part.trim())
    .filter(part => part.length > 0)

  if (paragraphs.length === 0) {
    return normalized
  }

  return paragraphs[paragraphs.length - 1] ?? normalized
}

/**
 * Packs retrieved chunks into a compact prompt-ready knowledge block.
 *
 * Before:
 * - multiple chunk objects with source metadata
 *
 * After:
 * - `"[Doc A]\\n...\\n\\n[Doc B]\\n..."`
 */
export function buildKnowledgeContext(args: {
  chunks: KnowledgeChunk[]
  maxChars: number
  maxChunks: number
}): string {
  return buildKnowledgeContextProjection(args).context
}

export function buildKnowledgeContextProjection(args: {
  chunks: KnowledgeChunk[]
  maxChars: number
  maxChunks: number
}): KnowledgeContextProjection {
  const segments: string[] = []
  const includedChunkIds: string[] = []
  const droppedChunkIds: string[] = []
  const trimmedChunkIds: string[] = []
  let totalChars = 0
  let truncated = false

  for (const chunk of args.chunks.slice(0, args.maxChunks)) {
    const segment = buildKnowledgeSegment(chunk)
    const nextLength = totalChars === 0
      ? segment.length
      : totalChars + KNOWLEDGE_SEGMENT_SEPARATOR.length + segment.length

    if (nextLength <= args.maxChars) {
      segments.push(segment)
      includedChunkIds.push(chunk.id)
      totalChars = nextLength
      continue
    }

    if (segments.length > 0) {
      droppedChunkIds.push(chunk.id)
      truncated = true

      for (const remainingChunk of args.chunks.slice(includedChunkIds.length + droppedChunkIds.length, args.maxChunks)) {
        droppedChunkIds.push(remainingChunk.id)
      }
      break
    }

    const remainingChars = args.maxChars - totalChars - (segments.length > 0 ? KNOWLEDGE_SEGMENT_SEPARATOR.length : 0)
    if (remainingChars > 0) {
      const fittedSegment = fitKnowledgeSegment(chunk, remainingChars)
      if (fittedSegment !== null) {
        segments.push(fittedSegment)
        includedChunkIds.push(chunk.id)
        trimmedChunkIds.push(chunk.id)
        totalChars = totalChars === 0
          ? fittedSegment.length
          : totalChars + KNOWLEDGE_SEGMENT_SEPARATOR.length + fittedSegment.length
      }
      else {
        droppedChunkIds.push(chunk.id)
      }
    }
    else {
      droppedChunkIds.push(chunk.id)
    }

    truncated = true

    for (const remainingChunk of args.chunks.slice(includedChunkIds.length + droppedChunkIds.length, args.maxChunks)) {
      droppedChunkIds.push(remainingChunk.id)
    }
    break
  }

  return {
    context: segments.join(KNOWLEDGE_SEGMENT_SEPARATOR),
    meta: {
      totalChars: args.maxChars,
      usedChars: segments.join(KNOWLEDGE_SEGMENT_SEPARATOR).length,
      truncated,
      includedChunkIds,
      droppedChunkIds,
      trimmedChunkIds,
    },
  }
}

function buildKnowledgeSegment(chunk: KnowledgeChunk): string {
  return `[${chunk.metadata.sourceName}]\n${chunk.text.trim()}`
}

function fitKnowledgeSegment(chunk: KnowledgeChunk, maxChars: number): string | null {
  const header = `[${chunk.metadata.sourceName}]\n`
  if (header.length >= maxChars) {
    return null
  }

  const availableTextChars = maxChars - header.length
  const trimmedText = chunk.text.trim()
  if (trimmedText.length <= availableTextChars) {
    return `${header}${trimmedText}`
  }

  if (availableTextChars <= KNOWLEDGE_TRUNCATION_SUFFIX.length) {
    return null
  }

  return `${header}${trimmedText.slice(0, availableTextChars - KNOWLEDGE_TRUNCATION_SUFFIX.length)}${KNOWLEDGE_TRUNCATION_SUFFIX}`
}
