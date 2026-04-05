import { beforeEach, describe, expect, it, vi } from 'vitest';

const providerCaps = new Map([
  ['claude', { costTracking: true, contextWindow: true, pendingPromptTrigger: 'startup-arg', shiftEnterNewline: true }],
  ['gemini', { costTracking: false, contextWindow: false, pendingPromptTrigger: 'startup-arg', shiftEnterNewline: false }],
  ['codex', { costTracking: false, contextWindow: false, pendingPromptTrigger: process.platform === 'win32' ? 'first-output' : 'startup-arg', shiftEnterNewline: false }],
]);

const mockPtyWrite = vi.fn();
const mockPtyKill = vi.fn();

vi.mock('@xterm/xterm', () => ({
  Terminal: class FakeTerminal {
    cols = 120;
    rows = 30;
    keyHandler?: (e: KeyboardEvent) => boolean;
    loadAddon(): void {}
    attachCustomKeyEventHandler(handler: (e: KeyboardEvent) => boolean): void {
      this.keyHandler = handler;
    }
    registerLinkProvider(): void {}
    onData(): void {}
    open(): void {}
    write(): void {}
    focus(): void {}
    dispose(): void {}
  },
}));

vi.mock('@xterm/addon-fit', () => ({
  FitAddon: class FakeFitAddon {
    fit(): void {}
  },
}));

vi.mock('@xterm/addon-webgl', () => ({
  WebglAddon: class FakeWebglAddon {},
}));

vi.mock('@xterm/addon-search', () => ({
  SearchAddon: class FakeSearchAddon {},
}));

vi.mock('@xterm/addon-web-links', () => ({
  WebLinksAddon: class FakeWebLinksAddon {
    constructor(_cb: unknown) {}
  },
}));

vi.mock('../session-activity.js', () => ({
  initSession: vi.fn(),
  removeSession: vi.fn(),
}));

vi.mock('../session-insights.js', () => ({
  markFreshSession: vi.fn(),
}));

vi.mock('../session-cost.js', () => ({
  removeSession: vi.fn(),
}));

vi.mock('../session-context.js', () => ({
  removeSession: vi.fn(),
}));

vi.mock('../provider-availability.js', () => ({
  getProviderCapabilities: vi.fn((providerId: string) => providerCaps.get(providerId) ?? null),
}));

vi.mock('./terminal-link-provider.js', () => ({
  FilePathLinkProvider: class FakeFilePathLinkProvider {},
  GithubLinkProvider: class FakeGithubLinkProvider {},
}));

class FakeClassList {
  private values = new Set<string>();

  add(...tokens: string[]): void {
    for (const token of tokens) this.values.add(token);
  }

  remove(...tokens: string[]): void {
    for (const token of tokens) this.values.delete(token);
  }

  toggle(token: string, force?: boolean): boolean {
    const shouldAdd = force ?? !this.values.has(token);
    if (shouldAdd) this.values.add(token);
    else this.values.delete(token);
    return shouldAdd;
  }

  contains(token: string): boolean {
    return this.values.has(token);
  }
}

class FakeElement {
  children: FakeElement[] = [];
  parentElement: FakeElement | null = null;
  className = '';
  classList = new FakeClassList();
  dataset: Record<string, string> = {};
  textContent = '';

  constructor(public tagName: string) {}

  appendChild(child: FakeElement): FakeElement {
    child.parentElement = this;
    this.children.push(child);
    return child;
  }

  remove(): void {
    if (!this.parentElement) return;
    this.parentElement.children = this.parentElement.children.filter((child) => child !== this);
    this.parentElement = null;
  }

  addEventListener(): void {}

  querySelector(selector: string): FakeElement | null {
    if (selector.startsWith('.')) {
      const className = selector.slice(1);
      return this.find((child) => child.className.split(/\s+/).includes(className) || child.classList.contains(className));
    }
    return null;
  }

  private find(predicate: (el: FakeElement) => boolean): FakeElement | null {
    for (const child of this.children) {
      if (predicate(child)) return child;
      const nested = child.find(predicate);
      if (nested) return nested;
    }
    return null;
  }
}

class FakeDocument {
  body = new FakeElement('body');
  activeElement: FakeElement | null = null;

  createElement(tagName: string): FakeElement {
    return new FakeElement(tagName);
  }
}

