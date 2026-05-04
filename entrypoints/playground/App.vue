<script setup lang="ts">
import type { CompletionEvent, CompletionResponse, Settings } from '~/types'
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import {
  buildCompletionFingerprint,
  buildCompletionSignalKey,
} from '~/utils/completion/request'
import { debounce, nextId } from '~/utils/core/base'
import { openSettingsPage, sendRuntimeMessage } from '~/utils/core/runtime'
import { GhostTextOverlay, syncPlaygroundGhostText } from '~/utils/ghost-text'
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
const debugKnowledgeContext = ref('')
const debugKnowledgeQuery = ref('')
const debugKnowledgeChunks = ref<Array<{
  id: string
  sourceName: string
  text: string
}>>([])
const stageFastCompletion = ref('')
const stageEnhancedCompletion = ref('')
const stageEnhancedTriggered = ref(false)
const stageEnhancedReplaced = ref(false)
const stageEnhancedRequested = ref(false)
const debugAppliedStrategy = ref('')
const debugTelemetry = ref('')
const lastRequestId = ref('')
const lastLatencyMs = ref<number | null>(null)
const settings = ref<Settings | null>(null)
const lastFingerprint = ref('')
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

const debouncedRequest = debounce(() => {
  void requestCompletion()
}, 250)

onMounted(async () => {
  settings.value = await loadSettings()
  document.addEventListener('selectionchange', queueGhostSync, true)
  document.addEventListener('scroll', queueGhostSync, true)
  window.addEventListener('resize', queueGhostSync, true)
})

onBeforeUnmount(() => {
  debouncedRequest.cancel()
  void cancelActiveRequest()
  document.removeEventListener('selectionchange', queueGhostSync, true)
  document.removeEventListener('scroll', queueGhostSync, true)
  window.removeEventListener('resize', queueGhostSync, true)
  ghostOverlay.dispose()
})

const previewPrefix = computed(() => draft.value.slice(0, getCaretIndex()))
const previewSuffix = computed(() => draft.value.slice(getCaretIndex()))
const canRequest = computed(() => {
  if (!settings.value)
    return false
  return previewPrefix.value.trim().length >= settings.value.minPrefixChars
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
    return `Type at least ${settings.value.minPrefixChars} non-space characters to trigger completion.`
  }
  return ''
})

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
  suggestion.value = ''
  errorText.value = ''
  infoText.value = ''
  lastLatencyMs.value = null

  if (blockedReason.value) {
    debouncedRequest.cancel()
    void cancelActiveRequest()
    lastFingerprint.value = ''
    queueGhostSync()
    return
  }
  queueGhostSync()
  debouncedRequest()
}

