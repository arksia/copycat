import {
  CompletionMemoryCache,
  buildCompletionCacheKey,
} from '~/utils/completion-cache';
import { completeOnce, completeOnceDetailed } from '~/utils/llm';
import { loadSettings, saveSettings } from '~/utils/settings';
import type {
  CompletionRequest,
  CompletionResponse,
  CompletionError,
  RuntimeMessage,
} from '~/types';

export default defineBackground(() => {
  const inFlight = new Map<string, AbortController>();
  const requestSignalKeys = new Map<string, string>();
  const completionCache = new CompletionMemoryCache();

  chrome.runtime.onInstalled.addListener((details) => {
    if (details.reason === 'install') {
      chrome.runtime.openOptionsPage?.();
    }
  });

  chrome.runtime.onMessage.addListener((message: RuntimeMessage, _sender, sendResponse) => {
    if (!message || typeof message !== 'object' || !('type' in message)) return false;

    switch (message.type) {
      case 'completion/request':
        handleCompletion(message.payload)
          .then((res) => sendResponse({ ok: true, data: res }))
          .catch((err: unknown) => {
            const payload: CompletionError = {
              id: message.payload.id,
              error: err instanceof Error ? err.message : String(err),
            };
            sendResponse({ ok: false, error: payload });
          });
        return true;

      case 'completion/cancel':
        cancel(message.payload.id);
        sendResponse({ ok: true });
        return false;

      case 'settings/get':
        loadSettings().then((s) => sendResponse({ ok: true, data: s }));
        return true;

      case 'settings/set':
        saveSettings(message.payload).then((s) => sendResponse({ ok: true, data: s }));
        return true;
    }
    return false;
  });

  async function handleCompletion(req: CompletionRequest): Promise<CompletionResponse> {
    if (req.signalKey) {
      cancelBySignalKey(req.signalKey);
    } else {
      cancel(req.id);
    }

    const settings = await loadSettings();
    if (!settings.enabled) {
      return emptyResponse(req.id, settings.provider, settings.model);
    }
    if (!settings.baseUrl) {
      throw new Error('Missing base URL. Please open the options page to configure Copycat.');
    }

    const cacheKey = buildCompletionCacheKey({
      provider: settings.provider,
      model: settings.model,
      prefix: req.prefix,
      suffix: req.suffix,
      context: req.context,
    });
    const cached = completionCache.get(cacheKey);
    if (cached !== null && !req.debug) {
      return {
        id: req.id,
        completion: cached,
        latencyMs: 0,
        provider: settings.provider,
        model: settings.model,
      };
    }

    const controller = new AbortController();
    inFlight.set(req.id, controller);
    if (req.signalKey) {
      requestSignalKeys.set(req.signalKey, req.id);
    }

    const start = performance.now();
    try {
      const detailed = req.debug
        ? await completeOnceDetailed({
            prefix: req.prefix,
            suffix: req.suffix,
            context: req.context,
            settings,
            signal: controller.signal,
          })
        : {
            completion: await completeOnce({
              prefix: req.prefix,
              suffix: req.suffix,
              context: req.context,
              settings,
              signal: controller.signal,
            }),
            debug: undefined,
          };
      const completion = detailed.completion;
      if (completion) {
        completionCache.set(cacheKey, completion);
      }
      return {
        id: req.id,
        completion,
        latencyMs: Math.round(performance.now() - start),
        provider: settings.provider,
        model: settings.model,
        debug: detailed.debug,
      };
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        return emptyResponse(req.id, settings.provider, settings.model);
      }
      throw error;
    } finally {
      clearRequest(req.id, req.signalKey);
    }
  }

  function cancel(id: string) {
    const ctrl = inFlight.get(id);
    if (ctrl) {
      ctrl.abort();
    }
    clearRequest(id);
  }

  function cancelBySignalKey(signalKey: string) {
    const requestId = requestSignalKeys.get(signalKey);
    if (!requestId) return;
    cancel(requestId);
  }

  function clearRequest(id: string, signalKey?: string) {
    inFlight.delete(id);
    if (signalKey) {
      const activeId = requestSignalKeys.get(signalKey);
      if (activeId === id) {
        requestSignalKeys.delete(signalKey);
      }
      return;
    }
    for (const [key, value] of requestSignalKeys.entries()) {
      if (value === id) {
        requestSignalKeys.delete(key);
      }
    }
  }

  function emptyResponse(id: string, provider: any, model: string): CompletionResponse {
    return { id, completion: '', latencyMs: 0, provider, model };
  }
});
