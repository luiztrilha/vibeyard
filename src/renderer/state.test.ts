import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockLoad = vi.fn();
const mockSave = vi.fn();

vi.stubGlobal('window', {
  claudeIde: {
    store: { load: mockLoad, save: mockSave },
  },
});

let uuidCounter = 0;
vi.stubGlobal('crypto', {
  randomUUID: () => `uuid-${++uuidCounter}`,
});

import { appState, _resetForTesting } from './state';

beforeEach(() => {
  vi.clearAllMocks();
  uuidCounter = 0;
  _resetForTesting();
});

// Helper: add a project and return it
function addProject(name = 'Test', path = '/test') {
  return appState.addProject(name, path);
}

// Helper: add a project with sessions
function addProjectWithSessions(count: number) {
  const project = addProject();
  const sessions = [];
  for (let i = 0; i < count; i++) {
    sessions.push(appState.addSession(project.id, `Session ${i + 1}`)!);
  }
  return { project, sessions };
}

describe('load()', () => {
  it('loads persisted state from store', async () => {
    const persisted = {
      version: 1,
      projects: [
        {
          id: 'p1',
          name: 'Proj',
          path: '/proj',
          sessions: [],
          activeSessionId: null,
          layout: { mode: 'tabs' as const, splitPanes: [], splitDirection: 'horizontal' as const },
        },
      ],
      activeProjectId: 'p1',
      preferences: { soundOnSessionWaiting: true, debugMode: false },
    };
    mockLoad.mockResolvedValue(persisted);
    await appState.load();
    expect(appState.projects).toHaveLength(1);
    expect(appState.activeProjectId).toBe('p1');
    expect(appState.preferences.soundOnSessionWaiting).toBe(true);
  });

  it('handles null return from store (keeps defaults)', async () => {
    mockLoad.mockResolvedValue(null);
    await appState.load();
    expect(appState.projects).toEqual([]);
    expect(appState.activeProjectId).toBeNull();
  });

  it('merges defaults for forward compatibility', async () => {
    const persisted = {
      version: 1,
      projects: [],
      activeProjectId: null,
      preferences: { soundOnSessionWaiting: true },
    };
    mockLoad.mockResolvedValue(persisted);
    await appState.load();
    // debugMode should be filled in from defaults
    expect(appState.preferences.debugMode).toBe(false);
    expect(appState.preferences.soundOnSessionWaiting).toBe(true);
  });

  it('emits state-loaded event', async () => {
    mockLoad.mockResolvedValue(null);
    const cb = vi.fn();
    appState.on('state-loaded', cb);
    await appState.load();
    expect(cb).toHaveBeenCalledTimes(1);
  });
});

describe('persist()', () => {
  it('calls store.save after addProject', () => {
    addProject();
    expect(mockSave).toHaveBeenCalled();
    const savedState = mockSave.mock.calls[0][0];
    expect(savedState.projects).toHaveLength(1);
  });

  it('calls store.save after addSession', () => {
    const project = addProject();
    mockSave.mockClear();
    appState.addSession(project.id, 'S1');
    expect(mockSave).toHaveBeenCalled();
  });
});

describe('getters', () => {
  it('projects returns empty array by default', () => {
    expect(appState.projects).toEqual([]);
  });

  it('activeProjectId returns null by default', () => {
    expect(appState.activeProjectId).toBeNull();
  });

  it('activeProject returns undefined when no projects', () => {
    expect(appState.activeProject).toBeUndefined();
  });

  it('activeSession returns undefined when no project', () => {
    expect(appState.activeSession).toBeUndefined();
  });

  it('activeProject returns the active project', () => {
    const project = addProject('My Proj', '/my');
    expect(appState.activeProject).toBeDefined();
    expect(appState.activeProject!.id).toBe(project.id);
  });

  it('activeSession returns the active session', () => {
    const project = addProject();
    const session = appState.addSession(project.id, 'S1')!;
    expect(appState.activeSession).toBeDefined();
    expect(appState.activeSession!.id).toBe(session.id);
  });

  it('sidebarWidth returns undefined by default', () => {
    expect(appState.sidebarWidth).toBeUndefined();
  });
});

describe('addProject()', () => {
  it('creates project with UUID and sets it active', () => {
    const project = addProject('Foo', '/foo');
    expect(project.id).toBe('uuid-1');
    expect(project.name).toBe('Foo');
    expect(project.path).toBe('/foo');
    expect(project.sessions).toEqual([]);
    expect(project.activeSessionId).toBeNull();
    expect(appState.activeProjectId).toBe('uuid-1');
  });

  it('emits project-added and project-changed', () => {
    const addedCb = vi.fn();
    const changedCb = vi.fn();
    appState.on('project-added', addedCb);
    appState.on('project-changed', changedCb);
    const project = addProject();
    expect(addedCb).toHaveBeenCalledWith(project);
    expect(changedCb).toHaveBeenCalledTimes(1);
  });
});

