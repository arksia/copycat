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
}

export interface CompletionResponse {
  id: string;
  completion: string;
  latencyMs: number;
  provider: ProviderId;
  model: string;
}

export interface CompletionError {
  id: string;
  error: string;
  code?: string;
}

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
