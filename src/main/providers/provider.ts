import type { CliProviderMeta, ClaudeConfig } from '../../shared/types';

export interface CliProvider {
  readonly meta: CliProviderMeta;
  resolveBinaryPath(): string;
  validatePrerequisites(): { ok: boolean; message: string };
  buildEnv(sessionId: string, baseEnv: Record<string, string>): Record<string, string>;
  buildArgs(opts: { cliSessionId: string | null; isResume: boolean; extraArgs: string }): string[];
  installHooks(): void;
  installStatusScripts(): void;
  cleanup(): void;
  getConfig(projectPath: string): Promise<ClaudeConfig | null>;
  getShiftEnterSequence(): string | null;
  parseCostFromOutput?(rawText: string): { totalCostUsd: number } | null;
}