describe('removeProject()', () => {
  it('removes the project and falls back to first remaining', () => {
    const p1 = addProject('P1', '/p1');
    const p2 = addProject('P2', '/p2');
    // p2 is active now
    appState.removeProject(p2.id);
    expect(appState.projects).toHaveLength(1);
    expect(appState.activeProjectId).toBe(p1.id);
  });

  it('sets activeProjectId to null when last project removed', () => {
    const p = addProject();
    appState.removeProject(p.id);
    expect(appState.projects).toHaveLength(0);
    expect(appState.activeProjectId).toBeNull();
  });

  it('emits project-removed and project-changed', () => {
    const removedCb = vi.fn();
    const changedCb = vi.fn();
    const p = addProject();
    appState.on('project-removed', removedCb);
    appState.on('project-changed', changedCb);
    appState.removeProject(p.id);
    expect(removedCb).toHaveBeenCalledWith(p.id);
    expect(changedCb).toHaveBeenCalled();
  });
});

describe('addSession()', () => {
  it('creates a session and sets it active', () => {
    const project = addProject();
    const session = appState.addSession(project.id, 'S1', '--verbose')!;
    expect(session).toBeDefined();
    expect(session.name).toBe('S1');
    expect(session.args).toBe('--verbose');
    expect(session.cliSessionId).toBeNull();
    expect(appState.activeProject!.activeSessionId).toBe(session.id);
  });

  it('returns undefined for nonexistent project', () => {
    expect(appState.addSession('nonexistent', 'S')).toBeUndefined();
  });

  it('emits session-added and session-changed', () => {
    const addedCb = vi.fn();
    const changedCb = vi.fn();
    const project = addProject();
    appState.on('session-added', addedCb);
    appState.on('session-changed', changedCb);
    appState.addSession(project.id, 'S1');
    expect(addedCb).toHaveBeenCalledTimes(1);
    expect(changedCb).toHaveBeenCalledTimes(1);
  });
});

describe('addDiffViewerSession()', () => {
  it('creates a diff-viewer session', () => {
    const project = addProject();
    const session = appState.addDiffViewerSession(project.id, '/path/to/file.ts', 'staged')!;
    expect(session.type).toBe('diff-viewer');
    expect(session.diffFilePath).toBe('/path/to/file.ts');
    expect(session.diffArea).toBe('staged');
    expect(session.name).toBe('file.ts');
  });

  it('deduplicates existing same file+area+worktree', () => {
    const project = addProject();
    const s1 = appState.addDiffViewerSession(project.id, '/f.ts', 'staged', '/wt')!;
    const s2 = appState.addDiffViewerSession(project.id, '/f.ts', 'staged', '/wt')!;
    expect(s2.id).toBe(s1.id);
    expect(appState.activeProject!.sessions).toHaveLength(1);
  });

  it('does not deduplicate different area', () => {
    const project = addProject();
    appState.addDiffViewerSession(project.id, '/f.ts', 'staged');
    appState.addDiffViewerSession(project.id, '/f.ts', 'unstaged');
    expect(appState.activeProject!.sessions).toHaveLength(2);
  });

  it('returns undefined for nonexistent project', () => {
    expect(appState.addDiffViewerSession('nope', '/f', 'staged')).toBeUndefined();
  });
});

describe('addFileReaderSession()', () => {
  it('creates a file-reader session', () => {
    const project = addProject();
    const session = appState.addFileReaderSession(project.id, '/path/to/readme.md')!;
    expect(session.type).toBe('file-reader');
    expect(session.fileReaderPath).toBe('/path/to/readme.md');
    expect(session.name).toBe('readme.md');
  });

  it('deduplicates existing same path', () => {
    const project = addProject();
    const s1 = appState.addFileReaderSession(project.id, '/f.ts')!;
    const s2 = appState.addFileReaderSession(project.id, '/f.ts')!;
    expect(s2.id).toBe(s1.id);
    expect(appState.activeProject!.sessions).toHaveLength(1);
  });

  it('returns undefined for nonexistent project', () => {
    expect(appState.addFileReaderSession('nope', '/f')).toBeUndefined();
  });
});

describe('addMcpInspectorSession()', () => {
  it('creates an mcp-inspector session', () => {
    const project = addProject();
    const session = appState.addMcpInspectorSession(project.id, 'Inspector')!;
    expect(session.type).toBe('mcp-inspector');
    expect(session.name).toBe('Inspector');
  });

  it('returns undefined for nonexistent project', () => {
    expect(appState.addMcpInspectorSession('nope', 'I')).toBeUndefined();
  });
});

