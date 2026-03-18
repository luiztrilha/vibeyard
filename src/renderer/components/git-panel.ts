import { appState } from '../state.js';
import { onChange as onGitStatusChange, getGitStatus } from '../git-status.js';
import { onChange as onStatusChange } from '../session-activity.js';
import type { GitFileEntry } from '../types.js';

const MAX_FILES = 100;

let collapsed = false;
let lastCountKey = '';

function esc(s: string): string {
  const d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}

function statusBadge(entry: GitFileEntry): string {
  const letterMap: Record<string, string> = {
    added: 'A', modified: 'M', deleted: 'D', renamed: 'R', untracked: '?', conflicted: 'U',
  };
  const letter = letterMap[entry.status] || '?';
  return `<span class="git-file-badge ${entry.status}">${letter}</span>`;
}

function groupLabel(area: string): string {
  switch (area) {
    case 'staged': return 'Staged';
    case 'working': return 'Changes';
    case 'untracked': return 'Untracked';
    case 'conflicted': return 'Conflicted';
    default: return area;
  }
}

async function refresh(): Promise<void> {
  const container = document.getElementById('git-panel');
  if (!container) return;

  const project = appState.activeProject;
  if (!project) {
    container.innerHTML = '';
    return;
  }

  const status = getGitStatus(project.id);
  if (!status || !status.isGitRepo) {
    container.innerHTML = '';
    return;
  }

  const total = status.staged + status.modified + status.untracked + status.conflicted;
  if (total === 0) {
    container.innerHTML = '';
    return;
  }

  // Build section shell
  const section = document.createElement('div');
  section.className = 'config-section';

  const header = document.createElement('div');
  header.className = 'config-section-header';
  header.innerHTML = `<span class="config-section-toggle ${collapsed ? 'collapsed' : ''}">&#x25BC;</span>Git Changes<span class="config-section-count">${total}</span>`;

  const body = document.createElement('div');
  body.className = `config-section-body${collapsed ? ' hidden' : ''}`;

  header.addEventListener('click', () => {
    collapsed = !collapsed;
    const toggle = header.querySelector('.config-section-toggle')!;
    toggle.classList.toggle('collapsed');
    body.classList.toggle('hidden');
    // Fetch files on expand
    if (!collapsed) loadFiles(body, project.path);
  });

  section.appendChild(header);
  section.appendChild(body);

  container.innerHTML = '';
  container.appendChild(section);

  if (!collapsed) {
    loadFiles(body, project.path);
  }
}

async function loadFiles(body: HTMLElement, projectPath: string): Promise<void> {
  body.innerHTML = '<div class="config-loading">Loading...</div>';

  let files: GitFileEntry[];
  try {
    files = await window.claudeIde.git.getFiles(projectPath) as GitFileEntry[];
  } catch {
    body.innerHTML = '';
    return;
  }

  body.innerHTML = '';

  // Group by area in display order
  const order: string[] = ['conflicted', 'staged', 'working', 'untracked'];
  const groups = new Map<string, GitFileEntry[]>();
  for (const f of files) {
    const list = groups.get(f.area) || [];
    list.push(f);
    groups.set(f.area, list);
  }

  let rendered = 0;
  for (const area of order) {
    const group = groups.get(area);
    if (!group || group.length === 0) continue;

    const groupHeader = document.createElement('div');
    groupHeader.className = 'git-group-header';
    groupHeader.textContent = `${groupLabel(area)} (${group.length})`;
    body.appendChild(groupHeader);

    for (const entry of group) {
      if (rendered >= MAX_FILES) break;
      const item = document.createElement('div');
      item.className = 'config-item';
      item.innerHTML = `${statusBadge(entry)}<span class="config-item-detail" title="${esc(entry.path)}">${esc(entry.path)}</span>`;
      body.appendChild(item);
      rendered++;
    }
    if (rendered >= MAX_FILES) break;
  }

  const remaining = files.length - rendered;
  if (remaining > 0) {
    const overflow = document.createElement('div');
    overflow.className = 'config-empty';
    overflow.textContent = `and ${remaining} more...`;
    body.appendChild(overflow);
  }
}

export function scrollToGitPanel(): void {
  const container = document.getElementById('git-panel');
  if (!container || !container.firstElementChild) return;
  container.scrollIntoView({ behavior: 'smooth', block: 'start' });
  // Expand if collapsed
  if (collapsed) {
    collapsed = false;
    const toggle = container.querySelector('.config-section-toggle');
    const body = container.querySelector('.config-section-body');
    if (toggle) toggle.classList.remove('collapsed');
    if (body) {
      body.classList.remove('hidden');
      const project = appState.activeProject;
      if (project) loadFiles(body as HTMLElement, project.path);
    }
  }
}

export function toggleGitPanel(): void {
  const container = document.getElementById('git-panel');
  if (!container || !container.firstElementChild) return;

  container.scrollIntoView({ behavior: 'smooth', block: 'start' });
  collapsed = !collapsed;
  const toggle = container.querySelector('.config-section-toggle');
  const body = container.querySelector('.config-section-body');
  if (toggle) toggle.classList.toggle('collapsed');
  if (body) {
    body.classList.toggle('hidden');
    if (!collapsed) {
      const project = appState.activeProject;
      if (project) loadFiles(body as HTMLElement, project.path);
    }
  }
}

export function initGitPanel(): void {
  appState.on('project-changed', () => refresh());
  appState.on('state-loaded', () => refresh());

  // Refresh when git status counts change
  onGitStatusChange((projectId, status) => {
    if (projectId !== appState.activeProjectId) return;
    const key = `${status.staged}:${status.modified}:${status.untracked}:${status.conflicted}`;
    if (key !== lastCountKey) {
      lastCountKey = key;
      refresh();
    }
  });

  // Refresh on session working → waiting transition
  onStatusChange((_sessionId, status) => {
    if (status === 'waiting' || status === 'completed') {
      refresh();
    }
  });
}
