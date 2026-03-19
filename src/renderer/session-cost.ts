import { stripAnsi } from './ansi';

export interface CostInfo {
  totalCostUsd: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  totalDurationMs: number;
  totalApiDurationMs: number;
}

type CostChangeCallback = (sessionId: string, cost: CostInfo) => void;

const costs = new Map<string, CostInfo>();
const listeners: CostChangeCallback[] = [];

// Search for dollar cost patterns (fallback)
const COST_RE = /\$(\d+\.\d{2,})/g;

export function setCostData(sessionId: string, rawData: { cost: Record<string, unknown>; context_window: Record<string, unknown> }): void {
  const cost = rawData.cost as { total_cost_usd?: number; total_duration_ms?: number; total_api_duration_ms?: number };
  const ctx = rawData.context_window as {
    total_input_tokens?: number;
    total_output_tokens?: number;
    current_usage?: {
      cache_read_input_tokens?: number;
      cache_creation_input_tokens?: number;
    };
  };

  const info: CostInfo = {
    totalCostUsd: cost.total_cost_usd ?? 0,
    totalInputTokens: ctx.total_input_tokens ?? 0,
    totalOutputTokens: ctx.total_output_tokens ?? 0,
    cacheReadTokens: ctx.current_usage?.cache_read_input_tokens ?? 0,
    cacheCreationTokens: ctx.current_usage?.cache_creation_input_tokens ?? 0,
    totalDurationMs: cost.total_duration_ms ?? 0,
    totalApiDurationMs: cost.total_api_duration_ms ?? 0,
  };

  costs.set(sessionId, info);
  for (const cb of listeners) cb(sessionId, info);
}

/** Fallback: parse $X.XX from raw terminal output (older CLI without statusline) */
export function parseCost(sessionId: string, rawData: string): void {
  // Don't overwrite structured data with regex fallback
  if (costs.has(sessionId) && costs.get(sessionId)!.totalInputTokens > 0) return;

  const clean = stripAnsi(rawData);
  let match: RegExpExecArray | null;
  let lastCost: string | null = null;

  while ((match = COST_RE.exec(clean)) !== null) {
    lastCost = match[0];
  }

  if (lastCost) {
    const usd = parseFloat(lastCost.replace('$', ''));
    const existing = costs.get(sessionId);
    if (!existing || existing.totalCostUsd !== usd) {
      const info: CostInfo = {
        totalCostUsd: usd,
        totalInputTokens: 0,
        totalOutputTokens: 0,
        cacheReadTokens: 0,
        cacheCreationTokens: 0,
        totalDurationMs: 0,
        totalApiDurationMs: 0,
      };
      costs.set(sessionId, info);
      for (const cb of listeners) cb(sessionId, info);
    }
  }
}

export function getCost(sessionId: string): CostInfo | null {
  return costs.get(sessionId) ?? null;
}

export function getAggregateCost(): CostInfo {
  const aggregate: CostInfo = {
    totalCostUsd: 0,
    totalInputTokens: 0,
    totalOutputTokens: 0,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
    totalDurationMs: 0,
    totalApiDurationMs: 0,
  };
  for (const info of costs.values()) {
    aggregate.totalCostUsd += info.totalCostUsd;
    aggregate.totalInputTokens += info.totalInputTokens;
    aggregate.totalOutputTokens += info.totalOutputTokens;
    aggregate.cacheReadTokens += info.cacheReadTokens;
    aggregate.cacheCreationTokens += info.cacheCreationTokens;
    aggregate.totalDurationMs += info.totalDurationMs;
    aggregate.totalApiDurationMs += info.totalApiDurationMs;
  }
  return aggregate;
}

export function onChange(callback: CostChangeCallback): void {
  listeners.push(callback);
}

export function removeSession(sessionId: string): void {
  costs.delete(sessionId);
}

/** @internal Test-only: reset all module state */
export function _resetForTesting(): void {
  costs.clear();
  listeners.length = 0;
}
