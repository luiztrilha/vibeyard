import * as pty from 'node-pty';
import { execSync, execFile } from 'child_process';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';

interface PtyInstance {
  process: pty.IPty;
  sessionId: string;
}

const ptys = new Map<string, PtyInstance>();
const silencedExits = new Set<string>();

/**
 * Get the full PATH by sourcing the user's login shell.
 * When Electron is launched from macOS Finder/Dock, process.env.PATH
 * is minimal (/usr/bin:/bin:/usr/sbin:/sbin) and misses nvm, homebrew, etc.
 * We resolve this once by running a login shell to get the real PATH.
 */
let cachedFullPath: string | null = null;

function getFullPath(): string {
  if (cachedFullPath) return cachedFullPath;

  const shell = process.env.SHELL || '/bin/zsh';
  const currentPath = process.env.PATH || '';

  // Try to get the real PATH from a login shell
  try {
    const shellPath = execSync(`${shell} -ilc 'echo __PATH__=$PATH'`, {
      encoding: 'utf-8',
      timeout: 5000,
      env: { ...process.env, HOME: os.homedir() },
    });
    const match = shellPath.match(/__PATH__=(.+)/);
    if (match && match[1]) {
      cachedFullPath = match[1].trim();
      return cachedFullPath;
    }
  } catch {}

  // Fallback: merge current PATH with common directories
  const home = os.homedir();
  const extraDirs = [
    '/usr/local/bin',
    '/opt/homebrew/bin',
    path.join(home, '.local', 'bin'),
    path.join(home, '.npm-global', 'bin'),
    '/usr/local/sbin',
    '/opt/homebrew/sbin',
  ];

  const pathSet = new Set(currentPath.split(':'));
  for (const dir of extraDirs) {
    pathSet.add(dir);
  }
  cachedFullPath = Array.from(pathSet).join(':');
  return cachedFullPath;
}

/**
 * Resolve the full path to the `claude` binary.
 * Falls back to bare 'claude' if resolution fails.
 */
function resolveClaudePath(): string {
  const fullPath = getFullPath();

  // Check common locations directly
  const candidates = [
    '/usr/local/bin/claude',
    '/opt/homebrew/bin/claude',
    path.join(os.homedir(), '.local', 'bin', 'claude'),
    path.join(os.homedir(), '.npm-global', 'bin', 'claude'),
  ];
  for (const candidate of candidates) {
    try {
      if (fs.existsSync(candidate)) return candidate;
    } catch {}
  }

  // Try `which` with augmented PATH
  try {
    const resolved = execSync('which claude', {
      env: { ...process.env, PATH: fullPath },
      encoding: 'utf-8',
      timeout: 3000,
    }).trim();
    if (resolved) return resolved;
  } catch {}

  return 'claude';
}

let cachedClaudePath: string | null = null;

function getClaudeBinary(): string {
  if (!cachedClaudePath) {
    cachedClaudePath = resolveClaudePath();
  }
  return cachedClaudePath;
}

export function spawnPty(
  sessionId: string,
  cwd: string,
  claudeSessionId: string | null,
  isResume: boolean,
  extraArgs: string,
  onData: (data: string) => void,
  onExit: (exitCode: number, signal?: number) => void
): void {
  if (ptys.has(sessionId)) {
    // Silence the old PTY's exit event so it doesn't remove the new session
    silencedExits.add(sessionId);
    killPty(sessionId);
  }

  const env = { ...process.env };
  delete env.CLAUDE_CODE; // avoid subprocess detection conflicts
  env.CLAUDE_IDE_SESSION_ID = sessionId;
  env.CLAUDE_CODE_STATUSLINE = '/tmp/ccide/statusline.sh';
  env.PATH = getFullPath();

  const args: string[] = [];
  if (claudeSessionId) {
    if (isResume) {
      args.push('-r', claudeSessionId);
    } else {
      args.push('--session-id', claudeSessionId);
    }
  }

  if (extraArgs) {
    args.push(...extraArgs.split(/\s+/).filter(Boolean));
  }

  const shell = getClaudeBinary();
  const ptyProcess = pty.spawn(shell, args, {
    name: 'xterm-256color',
    cols: 120,
    rows: 30,
    cwd,
    env,
  });

  ptyProcess.onData((data) => onData(data));
  ptyProcess.onExit(({ exitCode, signal }) => {
    // Only remove from map if this PTY is still the active one for this session
    const current = ptys.get(sessionId);
    if (current?.process === ptyProcess) {
      ptys.delete(sessionId);
    }
    onExit(exitCode, signal);
  });

  ptys.set(sessionId, { process: ptyProcess, sessionId });
}

