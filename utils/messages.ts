import type { RuntimeMessage, RuntimeResponse } from '~/types';

export function sendRuntimeMessage<T = unknown>(message: RuntimeMessage): Promise<T> {
  return new Promise((resolve, reject) => {
    try {
      chrome.runtime.sendMessage(message, (response: RuntimeResponse<T> | undefined) => {
        const runtimeError = chrome.runtime.lastError;
        if (runtimeError) {
          reject(new Error(runtimeError.message));
          return;
        }
        if (!response) {
          resolve(undefined as T);
          return;
        }
        if (response.ok) {
          resolve(response.data as T);
          return;
        }
        reject(new Error(response.error?.error ?? 'Unknown error'));
      });
    } catch (error) {
      reject(error);
    }
  });
}
