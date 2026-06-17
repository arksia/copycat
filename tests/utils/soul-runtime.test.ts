import type {
  CompletionEvent,
  Settings,
  SoulExportSyncResult,
  SoulLearningLogEntry,
} from '~/types'
import { describe, expect, it } from 'vitest'
import { createSoulRuntime } from '~/soul'
import { buildDefaultSettings } from '~/utils/settings'

function buildSettings(overrides: Partial<Settings> = {}): Settings {
  const defaults = buildDefaultSettings()
  return {
    ...defaults,
    baseUrl: 'https://example.com/v1',
    model: 'test-model',
    soul: {
      ...defaults.soul,
      enabled: true,
      learningEnabled: true,
      text: '保持直接',
      ...overrides.soul,
    },
    ...overrides,
  }
}

function buildEvent(index: number): CompletionEvent {
  return {
    id: `evt-${index}`,
    action: index % 3 === 0 ? 'rejected' : 'accepted',
    actualContinuation: index % 3 === 0 ? '直接列步骤' : '先给结论',
    host: 'chatgpt.com',
    latencyMs: 100,
    prefix: `帮我写方案 ${index}`,
    suggestion: index % 3 === 0 ? '先铺背景' : '先给结论',
    timestamp: 100 + index,
  }
}

function buildSyncResult(overrides: Partial<SoulExportSyncResult> = {}): SoulExportSyncResult {
  return {
    exportDirectoryConfigured: true,
    permissionGranted: true,
    wroteLog: false,
    wroteSoul: false,
    ...overrides,
  }
}

describe('createSoulRuntime', () => {
  it('schedules learning after a persisted completion event when learning is configured', async () => {
    const alarms: Array<{ delayInMinutes: number, name: string }> = []
    const runtime = createSoulRuntime({
      createAlarm: async (name, options) => {
        alarms.push({ name, delayInMinutes: options.delayInMinutes })
      },
      listRecentCompletionEvents: async () => [],
      loadSettings: async () => buildSettings(),
      saveSoulText: async () => buildSettings(),
      syncSoulText: async () => buildSyncResult(),
    })

    await runtime.handleCompletionEventPersisted()

    expect(alarms).toEqual([{
      name: 'copycat:soul-learning',
      delayInMinutes: 3,
    }])
  })

  it('does not schedule learning when the user fixed Soul text by disabling learning', async () => {
    const alarms: string[] = []
    const runtime = createSoulRuntime({
      createAlarm: async (name) => {
        alarms.push(name)
      },
      listRecentCompletionEvents: async () => [],
      loadSettings: async () => buildSettings({
        soul: {
          ...buildDefaultSettings().soul,
          learningEnabled: false,
        },
      }),
      saveSoulText: async () => buildSettings(),
      syncSoulText: async () => buildSyncResult(),
    })

    await runtime.handleCompletionEventPersisted()

    expect(alarms).toEqual([])
  })

  it('runs learning from recent events and saves only the next Soul text', async () => {
    const savedSoulTexts: string[] = []
    const logEntries: SoulLearningLogEntry[] = []
    const events = Array.from({ length: 12 }, (_, index) => buildEvent(index + 1))
    const runtime = createSoulRuntime({
      appendLearningLog: async (entry) => {
        logEntries.push(entry)
        return buildSyncResult({ wroteLog: true })
      },
      createAlarm: async () => {},
      listRecentCompletionEvents: async limit => events.slice(0, limit),
      loadSettings: async () => buildSettings({
        soul: {
          ...buildDefaultSettings().soul,
          learningEnabled: true,
          text: '保持直接',
        },
      }),
      now: () => 1_000_000,
      runLearning: async args => ({
        nextSoulText: `${args.currentSoulText}\n先给结论`,
        reason: 'accepted completions repeatedly start with the conclusion',
        shouldUpdate: true,
      }),
      saveSoulText: async (text) => {
        savedSoulTexts.push(text)
        return buildSettings({
          soul: {
            ...buildDefaultSettings().soul,
            text,
          },
        })
      },
      syncSoulText: async () => buildSyncResult(),
    }, {
      learningCooldownMs: 0,
    })

    await runtime.handleLearningAlarm()

    expect(savedSoulTexts).toEqual(['保持直接\n先给结论'])
    expect(logEntries).toHaveLength(1)
    expect(logEntries[0]).toMatchObject({
      freshEventCount: 12,
      reason: 'accepted completions repeatedly start with the conclusion',
      selectedEventCount: 12,
      trigger: 'accepted_rejected_threshold',
      updated: true,
    })
  })

  it('syncs exported Soul from the current settings source of truth', async () => {
    const syncedSoulTexts: string[] = []
    const runtime = createSoulRuntime({
      createAlarm: async () => {},
      listRecentCompletionEvents: async () => [],
      loadSettings: async () => buildSettings({
        soul: {
          ...buildDefaultSettings().soul,
          text: '固定 Soul 文本',
        },
      }),
      saveSoulText: async () => buildSettings(),
      syncSoulText: async (soulText) => {
        syncedSoulTexts.push(soulText)
        return buildSyncResult({ wroteSoul: true })
      },
    })

    const result = await runtime.syncExportedSoul()

    expect(syncedSoulTexts).toEqual(['固定 Soul 文本'])
    expect(result.wroteSoul).toBe(true)
  })
})
