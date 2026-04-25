<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { buildModelsUrl, parseModelListResponse, type DiscoveredModel } from '~/utils/model-discovery';
import {
  buildOpenAICompatibleHeaders,
  extractAssistantMessageContent,
  joinOpenAICompatibleUrl,
} from '~/utils/openai-compatible';
import { DEFAULT_SETTINGS, DEFAULT_SYSTEM_PROMPT, loadSettings, saveSettings } from '~/utils/settings';
import { PROVIDER_ORDER, PROVIDER_PRESETS, resolveProviderPreset } from '~/utils/providers';
import type { ProviderId, Settings } from '~/types';

const settings = ref<Settings>({ ...DEFAULT_SETTINGS });
const loaded = ref(false);
const saving = ref(false);
const toast = ref<{ kind: 'ok' | 'err'; text: string } | null>(null);
const testingConnection = ref(false);
const connectionResult = ref<{ ok: boolean; message: string } | null>(null);
const fetchingModels = ref(false);
const modelsError = ref('');
const discoveredModels = ref<DiscoveredModel[]>([]);
const loadError = ref('');

const hostsText = ref('');

const provider = computed(
  () => resolveProviderPreset(settings.value.provider),
);

onMounted(async () => {
  try {
    const s = await loadSettings();
    settings.value = s;
    hostsText.value = s.enabledHosts.join('\n');
  } catch (e) {
    loadError.value =
      e instanceof Error ? e.message : 'Failed to load settings. Defaults are shown instead.';
    settings.value = { ...DEFAULT_SETTINGS };
    hostsText.value = DEFAULT_SETTINGS.enabledHosts.join('\n');
  } finally {
    loaded.value = true;
  }
});

watch(
  () => settings.value.provider,
  (id: ProviderId, prev) => {
    if (!loaded.value || id === prev) return;
    const preset = resolveProviderPreset(id);
    if (preset.baseUrl) settings.value.baseUrl = preset.baseUrl;
    if (preset.defaultModel) settings.value.model = preset.defaultModel;
  },
);

async function persist() {
  saving.value = true;
  try {
    settings.value.enabledHosts = hostsText.value
      .split(/\r?\n/)
      .map((s: string) => s.trim())
      .filter(Boolean);
    const next = await saveSettings(settings.value);
    settings.value = next;
    hostsText.value = next.enabledHosts.join('\n');
    showToast('ok', 'Settings saved');
  } catch (e) {
    showToast('err', e instanceof Error ? e.message : String(e));
  } finally {
    saving.value = false;
  }
}

function resetSystemPrompt() {
  settings.value.systemPrompt = DEFAULT_SYSTEM_PROMPT;
}

function resetAll() {
  if (!confirm('Reset all settings to defaults? Your API key will be cleared.')) return;
  settings.value = { ...DEFAULT_SETTINGS };
  hostsText.value = DEFAULT_SETTINGS.enabledHosts.join('\n');
}

async function testConnection() {
  testingConnection.value = true;
  connectionResult.value = null;
  try {
    const url = joinOpenAICompatibleUrl(settings.value.baseUrl, '/chat/completions');
    const headers = buildOpenAICompatibleHeaders(settings.value.apiKey);
    const res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: settings.value.model,
        messages: [
          { role: 'system', content: 'You are a connectivity test.' },
          { role: 'user', content: 'Say "ok".' },
        ],
        max_tokens: 4,
        temperature: 0,
      }),
    });
    if (!res.ok) {
      const text = await res.text();
      connectionResult.value = {
        ok: false,
        message: `HTTP ${res.status}: ${text.slice(0, 180)}`,
      };
      return;
    }
    const data = await res.json();
    const reply = extractAssistantMessageContent(data) || '(empty)';
    connectionResult.value = { ok: true, message: `Connected — reply: ${reply}` };
  } catch (e) {
    connectionResult.value = {
      ok: false,
      message: e instanceof Error ? e.message : String(e),
    };
  } finally {
    testingConnection.value = false;
  }
}

