export interface ContextWindowInfo {
  totalTokens: number;
  contextWindowSize: number;
  usedPercentage: number;
}

type ContextChangeCallback = (sessionId: string, info: ContextWindowInfo) => void;

const contexts = new Map<string, ContextWindowInfo>();
const listeners: ContextChangeCallback[] = [];

const DEFAULT_CONTEXT_WINDOW = 200_000;

export function setContextData(
  sessionId: string,
  contextWindow: {
    total_input_tokens?: number;
    total_output_tokens?: number;
    context_window_tokens?: number;
    context_window_size?: number;
    used_percentage?: number;
    current_usage?: {
      input_tokens?: number;
      output_tokens?: number;
      cache_creation_input_tokens?: number;
      cache_read_input_tokens?: number;
    };
  } | undefined
): void {
  if (!contextWindow) return;

  const usage = contextWindow.current_usage;
  // Prefer current_usage breakdown (input + cache tokens), fall back to top-level totals
  const totalTokens = usage
    ? (usage.input_tokens ?? 0) + (usage.cache_creation_input_tokens ?? 0) + (usage.cache_read_input_tokens ?? 0)
    : (contextWindow.total_input_tokens ?? 0) + (contextWindow.total_output_tokens ?? 0);
  const contextWindowSize = contextWindow.context_window_size ?? contextWindow.context_window_tokens ?? DEFAULT_CONTEXT_WINDOW;
  const usedPercentage = contextWindow.used_percentage ?? (contextWindowSize > 0 ? (totalTokens / contextWindowSize) * 100 : 0);

  const info: ContextWindowInfo = { totalTokens, contextWindowSize, usedPercentage };
  contexts.set(sessionId, info);
  for (const cb of listeners) cb(sessionId, info);
}

export function getContext(sessionId: string): ContextWindowInfo | null {
  return contexts.get(sessionId) ?? null;
}

export function onChange(callback: ContextChangeCallback): void {
  listeners.push(callback);
}

export function removeSession(sessionId: string): void {
  contexts.delete(sessionId);
}

/** @internal Test-only: reset all module state */
export function _resetForTesting(): void {
  contexts.clear();
  listeners.length = 0;
}
