import { appState } from './state.js';
import { promptNewProject } from './components/sidebar.js';
import { promptNewSession } from './components/tab-bar.js';
import { toggleProjectTerminal } from './components/project-terminal.js';
import { toggleDebugPanel } from './components/debug-panel.js';
import { showHelpDialog } from './components/help-dialog.js';
import { getFocusedSessionId } from './components/terminal-pane.js';
import { showSearchBar } from './components/search-bar.js';
import { toggleGitPanel } from './components/git-panel.js';

export function initKeybindings(): void {
  // Menu-based shortcuts (registered via Electron menu accelerators)
  // These handlers receive events forwarded from the main process menu

  window.claudeIde.menu.onNewProject(() => promptNewProject());
  window.claudeIde.menu.onNewSession(() => promptNewSession());
  window.claudeIde.menu.onToggleSplit(() => appState.toggleSplit());
  window.claudeIde.menu.onNextSession(() => appState.cycleSession(1));
  window.claudeIde.menu.onPrevSession(() => appState.cycleSession(-1));
  window.claudeIde.menu.onGotoSession((index) => appState.gotoSession(index));
  window.claudeIde.menu.onToggleDebug(() => toggleDebugPanel());

  document.addEventListener('keydown', (e) => {
    // Cmd+F / Ctrl+F to open terminal search
    if ((e.metaKey || e.ctrlKey) && e.key === 'f') {
      const sessionId = getFocusedSessionId();
      if (sessionId) {
        e.preventDefault();
        showSearchBar(sessionId);
      }
    }
    // Ctrl+` to toggle project terminal
    if ((e.ctrlKey || e.metaKey) && e.key === '`') {
      e.preventDefault();
      toggleProjectTerminal();
    }
    // F1 to show help dialog
    if (e.key === 'F1') {
      e.preventDefault();
      showHelpDialog();
    }
    // Ctrl+Shift+G / Cmd+Shift+G to toggle git panel
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'G') {
      e.preventDefault();
      toggleGitPanel();
    }
  });
}
