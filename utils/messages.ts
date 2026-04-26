import type { RuntimeMessage, RuntimeResponse } from '~/types'

/**
 * Sends a typed runtime message to the background script and unwraps the response payload.
 *
 * Use when:
 * - popup, options, playground, or content code needs background-side work
 * - callers want the success payload instead of the raw runtime envelope
 *
 * Expects:
 * - `message` to match one of the shared runtime contracts
 *
 * Returns:
 * - the typed success payload, or rejects with a user-readable error
 */
export async function sendRuntimeMessage<T = unknown>(message: RuntimeMessage): Promise<T> {
  return new Promise((resolve, reject) => {
    try {
      chrome.runtime.sendMessage(message, (response: RuntimeResponse<T> | undefined) => {
        const runtimeError = chrome.runtime.lastError
        if (runtimeError) {
          reject(new Error(runtimeError.message))
          return
        }
        if (!response) {
          resolve(undefined as T)
          return
        }
        if (response.ok) {
          resolve(response.data as T)
          return
        }
        reject(new Error(response.error?.error ?? 'Unknown error'))
      })
    }
    catch (error) {
      reject(error)
    }
  })
}
