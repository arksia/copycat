<script setup lang="ts">
import type { CompletionDebugInfo, CompletionEvent, CompletionResponse, Settings } from '~/types'
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import {
  buildCompletionFingerprint,
  buildCompletionSignalKey,
} from '~/utils/completion/request'
import { supportsInlineCompletion } from '~/utils/completion/position'
import {
  createCompletionTriggerMemory,
  evaluateCompletionTrigger,
} from '~/utils/completion/trigger'
import { debounce, nextId } from '~/utils/core/base'
import { openSettingsPage, sendRuntimeMessage } from '~/utils/runtime'
import { GhostTextOverlay, syncPlaygroundGhostText } from '~/integrations/overlay/ghost-text'
import { PROVIDER_PRESETS } from '~/utils/providers'
import {
  buildStageActivityLines,
  summarizeEnhancedOutcome,
} from '~/utils/completion/staging'
import { loadSettings } from '~/utils/settings'
import {
  shouldPreferEnhancedCompletion,
  shouldRequestEnhancedStage,
} from '~/utils/completion/staging'

const PLAYGROUND_SIGNAL_KEY = buildCompletionSignalKey('playground', 'textarea')
const ghostOverlay = new GhostTextOverlay()

const samplePrompt = `Please help me write a concise engineering prompt for:
- clarifying scope
- identifying tradeoffs
- proposing the smallest implementation path`

const draft = ref('')
const suggestion = ref('')
const loading = ref(false)
const errorText = ref('')
const infoText = ref('')
const debugRawCompletion = ref('')
const debugSanitizedCompletion = ref('')
const debugRawChoice = ref('')
const debugUserPrompt = ref('')
const debugSystemPrompt = ref('')
const debugPromptLayers = ref('')
const debugSoulSignals = ref('')
const debugSoulContext = ref('')
const debugSoulExplicitContext = ref('')
const debugSoulLearnedContext = ref('')
const debugSoulLearnedProfile = ref('')
const debugSoulObservedSignalCount = ref(0)
const debugKnowledgeContext = ref('')
const debugKnowledgeBudget = ref('')
const debugKnowledgeQuery = ref('')
const debugKnowledgeRecall = ref('')
const debugKnowledgeRerank = ref('')
const debugKnowledgeChunks = ref<Array<{
  id: string
  sourceName: string
  text: string
}>>([])
const debugTimings = ref('')
const stageFastCompletion = ref('')
const stageEnhancedCompletion = ref('')
const stageEnhancedTriggered = ref(false)
const stageEnhancedReplaced = ref(false)
const stageEnhancedRequested = ref(false)
const debugAppliedStrategy = ref('')
const debugTelemetry = ref('')
const debugSoulEnabled = ref(false)
const debugSoulConfigured = ref(false)
const debugSoulCharCount = ref(0)
const debugSoulBudget = ref('')
const lastRequestId = ref('')
const lastLatencyMs = ref<number | null>(null)
const settings = ref<Settings | null>(null)
const lastFingerprint = ref('')
const flowLogs = ref<string[]>([])
const flowLogsCopied = ref(false)
const triggerMemory = createCompletionTriggerMemory()
const completionMode = computed(() => {
  if (loading.value)
    return 'Requesting'
  if (errorText.value)
    return 'Error'
  if (infoText.value)
    return 'Info'
  if (suggestion.value)
    return 'Ready'
  return 'Idle'
})
const providerPreset = computed(() => {
  if (!settings.value)
    return null
  return PROVIDER_PRESETS[settings.value.provider]
})
const stageOutcome = computed(() => summarizeEnhancedOutcome({
  triggered: stageEnhancedTriggered.value,
  replaced: stageEnhancedReplaced.value,
}))
const stageActivityLines = computed(() => buildStageActivityLines({
  fastCompletion: stageFastCompletion.value,
  shouldRunEnhancedStage: stageEnhancedRequested.value,
  enhancedCompletion: stageEnhancedCompletion.value,
  enhancedReplaced: stageEnhancedReplaced.value,
}))
const parsedTimings = computed(() => parseDebugTimings(debugTimings.value))
const timingSummary = computed(() => {
  const timings = parsedTimings.value
  if (timings === null || timings === undefined) {
    return []
  }

  return [
    ['Total', `${timings.totalMs} ms`],
    ['LLM', `${timings.llmMs} ms`],
    ['Knowledge', `${timings.knowledgeMs} ms`],
    ['Settings', `${timings.settingsMs} ms`],
    ['Telemetry', `${timings.telemetryMs} ms`],
  ]
})
const knowledgeTimingSummary = computed(() => {
  const knowledge = parsedTimings.value?.knowledge
  if (knowledge === undefined) {
    return []
  }

  return [
    ['Semantic state', knowledge.semanticState],
    ['All chunks', String(knowledge.allChunkCount)],
    ['Embedded chunks', String(knowledge.embeddedChunkCount)],
    ['Query embedding', `${knowledge.queryEmbeddingMs} ms`],
    ['Search', `${knowledge.searchMs} ms`],
    ['Context', `${knowledge.contextMs} ms`],
    ['Load chunks', `${knowledge.loadChunksMs} ms`],
  ]
})
const parsedKnowledgeBudget = computed(() => {
  if (!debugKnowledgeBudget.value) {
    return null
  }

  try {
    return JSON.parse(debugKnowledgeBudget.value) as CompletionDebugInfo['knowledgeBudgetMeta']
  }
  catch {
    return null
  }
})
const parsedPromptLayers = computed(() => {
  if (!debugPromptLayers.value) {
    return null
  }

  try {
    return JSON.parse(debugPromptLayers.value) as CompletionDebugInfo['promptLayers']
  }
  catch {
    return null
  }
})
const parsedSoulSignals = computed(() => {
  if (!debugSoulSignals.value) {
    return null
  }

  try {
    return JSON.parse(debugSoulSignals.value) as CompletionDebugInfo['soulSignals']
  }
  catch {
    return null
  }
})
const parsedSoulLearnedProfile = computed(() => {
  if (!debugSoulLearnedProfile.value) {
    return null
  }

  try {
    return JSON.parse(debugSoulLearnedProfile.value) as CompletionDebugInfo['soulLearnedProfile']
  }
  catch {
    return null
  }
})
const knowledgeBudgetSummary = computed(() => {
  const budget = parsedPromptLayers.value?.knowledge?.budget ?? parsedKnowledgeBudget.value
  if (budget === null || budget === undefined) {
    return []
  }

  return [
    ['Packed', `${parsedPromptLayers.value?.knowledge?.usedChars ?? budget.usedChars} / ${budget.totalChars} chars`],
    ['Truncated', budget.truncated ? 'yes' : 'no'],
    ['Included chunks', budget.includedChunkIds.join(', ') || 'none'],
    ['Dropped chunks', budget.droppedChunkIds.join(', ') || 'none'],
    ['Trimmed chunks', budget.trimmedChunkIds.join(', ') || 'none'],
  ]
})
const soulHighlights = computed(() => {
  const soulLayer = parsedPromptLayers.value?.soul
  if (!debugSoulEnabled.value && !debugSoulConfigured.value && soulLayer === undefined) {
    return []
  }

  return [
    {
      label: 'Projection',
      value: (soulLayer?.enabled ?? debugSoulEnabled.value) ? 'active' : 'configured but empty',
    },
    {
      label: 'Chars',
      value: String(soulLayer?.usedChars ?? debugSoulCharCount.value),
    },
    {
      label: 'Included',
      value: (soulLayer?.budget?.includedBlocks ?? parsedSoulBudget.value?.includedBlocks)?.join(', ') || 'none',
    },
  ]
})
const learnedSoulHighlights = computed(() => {
  const learnedProfile = parsedSoulLearnedProfile.value
  if (learnedProfile === null && !debugSoulLearnedContext.value) {
    return []
  }

  return [
    {
      label: 'Preferences',
      value: String(learnedProfile?.preferences.length ?? 0),
    },
    {
      label: 'Avoidances',
      value: String(learnedProfile?.avoidances.length ?? 0),
    },
    {
      label: 'Terms',
      value: String(learnedProfile?.terms.length ?? 0),
    },
  ]
})
const soulSignalHighlights = computed(() => {
  const signals = parsedSoulSignals.value
  if (signals === null || signals === undefined) {
    return []
  }

  return [
    {
      label: 'Observed',
      value: String(signals.totalCount),
    },
    {
      label: 'Mature',
      value: String(signals.matureCount),
    },
    {
      label: 'Top signal',
      value: signals.signals[0] ? `${signals.signals[0].kind}:${signals.signals[0].value}` : 'none',
    },
  ]
})
const debugSections = computed(() => [
  {
    key: 'prompt',
    title: 'Prompt anatomy',
    summary: `${previewPrefix.value.length} prefix chars · ${previewSuffix.value.length} suffix chars`,
    open: true,
  },
  {
    key: 'soul',
    title: 'Soul',
    summary: debugSoulEnabled.value
      ? `${debugSoulCharCount.value} chars projected`
      : debugSoulConfigured.value
        ? 'configured but empty'
        : 'disabled',
    open: true,
  },
  {
    key: 'learned-soul',
    title: 'Learned Soul',
    summary: parsedSoulLearnedProfile.value
      ? `${parsedSoulLearnedProfile.value.preferences.length} prefs · ${parsedSoulLearnedProfile.value.terms.length} terms`
      : debugSoulLearnedContext.value
        ? 'learned context available'
        : 'no learned soul yet',
    open: true,
  },
  {
    key: 'observed-signals',
    title: 'Observed Signals',
    summary: parsedSoulSignals.value
      ? `${parsedSoulSignals.value.totalCount} observed · ${parsedSoulSignals.value.matureCount} mature`
      : 'no observed signals yet',
    open: true,
  },
  {
    key: 'knowledge',
    title: 'Knowledge',
    summary: debugKnowledgeContext.value
      ? `${debugKnowledgeChunks.value.length} chunks packed`
      : 'no knowledge context',
    open: false,
  },
  {
    key: 'model',
    title: 'Model I/O',
    summary: debugSanitizedCompletion.value
      ? `${debugSanitizedCompletion.value.length} completion chars`
      : 'no completion payload',
    open: false,
  },
  {
    key: 'raw',
    title: 'Raw payloads',
    summary: 'full prompts, timings, telemetry, and raw choice',
    open: false,
  },
])
const knowledgeHighlights = computed(() => {
  const knowledgeLayer = parsedPromptLayers.value?.knowledge
  const budget = knowledgeLayer?.budget ?? parsedKnowledgeBudget.value
  if (budget === null || budget === undefined) {
    return []
  }

  return [
    {
      label: 'Packed',
      value: `${knowledgeLayer?.usedChars ?? budget.usedChars} / ${budget.totalChars}`,
    },
    {
      label: 'Included',
      value: String(budget.includedChunkIds.length),
    },
    {
      label: 'Dropped',
      value: String(budget.droppedChunkIds.length),
    },
  ]
})
const parsedSoulBudget = computed(() => {
  if (!debugSoulBudget.value) {
    return null
  }

  try {
    return JSON.parse(debugSoulBudget.value) as CompletionDebugInfo['soulBudget']
  }
  catch {
    return null
  }
})