describe('terminal pending prompt injection', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.useFakeTimers();

    vi.stubGlobal('document', new FakeDocument());
    vi.stubGlobal('window', {
      vibeyard: {
        pty: {
          write: mockPtyWrite,
          kill: mockPtyKill,
          resize: vi.fn(),
          create: vi.fn(),
        },
        git: {
          getRemoteUrl: vi.fn(async () => null),
        },
        app: {
          openExternal: vi.fn(),
        },
      },
    });
  });

  it('passes pending prompt as initialPrompt to pty.create for claude', async () => {
    const { createTerminalPane, setPendingPrompt, spawnTerminal } = await import('./terminal-pane.js');
    const mockPtyCreate = (window as any).vibeyard.pty.create;

    createTerminalPane('claude-1', '/project', null, false, '', 'claude');
    setPendingPrompt('claude-1', 'fix the bug');
    await spawnTerminal('claude-1');

    expect(mockPtyCreate).toHaveBeenCalledWith('claude-1', '/project', null, false, '', 'claude', 'fix the bug');
    expect(mockPtyWrite).not.toHaveBeenCalled();
  });

  it('passes pending prompt as initialPrompt to pty.create for codex', async () => {
    const { createTerminalPane, setPendingPrompt, spawnTerminal } = await import('./terminal-pane.js');
    const mockPtyCreate = (window as any).vibeyard.pty.create;

    createTerminalPane('codex-1', '/project', null, false, '', 'codex');
    setPendingPrompt('codex-1', 'fix the bug');
    await spawnTerminal('codex-1');
    if (process.platform === 'win32') {
      expect(mockPtyCreate).toHaveBeenCalledWith('codex-1', '/project', null, false, '', 'codex', undefined);
      const { handlePtyData } = await import('./terminal-pane.js');
      handlePtyData('codex-1', 'OpenAI Codex');
      handlePtyData('codex-1', 'Run /review on my current changes');
      await vi.advanceTimersByTimeAsync(10);
      expect(mockPtyWrite).toHaveBeenCalledWith('codex-1', 'fix the bug\r');
    } else {
      expect(mockPtyCreate).toHaveBeenCalledWith('codex-1', '/project', null, false, '', 'codex', 'fix the bug');
      expect(mockPtyWrite).not.toHaveBeenCalled();
    }
  });

  it('does not pass initialPrompt when no pending prompt is set', async () => {
    const { createTerminalPane, spawnTerminal } = await import('./terminal-pane.js');
    const mockPtyCreate = (window as any).vibeyard.pty.create;

    createTerminalPane('claude-2', '/project', null, false, '', 'claude');
    await spawnTerminal('claude-2');

    expect(mockPtyCreate).toHaveBeenCalledWith('claude-2', '/project', null, false, '', 'claude', undefined);
  });

  it('injects pending prompt only once when Codex prompt is ready', async () => {
    const { createTerminalPane, setPendingPrompt, handlePtyData, spawnTerminal } = await import('./terminal-pane.js');

    createTerminalPane('codex-2', '/project', null, false, '', 'codex');
    setPendingPrompt('codex-2', 'some prompt');
    await spawnTerminal('codex-2');
    handlePtyData('codex-2', 'some output');
    await vi.runAllTimersAsync();
    if (process.platform === 'win32') {
      expect(mockPtyWrite).not.toHaveBeenCalled();
      handlePtyData('codex-2', 'Run /review on my current changes');
      await vi.runAllTimersAsync();
      expect(mockPtyWrite).toHaveBeenCalledTimes(1);
      expect(mockPtyWrite).toHaveBeenCalledWith('codex-2', 'some prompt\r');
      mockPtyWrite.mockClear();
      handlePtyData('codex-2', 'second output');
      await vi.runAllTimersAsync();
      expect(mockPtyWrite).not.toHaveBeenCalled();
    } else {
      expect(mockPtyWrite).not.toHaveBeenCalled();
    }
  });

  it('sends the custom Shift+Enter sequence only for providers that support it', async () => {
    const { createTerminalPane } = await import('./terminal-pane.js');

    const instance = createTerminalPane('claude-shift-enter', '/project', null, false, '', 'claude');
    const keyHandler = (instance.terminal as { keyHandler?: (e: KeyboardEvent) => boolean }).keyHandler;
    const preventDefault = vi.fn();

    const result = keyHandler?.({
      type: 'keydown',
      key: 'Enter',
      shiftKey: true,
      metaKey: false,
      ctrlKey: false,
      preventDefault,
    } as unknown as KeyboardEvent);

    expect(result).toBe(false);
    expect(preventDefault).toHaveBeenCalled();
    expect(mockPtyWrite).toHaveBeenCalledWith('claude-shift-enter', '\x1b[13;2u');
  });

  it('does not intercept Shift+Enter for providers without a custom newline sequence', async () => {
    const { createTerminalPane } = await import('./terminal-pane.js');

    const instance = createTerminalPane('codex-shift-enter', '/project', null, false, '', 'codex');
    const keyHandler = (instance.terminal as { keyHandler?: (e: KeyboardEvent) => boolean }).keyHandler;
    const preventDefault = vi.fn();

    const result = keyHandler?.({
      type: 'keydown',
      key: 'Enter',
      shiftKey: true,
      metaKey: false,
      ctrlKey: false,
      preventDefault,
    } as unknown as KeyboardEvent);

    expect(result).toBe(true);
    expect(preventDefault).not.toHaveBeenCalled();
    expect(mockPtyWrite).not.toHaveBeenCalled();
  });
});
