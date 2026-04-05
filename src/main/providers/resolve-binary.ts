import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { execSync } from 'child_process';
import { getFullPath } from '../pty-manager';

const isWindows = process.platform === 'win32';
const PATH_SEPARATOR = path.delimiter;
const LOOKUP_COMMAND = isWindows ? 'where' : 'which';

function buildCandidatePath(dir: string, binaryName: string): string {
  if (dir.includes('\\')) {
    return path.join(dir, binaryName);
  }
  return `${dir.replace(/\/+$/, '')}/${binaryName}`;
}

const COMMON_BIN_DIRS = [
  '/usr/local/bin',
  '/opt/homebrew/bin',
  path.join(os.homedir(), '.local', 'bin'),
  path.join(os.homedir(), '.npm-global', 'bin'),
];

function rankWindowsBinary(candidate: string): number {
  const ext = path.extname(candidate).toLowerCase();
  if (ext === '.exe') return 0;
  if (ext === '.cmd') return 1;
  if (ext === '.bat') return 2;
  if (ext === '.com') return 3;
  if (!ext) return 4;
  if (ext === '.ps1') return 5;
  return 6;
}

function pickResolvedBinary(output: string): string | undefined {
  const entries = output
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean);

  if (!isWindows) return entries[0];
  return entries.sort((a, b) => rankWindowsBinary(a) - rankWindowsBinary(b))[0];
}

export function resolveBinary(binaryName: string, cache: { path: string | null }): string {
  if (cache.path) return cache.path;

  const fullPath = getFullPath();
  const candidates = COMMON_BIN_DIRS.map(dir => buildCandidatePath(dir, binaryName));

  for (const candidate of candidates) {
    try {
      if (fs.existsSync(candidate)) {
        cache.path = candidate;
        return candidate;
      }
    } catch {}
  }

  try {
    const resolved = pickResolvedBinary(execSync(`${LOOKUP_COMMAND} ${binaryName}`, {
      env: { ...process.env, PATH: fullPath },
      encoding: 'utf-8',
      timeout: 3000,
    }));
    if (resolved) {
      cache.path = resolved;
      return resolved;
    }
  } catch (err) {
    console.warn(`Failed to resolve ${binaryName} path via ${LOOKUP_COMMAND}:`, err);
  }

  cache.path = binaryName;
  return binaryName;
}

export function validateBinaryExists(
  binaryName: string,
  displayName: string,
  installCommand: string,
): { ok: boolean; message: string } {
  const candidates = COMMON_BIN_DIRS.map(dir => buildCandidatePath(dir, binaryName));

  for (const candidate of candidates) {
    try {
      if (fs.existsSync(candidate)) return { ok: true, message: '' };
    } catch {}
  }

  try {
    const currentPath = process.env.PATH || '';
    const extraDirs = [
      ...COMMON_BIN_DIRS,
      '/usr/local/sbin',
      '/opt/homebrew/sbin',
    ];
    const pathSet = new Set(currentPath.split(PATH_SEPARATOR));
    for (const dir of extraDirs) {
      pathSet.add(dir);
    }
    const augmentedPath = Array.from(pathSet).join(PATH_SEPARATOR);

    const resolved = pickResolvedBinary(execSync(`${LOOKUP_COMMAND} ${binaryName}`, {
      env: { ...process.env, PATH: augmentedPath },
      encoding: 'utf-8',
      timeout: 3000,
    }));
    if (resolved) return { ok: true, message: '' };
  } catch {}

  return {
    ok: false,
    message:
      `${displayName} not found.\n\n` +
      `Vibeyard requires the ${displayName} to be installed.\n\n` +
      `Install it with:\n` +
      `  ${installCommand}\n\n` +
      `After installing, restart Vibeyard.`,
  };
}