const debouncedRequest = debounce(() => {
  void requestCompletion()
}, 250)

onMounted(async () => {
  settings.value = await loadSettings()
  document.addEventListener('selectionchange', scheduleCompletion, true)
  document.addEventListener('scroll', queueGhostSync, true)
  window.addEventListener('resize', queueGhostSync, true)
})

onBeforeUnmount(() => {
  debouncedRequest.cancel()
  void cancelActiveRequest()
  document.removeEventListener('selectionchange', scheduleCompletion, true)
  document.removeEventListener('scroll', queueGhostSync, true)
  window.removeEventListener('resize', queueGhostSync, true)
  ghostOverlay.dispose()
})

const previewPrefix = computed(() => draft.value.slice(0, getCaretIndex()))
const previewSuffix = computed(() => draft.value.slice(getCaretIndex()))
const canRequest = computed(() => {
  if (!settings.value)
    return false
  return (
    previewPrefix.value.trim().length >= settings.value.minPrefixChars
    && supportsInlineCompletion(previewSuffix.value)
  )
})
const blockedReason = computed(() => {
  if (!settings.value)
    return 'Loading settings…'
  if (!settings.value.enabled)
    return 'Copycat is disabled in settings.'
  if (!settings.value.baseUrl)
    return 'Base URL is missing. Open settings and configure a provider.'
  if (providerPreset.value?.requiresKey && !settings.value.apiKey.trim()) {
    return `Missing API key for ${providerPreset.value.name}.`
  }
  if (!canRequest.value) {
    if (!supportsInlineCompletion(previewSuffix.value)) {
      return 'Inline completion is currently only available at the end of the text.'
    }
    return `Type at least ${settings.value.minPrefixChars} non-space characters to trigger completion.`
  }
  return ''
})

function logFlow(event: string, extra: Record<string, unknown> = {}) {
  const payload = {
    blockedReason: blockedReason.value,
    hasSuggestion: suggestion.value.length > 0,
    lastFingerprint: lastFingerprint.value,
    lastRequestId: lastRequestId.value,
    loading: loading.value,
    prefixLength: previewPrefix.value.length,
    suffixLength: previewSuffix.value.length,
    ...extra,
  }
  console.debug('[copycat][flow]', event, payload)
  const line = `${event} ${JSON.stringify(payload)}`
  flowLogs.value = [line, ...flowLogs.value].slice(0, 40)
}

function getTextarea(): HTMLTextAreaElement | null {
  return document.getElementById('playground-input') as HTMLTextAreaElement | null
}

