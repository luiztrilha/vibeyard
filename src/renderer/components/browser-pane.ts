interface BrowserPaneInstance {
  element: HTMLElement;
  webview: Electron.WebviewTag;
  addressBar: HTMLInputElement;
  backBtn: HTMLButtonElement;
  forwardBtn: HTMLButtonElement;
}

const instances = new Map<string, BrowserPaneInstance>();

function smartUrl(input: string): string {
  const trimmed = input.trim();
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
}

function updateNavButtons(instance: BrowserPaneInstance): void {
  instance.backBtn.disabled = !instance.webview.canGoBack();
  instance.forwardBtn.disabled = !instance.webview.canGoForward();
}

export function createBrowserPane(sessionId: string, url: string): void {
  if (instances.has(sessionId)) return;

  const el = document.createElement('div');
  el.className = 'browser-pane';
  el.style.display = 'none';

  const nav = document.createElement('div');
  nav.className = 'browser-nav';

  const backBtn = document.createElement('button');
  backBtn.className = 'browser-nav-btn';
  backBtn.title = 'Back';
  backBtn.textContent = '←';
  backBtn.disabled = true;

  const forwardBtn = document.createElement('button');
  forwardBtn.className = 'browser-nav-btn';
  forwardBtn.title = 'Forward';
  forwardBtn.textContent = '→';
  forwardBtn.disabled = true;

  const reloadBtn = document.createElement('button');
  reloadBtn.className = 'browser-nav-btn';
  reloadBtn.title = 'Reload';
  reloadBtn.textContent = '↻';

  const addressBar = document.createElement('input');
  addressBar.className = 'browser-address-bar';
  addressBar.type = 'text';
  addressBar.value = url;
  addressBar.spellcheck = false;

  nav.appendChild(backBtn);
  nav.appendChild(forwardBtn);
  nav.appendChild(reloadBtn);
  nav.appendChild(addressBar);
  el.appendChild(nav);

  const webview = document.createElement('webview') as Electron.WebviewTag;
  webview.className = 'browser-webview';
  webview.src = url;
  el.appendChild(webview);

  const instance: BrowserPaneInstance = { element: el, webview, addressBar, backBtn, forwardBtn };
  instances.set(sessionId, instance);

  webview.addEventListener('did-navigate', (e) => {
    addressBar.value = e.url;
    updateNavButtons(instance);
  });

  webview.addEventListener('did-navigate-in-page', (e) => {
    if (e.isMainFrame) {
      addressBar.value = e.url;
      updateNavButtons(instance);
    }
  });

  backBtn.addEventListener('click', () => webview.goBack());
  forwardBtn.addEventListener('click', () => webview.goForward());
  reloadBtn.addEventListener('click', () => webview.reload());

  addressBar.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      webview.loadURL(smartUrl(addressBar.value));
    }
  });

  addressBar.addEventListener('focus', () => addressBar.select());
}

export function destroyBrowserPane(sessionId: string): void {
  const instance = instances.get(sessionId);
  if (!instance) return;
  instance.element.remove();
  instances.delete(sessionId);
}

export function showBrowserPane(sessionId: string, isSplit: boolean): void {
  const instance = instances.get(sessionId);
  if (!instance) return;
  instance.element.style.display = 'flex';
  if (isSplit) instance.element.classList.add('split');
  else instance.element.classList.remove('split');
}

export function hideAllBrowserPanes(): void {
  for (const instance of instances.values()) {
    instance.element.style.display = 'none';
  }
}

export function attachBrowserToContainer(sessionId: string, container: HTMLElement): void {
  const instance = instances.get(sessionId);
  if (!instance) return;
  if (instance.element.parentElement !== container) {
    container.appendChild(instance.element);
  }
}

export function getBrowserInstance(sessionId: string): BrowserPaneInstance | undefined {
  return instances.get(sessionId);
}
