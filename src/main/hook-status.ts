import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { BrowserWindow } from 'electron';

const TMP_DIR = os.tmpdir();
export const STATUS_DIR = TMP_DIR.startsWith('/')
  ? path.posix.join(TMP_DIR, 'vibeyard')
  : path.join(TMP_DIR, 'vibeyard');
export const STATUS_DIR_ENV_VAR = 'VIBEYARD_STATUS_DIR';
const IS_WINDOWS = process.platform === 'win32';
const joinStatusPath = (...parts: string[]): string =>
  STATUS_DIR.startsWith('/')
    ? path.posix.join(STATUS_DIR, ...parts)
    : path.join(STATUS_DIR, ...parts);
const STATUSLINE_SCRIPT = joinStatusPath(IS_WINDOWS ? 'statusline.cmd' : 'statusline.sh');
const STATUSLINE_HELPER = joinStatusPath('statusline.js');

process.env[STATUS_DIR_ENV_VAR] = STATUS_DIR;

const KNOWN_EXTENSIONS = ['.status', '.sessionid', '.cost', '.toolfailure', '.events'];

let watcher: fs.FSWatcher | null = null;
let pollInterval: ReturnType<typeof setInterval> | null = null;
const lastMtimes = new Map<string, number>();
const eventFileOffsets = new Map<string, number>();
const knownSessionIds = new Set<string>();

export function registerSession(sessionId: string): void {
  knownSessionIds.add(sessionId);
}

export function unregisterSession(sessionId: string): void {
  knownSessionIds.delete(sessionId);
}

function isKnownExtension(filename: string): boolean {
  return KNOWN_EXTENSIONS.some(ext => filename.endsWith(ext));
}

export function getStatusLineScriptPath(): string {
  return STATUSLINE_SCRIPT;
}

export function installStatusLineScript(): void {
  fs.mkdirSync(STATUS_DIR, { recursive: true, mode: 0o700 });

  const helperScript = `let input='';\n` +
    `process.stdin.setEncoding('utf8');\n` +
    `process.stdin.on('data', chunk => input += chunk);\n` +
    `process.stdin.on('end', () => {\n` +
    `  let d;\n` +
    `  try { d = JSON.parse(input || '{}'); } catch { return; }\n` +
    `  const fs = require('fs');\n` +
    `  const path = require('path');\n` +
    `  const statusDir = process.env[${JSON.stringify(STATUS_DIR_ENV_VAR)}] || ${JSON.stringify(STATUS_DIR)};\n` +
    `  const sid = process.env.CLAUDE_IDE_SESSION_ID || '';\n` +
    `  if (!sid) return;\n` +
    `  const cost = d.cost || {};\n` +
    `  const ctx = d.context_window || {};\n` +
    `  const model = d.model?.display_name || '';\n` +
    `  if (Object.keys(cost).length || Object.keys(ctx).length || model) {\n` +
    `    const payload = { cost, context_window: ctx };\n` +
    `    if (model) payload.model = model;\n` +
    `    fs.mkdirSync(statusDir, { recursive: true });\n` +
    `    fs.writeFileSync(path.join(statusDir, sid + '.cost'), JSON.stringify(payload));\n` +
    `  }\n` +
    `  const claudeSid = d.session_id || '';\n` +
    `  if (claudeSid) {\n` +
    `    fs.mkdirSync(statusDir, { recursive: true });\n` +
    `    fs.writeFileSync(path.join(statusDir, sid + '.sessionid'), claudeSid);\n` +
    `  }\n` +
    `});\n` +
    `process.stdin.resume();\n`;

  if (IS_WINDOWS) {
    const wrapper = `@echo off\r\nnode "%~dp0statusline.js"\r\n`;
    fs.writeFileSync(STATUSLINE_HELPER, helperScript, { mode: 0o755 });
    fs.writeFileSync(STATUSLINE_SCRIPT, wrapper, { mode: 0o755 });
    return;
  }

  const script = `#!/bin/sh\nnode "${STATUSLINE_HELPER.replace(/\\/g, '\\\\')}"\n`;
  fs.writeFileSync(STATUSLINE_HELPER, helperScript, { mode: 0o755 });
  fs.writeFileSync(STATUSLINE_SCRIPT, script, { mode: 0o755 });
}

function extractSessionId(filename: string): string {
  if (filename.endsWith('.toolfailure')) {
    const base = filename.replace('.toolfailure', '');
    const lastDash = base.lastIndexOf('-');
    return lastDash !== -1 ? base.slice(0, lastDash) : base;
  }
  for (const ext of KNOWN_EXTENSIONS) {
    if (filename.endsWith(ext)) return filename.slice(0, -ext.length);
  }
  return '';
}

