<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { loadSettings, saveSettings, hostMatches } from '~/utils/settings';
import type { Settings } from '~/types';

const settings = ref<Settings | null>(null);
const currentHost = ref<string>('');
const hostEnabled = ref(true);

onMounted(async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  try {
    if (tab?.url) currentHost.value = new URL(tab.url).hostname;
  } catch {
    currentHost.value = '';
  }
  const s = await loadSettings();
  settings.value = s;
  hostEnabled.value =
    !!currentHost.value && s.enabledHosts.some((h: string) => hostMatches(tab?.url ?? '', h));
});

async function toggleGlobal() {
  if (!settings.value) return;
  const next = await saveSettings({ enabled: !settings.value.enabled });
  settings.value = next;
}

async function toggleCurrentHost() {
  if (!settings.value || !currentHost.value) return;
  const host = currentHost.value;
  const list = settings.value.enabledHosts.slice();
  const idx = list.indexOf(host);
  if (idx >= 0) list.splice(idx, 1);
  else list.push(host);
  const next = await saveSettings({ enabledHosts: list });
  settings.value = next;
  hostEnabled.value = list.includes(host);
}

function openOptions() {
  chrome.runtime.openOptionsPage();
}
</script>

<template>
  <div class="p-4">
    <div class="mb-3 flex items-center gap-2">
      <div
        class="flex h-8 w-8 items-center justify-center rounded-md bg-brand-600 text-sm font-bold text-white"
      >
        CC
      </div>
      <div>
        <div class="text-sm font-semibold">Copycat</div>
        <div class="text-xs text-neutral-500">Autocomplete for AI chats</div>
      </div>
    </div>

    <div v-if="settings" class="space-y-3">
      <label class="flex items-center justify-between rounded-md border border-neutral-200 px-3 py-2 text-sm">
        <span>Enable globally</span>
        <input
          v-model="settings.enabled"
          type="checkbox"
          class="h-4 w-4 rounded border-neutral-300 text-brand-600"
          @change="toggleGlobal"
        />
      </label>

      <label
        v-if="currentHost"
        class="flex items-center justify-between rounded-md border border-neutral-200 px-3 py-2 text-sm"
      >
        <span class="truncate">
          Enable on
          <span class="font-mono text-xs">{{ currentHost }}</span>
        </span>
        <input
          v-model="hostEnabled"
          type="checkbox"
          class="h-4 w-4 rounded border-neutral-300 text-brand-600"
          @change="toggleCurrentHost"
        />
      </label>

      <button class="btn-primary w-full" @click="openOptions">Open settings</button>

      <p v-if="!settings.apiKey && settings.provider !== 'ollama'" class="text-xs text-amber-600">
        No API key configured yet. Open settings to add one.
      </p>
    </div>
    <div v-else class="text-xs text-neutral-500">Loading…</div>
  </div>
</template>
