<script setup lang="ts">
import type {
  CompletionEvent,
  CompletionEventStats,
  KnowledgeChunk,
  KnowledgeDeleteResult,
  KnowledgeDocument,
  KnowledgeImportRequest,
  KnowledgeImportResult,
  KnowledgeSearchRequest,
  ProviderId,
  Settings,
} from '~/types'
import type { DiscoveredModel } from '~/utils/model-discovery'
import { computed, onMounted, ref, watch } from 'vue'
import { sendRuntimeMessage } from '~/utils/messages'
import { buildModelsUrl, parseModelListResponse } from '~/utils/model-discovery'
import {
  buildOpenAICompatibleHeaders,
  extractAssistantMessageContent,
  joinOpenAICompatibleUrl,
} from '~/utils/openai-compatible'
import { PROVIDER_ORDER, PROVIDER_PRESETS, resolveProviderPreset } from '~/utils/providers'
import { DEFAULT_SETTINGS, DEFAULT_SYSTEM_PROMPT, loadSettings, saveSettings } from '~/utils/settings'
import { loadTelemetrySnapshot } from '~/utils/telemetry'

const DEFAULT_KB_ID = 'default'

const settings = ref<Settings>({ ...DEFAULT_SETTINGS })
const loaded = ref(false)
const saving = ref(false)
const toast = ref<{ kind: 'ok' | 'err', text: string } | null>(null)
const testingConnection = ref(false)
const connectionResult = ref<{ ok: boolean, message: string } | null>(null)
const fetchingModels = ref(false)
const modelsError = ref('')
const discoveredModels = ref<DiscoveredModel[]>([])
const loadError = ref('')
const hostsText = ref('')
const importingKnowledge = ref(false)
const knowledgeDocuments = ref<KnowledgeDocument[]>([])
const knowledgeError = ref('')
const knowledgeQuery = ref('')
const knowledgeResults = ref<KnowledgeChunk[]>([])
const searchingKnowledge = ref(false)
const telemetryHost = ref('')
const telemetryEvents = ref<CompletionEvent[]>([])
const telemetryStats = ref<CompletionEventStats | null>(null)
const telemetryError = ref('')
const loadingTelemetry = ref(false)

const provider = computed(() => resolveProviderPreset(settings.value.provider))

onMounted(async () => {
  try {
    const stored = await loadSettings()
    settings.value = stored
    hostsText.value = stored.enabledHosts.join('\n')
    await reloadKnowledgeDocuments()
  }
  catch (error) {
    loadError.value
      = error instanceof Error ? error.message : 'Failed to load settings. Defaults are shown instead.'
    settings.value = { ...DEFAULT_SETTINGS }
    hostsText.value = DEFAULT_SETTINGS.enabledHosts.join('\n')
  }
  finally {
    telemetryHost.value = await resolveTelemetryHost()
    await reloadTelemetry()
    loaded.value = true
  }
})

watch(
  () => settings.value.provider,
  (id: ProviderId, previous) => {
    if (!loaded.value || id === previous)
      return
    const preset = resolveProviderPreset(id)
    if (preset.baseUrl)
      settings.value.baseUrl = preset.baseUrl
    if (preset.defaultModel)
      settings.value.model = preset.defaultModel
  },
)

async function persist() {
  saving.value = true
  try {
    settings.value.enabledHosts = hostsText.value
      .split(/\r?\n/)
      .map(item => item.trim())
      .filter(Boolean)
    const next = await saveSettings(settings.value)
    settings.value = next
    hostsText.value = next.enabledHosts.join('\n')
    showToast('ok', 'Settings saved')
  }
  catch (error) {
    showToast('err', error instanceof Error ? error.message : String(error))
  }
  finally {
    saving.value = false
  }
}

function resetSystemPrompt() {
  settings.value.systemPrompt = DEFAULT_SYSTEM_PROMPT
}