async function fetchModels() {
  fetchingModels.value = true;
  modelsError.value = '';
  discoveredModels.value = [];

  try {
    const url = buildModelsUrl(settings.value.baseUrl);
    const headers = buildOpenAICompatibleHeaders(settings.value.apiKey);
    const res = await fetch(url, {
      method: 'GET',
      headers,
    });
    if (!res.ok) {
      const text = await res.text();
      modelsError.value = `HTTP ${res.status}: ${text.slice(0, 180)}`;
      return;
    }

    const data = await res.json();
    const models = parseModelListResponse(data);
    if (models.length === 0) {
      modelsError.value = 'No models were returned by this host.';
      return;
    }
    discoveredModels.value = models;
  } catch (e) {
    modelsError.value = e instanceof Error ? e.message : String(e);
  } finally {
    fetchingModels.value = false;
  }
}

function useDiscoveredModel(modelId: string) {
  settings.value.model = modelId;
}

function showToast(kind: 'ok' | 'err', text: string) {
  toast.value = { kind, text };
  setTimeout(() => {
    toast.value = null;
  }, 2400);
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
            <input v-model="settings.model" class="input" placeholder="e.g. llama-3.1-8b-instant" />
          </div>

          <div class="md:col-span-2">
            <label class="label">Base URL</label>
            <input v-model="settings.baseUrl" class="input" placeholder="https://api.groq.com/openai/v1" />
            <p class="mt-1 text-xs text-neutral-500">
              Any OpenAI-compatible <code class="rounded bg-neutral-100 px-1">/chat/completions</code>
              endpoint works — Groq, OpenAI, DeepSeek, Ollama, LM Studio, etc.
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
              Stored locally in <code>chrome.storage.local</code>. Never sent anywhere except the endpoint above.
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

        <div class="mt-4 rounded-lg border border-neutral-200 bg-neutral-50 p-4">
          <div class="mb-2 flex items-center justify-between">
            <h3 class="text-sm font-semibold text-neutral-800">Available models</h3>
            <span class="text-xs text-neutral-500">Uses the current base URL and API key</span>
          </div>

          <p v-if="modelsError" class="text-sm text-rose-600">
            {{ modelsError }}
          </p>

          <p v-else-if="fetchingModels" class="text-sm text-neutral-500">
            Fetching model list…
          </p>

          <p v-else-if="discoveredModels.length === 0" class="text-sm text-neutral-500">
            Click <span class="font-medium">Fetch models</span> to inspect the current host.
          </p>

          <ul v-else class="space-y-2">
            <li
              v-for="model in discoveredModels"
              :key="model.id"
              class="flex items-center justify-between gap-3 rounded-md border border-neutral-200 bg-white px-3 py-2"
            >
              <div class="min-w-0">
                <div class="truncate font-mono text-sm text-neutral-800">{{ model.id }}</div>
                <div v-if="model.ownedBy" class="text-xs text-neutral-500">
                  owned by {{ model.ownedBy }}
                </div>
              </div>
              <button class="btn-ghost shrink-0" @click="useDiscoveredModel(model.id)">Use</button>
            </li>
          </ul>
        </div>
      </section>

      <section class="card mb-6">
        <h2 class="mb-4 text-base font-semibold">Completion behavior</h2>

        <div class="grid grid-cols-1 gap-4 md:grid-cols-3">
          <div>
            <label class="label">Debounce (ms)</label>
            <input
              v-model.number="settings.debounceMs"
              type="number"
              min="50"
              max="2000"
              class="input"
            />
          </div>
          <div>
            <label class="label">Min prefix chars</label>
            <input
              v-model.number="settings.minPrefixChars"
              type="number"
              min="1"
              max="40"
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
          <label class="flex items-center gap-3 rounded-md border border-neutral-200 px-3 py-2 text-sm md:col-span-2">
            <input
              v-model="settings.disableThinking"
              type="checkbox"
              class="h-4 w-4 rounded border-neutral-300 text-brand-600"
            />
            <span>Disable thinking when supported</span>
          </label>
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

      <div class="sticky bottom-4 flex items-center justify-between gap-3 rounded-xl border border-neutral-200 bg-white/90 p-4 shadow-lg backdrop-blur">
        <button class="btn-ghost" @click="resetAll">Reset to defaults</button>
        <div class="flex items-center gap-3">
          <span v-if="toast" class="text-sm" :class="toast.kind === 'ok' ? 'text-emerald-600' : 'text-rose-600'">
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
