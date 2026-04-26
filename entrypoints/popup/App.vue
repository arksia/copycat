<script setup lang="ts">
import type { Settings } from '~/types'
import { onMounted, ref } from 'vue'
import { openSettingsPage } from '~/utils/open-settings'
import { isHostEnabled, loadSettings, saveSettings } from '~/utils/settings'

const settings = ref<Settings | null>(null)
const currentHost = ref<string>('')
const currentUrl = ref('')
const hostEnabled = ref(true)

onMounted(async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
  try {
    currentUrl.value = tab?.url ?? ''
    if (tab?.url)
      currentHost.value = new URL(tab.url).hostname
  }
  catch {
    currentUrl.value = ''
    currentHost.value = ''
  }
  const stored = await loadSettings()
  settings.value = stored
  hostEnabled.value = !!currentHost.value && isHostEnabled(stored, currentUrl.value)
})

async function toggleGlobal() {
  if (!settings.value)
    return
  settings.value = await saveSettings({ enabled: !settings.value.enabled })
}

async function toggleCurrentHost() {
  if (!settings.value || !currentHost.value)
    return
  const host = currentHost.value
  const enabledHosts = settings.value.enabledHosts.slice()
  const disabledHosts = settings.value.disabledHosts.filter(item => item !== host)

  if (hostEnabled.value) {
    if (
      enabledHosts.length > 0
      && !enabledHosts.some(item => item === host || host.endsWith(`.${item}`))
    ) {
      enabledHosts.push(host)
    }
  }
  else {
    if (!disabledHosts.includes(host)) {
      disabledHosts.push(host)
    }
  }

  settings.value = await saveSettings({ enabledHosts, disabledHosts })
  hostEnabled.value = isHostEnabled(settings.value, currentUrl.value || `https://${host}`)
}

function openOptions() {
  void openSettingsPage()
}

async function openPlayground() {
  await chrome.tabs.create({ url: chrome.runtime.getURL('playground.html') })
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
      <button class="btn-ghost w-full" @click="openPlayground">Open playground</button>

      <p v-if="!settings.apiKey && settings.provider !== 'ollama'" class="text-xs text-amber-600">
        No API key configured yet. Open settings to add one.
      </p>
    </div>
    <div v-else class="text-xs text-neutral-500">Loading…</div>
  </div>
</template>