function resetAll() {
  if (!confirm('Reset all settings to defaults? Your API key will be cleared.'))
    return
  settings.value = { ...DEFAULT_SETTINGS }
  hostsText.value = DEFAULT_SETTINGS.enabledHosts.join('\n')
}

async function testConnection() {
  testingConnection.value = true
  connectionResult.value = null
  try {
    const url = joinOpenAICompatibleUrl(settings.value.baseUrl, '/chat/completions')
    const res = await fetch(url, {
      method: 'POST',
      headers: buildOpenAICompatibleHeaders(settings.value.apiKey),
      body: JSON.stringify({
        model: settings.value.model,
        messages: [
          { role: 'system', content: 'You are a connectivity test.' },
          { role: 'user', content: 'Say "ok".' },
        ],
        max_tokens: 4,
        temperature: 0,
      }),
    })
    if (!res.ok) {
      const text = await res.text()
      connectionResult.value = {
        ok: false,
        message: `HTTP ${res.status}: ${text.slice(0, 180)}`,
      }
      return
    }

    const data = await res.json()
    const reply = extractAssistantMessageContent(data) || '(empty)'
    connectionResult.value = { ok: true, message: `Connected — reply: ${reply}` }
  }
  catch (error) {
    connectionResult.value = {
      ok: false,
      message: error instanceof Error ? error.message : String(error),
    }
  }
  finally {
    testingConnection.value = false
  }
}

async function fetchModels() {
  fetchingModels.value = true
  modelsError.value = ''
  discoveredModels.value = []

  try {
    const url = buildModelsUrl(settings.value.baseUrl)
    const res = await fetch(url, {
      method: 'GET',
      headers: buildOpenAICompatibleHeaders(settings.value.apiKey),
    })
    if (!res.ok) {
      const text = await res.text()
      modelsError.value = `HTTP ${res.status}: ${text.slice(0, 180)}`
      return
    }

    const data = await res.json()
    const models = parseModelListResponse(data)
    if (models.length === 0) {
      modelsError.value = 'No models were returned by this host.'
      return
    }
    discoveredModels.value = models
  }
  catch (error) {
    modelsError.value = error instanceof Error ? error.message : String(error)
  }
  finally {
    fetchingModels.value = false
  }
}

function useDiscoveredModel(modelId: string) {
  settings.value.model = modelId
}

function showToast(kind: 'ok' | 'err', text: string) {
  toast.value = { kind, text }
  setTimeout(() => {
    toast.value = null
  }, 2400)
}

async function reloadKnowledgeDocuments() {
  knowledgeDocuments.value = await sendRuntimeMessage<KnowledgeDocument[]>({
    type: 'knowledge/list',
    payload: { kbId: DEFAULT_KB_ID },
  })
}

async function resolveTelemetryHost() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
  try {
    return tab?.url ? new URL(tab.url).host : ''
  }
  catch {
    return ''
  }
}

async function reloadTelemetry() {
  loadingTelemetry.value = true

  try {
    const snapshot = await loadTelemetrySnapshot({
      host: telemetryHost.value,
      loadStats: () =>
        sendRuntimeMessage<CompletionEventStats>({
          type: 'completion/events/stats',
          payload: { host: telemetryHost.value },
        }),
      loadEvents: () =>
        sendRuntimeMessage<CompletionEvent[]>({
          type: 'completion/events/recent',
          payload: { host: telemetryHost.value, limit: 8 },
        }),
    })

    telemetryStats.value = snapshot.stats
    telemetryEvents.value = snapshot.events
    telemetryError.value = snapshot.error
  }
  finally {
    loadingTelemetry.value = false
  }
}

