export type ProviderId = 'groq' | 'openai' | 'deepseek' | 'ollama' | 'custom';

export interface ProviderPreset {
  id: ProviderId;
  name: string;
  baseUrl: string;
  defaultModel: string;
  requiresKey: boolean;
  docsUrl?: string;
}

export interface Settings {
  enabled: boolean;
  provider: ProviderId;
  baseUrl: string;
  apiKey: string;
  model: string;
  temperature: number;
  maxTokens: number;
  debounceMs: number;
  minPrefixChars: number;
  disableThinking: boolean;
  systemPrompt: string;
  enabledHosts: string[];
  disabledHosts: string[];
}

export interface CompletionRequest {
  id: string;
  prefix: string;
  suffix?: string;
  context?: string;
  signalKey?: string;
  debug?: boolean;
}

export interface CompletionDebugInfo {
  rawCompletion: string;
  sanitizedCompletion: string;
  rawChoice: string;
  cacheHit: boolean;
  disableThinkingRequested: boolean;
  thinkingControlsFallback: boolean;
  requestBody: {
    systemPrompt: string;
    userPrompt: string;
    reasoning?: {
      enabled: boolean;
    };
    thinking?: {
      type: string;
    };
  };
}

export interface CompletionResponse {
  id: string;
  completion: string;
  latencyMs: number;
  provider: ProviderId;
  model: string;
  debug?: CompletionDebugInfo;
}

export interface CompletionError {
  id: string;
  error: string;
  code?: string;
}

export interface RuntimeFailure {
  ok: false;
  error?: CompletionError | { error?: string };
}

export interface RuntimeSuccess<T> {
  ok: true;
  data?: T;
}

export type RuntimeResponse<T> = RuntimeSuccess<T> | RuntimeFailure;

export type RuntimeMessage =
  | { type: 'completion/request'; payload: CompletionRequest }
  | { type: 'completion/cancel'; payload: { id: string } }
  | { type: 'settings/get' }
  | { type: 'settings/set'; payload: Partial<Settings> };

export interface CompletionEvent {
  id: string;
  prefix: string;
  suggestion: string;
  action: 'accepted' | 'rejected' | 'ignored';
  latencyMs: number;
  timestamp: number;
  host: string;
}
