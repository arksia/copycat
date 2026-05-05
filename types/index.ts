export type ProviderId = 'groq' | 'openai' | 'deepseek' | 'ollama' | 'custom'

export interface ProviderPreset {
  id: ProviderId
  name: string
  baseUrl: string
  defaultModel: string
  requiresKey: boolean
  docsUrl?: string
}

export type KnowledgeEmbeddingBackend = 'wasm' | 'webgpu'

export interface KnowledgeChunkEmbedding {
  backend: KnowledgeEmbeddingBackend
  embeddedAt: number
  model: string
  values: number[]
  version: string
}

export interface Settings {
  enabled: boolean
  provider: ProviderId
  baseUrl: string
  apiKey: string
  model: string
  temperature: number
  maxTokens: number
  debounceMs: number
  minPrefixChars: number
  systemPrompt: string
  enabledHosts: string[]
  disabledHosts: string[]
}

export interface CompletionRequest {
  id: string
  prefix: string
  suffix?: string
  context?: string
  signalKey?: string
  stage?: 'enhanced' | 'fast'
  debug?: boolean
}

export interface CompletionDebugInfo {
  rawCompletion: string
  sanitizedCompletion: string
  rawChoice: string
  cacheHit: boolean
  appliedStrategy?: {
    requestStage: 'enhanced' | 'fast'
    shouldRunEnhancedStage: boolean
    telemetryWindowSize: number
    knowledgeBudget: {
      topK: number
      maxChars: number
    }
  }
  timings?: {
    totalMs: number
    settingsMs: number
    telemetryMs: number
    knowledgeMs: number
    llmMs: number
    knowledge?: {
      totalMs: number
      loadChunksMs: number
      queryEmbeddingMs: number
      searchMs: number
      contextMs: number
    }
  }
  knowledgeContext?: string
  knowledgeQuery?: string
  knowledgeRecall?: {
    strategy: 'keyword_index' | 'semantic_index'
    queryTerms: string[]
    candidateCount: number
    returnedCount: number
  }
  knowledgeRerank?: {
    strategy: 'lexical_v1' | 'semantic_primary_v1'
    semanticEnabled: boolean
    semanticBackend?: KnowledgeEmbeddingBackend
    semanticModel?: string
    semanticQueryLatencyMs?: number
    queryTerms: string[]
    rankedChunks: Array<{
      id: string
      sourceName: string
      totalScore: number
      lexicalScore: number
      semanticScore: number | null
      matchedTerms: number
      keywordHits: number
      textHits: number
      tokenCount: number
      charCount: number
    }>
  }
  knowledgeChunks?: Array<{
    id: string
    sourceName: string
    text: string
  }>
  telemetry?: {
    host: string
    stats: CompletionEventStats
    qualitySignal: {
      band: 'healthy' | 'insufficient_data' | 'mixed' | 'poor'
      shouldBoostKnowledge: boolean
      reason: string
    }
  }
  requestBody: {
    systemPrompt: string
    userPrompt: string
  }
}

export interface CompletionResponse {
  id: string
  completion: string
  latencyMs: number
  provider: ProviderId
  model: string
  stage: 'enhanced' | 'fast'
  shouldRunEnhancedStage: boolean
  debug?: CompletionDebugInfo
}

export interface CompletionError {
  id: string
  error: string
  code?: string
}

export interface RuntimeFailure {
  ok: false
  error?: CompletionError | { error?: string }
}

export interface RuntimeSuccess<T> {
  ok: true
  data?: T
}

export type RuntimeResponse<T> = RuntimeSuccess<T> | RuntimeFailure

export type RuntimeMessage
  = | { type: 'completion/request', payload: CompletionRequest }
    | { type: 'completion/cancel', payload: { id: string } }
    | { type: 'completion/event', payload: CompletionEvent }
    | { type: 'completion/events/recent', payload: { host: string, limit?: number } }
    | { type: 'completion/events/stats', payload: { host: string } }
    | { type: 'knowledge/delete', payload: { docId: string, kbId: string } }
    | { type: 'knowledge/import', payload: KnowledgeImportRequest }
    | { type: 'knowledge/list', payload: { kbId: string } }
    | { type: 'knowledge/search', payload: KnowledgeSearchRequest }
    | { type: 'settings/get' }
    | { type: 'settings/set', payload: Partial<Settings> }

export interface CompletionEvent {
  id: string
  prefix: string
  suggestion: string
  action: 'accepted' | 'rejected' | 'ignored'
  latencyMs: number
  timestamp: number
  host: string
}

export interface CompletionEventStats {
  total: number
  accepted: number
  rejected: number
  ignored: number
  acceptanceRate: number
  averageLatencyMs: number
}

export type KnowledgeSourceType = 'html' | 'manual' | 'markdown' | 'txt'

export interface KnowledgeDocument {
  id: string
  kbId: string
  title: string
  sourceType: KnowledgeSourceType
  sourceUri?: string
  checksum: string
  metadata: {
    chunkCount: number
    charCount: number
  } & Record<string, unknown>
  createdAt: number
  updatedAt: number
}

export interface KnowledgeChunk {
  id: string
  kbId: string
  docId: string
  text: string
  keywords: string[]
  embedding?: KnowledgeChunkEmbedding
  metadata: {
    charCount: number
    sourceName: string
    tokenCount: number
  }
}

export interface KnowledgeImportRequest {
  kbId: string
  rawContent: string
  sourceType: KnowledgeSourceType
  sourceUri?: string
  title: string
}

export interface KnowledgeImportResult {
  chunkCount: number
  document: KnowledgeDocument
}

export interface KnowledgeSearchRequest {
  kbId: string
  query: string
  topK: number
}

export interface KnowledgeDeleteResult {
  chunkCount: number
  docId: string
}