async function handleKnowledgeFiles(event: Event) {
  const input = event.target as HTMLInputElement
  const files = [...(input.files ?? [])]
  input.value = ''
  if (files.length === 0) {
    return
  }

  importingKnowledge.value = true
  knowledgeError.value = ''

  try {
    for (const file of files) {
      const rawContent = await file.text()
      const payload: KnowledgeImportRequest = {
        kbId: DEFAULT_KB_ID,
        rawContent,
        sourceType: 'markdown',
        title: file.name,
      }
      await sendRuntimeMessage<KnowledgeImportResult>({
        type: 'knowledge/import',
        payload,
      })
    }
    await reloadKnowledgeDocuments()
    showToast('ok', `Imported ${files.length} file${files.length > 1 ? 's' : ''}`)
  }
  catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    knowledgeError.value = message
    showToast('err', message)
  }
  finally {
    importingKnowledge.value = false
  }
}

async function removeKnowledgeDocument(docId: string) {
  try {
    await sendRuntimeMessage<KnowledgeDeleteResult>({
      type: 'knowledge/delete',
      payload: {
        docId,
        kbId: DEFAULT_KB_ID,
      },
    })
    await reloadKnowledgeDocuments()
    knowledgeResults.value = knowledgeResults.value.filter(chunk => chunk.docId !== docId)
    showToast('ok', 'Document removed')
  }
  catch (error) {
    showToast('err', error instanceof Error ? error.message : String(error))
  }
}

async function runKnowledgeSearch() {
  const query = knowledgeQuery.value.trim()
  if (query.length === 0) {
    knowledgeResults.value = []
    return
  }

  searchingKnowledge.value = true
  knowledgeError.value = ''
  try {
    const payload: KnowledgeSearchRequest = {
      kbId: DEFAULT_KB_ID,
      query,
      topK: 5,
    }
    knowledgeResults.value = await sendRuntimeMessage<KnowledgeChunk[]>({
      type: 'knowledge/search',
      payload,
    })
  }
  catch (error) {
    knowledgeError.value = error instanceof Error ? error.message : String(error)
  }
  finally {
    searchingKnowledge.value = false
  }
}
</script>

