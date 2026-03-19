import { appState, ProjectRecord } from '../state.js';
import {
  createTerminalPane,
  attachToContainer,
  showPane,
  hideAllPanes,
  fitAllVisible,
  setFocused,
  spawnTerminal,
  destroyTerminal,
  getTerminalInstance,
} from './terminal-pane.js';
import {
  createInspectorPane,
  destroyInspectorPane,
  showInspectorPane,
  hideAllInspectorPanes,
  attachInspectorToContainer,
  getInspectorInstance,
  disconnectInspector,
} from './mcp-inspector.js';
import {
  createFileViewerPane,
  destroyFileViewerPane,
  showFileViewerPane,
  hideAllFileViewerPanes,
  attachFileViewerToContainer,
  getFileViewerInstance,
} from './file-viewer.js';
import {
  createFileReaderPane,
  destroyFileReaderPane,
  showFileReaderPane,
  hideAllFileReaderPanes,
  attachFileReaderToContainer,
  getFileReaderInstance,
} from './file-reader.js';

const container = document.getElementById('terminal-container')!;

export function initSplitLayout(): void {
  appState.on('state-loaded', renderLayout);
  appState.on('project-changed', renderLayout);
  appState.on('session-added', onSessionAdded);
  appState.on('session-removed', onSessionRemoved);
  appState.on('session-changed', renderLayout);
  appState.on('layout-changed', renderLayout);

  // Refit on window resize
  window.addEventListener('resize', () => {
    requestAnimationFrame(fitAllVisible);
  });
}

function onSessionAdded(data: unknown): void {
  const { session } = data as { projectId: string; session: { id: string; type?: string; claudeSessionId: string | null; args?: string; diffFilePath?: string; diffArea?: string; worktreePath?: string; fileReaderPath?: string } };
  const project = appState.activeProject;
  if (!project) return;

  if (session.type === 'file-reader') {
    createFileReaderPane(session.id, session.fileReaderPath || '');
    renderLayout();
  } else if (session.type === 'diff-viewer') {
    createFileViewerPane(session.id, session.diffFilePath || '', session.diffArea || '', session.worktreePath);
    renderLayout();
  } else if (session.type === 'mcp-inspector') {
    createInspectorPane(session.id);
    renderLayout();
  } else {
    // Create and spawn immediately
    createTerminalPane(session.id, project.path, session.claudeSessionId, false, session.args || '');
    renderLayout();

    // Spawn after layout is rendered so terminal has dimensions
    requestAnimationFrame(() => {
      spawnTerminal(session.id);
      fitAllVisible();
    });
  }
}

function onSessionRemoved(data: unknown): void {
  const { sessionId } = data as { projectId: string; sessionId: string };
  if (getFileReaderInstance(sessionId)) {
    destroyFileReaderPane(sessionId);
  } else if (getFileViewerInstance(sessionId)) {
    destroyFileViewerPane(sessionId);
  } else if (getInspectorInstance(sessionId)) {
    disconnectInspector(sessionId);
    destroyInspectorPane(sessionId);
  } else {
    destroyTerminal(sessionId);
  }
  renderLayout();
}

export function renderLayout(): void {
  const project = appState.activeProject;

  if (!project || project.sessions.length === 0) {
    hideAllPanes();
    container.className = '';
    showEmptyState(project);
    return;
  }

  removeEmptyState();

  // Ensure all sessions have their respective instances
  for (const session of project.sessions) {
    if (session.type === 'file-reader') {
      if (!getFileReaderInstance(session.id)) {
        createFileReaderPane(session.id, session.fileReaderPath || '');
      }
    } else if (session.type === 'diff-viewer') {
      if (!getFileViewerInstance(session.id)) {
        createFileViewerPane(session.id, session.diffFilePath || '', session.diffArea || '', session.worktreePath);
      }
    } else if (session.type === 'mcp-inspector') {
      if (!getInspectorInstance(session.id)) {
        createInspectorPane(session.id);
      }
    } else {
      if (!getTerminalInstance(session.id)) {
        createTerminalPane(session.id, project.path, session.claudeSessionId, !!session.claudeSessionId, session.args || '');
      }
    }
  }

  hideAllPanes();
  hideAllInspectorPanes();
  hideAllFileViewerPanes();
  hideAllFileReaderPanes();

  if (project.layout.mode === 'split' && project.layout.splitPanes.length > 1) {
    renderSplitMode(project);
  } else {
    renderTabMode(project);
  }

  requestAnimationFrame(fitAllVisible);
}

function renderTabMode(project: ProjectRecord): void {
  container.className = '';

  const activeId = project.activeSessionId;
  if (!activeId) return;

  const activeSession = project.sessions.find(s => s.id === activeId);
  if (activeSession?.type === 'file-reader') {
    attachFileReaderToContainer(activeId, container);
    showFileReaderPane(activeId, false);
    return;
  }
  if (activeSession?.type === 'diff-viewer') {
    attachFileViewerToContainer(activeId, container);
    showFileViewerPane(activeId, false);
    return;
  }
  if (activeSession?.type === 'mcp-inspector') {
    attachInspectorToContainer(activeId, container);
    showInspectorPane(activeId, false);
    return;
  }

  attachToContainer(activeId, container);
  showPane(activeId, false);
  setFocused(activeId);

  // Ensure spawned
  const instance = getTerminalInstance(activeId);
  if (instance && !instance.spawned && !instance.exited) {
    requestAnimationFrame(() => {
      spawnTerminal(activeId);
      fitAllVisible();
    });
  }
}

function renderSplitMode(project: ProjectRecord): void {
  container.className = `split-${project.layout.splitDirection}`;

  for (const paneId of project.layout.splitPanes) {
    const session = project.sessions.find(s => s.id === paneId);
    if (session?.type === 'file-reader') {
      attachFileReaderToContainer(paneId, container);
      showFileReaderPane(paneId, true);
      continue;
    }
    if (session?.type === 'diff-viewer') {
      attachFileViewerToContainer(paneId, container);
      showFileViewerPane(paneId, true);
      continue;
    }
    if (session?.type === 'mcp-inspector') {
      attachInspectorToContainer(paneId, container);
      showInspectorPane(paneId, true);
      continue;
    }

    attachToContainer(paneId, container);
    showPane(paneId, true);

    // Ensure spawned
    const instance = getTerminalInstance(paneId);
    if (instance && !instance.spawned && !instance.exited) {
      requestAnimationFrame(() => {
        spawnTerminal(paneId);
        fitAllVisible();
      });
    }
  }

  // Focus active session
  if (project.activeSessionId && project.layout.splitPanes.includes(project.activeSessionId)) {
    setFocused(project.activeSessionId);
  } else if (project.layout.splitPanes.length > 0) {
    setFocused(project.layout.splitPanes[0]);
  }
}

function showEmptyState(project: ProjectRecord | undefined): void {
  removeEmptyState();
  const el = document.createElement('div');
  el.className = 'empty-state';
  if (!project) {
    el.innerHTML = `
      <div>No project selected</div>
      <div class="hint">Create a project with the + button in the sidebar</div>
    `;
  } else {
    el.innerHTML = `
      <div>No sessions in "${project.name}"</div>
      <div class="hint">Create a session with the + button in the tab bar</div>
    `;
  }
  container.appendChild(el);
}

function removeEmptyState(): void {
  container.querySelector('.empty-state')?.remove();
}
