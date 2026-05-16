import type {
  KnowledgeDocument,
  KnowledgeImportRequest,
} from '~/types'

/**
 * Builds a stable local document id from import metadata.
 *
 * Use when:
 * - creating a deterministic document record before chunk persistence
 * - callers want one imported source to map to one stored document id
 *
 * Expects:
 * - `kbId` and `checksum` to already be stable
 *
 * Returns:
 * - a local knowledge document id
 */
export function buildKnowledgeDocumentId(args: {
  checksum: string
  kbId: string
  title: string
}): string {
  return `${args.kbId}:${slugifyKnowledgeTitle(args.title)}:${args.checksum.slice(0, 12)}`
}

/**
 * Computes a SHA-256 checksum for imported textual content.
 *
 * Use when:
 * - imported materials need stable deduplication keys
 * - callers want the same document content to map to the same logical record
 *
 * Expects:
 * - `value` to be a UTF-8 string
 *
 * Returns:
 * - a lowercase hexadecimal SHA-256 checksum
 */
export async function computeKnowledgeChecksum(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value)
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return [...new Uint8Array(digest)]
    .map(part => part.toString(16).padStart(2, '0'))
    .join('')
}

/**
 * Builds the persisted knowledge document record after parsing and chunking.
 *
 * Use when:
 * - the background import pipeline needs a final document row for IndexedDB
 * - callers already know the normalized text length and chunk count
 *
 * Expects:
 * - `checksum` to come from the normalized imported text
 *
 * Returns:
 * - the persisted knowledge document shape
 */
export function buildKnowledgeDocumentRecord(args: {
  checksum: string
  chunkCount: number
  normalizedText: string
  request: KnowledgeImportRequest
}): KnowledgeDocument {
  const now = Date.now()

  return {
    id: buildKnowledgeDocumentId({
      checksum: args.checksum,
      kbId: args.request.kbId,
      title: args.request.title,
    }),
    kbId: args.request.kbId,
    title: args.request.title,
    sourceType: args.request.sourceType,
    sourceUri: args.request.sourceUri,
    checksum: args.checksum,
    metadata: {
      chunkCount: args.chunkCount,
      charCount: args.normalizedText.length,
    },
    createdAt: now,
    updatedAt: now,
  }
}

/**
 * Normalizes a file name into a small id-safe slug.
 *
 * Before:
 * - `"Architecture Notes.md"`
 *
 * After:
 * - `"architecture-notes-md"`
 */
export function slugifyKnowledgeTitle(title: string): string {
  const slug = title
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')

  return slug.length > 0 ? slug : 'document'
}
