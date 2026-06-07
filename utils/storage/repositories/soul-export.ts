import { openCopycatDb, requestToPromise, transactionToPromise } from '../client'
import { DB_STORES } from '../schema'

const SOUL_EXPORT_HANDLE_ID = 'default'

interface PersistedSoulExportHandleRecord {
  handle: FileSystemDirectoryHandle
  id: string
}

export async function putSoulExportDirectoryHandle(handle: FileSystemDirectoryHandle): Promise<void> {
  const db = await openCopycatDb()
  const transaction = db.transaction(DB_STORES.soulExportHandles, 'readwrite')
  transaction.objectStore(DB_STORES.soulExportHandles).put({
    handle,
    id: SOUL_EXPORT_HANDLE_ID,
  } satisfies PersistedSoulExportHandleRecord)
  await transactionToPromise(transaction)
}

export async function getSoulExportDirectoryHandle(): Promise<FileSystemDirectoryHandle | null> {
  const db = await openCopycatDb()
  const transaction = db.transaction(DB_STORES.soulExportHandles, 'readonly')
  const record = await requestToPromise(
    transaction.objectStore(DB_STORES.soulExportHandles).get(SOUL_EXPORT_HANDLE_ID),
  )
  await transactionToPromise(transaction)

  if (
    typeof record !== 'object'
    || record === null
    || !('handle' in record)
    || typeof record.handle !== 'object'
    || record.handle === null
  ) {
    return null
  }

  const handle = (record as PersistedSoulExportHandleRecord).handle
  return typeof handle.getFileHandle === 'function' ? handle : null
}

export async function clearSoulExportDirectoryHandle(): Promise<void> {
  const db = await openCopycatDb()
  const transaction = db.transaction(DB_STORES.soulExportHandles, 'readwrite')
  transaction.objectStore(DB_STORES.soulExportHandles).delete(SOUL_EXPORT_HANDLE_ID)
  await transactionToPromise(transaction)
}