<template>
  <div class="mx-auto max-w-3xl px-6 py-10">
    <header class="mb-8 flex items-start justify-between">
      <div>
        <div class="flex items-center gap-3">
          <div
            class="flex h-10 w-10 items-center justify-center rounded-lg bg-brand-600 font-bold text-white"
          >
            CC
          </div>
          <div>
            <h1 class="text-2xl font-bold tracking-tight">Copycat</h1>
            <p class="text-sm text-neutral-500">
              Your portable project memory for any AI chat.
            </p>
          </div>
        </div>
      </div>
      <label class="flex items-center gap-2 text-sm">
        <input
          v-model="settings.enabled"
          type="checkbox"
          class="h-4 w-4 rounded border-neutral-300 text-brand-600 focus:ring-brand-500"
        />
        <span>{{ settings.enabled ? 'Enabled' : 'Disabled' }}</span>
      </label>
    </header>

    <template v-if="loaded">
      <section v-if="loadError" class="card mb-6 border-rose-200 bg-rose-50">
        <h2 class="mb-2 text-base font-semibold text-rose-700">Settings load warning</h2>
        <p class="text-sm text-rose-700">
          {{ loadError }}
        </p>
      </section>

      <section class="card mb-6">
        <h2 class="mb-4 text-base font-semibold">Inference backend</h2>

        <div class="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div>
            <label class="label">Provider</label>
            <select v-model="settings.provider" class="input">
              <option v-for="id in PROVIDER_ORDER" :key="id" :value="id">
                {{ PROVIDER_PRESETS[id].name }}
              </option>
            </select>
            <p v-if="provider.docsUrl" class="mt-1 text-xs text-neutral-500">
              <a :href="provider.docsUrl" target="_blank" class="text-brand-600 hover:underline">
                Get an API key →
              </a>
            </p>
          </div>

          <div>
            <label class="label">Model</label>
            <input
              v-model="settings.model"
              class="input"
              placeholder="e.g. llama-3.1-8b-instant"
            />
          </div>

          <div class="md:col-span-2">
            <label class="label">Base URL</label>
            <input
              v-model="settings.baseUrl"
              class="input"
              placeholder="https://api.groq.com/openai/v1"
            />
            <p class="mt-1 text-xs text-neutral-500">
              Any OpenAI-compatible
              <code class="rounded bg-neutral-100 px-1">/chat/completions</code>
              endpoint works.
            </p>
          </div>

          <div class="md:col-span-2">
            <label class="label">API Key</label>
            <input
              v-model="settings.apiKey"
              type="password"
              class="input"
              :placeholder="provider.requiresKey ? 'Required' : 'Optional'"
              autocomplete="off"
            />
            <p class="mt-1 text-xs text-neutral-500">
              Stored locally in <code>chrome.storage.local</code>.
            </p>
          </div>
        </div>

        <div class="mt-4 flex items-center gap-3">
          <button class="btn-ghost" :disabled="testingConnection" @click="testConnection">
            {{ testingConnection ? 'Testing…' : 'Test connection' }}
          </button>
          <button class="btn-ghost" :disabled="fetchingModels" @click="fetchModels">
            {{ fetchingModels ? 'Fetching…' : 'Fetch models' }}
          </button>
          <p
            v-if="connectionResult"
            class="text-sm"
            :class="connectionResult.ok ? 'text-emerald-600' : 'text-rose-600'"
          >
            {{ connectionResult.message }}
          </p>
        </div>

        <div v-if="modelsError" class="mt-3 text-sm text-rose-600">
          {{ modelsError }}
        </div>
        <div v-if="discoveredModels.length" class="mt-4">
          <div class="mb-2 text-sm font-medium text-neutral-700">Host models</div>
          <div class="flex flex-wrap gap-2">
            <button
              v-for="item in discoveredModels"
              :key="item.id"
              class="rounded-full border border-neutral-200 px-3 py-1 text-xs hover:bg-neutral-50"
              @click="useDiscoveredModel(item.id)"
            >
              {{ item.id }}
            </button>
          </div>
        </div>
      </section>

      <section class="card mb-6">
        <h2 class="mb-4 text-base font-semibold">Completion behavior</h2>

        <div class="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div>
            <label class="label">Min prefix chars</label>
            <input
              v-model.number="settings.minPrefixChars"
              type="number"
              min="1"
              max="32"
              class="input"
            />
          </div>
          <div>
            <label class="label">Debounce (ms)</label>
            <input
              v-model.number="settings.debounceMs"
              type="number"
              min="0"
              max="5000"
              class="input"
            />
          </div>
          <div>
            <label class="label">Max tokens</label>
            <input
              v-model.number="settings.maxTokens"
              type="number"
              min="4"
              max="1024"
              class="input"
            />
          </div>
          <div>
            <label class="label">Temperature</label>
            <input
              v-model.number="settings.temperature"
              type="number"
              step="0.05"
              min="0"
              max="1.5"
              class="input"
            />
          </div>
        </div>

        <div class="mt-4">
          <div class="mb-1 flex items-center justify-between">
            <label class="label mb-0">System prompt</label>
            <button class="text-xs text-brand-600 hover:underline" @click="resetSystemPrompt">
              Reset to default
            </button>
          </div>
          <textarea
            v-model="settings.systemPrompt"
            rows="6"
            class="input h-auto py-2 font-mono text-xs leading-relaxed"
          />
        </div>
      </section>

      <section class="card mb-6">
        <h2 class="mb-2 text-base font-semibold">Enabled hosts</h2>
        <p class="mb-3 text-sm text-neutral-500">
          One hostname per line. Leave empty to enable Copycat on every site.
        </p>
        <textarea
          v-model="hostsText"
          rows="8"
          class="input h-auto py-2 font-mono text-xs"
          placeholder="chatgpt.com&#10;claude.ai&#10;gemini.google.com"
        />
      </section>

      <section class="card mb-6">
        <div class="mb-4 flex items-center justify-between gap-3">
          <div>
            <h2 class="text-base font-semibold">Knowledge base</h2>
            <p class="mt-1 text-sm text-neutral-500">
              Import Markdown files for local chunking, storage, and retrieval debugging.
            </p>
          </div>
          <label class="btn-ghost cursor-pointer">
            <input
              type="file"
              multiple
              accept=".md,.markdown,text/markdown"
              class="hidden"
              :disabled="importingKnowledge"
              @change="handleKnowledgeFiles"
            >
            {{ importingKnowledge ? 'Importing…' : 'Import Markdown' }}
          </label>
        </div>

        <div class="mb-4 flex flex-col gap-3 md:flex-row">
          <input
            v-model="knowledgeQuery"
            class="input"
            placeholder="Search imported knowledge…"
            @keydown.enter.prevent="runKnowledgeSearch"
          />
          <button class="btn-ghost shrink-0" :disabled="searchingKnowledge" @click="runKnowledgeSearch">
            {{ searchingKnowledge ? 'Searching…' : 'Search' }}
          </button>
        </div>

        <div v-if="knowledgeError" class="mb-3 text-sm text-rose-600">
          {{ knowledgeError }}
        </div>

        <div v-if="knowledgeResults.length" class="mb-4 rounded-xl border border-neutral-200 p-4">
          <div class="mb-2 text-sm font-medium text-neutral-700">Search results</div>
          <div class="space-y-3">
            <div
              v-for="chunk in knowledgeResults"
              :key="chunk.id"
              class="rounded-lg border border-neutral-100 bg-neutral-50 p-3"
            >
              <div class="mb-1 text-xs text-neutral-500">
                {{ chunk.metadata.sourceName }} · {{ chunk.metadata.tokenCount }} tokens
              </div>
              <p class="text-sm leading-relaxed text-neutral-800">
                {{ chunk.text }}
              </p>
            </div>
          </div>
        </div>

        <div>
          <div class="mb-2 text-sm font-medium text-neutral-700">
            Imported documents
          </div>
          <div v-if="knowledgeDocuments.length === 0" class="text-sm text-neutral-500">
            No Markdown documents imported yet.
          </div>
          <div v-else class="space-y-3">
            <div
              v-for="doc in knowledgeDocuments"
              :key="doc.id"
              class="flex flex-col gap-3 rounded-xl border border-neutral-200 p-4 md:flex-row md:items-center md:justify-between"
            >
              <div>
                <div class="font-medium text-neutral-900">
                  {{ doc.title }}
                </div>
                <div class="mt-1 text-xs text-neutral-500">
                  {{ doc.metadata.chunkCount }} chunks · {{ doc.metadata.charCount }} chars
                </div>
              </div>
              <button class="btn-ghost text-rose-600 hover:bg-rose-50" @click="removeKnowledgeDocument(doc.id)">
                Remove
              </button>
            </div>
          </div>
        </div>
      </section>

      <section class="card mb-6">
        <div class="mb-4 flex items-center justify-between gap-3">
          <div>
            <h2 class="text-base font-semibold">Local telemetry</h2>
            <p class="mt-1 text-sm text-neutral-500">
              Recent completion outcomes stored locally for the current site.
            </p>
          </div>
          <button class="btn-ghost" :disabled="loadingTelemetry" @click="reloadTelemetry">
            {{ loadingTelemetry ? 'Refreshing…' : 'Refresh' }}
          </button>
        </div>

        <p v-if="telemetryHost" class="mb-4 text-sm text-neutral-600">
          Current host:
          <code class="rounded bg-neutral-100 px-1 py-0.5">{{ telemetryHost }}</code>
        </p>
        <p v-else class="mb-4 text-sm text-neutral-500">
          No active browser tab host was detected.
        </p>

        <div v-if="telemetryError" class="mb-3 text-sm text-rose-600">
          {{ telemetryError }}
        </div>

        <template v-if="telemetryStats">
          <div class="mb-4 grid grid-cols-2 gap-3 md:grid-cols-3">
            <div class="rounded-lg border border-neutral-200 px-3 py-2">
              <div class="text-xs text-neutral-500">Total</div>
              <div class="mt-1 text-lg font-semibold">{{ telemetryStats.total }}</div>
            </div>
            <div class="rounded-lg border border-neutral-200 px-3 py-2">
              <div class="text-xs text-neutral-500">Accepted</div>
              <div class="mt-1 text-lg font-semibold text-emerald-600">{{ telemetryStats.accepted }}</div>
            </div>
            <div class="rounded-lg border border-neutral-200 px-3 py-2">
              <div class="text-xs text-neutral-500">Rejected</div>
              <div class="mt-1 text-lg font-semibold text-rose-600">{{ telemetryStats.rejected }}</div>
            </div>
            <div class="rounded-lg border border-neutral-200 px-3 py-2">
              <div class="text-xs text-neutral-500">Ignored</div>
              <div class="mt-1 text-lg font-semibold">{{ telemetryStats.ignored }}</div>
            </div>
            <div class="rounded-lg border border-neutral-200 px-3 py-2">
              <div class="text-xs text-neutral-500">Acceptance rate</div>
              <div class="mt-1 text-lg font-semibold">{{ Math.round(telemetryStats.acceptanceRate * 100) }}%</div>
            </div>
            <div class="rounded-lg border border-neutral-200 px-3 py-2">
              <div class="text-xs text-neutral-500">Avg latency</div>
              <div class="mt-1 text-lg font-semibold">{{ telemetryStats.averageLatencyMs }} ms</div>
            </div>
          </div>

          <div class="space-y-3">
            <div
              v-for="event in telemetryEvents"
              :key="event.id"
              class="rounded-lg border border-neutral-200 px-3 py-3"
            >
              <div class="mb-2 flex items-center justify-between gap-3">
                <span
                  class="rounded-full px-2 py-0.5 text-xs font-medium"
                  :class="{
                    'bg-emerald-50 text-emerald-700': event.action === 'accepted',
                    'bg-rose-50 text-rose-700': event.action === 'rejected',
                    'bg-neutral-100 text-neutral-700': event.action === 'ignored',
                  }"
                >
                  {{ event.action }}
                </span>
                <span class="text-xs text-neutral-500">{{ event.latencyMs }} ms</span>
              </div>

              <div class="space-y-2 text-sm">
                <div>
                  <div class="mb-1 text-xs text-neutral-500">Prefix</div>
                  <p class="whitespace-pre-wrap rounded bg-neutral-50 px-2 py-1 font-mono text-xs text-neutral-700">
                    {{ event.prefix }}
                  </p>
                </div>
                <div>
                  <div class="mb-1 text-xs text-neutral-500">Suggestion</div>
                  <p class="whitespace-pre-wrap rounded bg-neutral-50 px-2 py-1 font-mono text-xs text-neutral-700">
                    {{ event.suggestion }}
                  </p>
                </div>
              </div>
            </div>

            <p v-if="telemetryEvents.length === 0" class="text-sm text-neutral-500">
              No completion events recorded for this host yet.
            </p>
          </div>
        </template>
      </section>

      <div
        class="sticky bottom-4 flex items-center justify-between gap-3 rounded-xl border border-neutral-200 bg-white/90 p-4 shadow-lg backdrop-blur"
      >
        <button class="btn-ghost" @click="resetAll">Reset to defaults</button>
        <div class="flex items-center gap-3">
          <span
            v-if="toast"
            class="text-sm"
            :class="toast.kind === 'ok' ? 'text-emerald-600' : 'text-rose-600'"
          >
            {{ toast.text }}
          </span>
          <button class="btn-primary" :disabled="saving" @click="persist">
            {{ saving ? 'Saving…' : 'Save' }}
          </button>
        </div>
      </div>
    </template>

    <p v-else class="text-sm text-neutral-500">Loading…</p>
  </div>
</template>
