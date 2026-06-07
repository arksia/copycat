import type {
  SoulExportSyncResult,
  SoulLearningLogEntry,
} from '~/types'
import { getSoulExportDirectoryHandle } from '~/utils/storage/repositories/soul-export'

const SOUL_FILE_NAME = 'soul.md'
const SOUL_LOG_FILE_NAME = 'soul-log.jsonl'

export async function syncSoulMarkdownToConfiguredDirectory(
  soulText: string,
): Promise<SoulExportSyncResult> {
  return syncSoulExportFiles({
    soulText,
  })
}

export async function appendSoulLearningLogToConfiguredDirectory(
  entry: SoulLearningLogEntry,
): Promise<SoulExportSyncResult> {
  return syncSoulExportFiles({
    logEntry: entry,
  })
}

export async function syncSoulExportFiles(args: {
  logEntry?: SoulLearningLogEntry
  soulText?: string
}): Promise<SoulExportSyncResult> {
  const handle = await getSoulExportDirectoryHandle()
  if (handle === null) {
    return {
      exportDirectoryConfigured: false,
      permissionGranted: false,
      wroteLog: false,
      wroteSoul: false,
    }
  }

  const permissionGranted = await hasWritePermission(handle)
  if (!permissionGranted) {
    return {
      exportDirectoryConfigured: true,
      permissionGranted: false,
      wroteLog: false,
      wroteSoul: false,
    }
  }

  let wroteSoul = false
  let wroteLog = false

  if (args.soulText !== undefined) {
    await writeFile(handle, SOUL_FILE_NAME, formatSoulMarkdown(args.soulText))
    wroteSoul = true
  }

  if (args.logEntry !== undefined) {
    await appendFile(handle, SOUL_LOG_FILE_NAME, formatSoulLogLine(args.logEntry))
    wroteLog = true
  }

  return {
    exportDirectoryConfigured: true,
    permissionGranted: true,
    wroteLog,
    wroteSoul,
  }
}

export function formatSoulMarkdown(value: string): string {
  const trimmed = value.trim()
  return trimmed.length > 0 ? `${trimmed}\n` : ''
}

export function formatSoulLogLine(entry: SoulLearningLogEntry): string {
  return `${JSON.stringify(entry)}\n`
}

async function hasWritePermission(handle: FileSystemDirectoryHandle): Promise<boolean> {
  const permission = await (handle as FileSystemHandle).queryPermission({ mode: 'readwrite' })
  return permission === 'granted'
}

async function writeFile(
  handle: FileSystemDirectoryHandle,
  fileName: string,
  content: string,
): Promise<void> {
  const fileHandle = await handle.getFileHandle(fileName, { create: true })
  const writable = await fileHandle.createWritable()
  try {
    await writable.write(content)
  }
  finally {
    await writable.close()
  }
}

async function appendFile(
  handle: FileSystemDirectoryHandle,
  fileName: string,
  content: string,
): Promise<void> {
  const fileHandle = await handle.getFileHandle(fileName, { create: true })
  const existingSize = (await fileHandle.getFile()).size
  const writable = await fileHandle.createWritable({ keepExistingData: true })
  try {
    await writable.write({
      data: content,
      position: existingSize,
      type: 'write',
    })
  }
  finally {
    await writable.close()
  }
}