function handleFileChange(win: BrowserWindow, filename: string): void {
  const extractedId = extractSessionId(filename);
  if (extractedId && !knownSessionIds.has(extractedId)) return;

  if (filename.endsWith('.status')) {
    const sessionId = filename.replace('.status', '');
    const filePath = joinStatusPath(filename);

    try {
      const raw = fs.readFileSync(filePath, 'utf-8').trim();
      // Format: "HookEvent:status" (e.g. "PostToolUse:working") or legacy plain status
      const colonIdx = raw.indexOf(':');
      const hookName = colonIdx !== -1 ? raw.slice(0, colonIdx) : '';
      const content = colonIdx !== -1 ? raw.slice(colonIdx + 1) : raw;
      if (content === 'working' || content === 'waiting' || content === 'completed' || content === 'input') {
        if (!win.isDestroyed()) {
          win.webContents.send('session:hookStatus', sessionId, content, hookName);
        }
      }
    } catch {
      // File may have been deleted between watch event and read
    }
  } else if (filename.endsWith('.sessionid')) {
    const sessionId = filename.replace('.sessionid', '');
    const filePath = joinStatusPath(filename);

    try {
      const cliSessionId = fs.readFileSync(filePath, 'utf-8').trim();
      if (cliSessionId && !win.isDestroyed()) {
        win.webContents.send('session:cliSessionId', sessionId, cliSessionId);
        // Backward compatibility
        win.webContents.send('session:claudeSessionId', sessionId, cliSessionId);
      }
    } catch {
      // File may have been deleted between watch event and read
    }
  } else if (filename.endsWith('.cost')) {
    const sessionId = filename.replace('.cost', '');
    const filePath = joinStatusPath(filename);

    try {
      const content = fs.readFileSync(filePath, 'utf-8').trim();
      const costData = JSON.parse(content);
      if (!win.isDestroyed()) {
        win.webContents.send('session:costData', sessionId, costData);
      }
    } catch {
      // File may have been deleted or contain invalid JSON
    }
  } else if (filename.endsWith('.toolfailure')) {
    const sessionId = extractedId;
    const filePath = joinStatusPath(filename);

    try {
      const content = fs.readFileSync(filePath, 'utf-8').trim();
      const data = JSON.parse(content);
      if (!win.isDestroyed()) {
        win.webContents.send('session:toolFailure', sessionId, data);
      }
    } catch {
      // File may have been deleted or contain invalid JSON
    }
    // Always attempt cleanup — each failure is a one-shot event
    try { fs.unlinkSync(filePath); } catch { /* already gone */ }
  } else if (filename.endsWith('.events')) {
    const sessionId = filename.replace('.events', '');
    const filePath = joinStatusPath(filename);
    const offset = eventFileOffsets.get(sessionId) ?? 0;

    let fd: number | null = null;
    try {
      fd = fs.openSync(filePath, 'r');
      const stat = fs.fstatSync(fd);
      if (stat.size > offset) {
        const buf = Buffer.alloc(stat.size - offset);
        fs.readSync(fd, buf, 0, buf.length, offset);
        eventFileOffsets.set(sessionId, stat.size);

        const lines = buf.toString('utf-8').trim().split('\n').filter(Boolean);
        const events = [];
        for (const line of lines) {
          try { events.push(JSON.parse(line)); } catch { /* skip malformed */ }
        }
        if (events.length > 0 && !win.isDestroyed()) {
          win.webContents.send('session:inspectorEvents', sessionId, events);
        }
      }
    } catch {
      // File may not exist yet
    } finally {
      if (fd !== null) {
        try { fs.closeSync(fd); } catch { /* already closed */ }
      }
    }
  }
}

function pollForChanges(win: BrowserWindow): void {
  if (win.isDestroyed()) return;

  try {
    const files = fs.readdirSync(STATUS_DIR);
    for (const filename of files) {
      if (!isKnownExtension(filename)) continue;
      const filePath = joinStatusPath(filename);
      try {
        const stat = fs.statSync(filePath);
        const mtime = stat.mtimeMs;
        const prev = lastMtimes.get(filename);
        if (prev === undefined || mtime > prev) {
          lastMtimes.set(filename, mtime);
          if (prev !== undefined) {
            handleFileChange(win, filename);
          }
        }
      } catch {
        // File may have been deleted
      }
    }
  } catch {
    // Directory may not exist yet
  }
}

function startPolling(win: BrowserWindow): void {
  stopPolling();
  pollInterval = setInterval(() => pollForChanges(win), 2000);
}

function stopPolling(): void {
  if (pollInterval) {
    clearInterval(pollInterval);
    pollInterval = null;
  }
  lastMtimes.clear();
}

function restartWatcher(win: BrowserWindow): void {
  if (watcher) {
    watcher.close();
    watcher = null;
  }

  fs.mkdirSync(STATUS_DIR, { recursive: true, mode: 0o700 });

  watcher = fs.watch(STATUS_DIR, (_eventType, filename) => {
    if (!filename) {
      resyncAllSessions(win);
      return;
    }
    handleFileChange(win, filename);
  });

  startPolling(win);
}

export function resyncAllSessions(win: BrowserWindow): void {
  if (win.isDestroyed()) return;

  try {
    const files = fs.readdirSync(STATUS_DIR);
    for (const filename of files) {
      if (isKnownExtension(filename)) {
        handleFileChange(win, filename);
      }
    }
  } catch {
    // Directory may not exist yet
  }
}

export function restartAndResync(win: BrowserWindow): void {
  restartWatcher(win);
  resyncAllSessions(win);
}

export function startWatching(win: BrowserWindow): void {
  restartWatcher(win);
}

export function cleanupSessionStatus(sessionId: string): void {
  for (const ext of KNOWN_EXTENSIONS) {
    try {
      fs.unlinkSync(joinStatusPath(`${sessionId}${ext}`));
    } catch {
      // Already gone
    }
  }
  eventFileOffsets.delete(sessionId);
  unregisterSession(sessionId);
}

export function cleanupAll(): void {
  stopPolling();
  knownSessionIds.clear();
  if (watcher) {
    watcher.close();
    watcher = null;
  }
  try {
    const files = fs.readdirSync(STATUS_DIR);
    for (const file of files) {
      if (isKnownExtension(file)) {
        fs.unlinkSync(joinStatusPath(file));
      }
    }
    // Remove helper and launcher
    try { fs.unlinkSync(STATUSLINE_HELPER); } catch { /* already gone */ }
    try { fs.unlinkSync(STATUSLINE_SCRIPT); } catch { /* already gone */ }
    fs.rmdirSync(STATUS_DIR);
  } catch {
    // Directory may not exist
  }
}