describe('removeSession()', () => {
  it('removes the session and falls back activeSessionId', () => {
    const { project, sessions } = addProjectWithSessions(2);
    // active is the last added session (sessions[1])
    appState.removeSession(project.id, sessions[1].id);
    expect(appState.activeProject!.sessions).toHaveLength(1);
    expect(appState.activeProject!.activeSessionId).toBe(sessions[0].id);
  });

  it('sets activeSessionId to null when last session removed', () => {
    const project = addProject();
    const session = appState.addSession(project.id, 'S1')!;
    appState.removeSession(project.id, session.id);
    expect(appState.activeProject!.activeSessionId).toBeNull();
  });

  it('clears session from splitPanes', () => {
    const { project, sessions } = addProjectWithSessions(2);
    appState.toggleSplit(); // populate splitPanes
    expect(appState.activeProject!.layout.splitPanes.length).toBeGreaterThan(0);
    appState.removeSession(project.id, sessions[0].id);
    expect(appState.activeProject!.layout.splitPanes).not.toContain(sessions[0].id);
  });

  it('emits session-removed and session-changed', () => {
    const removedCb = vi.fn();
    const changedCb = vi.fn();
    const project = addProject();
    const session = appState.addSession(project.id, 'S1')!;
    appState.on('session-removed', removedCb);
    appState.on('session-changed', changedCb);
    appState.removeSession(project.id, session.id);
    expect(removedCb).toHaveBeenCalledWith({ projectId: project.id, sessionId: session.id });
    expect(changedCb).toHaveBeenCalled();
  });
});

describe('setActiveSession()', () => {
  it('updates activeSessionId and persists', () => {
    const { project, sessions } = addProjectWithSessions(2);
    mockSave.mockClear();
    appState.setActiveSession(project.id, sessions[0].id);
    expect(appState.activeProject!.activeSessionId).toBe(sessions[0].id);
    expect(mockSave).toHaveBeenCalled();
  });
});

describe('updateSessionCliId()', () => {
  it('updates cliSessionId and persists', () => {
    const project = addProject();
    const session = appState.addSession(project.id, 'S1')!;
    mockSave.mockClear();
    appState.updateSessionCliId(project.id, session.id, 'claude-abc');
    expect(appState.activeSession!.cliSessionId).toBe('claude-abc');
    expect(mockSave).toHaveBeenCalled();
  });
});

describe('renameSession()', () => {
  it('updates session name and persists', () => {
    const project = addProject();
    const session = appState.addSession(project.id, 'Old')!;
    mockSave.mockClear();
    appState.renameSession(project.id, session.id, 'New');
    expect(appState.activeSession!.name).toBe('New');
    expect(mockSave).toHaveBeenCalled();
  });
});

describe('toggleSplit()', () => {
  it('switches from tabs to split and populates splitPanes', () => {
    const { project, sessions } = addProjectWithSessions(3);
    // active session is sessions[2] (the last added)
    appState.toggleSplit();
    const layout = appState.activeProject!.layout;
    expect(layout.mode).toBe('split');
    expect(layout.splitPanes).toContain(sessions[2].id);
    expect(layout.splitPanes.length).toBe(2);
  });

  it('switches from split back to tabs and clears splitPanes', () => {
    addProjectWithSessions(2);
    appState.toggleSplit(); // tabs -> split
    appState.toggleSplit(); // split -> tabs
    const layout = appState.activeProject!.layout;
    expect(layout.mode).toBe('tabs');
    expect(layout.splitPanes).toEqual([]);
  });

  it('emits layout-changed', () => {
    addProjectWithSessions(2);
    const cb = vi.fn();
    appState.on('layout-changed', cb);
    appState.toggleSplit();
    expect(cb).toHaveBeenCalledTimes(1);
  });
});

describe('cycleSession()', () => {
  it('cycles forward', () => {
    const { project, sessions } = addProjectWithSessions(3);
    appState.setActiveSession(project.id, sessions[0].id);
    appState.cycleSession(1);
    expect(appState.activeProject!.activeSessionId).toBe(sessions[1].id);
  });

  it('cycles backward', () => {
    const { project, sessions } = addProjectWithSessions(3);
    appState.setActiveSession(project.id, sessions[0].id);
    appState.cycleSession(-1);
    expect(appState.activeProject!.activeSessionId).toBe(sessions[2].id);
  });

  it('wraps around forward', () => {
    const { project, sessions } = addProjectWithSessions(3);
    appState.setActiveSession(project.id, sessions[2].id);
    appState.cycleSession(1);
    expect(appState.activeProject!.activeSessionId).toBe(sessions[0].id);
  });
});

