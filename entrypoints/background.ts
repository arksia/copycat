import { completeOnce } from '~/utils/llm';
import { loadSettings, saveSettings } from '~/utils/settings';
import type {
  CompletionRequest,
  CompletionResponse,
  CompletionError,
  RuntimeMessage,
} from '~/types';

export default defineBackground(() => {
  const inFlight = new Map<string, AbortController>();

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
    cancel(req.id);

    const settings = await loadSettings();
    if (!settings.enabled) {
      return emptyResponse(req.id, settings.provider, settings.model);
    }
    if (!settings.baseUrl) {
      throw new Error('Missing base URL. Please open the options page to configure Copycat.');
    }

    const controller = new AbortController();
    inFlight.set(req.id, controller);

    const start = performance.now();
    try {
      const completion = await completeOnce({
        prefix: req.prefix,
        suffix: req.suffix,
        context: req.context,
        settings,
        signal: controller.signal,
      });
      return {
        id: req.id,
        completion,
        latencyMs: Math.round(performance.now() - start),
        provider: settings.provider,
        model: settings.model,
      };
    } finally {
      inFlight.delete(req.id);
    }
  }

  function cancel(id: string) {
    const ctrl = inFlight.get(id);
    if (ctrl) {
      ctrl.abort();
      inFlight.delete(id);
    }
  }

  function emptyResponse(id: string, provider: any, model: string): CompletionResponse {
    return { id, completion: '', latencyMs: 0, provider, model };
  }
});
