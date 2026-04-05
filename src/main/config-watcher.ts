import * as fs from 'fs';
import * as os from 'os';
import type { BrowserWindow } from 'electron';
import type { ProviderId } from '../shared/types';
import { joinPath } from './fs-utils';

const DEBOUNCE_MS = 500;

let debounceTimer: ReturnType<typeof setTimeout> | null = null;
let watchedFiles: string[] = [];
let dirWatchers: fs.FSWatcher[] = [];
let currentProjectPath: string | null = null;
let currentWin: BrowserWindow | null = null;
let currentProviderId: ProviderId | null = null;

function notify(): void {
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    if (currentWin && !currentWin.isDestroyed()) {
      currentWin.webContents.send('config:changed');
    }
  }, DEBOUNCE_MS);
}

function watchFile(filePath: string): void {
  fs.watchFile(filePath, { interval: 2000 }, () => notify());
  watchedFiles.push(filePath);
}

function watchDir(dirPath: string): void {
  try {
    const watcher = fs.watch(dirPath, { recursive: true }, () => notify());
    watcher.on('error', () => {}); // ignore errors (dir deleted, etc.)
    dirWatchers.push(watcher);
  } catch {
    // Directory doesn't exist — that's fine
  }
}

function stopAll(): void {
  if (debounceTimer) {
    clearTimeout(debounceTimer);
    debounceTimer = null;
  }
  for (const f of watchedFiles) fs.unwatchFile(f);
  watchedFiles = [];
  for (const w of dirWatchers) w.close();
  dirWatchers = [];
}

function setupClaudeWatchers(projectPath: string): void {
  const home = os.homedir();
  const claudeDir = joinPath(home, '.claude');

  // Config files
  const files = [
    joinPath(home, '.claude.json'),
    joinPath(claudeDir, 'settings.json'),
    joinPath(home, '.mcp.json'),
    joinPath(projectPath, '.claude', 'settings.json'),
    joinPath(projectPath, '.mcp.json'),
  ];
  for (const f of files) watchFile(f);

  // Directories for agents/skills/commands
  const dirs = [
    joinPath(claudeDir, 'agents'),
    joinPath(claudeDir, 'skills'),
    joinPath(claudeDir, 'commands'),
    joinPath(projectPath, '.claude', 'agents'),
    joinPath(projectPath, '.claude', 'skills'),
    joinPath(projectPath, '.claude', 'commands'),
  ];
  for (const d of dirs) watchDir(d);
}

function setupCodexWatchers(projectPath: string): void {
  const home = os.homedir();
  const codexDir = joinPath(home, '.codex');

  const files = [
    joinPath(codexDir, 'config.toml'),
    joinPath(projectPath, '.codex', 'config.toml'),
  ];
  for (const f of files) watchFile(f);

  const dirs = [
    joinPath(codexDir, 'agents'),
    joinPath(codexDir, 'skills'),
    joinPath(projectPath, '.codex', 'agents'),
    joinPath(projectPath, '.codex', 'skills'),
  ];
  for (const d of dirs) watchDir(d);
}

function setupGeminiWatchers(projectPath: string): void {
  const home = os.homedir();

  const files = [
    joinPath(home, '.gemini', 'settings.json'),
    joinPath(projectPath, '.gemini', 'settings.json'),
  ];
  for (const f of files) watchFile(f);
}

export function startConfigWatcher(win: BrowserWindow, projectPath: string, providerId: ProviderId = 'claude'): void {
  if (projectPath === currentProjectPath && providerId === currentProviderId) return;
  stopAll();
  currentWin = win;
  currentProjectPath = projectPath;
  currentProviderId = providerId;
  if (providerId === 'codex') {
    setupCodexWatchers(projectPath);
  } else if (providerId === 'gemini') {
    setupGeminiWatchers(projectPath);
  } else {
    setupClaudeWatchers(projectPath);
  }
}

export function stopConfigWatcher(): void {
  stopAll();
  currentWin = null;
  currentProjectPath = null;
  currentProviderId = null;
}
