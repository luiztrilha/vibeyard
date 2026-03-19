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
  }
): void {
  const totalTokens = (contextWindow.total_input_tokens ?? 0) + (contextWindow.total_output_tokens ?? 0);
  const contextWindowSize = contextWindow.context_window_tokens ?? DEFAULT_CONTEXT_WINDOW;
  const usedPercentage = contextWindowSize > 0 ? (totalTokens / contextWindowSize) * 100 : 0;

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