function getCaretIndex(): number {
  const textarea = getTextarea()
  if (!textarea)
    return draft.value.length
  return textarea.selectionStart ?? draft.value.length
}

function queueGhostSync() {
  requestAnimationFrame(() => {
    syncPlaygroundGhostText(ghostOverlay, getTextarea(), suggestion.value)
  })
}

function scheduleCompletion() {
  logFlow('schedule-start')
  suggestion.value = ''
  errorText.value = ''
  infoText.value = ''
  lastLatencyMs.value = null

  if (blockedReason.value) {
    logFlow('schedule-blocked')
    debouncedRequest.cancel()
    void cancelActiveRequest()
    lastFingerprint.value = ''
    queueGhostSync()
    return
  }
  logFlow('schedule-debounced')
  queueGhostSync()
  debouncedRequest()
}

async function requestCompletion() {
  if (!settings.value?.enabled)
    return
  const prefix = previewPrefix.value
  const suffix = previewSuffix.value
  if (prefix.trim().length < settings.value.minPrefixChars) {
    logFlow('request-skip-min-prefix', {
      minPrefixChars: settings.value.minPrefixChars,
    })
    return
  }
  if (!supportsInlineCompletion(suffix)) {
    logFlow('request-skip-suffix')
    return
  }

  const fingerprint = buildCompletionFingerprint({
    host: 'playground',
    editorKind: 'textarea',
    prefix,
    suffix,
  })
  if (fingerprint === lastFingerprint.value) {
    logFlow('request-skip-duplicate', {
      fingerprint,
    })
    return
  }
  const triggerDecision = evaluateCompletionTrigger({
    prefix,
    now: Date.now(),
    memory: triggerMemory,
  })
  if (!triggerDecision.allowed) {
    logFlow('request-skip-trigger-policy', {
      reason: triggerDecision.reason,
    })
    return
  }

  await cancelActiveRequest()

  const requestId = nextId('play')
  triggerMemory.lastRequestedPrefix = prefix
  lastRequestId.value = requestId
  lastFingerprint.value = fingerprint
  loading.value = true
  errorText.value = ''
  infoText.value = ''
  stageFastCompletion.value = ''
  stageEnhancedCompletion.value = ''
  stageEnhancedTriggered.value = false
  stageEnhancedReplaced.value = false
  stageEnhancedRequested.value = false
  logFlow('request-send-fast', {
    fingerprint,
    requestId: requestId,
  })

  try {
    const response = await sendRuntimeMessage<CompletionResponse>({
      type: 'completion/request',
      payload: {
        id: requestId,
        prefix,
        suffix,
        signalKey: PLAYGROUND_SIGNAL_KEY,
        stage: 'fast',
        debug: true,
      },
    })
    if (lastRequestId.value !== requestId) {
      logFlow('request-drop-stale-fast', {
        requestId,
      })
      return
    }
    if (!supportsInlineCompletion(previewSuffix.value)) {
      logFlow('request-drop-suffix-blocked-fast', {
        requestId,
      })
      return
    }
    logFlow('request-apply-fast', {
      requestId,
      suggestionLength: (response?.completion ?? '').length,
      skipped: response.skipped,
    })
    suggestion.value = response?.completion ?? ''
    if (response.skipped) {
      triggerMemory.lastSkipPrefix = prefix
      triggerMemory.lastSkipAt = Date.now()
    }
    stageFastCompletion.value = response?.completion ?? ''
    lastLatencyMs.value = response?.latencyMs ?? null
    assignDebugState(response.debug)
    queueGhostSync()
    if (!suggestion.value) {
      logFlow(response.skipped ? 'request-skip-fast' : 'request-empty-fast', {
        requestId,
      })
      infoText.value
        = response.skipped
          ? 'The model decided the current prefix does not need inline continuation yet.'
          : 'The request completed, but the model returned an empty completion for the current prefix.'
    }
    if (shouldRequestEnhancedStage(response) && lastRequestId.value === requestId) {
      logFlow('request-send-enhanced', {
        requestId,
      })
      stageEnhancedRequested.value = true
      void requestEnhancedCompletion({
        currentSuggestion: response.completion,
        prefix,
        suffix,
      })
    }
  }
  catch (error) {
    if (lastRequestId.value !== requestId)
      return
    logFlow('request-error-fast', {
      message: error instanceof Error ? error.message : String(error),
      requestId,
    })
    errorText.value = error instanceof Error ? error.message : String(error)
    suggestion.value = ''
    clearDebugState()
    queueGhostSync()
  }
  finally {
    if (lastRequestId.value === requestId) {
      loading.value = false
      lastFingerprint.value = ''
    }
  }
}

async function requestEnhancedCompletion(args: {
  currentSuggestion: string
  prefix: string
  suffix: string
}) {
  if (!settings.value?.enabled)
    return

  const requestId = nextId('play')
  lastRequestId.value = requestId

  try {
    const response = await sendRuntimeMessage<CompletionResponse>({
      type: 'completion/request',
      payload: {
        id: requestId,
        prefix: args.prefix,
        suffix: args.suffix,
        signalKey: PLAYGROUND_SIGNAL_KEY,
        stage: 'enhanced',
        debug: true,
      },
    })

    if (lastRequestId.value !== requestId) {
      logFlow('request-drop-stale-enhanced', {
        requestId,
      })
      return
    }
    if (previewPrefix.value !== args.prefix) {
      logFlow('request-drop-prefix-changed-enhanced', {
        requestId,
      })
      return
    }
    stageEnhancedTriggered.value = true
    stageEnhancedCompletion.value = response.completion
    const shouldReplace = shouldPreferEnhancedCompletion(args.currentSuggestion, response.completion)
    stageEnhancedReplaced.value = shouldReplace
    if (!shouldReplace) {
      logFlow('request-drop-not-better-enhanced', {
        requestId,
      })
      return
    }
    if (!supportsInlineCompletion(previewSuffix.value)) {
      logFlow('request-drop-suffix-blocked-enhanced', {
        requestId,
      })
      return
    }

    logFlow('request-apply-enhanced', {
      requestId,
      suggestionLength: response.completion.length,
    })
    suggestion.value = response.completion
    lastLatencyMs.value = response.latencyMs
    assignDebugState(response.debug)
    queueGhostSync()
  }
  catch (error) {
    if (!(error instanceof Error && /abort/i.test(error.message))) {
      console.warn('[copycat] enhanced playground completion error:', error)
    }
  }
}

async function cancelActiveRequest() {
  if (!lastRequestId.value) {
    loading.value = false
    return
  }
  const requestId = lastRequestId.value
  logFlow('request-cancel', {
    requestId,
  })
  lastRequestId.value = ''
  loading.value = false
  try {
    await sendRuntimeMessage({
      type: 'completion/cancel',
      payload: { id: requestId },
    })
  }
  catch {
    // Ignore runtime cancellation failures in the playground.
  }
}

