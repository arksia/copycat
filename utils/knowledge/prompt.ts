import type { KnowledgeChunk } from '~/types'

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
  const segments: string[] = []
  let totalChars = 0

  for (const chunk of args.chunks.slice(0, args.maxChunks)) {
    const segment = `[${chunk.metadata.sourceName}]\n${chunk.text.trim()}`
    const nextLength = totalChars === 0 ? segment.length : totalChars + 2 + segment.length
    if (nextLength > args.maxChars) {
      break
    }

    segments.push(segment)
    totalChars = nextLength
  }

  return segments.join('\n\n')
}