describe('gotoSession()', () => {
  it('goes to session by index', () => {
    const { sessions } = addProjectWithSessions(3);
    appState.gotoSession(1);
    expect(appState.activeProject!.activeSessionId).toBe(sessions[1].id);
  });

  it('no-op for out-of-bounds index', () => {
    const { sessions } = addProjectWithSessions(2);
    const before = appState.activeProject!.activeSessionId;
    appState.gotoSession(5);
    expect(appState.activeProject!.activeSessionId).toBe(before);
  });
});

describe('batch removals', () => {
  it('removeAllSessions removes all sessions', () => {
    const { project } = addProjectWithSessions(3);
    appState.removeAllSessions(project.id);
    expect(appState.activeProject!.sessions).toHaveLength(0);
  });

  it('removeSessionsFromRight removes sessions after given', () => {
    const { project, sessions } = addProjectWithSessions(4);
    appState.removeSessionsFromRight(project.id, sessions[1].id);
    expect(appState.activeProject!.sessions).toHaveLength(2);
    expect(appState.activeProject!.sessions.map((s) => s.id)).toEqual([sessions[0].id, sessions[1].id]);
  });

  it('removeSessionsFromLeft removes sessions before given', () => {
    const { project, sessions } = addProjectWithSessions(4);
    appState.removeSessionsFromLeft(project.id, sessions[2].id);
    expect(appState.activeProject!.sessions).toHaveLength(2);
    expect(appState.activeProject!.sessions.map((s) => s.id)).toEqual([sessions[2].id, sessions[3].id]);
  });

  it('removeOtherSessions removes all except given', () => {
    const { project, sessions } = addProjectWithSessions(4);
    appState.removeOtherSessions(project.id, sessions[1].id);
    expect(appState.activeProject!.sessions).toHaveLength(1);
    expect(appState.activeProject!.sessions[0].id).toBe(sessions[1].id);
  });
});

describe('reorderSession()', () => {
  it('moves session to a different index', () => {
    const { project, sessions } = addProjectWithSessions(3);
    appState.reorderSession(project.id, sessions[0].id, 2);
    const ids = appState.activeProject!.sessions.map((s) => s.id);
    expect(ids).toEqual([sessions[1].id, sessions[2].id, sessions[0].id]);
  });

  it('no-op when fromIndex === toIndex', () => {
    const { project, sessions } = addProjectWithSessions(3);
    mockSave.mockClear();
    appState.reorderSession(project.id, sessions[1].id, 1);
    expect(mockSave).not.toHaveBeenCalled();
  });
});

describe('preferences', () => {
  it('setPreference updates and persists', () => {
    appState.setPreference('debugMode', true);
    expect(appState.preferences.debugMode).toBe(true);
    expect(mockSave).toHaveBeenCalled();
  });

  it('setPreference emits preferences-changed', () => {
    const cb = vi.fn();
    appState.on('preferences-changed', cb);
    appState.setPreference('soundOnSessionWaiting', true);
    expect(cb).toHaveBeenCalledTimes(1);
  });
});

describe('setSidebarWidth()', () => {
  it('sets sidebarWidth and persists', () => {
    appState.setSidebarWidth(300);
    expect(appState.sidebarWidth).toBe(300);
    expect(mockSave).toHaveBeenCalled();
  });
});

describe('setTerminalPanelOpen()', () => {
  it('sets terminalPanelOpen on active project and emits', () => {
    addProject();
    const cb = vi.fn();
    appState.on('terminal-panel-changed', cb);
    appState.setTerminalPanelOpen(true);
    expect(appState.activeProject!.terminalPanelOpen).toBe(true);
    expect(cb).toHaveBeenCalledTimes(1);
    expect(mockSave).toHaveBeenCalled();
  });

  it('no-op when no active project', () => {
    mockSave.mockClear();
    appState.setTerminalPanelOpen(true);
    expect(mockSave).not.toHaveBeenCalled();
  });
});

describe('setTerminalPanelHeight()', () => {
  it('sets terminalPanelHeight on active project', () => {
    addProject();
    appState.setTerminalPanelHeight(250);
    expect(appState.activeProject!.terminalPanelHeight).toBe(250);
    expect(mockSave).toHaveBeenCalled();
  });
});

describe('on() / event system', () => {
  it('returns an unsubscribe function that works', () => {
    const cb = vi.fn();
    const unsub = appState.on('project-changed', cb);
    addProject();
    expect(cb).toHaveBeenCalledTimes(1);
    unsub();
    addProject();
    expect(cb).toHaveBeenCalledTimes(1); // not called again
  });
});

describe('setActiveProject()', () => {
  it('sets activeProjectId and emits project-changed', () => {
    const p1 = addProject('P1', '/p1');
    addProject('P2', '/p2');
    const cb = vi.fn();
    appState.on('project-changed', cb);
    appState.setActiveProject(p1.id);
    expect(appState.activeProjectId).toBe(p1.id);
    expect(cb).toHaveBeenCalled();
    expect(mockSave).toHaveBeenCalled();
  });
});
