import type {
  KnowledgeChunk,
  KnowledgeChunkEmbedding,
  KnowledgeEmbeddingBackend,
} from '~/types'

export const DEFAULT_EMBEDDING_MODEL = 'Xenova/all-MiniLM-L6-v2'
export const DEFAULT_EMBEDDING_VERSION = '2026-05-04'

interface EmbedTextsResult {
  backend: KnowledgeEmbeddingBackend
  latencyMs: number
  model: string
  values: number[][]
  version: string
}

interface KnowledgeExtractorEntry {
  backend: KnowledgeEmbeddingBackend
  extractor: (text: string | string[], options?: {
    normalize?: boolean
    pooling?: 'mean' | 'cls' | 'none'
  }) => Promise<{
    data: unknown
    dims?: number[]
    size?: number
  }>
  model: string
}

let activeExtractorPromise: Promise<KnowledgeExtractorEntry> | null = null

/**
 * Builds a persisted knowledge embedding record.
 *
 * Use when:
 * - a chunk has just been embedded locally
 * - callers need one stable storage shape for IndexedDB
 *
 * Expects:
 * - `values` to already be normalized model output
 *
 * Returns:
 * - one chunk embedding payload suitable for local persistence
 */
export function buildKnowledgeChunkEmbedding(args: {
  backend: KnowledgeEmbeddingBackend
  model: string
  values: number[]
  version?: string
}): KnowledgeChunkEmbedding {
  return {
    backend: args.backend,
    embeddedAt: Date.now(),
    model: args.model,
    values: args.values,
    version: args.version ?? DEFAULT_EMBEDDING_VERSION,
  }
}

/**
 * Returns whether a stored chunk embedding can be used by the current runtime.
 *
 * Use when:
 * - retrieval wants to know whether semantic rerank can reuse the stored vector
 * - import flows need to skip redundant embedding work
 *
 * Returns:
 * - `true` when the embedding matches the current model and version
 */
export function hasCurrentKnowledgeEmbedding(chunk: KnowledgeChunk): boolean {
  return chunk.embedding?.model === DEFAULT_EMBEDDING_MODEL
    && chunk.embedding.version === DEFAULT_EMBEDDING_VERSION
    && chunk.embedding.values.length > 0
}

/**
 * Embeds one or more texts with the local browser runtime.
 *
 * Use when:
 * - imported chunks need persisted local vectors
 * - retrieval needs one query embedding for semantic rerank
 *
 * Expects:
 * - the caller to run inside the offscreen document runtime
 *
 * Returns:
 * - normalized embedding vectors plus execution metadata
 */
export async function embedKnowledgeTexts(texts: string[]): Promise<EmbedTextsResult> {
  if (texts.length === 0) {
    return {
      backend: 'wasm',
      latencyMs: 0,
      model: DEFAULT_EMBEDDING_MODEL,
      values: [],
      version: DEFAULT_EMBEDDING_VERSION,
    }
  }

  const extractorEntry = await getKnowledgeExtractor()
  const start = performance.now()
  const output = await extractorEntry.extractor(texts, {
    pooling: 'mean',
    normalize: true,
  })
  const values = flattenEmbeddingOutput(output.data, texts.length)

  return {
    backend: extractorEntry.backend,
    latencyMs: Math.round(performance.now() - start),
    model: extractorEntry.model,
    values,
    version: DEFAULT_EMBEDDING_VERSION,
  }
}

async function getKnowledgeExtractor() {
  if (activeExtractorPromise === null) {
    activeExtractorPromise = createKnowledgeExtractor()
  }

  return activeExtractorPromise
}

async function createKnowledgeExtractor(): Promise<KnowledgeExtractorEntry> {
  const { env, pipeline } = await import('@xenova/transformers')

  env.allowLocalModels = false
  env.useBrowserCache = true
  env.backends.onnx.wasm.proxy = false
  env.backends.onnx.wasm.numThreads = 1

  const extractor = await pipeline('feature-extraction', DEFAULT_EMBEDDING_MODEL, {
    quantized: true,
  })

  return {
    backend: 'wasm',
    extractor: (text, options) => extractor(text, options),
    model: DEFAULT_EMBEDDING_MODEL,
  }
}

function flattenEmbeddingOutput(rawData: unknown, batchSize: number): number[][] {
  const values = normalizeEmbeddingValues(rawData)
  if (batchSize <= 1) {
    return [values]
  }

  const rowSize = Math.floor(values.length / batchSize)
  const rows: number[][] = []

  for (let index = 0; index < batchSize; index += 1) {
    rows.push(values.slice(index * rowSize, (index + 1) * rowSize))
  }

  return rows
}

function normalizeEmbeddingValues(rawData: unknown): number[] {
  if (Array.isArray(rawData)) {
    return rawData.map(value => Number(value))
  }
  if (isArrayLikeNumberSource(rawData)) {
    return Array.from(rawData, value => Number(value))
  }

  throw new Error('Embedding output is not array-like.')
}

function isArrayLikeNumberSource(value: unknown): value is ArrayLike<number | bigint> {
  return typeof value === 'object'
    && value !== null
    && 'length' in value
}
