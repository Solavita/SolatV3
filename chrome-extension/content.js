(() => {
  'use strict';
  const LIMIT = 120;
  const MAX_DOM_NODES = 10_000;
  const MAX_CANDIDATES = 2_000;
  const MAX_FILL_CHARACTERS = 50_000;
  let revision = 0;
  let targets = new Map();
  let controlUi = null;
  let controlUiCleanup = null;
  let privacyStateValue = null;
  let privacyCheckTimer = null;

  const privateSelector = [
    'input[type="password"]',
    'input[autocomplete="current-password"]',
    'input[autocomplete="new-password"]',
    'input[autocomplete="one-time-code"]',
    'input[autocomplete^="cc-"]',
    'iframe[src*="recaptcha" i]',
    'iframe[src*="hcaptcha" i]',
    '[class*="captcha" i]',
    '[id*="captcha" i]',
  ].join(',');

  const identitySelector = [
    'input[autocomplete="username"]',
    'input[autocomplete="email"]',
    'input[name*="username" i]',
    'input[name*="login" i]',
  ].join(',');

  function isPrivateSurface() {
    const host = String(location.hostname || '').toLowerCase();
    const path = String(location.pathname || '').toLowerCase();
    const authRoute = /(?:^|\/)(?:login|log-in|signin|sign-in|signup|sign-up|register|registration|oauth|authorize|authorization|auth|sso|session|challenge|verify|verification|mfa|2fa|checkout|purchase|billing|payment)(?:\/|$)/u.test(path);
    const secretUrl = /(?:[?&#](?:code|token|access_token|id_token|refresh_token|session|credential|api_key|key)=)/iu.test(`${location.search || ''}${location.hash || ''}`);
    const authHost = host === 'accounts.google.com' || host.endsWith('.accounts.google.com')
      || host === 'login.microsoftonline.com' || host.endsWith('.auth0.com')
      || host.endsWith('.okta.com') || host === 'appleid.apple.com';
    const visiblePrivateField = Array.from(document.querySelectorAll(privateSelector)).some(currentlyExposed);
    const visibleAuthForm = Array.from(document.querySelectorAll(identitySelector)).some(element => {
      if (!currentlyExposed(element)) return false;
      const region = element.closest('form,[role="dialog"]') || element.parentElement;
      const clue = `${region?.getAttribute?.('action') || ''} ${region?.innerText || ''}`.slice(0, 4000);
      return /(?:log\s*in|sign\s*in|continue\s+with|authenticate|verify|เข้าสู่ระบบ|ลงชื่อเข้าใช้)/iu.test(clue);
    });
    return authHost || authRoute || secretUrl || visiblePrivateField || visibleAuthForm;
  }

  function reportPrivacyState(next) {
    if (privacyStateValue === next) return;
    privacyStateValue = next;
    try {
      const pending = chrome.runtime.sendMessage({ type: 'solat_privacy_state', privacy: next });
      pending?.catch?.(() => {});
    } catch {}
  }

  function removeControlIndicator() {
    controlUiCleanup?.();
    controlUiCleanup = null;
    controlUi?.remove?.();
    controlUi = null;
    document.documentElement?.removeAttribute('data-solat-control-active');
  }

  function installControlIndicator() {
    if (controlUi || isPrivateSurface() || !document.documentElement) return Boolean(controlUi);
    const host = document.createElement('div');
    host.id = 'solatControlOverlay';
    host.setAttribute('aria-hidden', 'true');
    const shadow = host.attachShadow?.({ mode: 'open' });
    if (!shadow) return false;
    const uiStyle = document.createElement('style');
    uiStyle.textContent = `
        :host { all: initial; position: fixed; inset: 0; z-index: 2147483647; pointer-events: none; }
        #solatCursor {
          position: fixed; left: 0; top: 0; z-index: 2; width: 28px; height: 34px;
          pointer-events: none; opacity: 0;
          transform: translate3d(var(--cursor-x, -80px), var(--cursor-y, -80px), 0) rotate(-14deg);
          transform-origin: 4px 4px; transition: opacity .12s linear, filter .12s ease;
          filter: drop-shadow(4px 5px 0 rgba(255,33,24,.9)) drop-shadow(-2px -2px 0 #27edee);
        }
        #solatCursor::before {
          content: ""; position: absolute; inset: 0; background: #f6f2df;
          clip-path: polygon(0 0, 92% 64%, 56% 68%, 72% 100%, 55% 100%, 39% 70%, 14% 94%);
        }
        #solatCursor.on { opacity: 1; }
        #solatCursor.hit { filter: drop-shadow(7px 8px 0 #27edee); }
        #solatControlIndicator {
          position: fixed; top: 12px; right: 16px; z-index: 3; display: inline-flex;
          align-items: center; gap: 7px; min-height: 26px; box-sizing: border-box;
          padding: 5px 10px; border: 1px solid #27edee; border-radius: 999px;
          color: #ecfbff; background: rgba(6,21,50,.88); box-shadow: 0 0 0 1px rgba(255,33,24,.55), 0 0 18px rgba(39,237,238,.36);
          font: 700 11px/1.1 "Segoe UI", sans-serif; letter-spacing: .08em; white-space: nowrap;
          text-transform: uppercase; pointer-events: none;
        }
        #solatControlIndicator::before { content: ""; width: 7px; height: 7px; border-radius: 50%; background: #27edee; box-shadow: 0 0 8px #27edee; }
      `;
    const cursor = document.createElement('div');
    cursor.id = 'solatCursor';
    const indicator = document.createElement('div');
    indicator.id = 'solatControlIndicator';
    indicator.setAttribute('role', 'status');
    indicator.setAttribute('aria-label', 'SOLAT Chrome control active');
    indicator.textContent = 'SOLAT CONTROL';
    shadow.append(uiStyle, cursor, indicator);
    document.documentElement.append(host);
    controlUi = host;
    const style = document.createElement('style');
    style.textContent = '[data-solat-control-active], [data-solat-control-active] * { cursor: none !important; }';
    document.documentElement.append(style);
    document.documentElement.setAttribute('data-solat-control-active', 'true');
    let frame = 0;
    let x = -80;
    let y = -80;
    const paint = () => {
      cursor.style.setProperty('--cursor-x', `${x - 3}px`);
      cursor.style.setProperty('--cursor-y', `${y - 3}px`);
      frame = 0;
    };
    const pointerMove = event => {
      x = event.clientX; y = event.clientY;
      cursor.classList.add('on');
      if (!frame) frame = requestAnimationFrame(paint);
    };
    const pointerDown = () => cursor.classList.add('hit');
    const pointerUp = () => cursor.classList.remove('hit');
    const pointerLeave = () => { cursor.classList.remove('on'); cursor.classList.remove('hit'); };
    document.addEventListener('pointermove', pointerMove, { passive: true });
    document.addEventListener('pointerdown', pointerDown, { passive: true });
    document.addEventListener('pointerup', pointerUp, { passive: true });
    document.addEventListener('pointercancel', pointerUp, { passive: true });
    document.documentElement.addEventListener('mouseleave', pointerLeave, { passive: true });
    const finePointer = globalThis.matchMedia?.('(pointer: fine)')?.matches !== false;
    if (!finePointer) cursor.classList.remove('on');
    controlUiCleanup = () => {
      if (frame) cancelAnimationFrame(frame);
      document.removeEventListener('pointermove', pointerMove);
      document.removeEventListener('pointerdown', pointerDown);
      document.removeEventListener('pointerup', pointerUp);
      document.removeEventListener('pointercancel', pointerUp);
      document.documentElement.removeEventListener('mouseleave', pointerLeave);
      style.remove();
    };
    reportPrivacyState('clear');
    return true;
  }

  function setControlIndicator(enabled) {
    if (!enabled || isPrivateSurface()) {
      removeControlIndicator();
      if (!enabled || isPrivateSurface()) reportPrivacyState(isPrivateSurface() ? 'shielded' : 'clear');
      return false;
    }
    return installControlIndicator();
  }

  function privacyState() {
    const shielded = isPrivateSurface();
    if (shielded) removeControlIndicator();
    reportPrivacyState(shielded ? 'shielded' : 'clear');
    return shielded ? 'shielded' : 'clear';
  }

  function queuePrivacyCheck() {
    clearTimeout(privacyCheckTimer);
    privacyCheckTimer = setTimeout(() => { privacyCheckTimer = null; privacyState(); }, 120);
  }

  function installPrivacyWatcher() {
    new MutationObserver(queuePrivacyCheck).observe(document.documentElement, { subtree: true, childList: true, attributes: true, attributeFilter: ['class', 'id', 'style', 'hidden', 'aria-hidden', 'src', 'autocomplete', 'type'] });
    for (const eventName of ['hashchange', 'popstate', 'pageshow', 'visibilitychange']) addEventListener(eventName, queuePrivacyCheck, { passive: true });
    privacyState();
  }

  function visible(element) {
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
  }

  function currentlyExposed(element) {
    if (!visible(element)) return false;
    const rect = element.getBoundingClientRect();
    const opacity = Number.parseFloat(getComputedStyle(element).opacity || '1');
    return opacity > 0.05 && rect.bottom > 0 && rect.right > 0 && rect.top < innerHeight && rect.left < innerWidth;
  }

  function label(element) {
    return String(element.getAttribute('aria-label') || element.innerText || element.getAttribute('alt')
      || element.getAttribute('placeholder') || element.getAttribute('title') || '')
      .replace(/\s+/gu, ' ').trim().slice(0, 300);
  }

  function role(element) {
    return String(element.getAttribute('role') || ({ A: 'link', BUTTON: 'button', INPUT: 'textbox', TEXTAREA: 'textbox', SELECT: 'combobox', IMG: 'image' }[element.tagName]) || element.tagName.toLowerCase()).slice(0, 40);
  }

  function opaqueTargetId() {
    const words = crypto.getRandomValues(new Uint32Array(4));
    return `solat_${Array.from(words, word => word.toString(16).padStart(8, '0')).join('')}`;
  }

  function sensitiveElement(element) {
    const text = [element.type, element.name, element.id, element.autocomplete, element.getAttribute('aria-label'), element.getAttribute('placeholder')].join(' ');
    return element.type === 'password' || /(?:password|passcode|credential|user.?name|e-?mail|one.?time|\botp\b|\bmfa\b|\b2fa\b|\bpin\b|\bcvv\b|\bcvc\b|card|security.?code|รหัส|บัตร)/iu.test(text);
  }

  function boundedCandidates() {
    const selector = 'a,button,input,textarea,select,[role],[tabindex],[contenteditable="true"],img';
    const root = document.body || document.documentElement;
    if (!root) return { candidates: [], truncated: false };
    const candidates = [];
    const queue = [root];
    let cursor = 0;
    let truncated = false;
    while (cursor < queue.length && cursor < MAX_DOM_NODES && candidates.length < MAX_CANDIDATES) {
      const element = queue[cursor];
      cursor += 1;
      if (element.matches?.(selector)) candidates.push(element);
      const children = element.children || [];
      for (let index = 0; index < children.length; index += 1) {
        if (queue.length >= MAX_DOM_NODES) { truncated = true; break; }
        queue.push(children[index]);
      }
    }
    return { candidates, truncated: truncated || cursor < queue.length || candidates.length >= MAX_CANDIDATES };
  }

  function observe(nextRevision) {
    if (isPrivateSurface()) {
      removeControlIndicator();
      reportPrivacyState('shielded');
    }
    if (isPrivateSurface()) return { privacy: 'shielded', revision: nextRevision, title: '', items: [] };
    reportPrivacyState('clear');
    revision = Number(nextRevision) || revision;
    targets = new Map();
    const scan = boundedCandidates();
    const candidates = scan.candidates;
    const items = [];
    for (const element of candidates) {
      if (items.length >= LIMIT || !visible(element) || sensitiveElement(element)) continue;
      const name = label(element);
      if (!name && element.tagName !== 'INPUT' && element.tagName !== 'TEXTAREA' && element.tagName !== 'SELECT') continue;
      const id = opaqueTargetId();
      targets.set(id, element);
      items.push({
        target_id: id,
        role: role(element),
        name,
        disabled: Boolean(element.disabled || element.getAttribute('aria-disabled') === 'true'),
        editable: Boolean(element.matches('input:not([type="password"]),textarea,select,[contenteditable="true"]')),
        asset: element.matches('img') && Boolean(element.currentSrc || element.src),
      });
    }
    return { privacy: 'clear', revision, title: String(document.title || '').slice(0, 300), items, truncated: scan.truncated || candidates.length > items.length };
  }

  function target(message) {
    if (isPrivateSurface()) { removeControlIndicator(); reportPrivacyState('shielded'); }
    if (isPrivateSurface()) throw Object.assign(new Error('Private authentication surface.'), { code: 'browser_sensitive_surface' });
    if (Number(message.revision) !== revision) throw Object.assign(new Error('Target belongs to an older navigation.'), { code: 'stale_target' });
    const element = targets.get(String(message.target_id || ''));
    if (!element || !element.isConnected || !visible(element) || sensitiveElement(element)) throw Object.assign(new Error('Target is stale or unavailable.'), { code: 'stale_target' });
    return element;
  }

  async function handle(message) {
    if (!message || typeof message !== 'object') throw new Error('Invalid SOLAT browser message.');
    if (message.command === 'control_indicator') return { enabled: setControlIndicator(Boolean(message.enabled)) };
    if (message.command === 'status') {
      const privacy = privacyState();
      return { privacy, title: privacy === 'shielded' ? '' : String(document.title || '').slice(0, 300) };
    }
    if (message.command === 'observe') return observe(message.revision);
    const element = target(message);
    if (message.command === 'click') {
      if (element.disabled || element.getAttribute('aria-disabled') === 'true') throw Object.assign(new Error('Target is disabled.'), { code: 'target_unavailable' });
      element.click();
      await new Promise(resolve => setTimeout(resolve, 120));
      return { clicked: true, target_gone: !element.isConnected };
    }
    if (message.command === 'fill') {
      if (!element.matches('input:not([type="password"]),textarea,[contenteditable="true"]')) throw Object.assign(new Error('Target is not editable.'), { code: 'target_unavailable' });
      const value = String(message.value ?? '');
      if (value.length > MAX_FILL_CHARACTERS) throw Object.assign(new Error('Fill text exceeds the bounded limit.'), { code: 'invalid_request' });
      if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
        const descriptor = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(element), 'value');
        descriptor?.set?.call(element, value);
      } else element.textContent = value;
      try { element.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: value })); }
      catch { element.dispatchEvent(new Event('input', { bubbles: true })); }
      element.dispatchEvent(new Event('change', { bubbles: true }));
      const actual = element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement ? element.value : element.textContent;
      return { filled: actual === value, value_length: value.length };
    }
    if (message.command === 'scroll') {
      element.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'auto' });
      await new Promise(resolve => requestAnimationFrame(() => resolve()));
      const rect = element.getBoundingClientRect();
      return { visible: rect.bottom > 0 && rect.right > 0 && rect.top < innerHeight && rect.left < innerWidth };
    }
    if (message.command === 'asset') {
      const image = element.matches('img') ? element : element.querySelector?.('img');
      const url = image?.currentSrc || image?.src;
      if (!url) throw Object.assign(new Error('Target has no image asset.'), { code: 'browser_asset_not_selected' });
      return { url, label: label(image) || 'Chrome image', page_url: location.href };
    }
    throw new Error('Unknown SOLAT browser command.');
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    Promise.resolve(handle(message)).then(value => sendResponse({ ok: true, value })).catch(error => sendResponse({ ok: false, error: { code: error?.code || 'chrome_content_error', message: String(error?.message || 'Chrome content action failed.').slice(0, 300) } }));
    return true;
  });

  document.addEventListener('click', event => {
    if (!event.altKey || privacyState() === 'shielded') return;
    const image = event.target?.closest?.('img');
    const url = image?.currentSrc || image?.src;
    if (!url) return;
    event.preventDefault(); event.stopPropagation(); event.stopImmediatePropagation();
    void chrome.runtime.sendMessage({ type: 'solat_asset_selected', url, label: label(image) || 'Chrome image', page_url: location.href });
  }, true);
  installPrivacyWatcher();
})();