export function writePty(sessionId: string, data: string): void {
  const instance = ptys.get(sessionId);
  if (instance) {
    instance.process.write(data);
  }
}

export function resizePty(sessionId: string, cols: number, rows: number): void {
  const instance = ptys.get(sessionId);
  if (instance) {
    instance.process.resize(cols, rows);
  }
}

export function killPty(sessionId: string): void {
  const instance = ptys.get(sessionId);
  if (instance) {
    instance.process.kill();
    ptys.delete(sessionId);
  }
}

export function spawnShellPty(
  sessionId: string,
  cwd: string,
  onData: (data: string) => void,
  onExit: (exitCode: number, signal?: number) => void
): void {
  if (ptys.has(sessionId)) {
    killPty(sessionId);
  }

  const shell = process.env.SHELL || '/bin/zsh';
  const shellEnv = { ...process.env, PATH: getFullPath() };
  const ptyProcess = pty.spawn(shell, [], {
    name: 'xterm-256color',
    cols: 120,
    rows: 15,
    cwd,
    env: shellEnv,
  });

  ptyProcess.onData((data) => onData(data));
  ptyProcess.onExit(({ exitCode, signal }) => {
    ptys.delete(sessionId);
    onExit(exitCode, signal);
  });

  ptys.set(sessionId, { process: ptyProcess, sessionId });
}

export function isSilencedExit(sessionId: string): boolean {
  return silencedExits.delete(sessionId);
}

export function killAllPtys(): void {
  for (const [id] of ptys) {
    killPty(id);
  }
}

/**
 * Get the current working directory of a PTY's deepest child process.
 * Uses pgrep to find the deepest child, then lsof to read its cwd.
 */
export function getPtyCwd(sessionId: string): Promise<string | null> {
  const instance = ptys.get(sessionId);
  if (!instance) return Promise.resolve(null);

  const pid = instance.process.pid;

  return new Promise((resolve) => {
    // Find deepest child process recursively
    findDeepestChild(pid, (deepestPid) => {
      // Read cwd of the deepest process via lsof
      execFile(
        'lsof',
        ['-a', '-d', 'cwd', '-Fn', '-p', String(deepestPid)],
        { timeout: 3000 },
        (err, stdout) => {
          if (err) {
            resolve(null);
            return;
          }
          // Parse lsof output: lines starting with 'n' contain the path
          for (const line of stdout.split('\n')) {
            if (line.startsWith('n') && line.length > 1) {
              resolve(line.slice(1));
              return;
            }
          }
          resolve(null);
        }
      );
    });
  });
}

function findDeepestChild(pid: number, callback: (deepestPid: number) => void): void {
  execFile(
    'pgrep',
    ['-P', String(pid)],
    { timeout: 3000 },
    (err, stdout) => {
      if (err || !stdout.trim()) {
        // No children — this is the deepest
        callback(pid);
        return;
      }
      const children = stdout.trim().split('\n').map(s => parseInt(s, 10)).filter(n => !isNaN(n));
      if (children.length === 0) {
        callback(pid);
        return;
      }
      // Recurse into the last child (most recent)
      findDeepestChild(children[children.length - 1], callback);
    }
  );
}
