export type ProviderId = 'groq' | 'openai' | 'deepseek' | 'ollama' | 'custom'

export interface SoulProfile {
  identity: string
  style: string
  preferences: string
  avoidances: string
  terms: string
  notes: string
}

export interface SoulSettings {
  enabled: boolean
  profile: SoulProfile
}

export interface SoulBudgetMeta {
  totalChars: number
  reservedChars: number
  usedChars: number
  truncated: boolean
  includedBlocks: string[]
  droppedBlocks: string[]
  trimmedBlocks: Array<{
    label: string
    wasDropped: boolean
  }>
}

export type SoulObservedSignalKind = 'preference' | 'avoidance' | 'term' | 'structure'

export interface SoulObservedSignalEvidence {
  action: CompletionEvent['action']
  host: string
  prefixPreview: string
  suggestionPreview: string
  suggestionLengthBucket: 'short' | 'medium' | 'long'
  openingStructure: 'answer-first' | 'context-first' | 'list-first' | 'unknown'
  toneHints: string[]
  termHits: string[]
  timestamp: number
}

export interface SoulObservedSignal {
  id: string
  kind: SoulObservedSignalKind
  value: string
  confidence: number
  count: number
  acceptedCount: number
  rejectedCount: number
  ignoredCount: number
  distinctContextCount: number
  firstSeenAt: number
  lastSeenAt: number
  lastReflectedAt?: number
  evidence: SoulObservedSignalEvidence
  contextKeys: string[]
  documentIds: string[]
}

export interface SoulObservedSignalSnapshot {
  totalCount: number
  matureCount: number
  signals: SoulObservedSignal[]
}

export interface SettingsPatch extends Partial<Omit<Settings, 'soul'>> {
  soul?: Partial<{
    enabled: boolean
    profile: Partial<SoulProfile>
  }>
}

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
  soul: SoulSettings
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
      allChunkCount: number
      embeddedChunkCount: number
      semanticState: 'cache_hit' | 'computed' | 'skipped'
    }
  }
  knowledgeContext?: string
  knowledgeBudgetMeta?: KnowledgeBudgetMeta
  promptLayers?: {
    knowledge?: {
      context: string
      enabled: boolean
      usedChars: number
      budget?: KnowledgeBudgetMeta
    }
    soul?: {
      context: string
      enabled: boolean
      usedChars: number
      budget?: SoulBudgetMeta
    }
  }
  soulSignals?: {
    triggered: boolean
    totalCount: number
    matureCount: number
    signals: Array<{
      id: string
      kind: SoulObservedSignalKind
      value: string
      confidence: number
      count: number
      acceptedCount: number
      rejectedCount: number
      ignoredCount: number
      distinctContextCount: number
      evidence: SoulObservedSignalEvidence
    }>
  }
  soulContext?: string
  soulEnabled?: boolean
  soulConfigured?: boolean
  soulCharCount?: number
  soulBudget?: SoulBudgetMeta
  knowledgeQuery?: string
  knowledgeRecall?: {
    strategy: 'semantic_index'
    queryTerms: string[]
    candidateCount: number
    returnedCount: number
  }
  knowledgeRerank?: {
    strategy: 'semantic_only_v1'
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
    | { type: 'soul/signals', payload: { limit?: number, matureOnly?: boolean } }
    | { type: 'knowledge/delete', payload: { docId: string, kbId: string } }
    | { type: 'knowledge/import', payload: KnowledgeImportRequest }
    | { type: 'knowledge/list', payload: { kbId: string } }
    | { type: 'knowledge/search', payload: KnowledgeSearchRequest }
    | { type: 'settings/get' }
    | { type: 'settings/set', payload: SettingsPatch }

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
  embedding?: KnowledgeChunkEmbedding
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

export interface KnowledgeBudgetMeta {
  totalChars: number
  usedChars: number
  truncated: boolean
  includedChunkIds: string[]
  droppedChunkIds: string[]
  trimmedChunkIds: string[]
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
