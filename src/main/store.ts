import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import type { PersistedState } from '../shared/types';

export type { SessionRecord, ProjectRecord, Preferences, PersistedState } from '../shared/types';

const STATE_DIR = path.join(os.homedir(), '.ccide');
const STATE_FILE = path.join(STATE_DIR, 'state.json');

let saveTimer: ReturnType<typeof setTimeout> | null = null;

function defaultState(): PersistedState {
  return {
    version: 1,
    projects: [],
    activeProjectId: null,
    preferences: { soundOnSessionWaiting: false, debugMode: false },
  };
}

export function loadState(): PersistedState {
  try {
    if (!fs.existsSync(STATE_FILE)) {
      return defaultState();
    }
    const raw = fs.readFileSync(STATE_FILE, 'utf-8');
    const parsed = JSON.parse(raw) as PersistedState;
    if (parsed.version !== 1) {
      return defaultState();
    }
    // Migrate: claudeSessionId → cliSessionId
    migrateSessionIds(parsed);
    return parsed;
  } catch (err) {
    console.warn('Failed to load state, using defaults:', err);
    return defaultState();
  }
}

/** Migrate legacy claudeSessionId fields to cliSessionId */
function migrateSessionIds(state: PersistedState): void {
  for (const project of state.projects) {
    for (const session of project.sessions) {
      const s = session as unknown as Record<string, unknown>;
      if (s.claudeSessionId !== undefined && s.cliSessionId === undefined) {
        s.cliSessionId = s.claudeSessionId;
      }
      if (!s.providerId) {
        s.providerId = 'claude';
      }
    }
  }
}

export function saveState(state: PersistedState): void {
  if (saveTimer) {
    clearTimeout(saveTimer);
  }
  lastState = state;
  saveTimer = setTimeout(() => {
    try {
      if (!fs.existsSync(STATE_DIR)) {
        fs.mkdirSync(STATE_DIR, { recursive: true });
      }
      fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), 'utf-8');
    } catch (err) {
      console.error('Failed to save state:', err);
    }
    saveTimer = null;
  }, 300);
}

let lastState: PersistedState | null = null;

export function flushState(): void {
  if (lastState) {
    saveStateSync(lastState);
  }
}

export function saveStateSync(state: PersistedState): void {
  try {
    if (!fs.existsSync(STATE_DIR)) {
      fs.mkdirSync(STATE_DIR, { recursive: true });
    }
    fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), 'utf-8');
  } catch (err) {
    console.error('Failed to save state:', err);
  }
}
