import type {
  CompletionEvent,
  Settings,
  SoulExportSyncResult,
  SoulLearningLogEntry,
} from '~/types'
import {
  appendSoulLearningLogToConfiguredDirectory,
  syncSoulMarkdownToConfiguredDirectory,
} from './export'
import {
  runSoulLearning,
  shouldRunSoulLearning,
  summarizeSoulLearningEvents,
} from './learning'

const DEFAULT_SOUL_LEARNING_IDLE_DELAY_MINUTES = 3
const DEFAULT_SOUL_LEARNING_COOLDOWN_MS = 30 * 60 * 1000
const DEFAULT_SOUL_LEARNING_WINDOW_SIZE = 24

export interface SoulRuntime {
  alarmName: string
  handleCompletionEventPersisted: () => Promise<void>
  handleLearningAlarm: () => Promise<void>
  syncExportedSoul: () => Promise<SoulExportSyncResult>
  syncExportedSoulText: (settings: Settings) => Promise<void>
}

export interface SoulRuntimeDeps {
  appendLearningLog?: (entry: SoulLearningLogEntry) => Promise<SoulExportSyncResult>
  createAlarm: (name: string, options: { delayInMinutes: number }) => Promise<void>
  listRecentCompletionEvents: (limit: number) => Promise<CompletionEvent[]>
  loadSettings: () => Promise<Settings>
  now?: () => number
  runLearning?: typeof runSoulLearning
  saveSoulText: (text: string) => Promise<Settings>
  syncSoulText?: (soulText: string) => Promise<SoulExportSyncResult>
}

export interface SoulRuntimeOptions {
  alarmName?: string
  learningCooldownMs?: number
  learningIdleDelayMinutes?: number
  learningWindowSize?: number
}

export function createSoulRuntime(
  deps: SoulRuntimeDeps,
  options: SoulRuntimeOptions = {},
): SoulRuntime {
  const alarmName = options.alarmName ?? 'copycat:soul-learning'
  const learningIdleDelayMinutes = options.learningIdleDelayMinutes ?? DEFAULT_SOUL_LEARNING_IDLE_DELAY_MINUTES
  const learningCooldownMs = options.learningCooldownMs ?? DEFAULT_SOUL_LEARNING_COOLDOWN_MS
  const learningWindowSize = options.learningWindowSize ?? DEFAULT_SOUL_LEARNING_WINDOW_SIZE
  const now = optionsNow(deps)
  const runLearning = deps.runLearning ?? runSoulLearning
  const appendLearningLog = deps.appendLearningLog ?? appendSoulLearningLogToConfiguredDirectory
  const syncSoulText = deps.syncSoulText ?? syncSoulMarkdownToConfiguredDirectory
  let lastLearningRunAt = 0
  let runningLearning: Promise<void> | null = null

  async function handleCompletionEventPersisted(): Promise<void> {
    const settings = await deps.loadSettings()
    if (!canRunSoulLearning(settings)) {
      return
    }

    await deps.createAlarm(alarmName, {
      delayInMinutes: learningIdleDelayMinutes,
    })
  }

  async function handleLearningAlarm(): Promise<void> {
    if (runningLearning !== null) {
      return
    }

    const settings = await deps.loadSettings()
    if (!canRunSoulLearning(settings)) {
      return
    }

    const events = await deps.listRecentCompletionEvents(learningWindowSize)
    const startedAt = now()
    const previousRunAt = lastLearningRunAt
    if (!shouldRunSoulLearning({
      cooldownMs: learningCooldownMs,
      events,
      lastRunAt: previousRunAt,
      now: startedAt,
    })) {
      return
    }

    const sampleSummary = summarizeSoulLearningEvents(events)
    const freshEventCount = events.filter(event => event.timestamp > previousRunAt).length
    lastLearningRunAt = startedAt
    runningLearning = runLearning({
      currentSoulText: settings.soul.text,
      events,
      settings,
    })
      .then(async (result) => {
        if (result === null) {
          return
        }

        if (result.shouldUpdate === true) {
          await deps.saveSoulText(result.nextSoulText)
        }

        await appendLearningLog({
          acceptedCount: sampleSummary.acceptedCount,
          droppedCounts: sampleSummary.droppedCounts,
          freshEventCount,
          reason: result.reason,
          rejectedCount: sampleSummary.rejectedCount,
          selectedEventCount: sampleSummary.selectedEventCount,
          timestamp: new Date(startedAt).toISOString(),
          trigger: 'accepted_rejected_threshold',
          updated: result.shouldUpdate,
        })
      })
      .catch((error: unknown) => {
        console.warn('[copycat] failed to run Soul learning', error)
      })
      .finally(() => {
        runningLearning = null
      })

    await runningLearning
  }

  async function syncExportedSoul(): Promise<SoulExportSyncResult> {
    const settings = await deps.loadSettings()
    return syncSoulText(settings.soul.text)
  }

  async function syncExportedSoulText(settings: Settings): Promise<void> {
    await syncSoulText(settings.soul.text)
  }

  return {
    alarmName,
    handleCompletionEventPersisted,
    handleLearningAlarm,
    syncExportedSoul,
    syncExportedSoulText,
  }
}

function canRunSoulLearning(settings: Settings): boolean {
  return settings.soul.learningEnabled && settings.baseUrl.length > 0 && settings.model.length > 0
}

function optionsNow(deps: SoulRuntimeDeps): () => number {
  return deps.now ?? Date.now
}