function acceptSuggestion() {
  if (!suggestion.value)
    return
  const textarea = getTextarea()
  const caret = getCaretIndex()
  const acceptedText = suggestion.value
  const acceptedPrefix = previewPrefix.value
  logFlow('accept-suggestion', {
    acceptedLength: acceptedText.length,
  })
  const nextValue
    = draft.value.slice(0, caret) + acceptedText + draft.value.slice(caret)
  draft.value = nextValue
  suggestion.value = ''
  errorText.value = ''
  infoText.value = 'Accepted the latest suggestion into the textarea.'
  lastLatencyMs.value = null
  lastFingerprint.value = ''
  emitCompletionEvent({
    action: 'accepted',
    prefix: acceptedPrefix,
    suggestion: acceptedText,
  })

  requestAnimationFrame(() => {
    if (!textarea)
      return
    const nextCaret = caret + acceptedText.length
    textarea.focus()
    textarea.setSelectionRange(nextCaret, nextCaret)
    queueGhostSync()
  })
}

function handleKeydown(event: KeyboardEvent) {
  if (event.key === 'Tab' && suggestion.value) {
    event.preventDefault()
    logFlow('keydown-tab-accept')
    acceptSuggestion()
    return
  }
  if (event.key === 'Escape' && suggestion.value) {
    event.preventDefault()
    logFlow('keydown-escape-dismiss')
    emitCompletionEvent({
      action: 'rejected',
      prefix: previewPrefix.value,
      suggestion: suggestion.value,
    })
    suggestion.value = ''
    errorText.value = ''
    infoText.value = 'Dismissed the latest suggestion.'
    queueGhostSync()
  }
}

function emitCompletionEvent(args: {
  action: CompletionEvent['action']
  prefix: string
  suggestion: string
}) {
  const event: CompletionEvent = {
    id: nextId('play-evt'),
    prefix: args.prefix,
    suggestion: args.suggestion,
    action: args.action,
    latencyMs: lastLatencyMs.value ?? 0,
    timestamp: Date.now(),
    host: 'playground',
  }

  void sendRuntimeMessage<void>({
    type: 'completion/event',
    payload: event,
  }).catch(() => {})
}

function clearAll() {
  if (suggestion.value) {
    emitCompletionEvent({
      action: 'ignored',
      prefix: previewPrefix.value,
      suggestion: suggestion.value,
    })
  }
  draft.value = ''
  suggestion.value = ''
  errorText.value = ''
  infoText.value = ''
  debugRawCompletion.value = ''
  debugSanitizedCompletion.value = ''
  debugRawChoice.value = ''
  debugUserPrompt.value = ''
  debugSystemPrompt.value = ''
  stageFastCompletion.value = ''
  stageEnhancedCompletion.value = ''
  stageEnhancedTriggered.value = false
  stageEnhancedReplaced.value = false
  stageEnhancedRequested.value = false
  clearDebugState()
  lastRequestId.value = ''
  lastLatencyMs.value = null
  lastFingerprint.value = ''
  flowLogs.value = []
  flowLogsCopied.value = false
  debouncedRequest.cancel()
  queueGhostSync()
}

async function copyFlowLogs() {
  const text = flowLogs.value.join('\n')
  if (!text) {
    return
  }

  try {
    await navigator.clipboard.writeText(text)
    flowLogsCopied.value = true
    window.setTimeout(() => {
      flowLogsCopied.value = false
    }, 1500)
  }
  catch (error) {
    console.warn('[copycat] failed to copy flow logs', error)
  }
}

function assignDebugState(debug: CompletionResponse['debug']) {
  debugRawCompletion.value = debug?.rawCompletion ?? ''
  debugSanitizedCompletion.value = debug?.sanitizedCompletion ?? ''
  debugRawChoice.value = debug?.rawChoice ?? ''
  debugUserPrompt.value = debug?.requestBody.userPrompt ?? ''
  debugSystemPrompt.value = debug?.requestBody.systemPrompt ?? ''
  debugPromptLayers.value = debug?.promptLayers
    ? JSON.stringify(debug.promptLayers, null, 2)
    : ''
  debugSoulSignals.value = debug?.soulSignals
    ? JSON.stringify(debug.soulSignals, null, 2)
    : ''
  debugAppliedStrategy.value = debug?.appliedStrategy
    ? JSON.stringify(debug.appliedStrategy, null, 2)
    : ''
  debugSoulContext.value = debug?.soulContext ?? ''
  debugSoulExplicitContext.value = debug?.soulExplicitContext ?? ''
  debugSoulLearnedContext.value = debug?.soulLearnedContext ?? ''
  debugSoulLearnedProfile.value = debug?.soulLearnedProfile
    ? JSON.stringify(debug.soulLearnedProfile, null, 2)
    : ''
  debugSoulObservedSignalCount.value = debug?.soulObservedSignalCount ?? 0
  debugSoulEnabled.value = debug?.soulEnabled ?? false
  debugSoulConfigured.value = debug?.soulConfigured ?? false
  debugSoulCharCount.value = debug?.soulCharCount ?? 0
  debugSoulBudget.value = debug?.soulBudget
    ? JSON.stringify(debug.soulBudget, null, 2)
    : ''
  debugKnowledgeContext.value = debug?.knowledgeContext ?? ''
  debugKnowledgeBudget.value = debug?.knowledgeBudgetMeta
    ? JSON.stringify(debug.knowledgeBudgetMeta, null, 2)
    : ''
  debugKnowledgeQuery.value = debug?.knowledgeQuery ?? ''
  debugKnowledgeRecall.value = debug?.knowledgeRecall
    ? JSON.stringify(debug.knowledgeRecall, null, 2)
    : ''
  debugKnowledgeRerank.value = debug?.knowledgeRerank
    ? JSON.stringify(debug.knowledgeRerank, null, 2)
    : ''
  debugKnowledgeChunks.value = debug?.knowledgeChunks ?? []
  debugTelemetry.value = debug?.telemetry
    ? JSON.stringify(debug.telemetry, null, 2)
    : ''
  debugTimings.value = debug?.timings
    ? JSON.stringify(debug.timings, null, 2)
    : ''
}

function clearDebugState() {
  debugPromptLayers.value = ''
  debugSoulSignals.value = ''
  debugAppliedStrategy.value = ''
  debugSoulContext.value = ''
  debugSoulExplicitContext.value = ''
  debugSoulLearnedContext.value = ''
  debugSoulLearnedProfile.value = ''
  debugSoulObservedSignalCount.value = 0
  debugSoulEnabled.value = false
  debugSoulConfigured.value = false
  debugSoulCharCount.value = 0
  debugSoulBudget.value = ''
  debugKnowledgeContext.value = ''
  debugKnowledgeBudget.value = ''
  debugKnowledgeQuery.value = ''
  debugKnowledgeRecall.value = ''
  debugKnowledgeRerank.value = ''
  debugKnowledgeChunks.value = []
  debugTelemetry.value = ''
  debugTimings.value = ''
}