async function requestCompletion() {
  if (!settings.value?.enabled)
    return
  const prefix = previewPrefix.value
  const suffix = previewSuffix.value
  if (prefix.trim().length < settings.value.minPrefixChars)
    return

  const fingerprint = buildCompletionFingerprint({
    host: 'playground',
    editorKind: 'textarea',
    prefix,
    suffix,
  })
  if (fingerprint === lastFingerprint.value)
    return

  await cancelActiveRequest()

  const requestId = nextId('play')
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
    if (lastRequestId.value !== requestId)
      return
    suggestion.value = response?.completion ?? ''
    stageFastCompletion.value = response?.completion ?? ''
    lastLatencyMs.value = response?.latencyMs ?? null
    debugRawCompletion.value = response?.debug?.rawCompletion ?? ''
    debugSanitizedCompletion.value = response?.debug?.sanitizedCompletion ?? ''
    debugRawChoice.value = response?.debug?.rawChoice ?? ''
    debugUserPrompt.value = response?.debug?.requestBody.userPrompt ?? ''
    debugSystemPrompt.value = response?.debug?.requestBody.systemPrompt ?? ''
    debugAppliedStrategy.value = response?.debug?.appliedStrategy
      ? JSON.stringify(response.debug.appliedStrategy, null, 2)
      : ''
    debugKnowledgeContext.value = response?.debug?.knowledgeContext ?? ''
    debugKnowledgeQuery.value = response?.debug?.knowledgeQuery ?? ''
    debugKnowledgeChunks.value = response?.debug?.knowledgeChunks ?? []
    debugTelemetry.value = response?.debug?.telemetry
      ? JSON.stringify(response.debug.telemetry, null, 2)
      : ''
    queueGhostSync()
    if (!suggestion.value) {
      infoText.value
        = 'The request completed, but the model returned an empty completion for the current prefix.'
    }
    if (shouldRequestEnhancedStage(response) && lastRequestId.value === requestId) {
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
    errorText.value = error instanceof Error ? error.message : String(error)
    suggestion.value = ''
    debugAppliedStrategy.value = ''
    debugKnowledgeContext.value = ''
    debugKnowledgeQuery.value = ''
    debugKnowledgeChunks.value = []
    debugTelemetry.value = ''
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

    if (lastRequestId.value !== requestId)
      return
    if (previewPrefix.value !== args.prefix)
      return
    stageEnhancedTriggered.value = true
    stageEnhancedCompletion.value = response.completion
    const shouldReplace = shouldPreferEnhancedCompletion(args.currentSuggestion, response.completion)
    stageEnhancedReplaced.value = shouldReplace
    if (!shouldReplace)
      return

    suggestion.value = response.completion
    lastLatencyMs.value = response.latencyMs
    debugRawCompletion.value = response?.debug?.rawCompletion ?? ''
    debugSanitizedCompletion.value = response?.debug?.sanitizedCompletion ?? ''
    debugRawChoice.value = response?.debug?.rawChoice ?? ''
    debugUserPrompt.value = response?.debug?.requestBody.userPrompt ?? ''
    debugSystemPrompt.value = response?.debug?.requestBody.systemPrompt ?? ''
    debugAppliedStrategy.value = response?.debug?.appliedStrategy
      ? JSON.stringify(response.debug.appliedStrategy, null, 2)
      : ''
    debugKnowledgeContext.value = response?.debug?.knowledgeContext ?? ''
    debugKnowledgeQuery.value = response?.debug?.knowledgeQuery ?? ''
    debugKnowledgeChunks.value = response?.debug?.knowledgeChunks ?? []
    debugTelemetry.value = response?.debug?.telemetry
      ? JSON.stringify(response.debug.telemetry, null, 2)
      : ''
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
    acceptSuggestion()
    return
  }
  if (event.key === 'Escape' && suggestion.value) {
    event.preventDefault()
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
    debugAppliedStrategy.value = ''
    debugTelemetry.value = ''
  lastRequestId.value = ''
  lastLatencyMs.value = null
  lastFingerprint.value = ''
  debouncedRequest.cancel()
  queueGhostSync()
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
            <h2 class="mb-4 text-base font-semibold">Debug preview</h2>
            <div class="space-y-4">
              <div>
                <div class="mb-1 text-xs font-semibold uppercase tracking-wide text-neutral-500">
                  Prefix
                </div>
                <pre class="overflow-auto rounded-md bg-neutral-950 p-3 text-xs text-neutral-100">{{ previewPrefix || '(empty)' }}</pre>
              </div>
              <div>
                <div class="mb-1 text-xs font-semibold uppercase tracking-wide text-neutral-500">
                  Suffix
                </div>
                <pre class="overflow-auto rounded-md bg-neutral-950 p-3 text-xs text-neutral-100">{{ previewSuffix || '(empty)' }}</pre>
              </div>
              <div v-if="errorText">
                <div class="mb-1 text-xs font-semibold uppercase tracking-wide text-rose-600">
                  Error
                </div>
                <pre class="overflow-auto rounded-md bg-rose-50 p-3 text-xs text-rose-700">{{ errorText }}</pre>
              </div>
              <div v-if="blockedReason">
                <div class="mb-1 text-xs font-semibold uppercase tracking-wide text-amber-700">
                  Blocked reason
                </div>
                <pre class="overflow-auto rounded-md bg-amber-50 p-3 text-xs text-amber-800">{{ blockedReason }}</pre>
              </div>
              <div v-if="infoText">
                <div class="mb-1 text-xs font-semibold uppercase tracking-wide text-sky-700">
                  Last info
                </div>
                <pre class="overflow-auto rounded-md bg-sky-50 p-3 text-xs text-sky-800">{{ infoText }}</pre>
              </div>
              <div>
                <div class="mb-1 text-xs font-semibold uppercase tracking-wide text-neutral-500">
                  Applied strategy
                </div>
                <pre class="overflow-auto rounded-md bg-neutral-950 p-3 text-xs text-neutral-100">{{ debugAppliedStrategy || '(empty)' }}</pre>
              </div>
              <div>
                <div class="mb-1 text-xs font-semibold uppercase tracking-wide text-neutral-500">
                  Knowledge query
                </div>
                <pre class="overflow-auto rounded-md bg-neutral-950 p-3 text-xs text-neutral-100">{{ debugKnowledgeQuery || '(empty)' }}</pre>
              </div>
              <div>
                <div class="mb-1 text-xs font-semibold uppercase tracking-wide text-neutral-500">
                  Knowledge context
                </div>
                <pre class="overflow-auto rounded-md bg-neutral-950 p-3 text-xs text-neutral-100">{{ debugKnowledgeContext || '(empty)' }}</pre>
              </div>
              <div>
                <div class="mb-1 text-xs font-semibold uppercase tracking-wide text-neutral-500">
                  Knowledge chunks
                </div>
                <pre class="overflow-auto rounded-md bg-neutral-950 p-3 text-xs text-neutral-100">{{ debugKnowledgeChunks.length ? JSON.stringify(debugKnowledgeChunks, null, 2) : '(empty)' }}</pre>
              </div>
              <div>
                <div class="mb-1 text-xs font-semibold uppercase tracking-wide text-neutral-500">
                  Telemetry
                </div>
                <pre class="overflow-auto rounded-md bg-neutral-950 p-3 text-xs text-neutral-100">{{ debugTelemetry || '(empty)' }}</pre>
              </div>
              <div>
                <div class="mb-1 text-xs font-semibold uppercase tracking-wide text-neutral-500">
                  Raw choice
                </div>
                <pre class="overflow-auto rounded-md bg-neutral-950 p-3 text-xs text-neutral-100">{{ debugRawChoice || '(empty)' }}</pre>
              </div>
              <div>
                <div class="mb-1 text-xs font-semibold uppercase tracking-wide text-neutral-500">
                  Raw completion
                </div>
                <pre class="overflow-auto rounded-md bg-neutral-950 p-3 text-xs text-neutral-100">{{ debugRawCompletion || '(empty)' }}</pre>
              </div>
              <div>
                <div class="mb-1 text-xs font-semibold uppercase tracking-wide text-neutral-500">
                  Sanitized completion
                </div>
                <pre class="overflow-auto rounded-md bg-neutral-950 p-3 text-xs text-neutral-100">{{ debugSanitizedCompletion || '(empty)' }}</pre>
              </div>
              <div>
                <div class="mb-1 text-xs font-semibold uppercase tracking-wide text-neutral-500">
                  User prompt
                </div>
                <pre class="overflow-auto rounded-md bg-neutral-950 p-3 text-xs text-neutral-100">{{ debugUserPrompt || '(empty)' }}</pre>
              </div>
              <div>
                <div class="mb-1 text-xs font-semibold uppercase tracking-wide text-neutral-500">
                  System prompt
                </div>
                <pre class="overflow-auto rounded-md bg-neutral-950 p-3 text-xs text-neutral-100">{{ debugSystemPrompt || '(empty)' }}</pre>
              </div>
            </div>
          </div>
        </section>
      </div>
    </div>
  </div>
</template>
