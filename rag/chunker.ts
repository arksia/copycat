import type { KnowledgeChunk } from '~/types'

/**
 * Chunking input for one imported knowledge document.
 *
 * Use when:
 * - normalized document text should be split into retrieval-sized chunks
 * - callers want keywords attached during chunk creation
 *
 * Expects:
 * - `text` to already be normalized plain text
 *
 * Returns:
 * - the metadata needed to derive chunks for one document
 */
export interface ChunkKnowledgeDocumentArgs {
  docId: string
  kbId: string
  sourceName: string
  text: string
  maxChars?: number
}

/**
 * Splits one plain-text knowledge document into retrieval-sized chunks.
 *
 * Before:
 * - `"Para A\n\nPara B\n\nPara C"`
 *
 * After:
 * - `[{ id: "doc-1:0", text: "Para A\n\nPara B", ... }, ...]`
 */
export function chunkKnowledgeDocument(
  args: ChunkKnowledgeDocumentArgs,
): KnowledgeChunk[] {
  const maxChars = args.maxChars ?? 500
  const paragraphs = args.text
    .split(/\n{2,}/)
    .map(part => part.trim())
    .filter(part => part.length > 0)

  if (paragraphs.length === 0) {
    return []
  }

  const chunkTexts: string[] = []
  let current = ''

  for (const paragraph of paragraphs) {
    const candidate = current.length === 0 ? paragraph : `${current}\n\n${paragraph}`
    if (candidate.length <= maxChars) {
      current = candidate
      continue
    }

    if (current.length > 0) {
      chunkTexts.push(current)
    }

    if (paragraph.length <= maxChars) {
      current = paragraph
      continue
    }

    const longParagraphChunks = splitLongParagraph(paragraph, maxChars)
    chunkTexts.push(...longParagraphChunks.slice(0, -1))
    current = longParagraphChunks[longParagraphChunks.length - 1] ?? ''
  }

  if (current.length > 0) {
    chunkTexts.push(current)
  }

  return chunkTexts.map((text, index) => ({
    id: `${args.docId}:${index}`,
    kbId: args.kbId,
    docId: args.docId,
    text,
    keywords: extractKnowledgeKeywords(text),
    metadata: {
      charCount: text.length,
      sourceName: args.sourceName,
      tokenCount: estimateTokenCount(text),
    },
  }))
}

/**
 * Extracts lightweight retrieval keywords from one text block.
 *
 * Before:
 * - `"使用虚拟列表优化长列表渲染 performance"`
 *
 * After:
 * - `["使用虚拟列表优化长列表渲染", "使用虚拟", "虚拟列表", "列表优化", "使用虚", "虚拟列", "long", "performance"]`
 */
export function extractKnowledgeKeywords(text: string): string[] {
  const normalized = text.toLowerCase()
  const keywords = new Set<string>()

  for (const match of normalized.matchAll(/[a-z0-9][a-z0-9-]*/g)) {
    const value = match[0]
    if (value.length >= 2) {
      keywords.add(value)
    }
  }

  for (const match of normalized.matchAll(/\p{Script=Han}+/gu)) {
    const value = match[0]
    if (value.length >= 2) {
      collectHanTerms(keywords, value)
    }
  }

  return [...keywords]
}

function collectHanTerms(keywords: Set<string>, value: string) {
  keywords.add(value)

  for (const windowSize of [4, 3, 2]) {
    if (value.length < windowSize) {
      continue
    }

    for (let index = 0; index <= value.length - windowSize; index += 1) {
      keywords.add(value.slice(index, index + windowSize))
    }
  }
}

function splitLongParagraph(paragraph: string, maxChars: number): string[] {
  const chunks: string[] = []
  let start = 0

  while (start < paragraph.length) {
    chunks.push(paragraph.slice(start, start + maxChars).trim())
    start += maxChars
  }

  return chunks.filter(chunk => chunk.length > 0)
}

function estimateTokenCount(text: string): number {
  const latinWords = text.match(/[a-z0-9]+/gi)?.length ?? 0
  const hanChars = text.match(/\p{Script=Han}/gu)?.length ?? 0
  return latinWords + hanChars
}