function parseDebugTimings(raw: string): CompletionDebugInfo['timings'] | null {
  if (!raw) {
    return null
  }

  try {
    return JSON.parse(raw) as CompletionDebugInfo['timings']
  }
  catch {
    return null
  }
}

function insertSample() {
  draft.value = samplePrompt
  requestAnimationFrame(() => {
    const textarea = getTextarea()
    if (!textarea)
      return
    textarea.focus()
    textarea.setSelectionRange(draft.value.length, draft.value.length)
    scheduleCompletion()
  })
}

function openOptions() {
  void openSettingsPage()
}
</script>

<template>
  <div class="min-h-screen bg-neutral-50">
    <div class="mx-auto max-w-5xl px-6 py-10">
      <header class="mb-8 flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <div class="mb-3 flex items-center gap-3">
            <div
              class="flex h-10 w-10 items-center justify-center rounded-lg bg-brand-600 font-bold text-white"
            >
              CC
            </div>
            <div>
              <h1 class="text-2xl font-bold tracking-tight">Copycat Playground</h1>
              <p class="text-sm text-neutral-500">
                Run the textarea completion loop without depending on site-specific editors.
              </p>
            </div>
          </div>
          <p class="max-w-2xl text-sm text-neutral-600">
            This page talks directly to the extension background worker. It ignores the
            host allowlist and is meant only for validating the core request and accept flow.
          </p>
        </div>

        <div class="flex flex-wrap items-center gap-3">
          <button class="btn-ghost" @click="insertSample">Insert sample</button>
          <button class="btn-ghost" @click="clearAll">Clear</button>
          <button class="btn-primary" @click="openOptions">Open settings</button>
        </div>
      </header>

      <div class="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(320px,1fr)]">
        <section class="card">
          <div class="mb-3 flex items-center justify-between">
            <div>
              <h2 class="text-base font-semibold">Textarea</h2>
              <p class="text-xs text-neutral-500">Type, wait for a suggestion, then press <kbd>Tab</kbd>.</p>
            </div>
            <span
              class="rounded-full px-2.5 py-1 text-xs font-medium"
              :class="{
                'bg-neutral-100 text-neutral-700': completionMode === 'Idle',
                'bg-amber-100 text-amber-700': completionMode === 'Requesting',
                'bg-emerald-100 text-emerald-700': completionMode === 'Ready',
                'bg-sky-100 text-sky-700': completionMode === 'Info',
                'bg-rose-100 text-rose-700': completionMode === 'Error',
              }"
            >
              {{ completionMode }}
            </span>
          </div>

          <label class="label" for="playground-input">Prompt draft</label>
          <textarea
            id="playground-input"
            v-model="draft"
            rows="14"
            class="input h-auto resize-y py-3 font-mono text-sm leading-6"
            placeholder="Start typing a prompt here..."
            @input="scheduleCompletion"
            @click="scheduleCompletion"
            @keyup="scheduleCompletion"
            @keydown="handleKeydown"
          />

          <div class="mt-4 rounded-lg border border-dashed border-neutral-300 bg-neutral-50 p-4">
            <div class="mb-1 text-xs font-semibold uppercase tracking-wide text-neutral-600">
              Suggested continuation
            </div>
            <p v-if="suggestion" class="whitespace-pre-wrap font-mono text-sm text-neutral-800">
              {{ suggestion }}
            </p>
            <p v-else-if="loading" class="text-sm text-neutral-500">Requesting suggestion…</p>
            <p v-else-if="errorText" class="text-sm text-rose-600">{{ errorText }}</p>
            <p v-else-if="blockedReason" class="text-sm text-amber-700">{{ blockedReason }}</p>
            <p v-else-if="infoText" class="text-sm text-sky-700">{{ infoText }}</p>
            <p v-else class="text-sm text-neutral-400">No suggestion yet.</p>
          </div>
        </section>

        <section class="space-y-6">
          <div class="card">
            <h2 class="mb-4 text-base font-semibold">Request state</h2>
            <dl class="space-y-3 text-sm">
              <div>
                <dt class="text-xs font-semibold uppercase tracking-wide text-neutral-500">
                  Provider
                </dt>
                <dd class="mt-1 text-neutral-800">
                  {{ settings?.provider || 'loading' }} / {{ settings?.model || 'loading' }}
                </dd>
              </div>
              <div>
                <dt class="text-xs font-semibold uppercase tracking-wide text-neutral-500">
                  API key
                </dt>
                <dd class="mt-1 text-neutral-800">
                  {{ settings?.apiKey ? 'configured' : 'missing' }}
                </dd>
              </div>
              <div>
                <dt class="text-xs font-semibold uppercase tracking-wide text-neutral-500">
                  Base URL
                </dt>
                <dd class="mt-1 break-all text-neutral-800">
                  {{ settings?.baseUrl || 'missing' }}
                </dd>
              </div>
              <div>
                <dt class="text-xs font-semibold uppercase tracking-wide text-neutral-500">
                  Request id
                </dt>
                <dd class="mt-1 font-mono text-xs text-neutral-700">
                  {{ lastRequestId || 'none' }}
                </dd>
              </div>
              <div>
                <dt class="text-xs font-semibold uppercase tracking-wide text-neutral-500">
                  Latency
                </dt>
                <dd class="mt-1 text-neutral-800">
                  {{ lastLatencyMs === null ? 'n/a' : `${lastLatencyMs} ms` }}
                </dd>
              </div>
              <div>
                <dt class="text-xs font-semibold uppercase tracking-wide text-neutral-500">
                  Prefix length
                </dt>
                <dd class="mt-1 text-neutral-800">{{ previewPrefix.length }}</dd>
              </div>
              <div>
                <dt class="text-xs font-semibold uppercase tracking-wide text-neutral-500">
                  Enabled
                </dt>
                <dd class="mt-1 text-neutral-800">{{ settings?.enabled ? 'yes' : 'no' }}</dd>
              </div>
              <div>
                <dt class="text-xs font-semibold uppercase tracking-wide text-neutral-500">
                  Soul
                </dt>
                <dd class="mt-1 text-neutral-800">
                  {{
                    debugSoulEnabled
                      ? `projected · ${debugSoulCharCount} chars`
                      : debugSoulConfigured
                        ? 'configured · 0 chars'
                        : 'disabled'
                  }}
                </dd>
              </div>
            </dl>
          </div>

          <div class="card">
            <div class="mb-4 flex items-center justify-between gap-3">
              <h2 class="text-base font-semibold">Flow log</h2>
              <div class="flex items-center gap-3">
                <span class="text-xs text-neutral-500">latest 40 events</span>
                <button
                  class="btn-ghost px-3 py-1 text-xs"
                  :disabled="flowLogs.length === 0"
                  @click="copyFlowLogs"
                >
                  {{ flowLogsCopied ? 'Copied' : 'Copy' }}
                </button>
              </div>
            </div>
            <div class="rounded-lg bg-neutral-950 p-3">
              <pre class="max-h-80 overflow-auto whitespace-pre-wrap break-all text-xs text-neutral-100">{{ flowLogs.length ? flowLogs.join('\n') : 'No flow events yet.' }}</pre>
            </div>
          </div>

          <div class="grid gap-4 lg:grid-cols-4">
            <div class="card">
              <h2 class="mb-4 text-base font-semibold">Soul snapshot</h2>
              <dl class="space-y-3 text-sm">
                <div v-for="item in soulHighlights" :key="item.label">
                  <dt class="text-xs font-semibold uppercase tracking-wide text-neutral-500">
                    {{ item.label }}
                  </dt>
                  <dd class="mt-1 text-neutral-800">{{ item.value }}</dd>
                </div>
                <div v-if="soulHighlights.length === 0" class="text-sm text-neutral-400">
                  No soul data yet.
                </div>
              </dl>
            </div>

            <div class="card">
              <h2 class="mb-4 text-base font-semibold">Learned Soul</h2>
              <dl class="space-y-3 text-sm">
                <div v-for="item in learnedSoulHighlights" :key="item.label">
                  <dt class="text-xs font-semibold uppercase tracking-wide text-neutral-500">
                    {{ item.label }}
                  </dt>
                  <dd class="mt-1 text-neutral-800">{{ item.value }}</dd>
                </div>
                <div v-if="learnedSoulHighlights.length === 0" class="text-sm text-neutral-400">
                  No learned Soul data yet.
                </div>
              </dl>
            </div>

            <div class="card">
              <h2 class="mb-4 text-base font-semibold">Observed signals</h2>
              <dl class="space-y-3 text-sm">
                <div v-for="item in soulSignalHighlights" :key="item.label">
                  <dt class="text-xs font-semibold uppercase tracking-wide text-neutral-500">
                    {{ item.label }}
                  </dt>
                  <dd class="mt-1 text-neutral-800">{{ item.value }}</dd>
                </div>
                <div v-if="soulSignalHighlights.length === 0" class="text-sm text-neutral-400">
                  No observed Soul signals yet.
                </div>
              </dl>
            </div>

            <div class="card">
              <h2 class="mb-4 text-base font-semibold">Knowledge snapshot</h2>
              <dl class="space-y-3 text-sm">
                <div v-for="item in knowledgeHighlights" :key="item.label">
                  <dt class="text-xs font-semibold uppercase tracking-wide text-neutral-500">
                    {{ item.label }}
                  </dt>
                  <dd class="mt-1 text-neutral-800">{{ item.value }}</dd>
                </div>
                <div v-if="knowledgeHighlights.length === 0" class="text-sm text-neutral-400">
                  No knowledge data yet.
                </div>
              </dl>
            </div>
          </div>

          <div class="card">
            <h2 class="mb-4 text-base font-semibold">Timings</h2>
            <dl class="space-y-3 text-sm">
              <div v-for="[label, value] in timingSummary" :key="label">
                <dt class="text-xs font-semibold uppercase tracking-wide text-neutral-500">
                  {{ label }}
                </dt>
                <dd class="mt-1 text-neutral-800">{{ value }}</dd>
              </div>
              <div v-if="timingSummary.length === 0" class="text-sm text-neutral-400">
                No timing data yet.
              </div>
            </dl>
          </div>

          <div class="card">
            <h2 class="mb-4 text-base font-semibold">Knowledge timings</h2>
            <dl class="space-y-3 text-sm">
              <div v-for="[label, value] in knowledgeTimingSummary" :key="label">
                <dt class="text-xs font-semibold uppercase tracking-wide text-neutral-500">
                  {{ label }}
                </dt>
                <dd class="mt-1 text-neutral-800">{{ value }}</dd>
              </div>
              <div v-if="knowledgeTimingSummary.length === 0" class="text-sm text-neutral-400">
                No knowledge timing data yet.
              </div>
            </dl>
          </div>

          <div class="card">
            <h2 class="mb-4 text-base font-semibold">Knowledge budget</h2>
            <dl class="space-y-3 text-sm">
              <div v-for="[label, value] in knowledgeBudgetSummary" :key="label">
                <dt class="text-xs font-semibold uppercase tracking-wide text-neutral-500">
                  {{ label }}
                </dt>
                <dd class="mt-1 text-neutral-800">{{ value }}</dd>
              </div>
              <div v-if="knowledgeBudgetSummary.length === 0" class="text-sm text-neutral-400">
                No knowledge budget data yet.
              </div>
            </dl>
          </div>

          <div class="card">
            <h2 class="mb-4 text-base font-semibold">Stage activity</h2>
            <dl class="space-y-3 text-sm">
              <div>
                <dt class="text-xs font-semibold uppercase tracking-wide text-neutral-500">
                  Fast completion
                </dt>
                <dd class="mt-1 text-neutral-800">
                  {{ stageFastCompletion ? 'returned' : 'n/a' }}
                </dd>
              </div>
              <div>
                <dt class="text-xs font-semibold uppercase tracking-wide text-neutral-500">
                  Enhanced requested
                </dt>
                <dd class="mt-1 text-neutral-800">
                  {{ stageEnhancedRequested ? 'yes' : 'no' }}
                </dd>
              </div>
              <div>
                <dt class="text-xs font-semibold uppercase tracking-wide text-neutral-500">
                  Enhanced outcome
                </dt>
                <dd class="mt-1 text-neutral-800">
                  {{ stageOutcome }}
                </dd>
              </div>
            </dl>

            <div class="mt-4">
              <div class="mb-1 text-xs font-semibold uppercase tracking-wide text-neutral-500">
                Timeline
              </div>
              <ul class="space-y-2 text-sm text-neutral-800">
                <li v-for="line in stageActivityLines" :key="line" class="rounded bg-neutral-50 px-2 py-1 font-mono text-xs">
                  {{ line }}
                </li>
              </ul>
            </div>
          </div>

          <div class="card">
            <div class="mb-4 flex items-center justify-between gap-3">
              <div>
                <h2 class="text-base font-semibold">Debug console</h2>
                <p class="mt-1 text-xs text-neutral-500">
                  Summary-first layout. Expand raw payloads only when you need them.
                </p>
              </div>
              <div class="rounded-full bg-neutral-100 px-3 py-1 text-xs font-medium text-neutral-600">
                {{ debugSections.length }} sections
              </div>
            </div>

            <div v-if="errorText || blockedReason || infoText" class="mb-4 grid gap-3 md:grid-cols-3">
              <div v-if="errorText" class="rounded-xl border border-rose-200 bg-rose-50 p-3">
                <div class="mb-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-rose-700">Error</div>
                <p class="text-sm text-rose-800">{{ errorText }}</p>
              </div>
              <div v-if="blockedReason" class="rounded-xl border border-amber-200 bg-amber-50 p-3">
                <div class="mb-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-amber-700">Blocked</div>
                <p class="text-sm text-amber-800">{{ blockedReason }}</p>
              </div>
              <div v-if="infoText" class="rounded-xl border border-sky-200 bg-sky-50 p-3">
                <div class="mb-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-sky-700">Info</div>
                <p class="text-sm text-sky-800">{{ infoText }}</p>
              </div>
            </div>

            <div class="space-y-3">
              <details
                v-for="section in debugSections"
                :key="section.key"
                class="group overflow-hidden rounded-xl border border-neutral-200 bg-white"
                :open="section.open"
              >
                <summary class="flex cursor-pointer list-none items-center justify-between gap-4 bg-neutral-50 px-4 py-3">
                  <div>
                    <div class="text-sm font-semibold text-neutral-900">{{ section.title }}</div>
                    <div class="mt-0.5 text-xs text-neutral-500">{{ section.summary }}</div>
                  </div>
                  <div class="text-xs font-medium text-neutral-400 transition group-open:rotate-90">›</div>
                </summary>

                <div v-if="section.key === 'prompt'" class="grid gap-4 border-t border-neutral-200 p-4">
                  <div>
                    <div class="mb-1 text-xs font-semibold uppercase tracking-wide text-neutral-500">Prefix</div>
                    <pre class="overflow-auto rounded-md bg-neutral-950 p-3 text-xs text-neutral-100">{{ previewPrefix || '(empty)' }}</pre>
                  </div>
                  <div>
                    <div class="mb-1 text-xs font-semibold uppercase tracking-wide text-neutral-500">Suffix</div>
                    <pre class="overflow-auto rounded-md bg-neutral-950 p-3 text-xs text-neutral-100">{{ previewSuffix || '(empty)' }}</pre>
                  </div>
                  <div>
                    <div class="mb-1 text-xs font-semibold uppercase tracking-wide text-neutral-500">Applied strategy</div>
                    <pre class="overflow-auto rounded-md bg-neutral-950 p-3 text-xs text-neutral-100">{{ debugAppliedStrategy || '(empty)' }}</pre>
                  </div>
                  <div>
                    <div class="mb-1 text-xs font-semibold uppercase tracking-wide text-neutral-500">Prompt layers</div>
                    <pre class="overflow-auto rounded-md bg-neutral-950 p-3 text-xs text-neutral-100">{{ debugPromptLayers || '(empty)' }}</pre>
                  </div>
                </div>

                <div v-else-if="section.key === 'soul'" class="grid gap-4 border-t border-neutral-200 p-4">
                  <div class="grid gap-3 sm:grid-cols-3">
                    <div class="rounded-lg border border-neutral-200 bg-neutral-50 p-3">
                      <div class="text-[11px] font-semibold uppercase tracking-[0.18em] text-neutral-500">Projection</div>
                      <div class="mt-1 text-sm text-neutral-900">{{ debugSoulEnabled ? 'active' : debugSoulConfigured ? 'configured but empty' : 'disabled' }}</div>
                    </div>
                    <div class="rounded-lg border border-neutral-200 bg-neutral-50 p-3">
                      <div class="text-[11px] font-semibold uppercase tracking-[0.18em] text-neutral-500">Projected chars</div>
                      <div class="mt-1 text-sm text-neutral-900">{{ debugSoulCharCount }}</div>
                    </div>
                    <div class="rounded-lg border border-neutral-200 bg-neutral-50 p-3">
                      <div class="text-[11px] font-semibold uppercase tracking-[0.18em] text-neutral-500">Included blocks</div>
                      <div class="mt-1 text-sm text-neutral-900">{{ parsedSoulBudget?.includedBlocks.join(', ') || 'none' }}</div>
                    </div>
                  </div>
                  <div>
                    <div class="mb-1 text-xs font-semibold uppercase tracking-wide text-neutral-500">Explicit soul context</div>
                    <pre class="overflow-auto rounded-md bg-neutral-950 p-3 text-xs text-neutral-100">{{ debugSoulExplicitContext || '(empty)' }}</pre>
                  </div>
                  <div>
                    <div class="mb-1 text-xs font-semibold uppercase tracking-wide text-neutral-500">Merged soul context</div>
                    <pre class="overflow-auto rounded-md bg-neutral-950 p-3 text-xs text-neutral-100">{{ debugSoulContext || '(empty)' }}</pre>
                  </div>
                  <div>
                    <div class="mb-1 text-xs font-semibold uppercase tracking-wide text-neutral-500">Soul budget</div>
                    <pre class="overflow-auto rounded-md bg-neutral-950 p-3 text-xs text-neutral-100">{{ debugSoulBudget || '(empty)' }}</pre>
                  </div>
                </div>

                <div v-else-if="section.key === 'learned-soul'" class="grid gap-4 border-t border-neutral-200 p-4">
                  <div class="grid gap-3 sm:grid-cols-3">
                    <div class="rounded-lg border border-neutral-200 bg-neutral-50 p-3">
                      <div class="text-[11px] font-semibold uppercase tracking-[0.18em] text-neutral-500">Preferences</div>
                      <div class="mt-1 text-sm text-neutral-900">{{ parsedSoulLearnedProfile?.preferences.length ?? 0 }}</div>
                    </div>
                    <div class="rounded-lg border border-neutral-200 bg-neutral-50 p-3">
                      <div class="text-[11px] font-semibold uppercase tracking-[0.18em] text-neutral-500">Avoidances</div>
                      <div class="mt-1 text-sm text-neutral-900">{{ parsedSoulLearnedProfile?.avoidances.length ?? 0 }}</div>
                    </div>
                    <div class="rounded-lg border border-neutral-200 bg-neutral-50 p-3">
                      <div class="text-[11px] font-semibold uppercase tracking-[0.18em] text-neutral-500">Terms</div>
                      <div class="mt-1 text-sm text-neutral-900">{{ parsedSoulLearnedProfile?.terms.length ?? 0 }}</div>
                    </div>
                  </div>
                  <div>
                    <div class="mb-1 text-xs font-semibold uppercase tracking-wide text-neutral-500">Learned soul context</div>
                    <pre class="overflow-auto rounded-md bg-neutral-950 p-3 text-xs text-neutral-100">{{ debugSoulLearnedContext || '(empty)' }}</pre>
                  </div>
                  <div>
                    <div class="mb-1 text-xs font-semibold uppercase tracking-wide text-neutral-500">Learned soul profile</div>
                    <pre class="overflow-auto rounded-md bg-neutral-950 p-3 text-xs text-neutral-100">{{ debugSoulLearnedProfile || '(empty)' }}</pre>
                  </div>
                </div>

                <div v-else-if="section.key === 'observed-signals'" class="grid gap-4 border-t border-neutral-200 p-4">
                  <div class="grid gap-3 sm:grid-cols-3">
                    <div class="rounded-lg border border-neutral-200 bg-neutral-50 p-3">
                      <div class="text-[11px] font-semibold uppercase tracking-[0.18em] text-neutral-500">Observed</div>
                      <div class="mt-1 text-sm text-neutral-900">{{ debugSoulObservedSignalCount }}</div>
                    </div>
                    <div class="rounded-lg border border-neutral-200 bg-neutral-50 p-3">
                      <div class="text-[11px] font-semibold uppercase tracking-[0.18em] text-neutral-500">Mature</div>
                      <div class="mt-1 text-sm text-neutral-900">{{ parsedSoulSignals?.matureCount ?? 0 }}</div>
                    </div>
                    <div class="rounded-lg border border-neutral-200 bg-neutral-50 p-3">
                      <div class="text-[11px] font-semibold uppercase tracking-[0.18em] text-neutral-500">Top signal</div>
                      <div class="mt-1 text-sm text-neutral-900">{{ parsedSoulSignals?.signals[0] ? `${parsedSoulSignals.signals[0].kind}:${parsedSoulSignals.signals[0].value}` : 'none' }}</div>
                    </div>
                  </div>
                  <div>
                    <div class="mb-1 text-xs font-semibold uppercase tracking-wide text-neutral-500">Soul signals</div>
                    <pre class="overflow-auto rounded-md bg-neutral-950 p-3 text-xs text-neutral-100">{{ debugSoulSignals || '(empty)' }}</pre>
                  </div>
                </div>

                <div v-else-if="section.key === 'knowledge'" class="grid gap-4 border-t border-neutral-200 p-4">
                  <div class="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                    <div class="rounded-lg border border-neutral-200 bg-neutral-50 p-3">
                      <div class="text-[11px] font-semibold uppercase tracking-[0.18em] text-neutral-500">Query</div>
                      <div class="mt-1 text-sm text-neutral-900">{{ debugKnowledgeQuery || 'none' }}</div>
                    </div>
                    <div class="rounded-lg border border-neutral-200 bg-neutral-50 p-3">
                      <div class="text-[11px] font-semibold uppercase tracking-[0.18em] text-neutral-500">Packed chunks</div>
                      <div class="mt-1 text-sm text-neutral-900">{{ debugKnowledgeChunks.length }}</div>
                    </div>
                    <div class="rounded-lg border border-neutral-200 bg-neutral-50 p-3">
                      <div class="text-[11px] font-semibold uppercase tracking-[0.18em] text-neutral-500">Budget</div>
                      <div class="mt-1 text-sm text-neutral-900">{{ knowledgeBudgetSummary[0]?.[1] ?? 'n/a' }}</div>
                    </div>
                    <div class="rounded-lg border border-neutral-200 bg-neutral-50 p-3">
                      <div class="text-[11px] font-semibold uppercase tracking-[0.18em] text-neutral-500">Recall</div>
                      <div class="mt-1 text-sm text-neutral-900">{{ debugKnowledgeRecall ? 'available' : 'none' }}</div>
                    </div>
                  </div>
                  <div>
                    <div class="mb-1 text-xs font-semibold uppercase tracking-wide text-neutral-500">Knowledge context</div>
                    <pre class="overflow-auto rounded-md bg-neutral-950 p-3 text-xs text-neutral-100">{{ debugKnowledgeContext || '(empty)' }}</pre>
                  </div>
                  <div>
                    <div class="mb-1 text-xs font-semibold uppercase tracking-wide text-neutral-500">Knowledge budget</div>
                    <pre class="overflow-auto rounded-md bg-neutral-950 p-3 text-xs text-neutral-100">{{ debugKnowledgeBudget || '(empty)' }}</pre>
                  </div>
                  <div>
                    <div class="mb-1 text-xs font-semibold uppercase tracking-wide text-neutral-500">Knowledge recall</div>
                    <pre class="overflow-auto rounded-md bg-neutral-950 p-3 text-xs text-neutral-100">{{ debugKnowledgeRecall || '(empty)' }}</pre>
                  </div>
                  <div>
                    <div class="mb-1 text-xs font-semibold uppercase tracking-wide text-neutral-500">Knowledge rerank</div>
                    <pre class="overflow-auto rounded-md bg-neutral-950 p-3 text-xs text-neutral-100">{{ debugKnowledgeRerank || '(empty)' }}</pre>
                  </div>
                  <div>
                    <div class="mb-1 text-xs font-semibold uppercase tracking-wide text-neutral-500">Knowledge chunks</div>
                    <pre class="overflow-auto rounded-md bg-neutral-950 p-3 text-xs text-neutral-100">{{ debugKnowledgeChunks.length ? JSON.stringify(debugKnowledgeChunks, null, 2) : '(empty)' }}</pre>
                  </div>
                </div>

                <div v-else-if="section.key === 'model'" class="grid gap-4 border-t border-neutral-200 p-4">
                  <div>
                    <div class="mb-1 text-xs font-semibold uppercase tracking-wide text-neutral-500">Sanitized completion</div>
                    <pre class="overflow-auto rounded-md bg-neutral-950 p-3 text-xs text-neutral-100">{{ debugSanitizedCompletion || '(empty)' }}</pre>
                  </div>
                  <div>
                    <div class="mb-1 text-xs font-semibold uppercase tracking-wide text-neutral-500">Raw completion</div>
                    <pre class="overflow-auto rounded-md bg-neutral-950 p-3 text-xs text-neutral-100">{{ debugRawCompletion || '(empty)' }}</pre>
                  </div>
                </div>

                <div v-else class="grid gap-4 border-t border-neutral-200 p-4">
                  <div>
                    <div class="mb-1 text-xs font-semibold uppercase tracking-wide text-neutral-500">Timings</div>
                    <pre class="overflow-auto rounded-md bg-neutral-950 p-3 text-xs text-neutral-100">{{ debugTimings || '(empty)' }}</pre>
                  </div>
                  <div>
                    <div class="mb-1 text-xs font-semibold uppercase tracking-wide text-neutral-500">Telemetry</div>
                    <pre class="overflow-auto rounded-md bg-neutral-950 p-3 text-xs text-neutral-100">{{ debugTelemetry || '(empty)' }}</pre>
                  </div>
                  <div>
                    <div class="mb-1 text-xs font-semibold uppercase tracking-wide text-neutral-500">Raw choice</div>
                    <pre class="overflow-auto rounded-md bg-neutral-950 p-3 text-xs text-neutral-100">{{ debugRawChoice || '(empty)' }}</pre>
                  </div>
                  <div>
                    <div class="mb-1 text-xs font-semibold uppercase tracking-wide text-neutral-500">User prompt</div>
                    <pre class="overflow-auto rounded-md bg-neutral-950 p-3 text-xs text-neutral-100">{{ debugUserPrompt || '(empty)' }}</pre>
                  </div>
                  <div>
                    <div class="mb-1 text-xs font-semibold uppercase tracking-wide text-neutral-500">System prompt</div>
                    <pre class="overflow-auto rounded-md bg-neutral-950 p-3 text-xs text-neutral-100">{{ debugSystemPrompt || '(empty)' }}</pre>
                  </div>
                </div>
              </details>
            </div>
          </div>
        </section>
      </div>
    </div>
  </div>
</template>
