/* SOLAT V2 renderer
 *
 * This file is the UI boundary only.  It deliberately contains no network
 * calls and no legacy V1 HTTP client.  Model work crosses the isolated
 * preload boundary through window.solat; the rest of this file owns the
 * interaction model that V1 exposed to the owner.
 */
(() => {
  'use strict';

  const $ = (selector, scope = document) => scope.querySelector(selector);
  const $$ = (selector, scope = document) => [...scope.querySelectorAll(selector)];
  const uid = prefix => `${prefix}-${globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`}`;
  const createSessionId = () => uid('session');
  const sessionStorageKey = threadId => `solat.v2.creative.session.${threadId}`;
  let sessionId = createSessionId();
  const now = () => Date.now();
  const root = document.documentElement;
  const store = {
    get(key, fallback = null) {
      try {
        const raw = localStorage.getItem(key);
        return raw == null ? fallback : JSON.parse(raw);
      } catch {
        return fallback;
      }
    },
    set(key, value) {
      try { localStorage.setItem(key, JSON.stringify(value)); } catch {}
    },
    remove(key) {
      try { localStorage.removeItem(key); } catch {}
    },
  };

  function text(value) { return String(value ?? ''); }

  // V1 only exposed sources from owner-approved public surfaces.  Keep the
  // same allowlist in the V2 presentation layer so a model response cannot
  // turn an arbitrary URL into a trusted-looking citation.
  const SOURCE_ALLOWLIST_HOSTS = new Set([
    'wikipedia.org', 'pinterest.com', 'tiktok.com', 'instagram.com',
    'facebook.com', 'youtube.com', 'youtu.be', 'gemini.google.com',
  ]);

  function isAllowedSourceUrl(value) {
    try {
      const parsed = new URL(value, location.href);
      if (!/^https?:$/i.test(parsed.protocol)) return false;
      const host = parsed.hostname.toLowerCase().replace(/\.$/, '');
      return [...SOURCE_ALLOWLIST_HOSTS].some(rootHost => host === rootHost || host.endsWith(`.${rootHost}`));
    } catch {
      return false;
    }
  }

  /* Remove a final model-written Sources block from the prose. Citations are
     rendered only from validated tool metadata, never from provider prose. */
  function splitSourceBlock(value) {
    const lines = text(value).replace(/\r\n?/g, '\n').split('\n');
    let headingIndex = -1;
    for (let index = lines.length - 1; index >= 0; index -= 1) {
      if (/^\s*(?:#{1,6}\s*)?(?:\*\*)?(?:Sources|แหล่งที่มา|แหล่งข้อมูล)(?:\*\*)?\s*:?\s*$/i.test(lines[index])) {
        headingIndex = index;
        break;
      }
    }
    if (headingIndex < 0) return null;
    const sources = [];
    let blockedCount = 0;
    let cursor = headingIndex + 1;
    for (; cursor < lines.length; cursor += 1) {
      const line = lines[cursor];
      if (!line.trim()) continue;
      const labeled = /^\s*(?:[-*+•]|\d{1,3}[.)])\s*(.*?)\s*:\s*(https?:\/\/\S+)\s*$/i.exec(line);
      const bare = /^\s*(?:(?:[-*+•]|\d{1,3}[.)])\s*)?(https?:\/\/\S+)\s*$/i.exec(line);
      if (!labeled && !bare) break;
      const rawUrl = (labeled ? labeled[2] : bare[1]).replace(/[),.;!?]+$/, '');
      if (!isAllowedSourceUrl(rawUrl)) { blockedCount += 1; continue; }
      sources.push({ title: labeled?.[1]?.trim() || new URL(rawUrl).hostname, url: rawUrl });
    }
    if (!sources.length && !blockedCount) return null;
    return {
      body: lines.slice(0, headingIndex).join('\n').trim(),
      sources,
      blockedCount,
    };
  }

  function sourceDisclosure(block) {
    const details = make('details', { class: 'source-fold', 'data-source-disclosure': '' });
    const summary = make('summary', { text: `Sources · ${block.sources.length}` });
    const list = make('div', { class: 'source-list' });
    for (const source of block.sources) {
      list.append(make('a', { href: source.url, target: '_blank', rel: 'noopener noreferrer', text: source.title }));
    }
    if (block.blockedCount) {
      list.append(make('div', { class: 'source-policy-note', text: `${block.blockedCount} source(s) hidden because the domain is outside SOLAT's approved source list.` }));
    }
    details.append(summary, list);
    return details;
  }

  function responseSources(value) {
    const seen = new Set();
    const sources = [];
    for (const source of Array.isArray(value) ? value : []) {
      const url = text(source?.url).trim();
      if (!url || seen.has(url) || !isAllowedSourceUrl(url)) continue;
      seen.add(url);
      sources.push({ title: text(source?.title).trim() || new URL(url).hostname, url });
    }
    return sources;
  }

  function canonicalSourceUrl(value) {
    try {
      const parsed = new URL(value);
      parsed.hash = '';
      return parsed.toString().replace(/\/$/, '');
    } catch {
      return '';
    }
  }

  function restrictAssistantLinks(node, sources) {
    const allowed = new Set(sources.map(source => canonicalSourceUrl(source.url)).filter(Boolean));
    for (const link of $$('a[href]', node)) {
      if (allowed.has(canonicalSourceUrl(link.href))) continue;
      link.replaceWith(document.createTextNode(link.textContent || link.href));
    }
  }

  function icon(name) {
    const svg = document.createElement('svg');
    svg.className = 'icon';
    const use = document.createElement('use');
    use.setAttribute('href', `#i-${name}`);
    svg.append(use);
    return svg;
  }

  function make(tag, attrs = {}, ...children) {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(attrs)) {
      if (value == null || value === false) continue;
      if (key === 'class') node.className = value;
      else if (key === 'text') node.textContent = value;
      else if (key === 'html') node.innerHTML = value;
      else if (key === 'style' && typeof value === 'object') Object.assign(node.style, value);
      else if (key === 'dataset' && typeof value === 'object') Object.assign(node.dataset, value);
      else if (value === true) node.setAttribute(key, '');
      else node.setAttribute(key, value);
    }
    for (const child of children.flat()) {
      if (child == null) continue;
      node.append(child.nodeType ? child : document.createTextNode(text(child)));
    }
    return node;
  }

  function escapeHtml(value) {
    return text(value).replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));
  }

  function inlineMarkdown(value) {
    let html = escapeHtml(value);
    html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
    html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    html = html.replace(/__([^_]+)__/g, '<strong>$1</strong>');
    html = html.replace(/\*([^*]+)\*/g, '<em>$1</em>');
    html = html.replace(/~~([^~]+)~~/g, '<s>$1</s>');
    html = html.replace(/\[([^\]]+)\]\((https:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noreferrer noopener">$1</a>');
    return html;
  }

  function codeBlock(language, source) {
    const box = make('div', { class: 'code' });
    const copy = make('button', { class: 'act', type: 'button' }, icon('copy'), make('span', { text: 'Copy' }));
    copy.addEventListener('click', async () => {
      const ok = await copyText(source);
      copy.textContent = '';
      copy.append(icon(ok ? 'check' : 'alert'), make('span', { text: ok ? 'Copied' : 'Copy failed' }));
      copy.classList.toggle('done', ok);
      setTimeout(() => { copy.textContent = ''; copy.append(icon('copy'), make('span', { text: 'Copy' })); copy.classList.remove('done'); }, 1700);
    });
    box.append(make('div', { class: 'code-top' }, make('span', { class: 'code-lang', text: language || 'text' }), copy), make('pre', {}, make('code', { text: source })));
    return box;
  }

  function markdownTable(rows) {
    const table = make('table', { class: 'md-table' });
    const head = make('thead');
    const body = make('tbody');
    rows.forEach((cells, index) => {
      const row = make('tr');
      cells.forEach(cell => row.append(make(index === 0 ? 'th' : 'td', { html: inlineMarkdown(cell.trim()) })));
      (index === 0 ? head : body).append(row);
    });
    table.append(head, body);
    return make('div', { class: 'md-tablewrap' }, table);
  }

  function splitTableRow(line) {
    return line.trim().replace(/^\||\|$/g, '').split('|');
  }

  function renderMarkdown(value) {
    const host = make('div', { class: 'md' });
    const lines = text(value).replace(/\r/g, '').split('\n');
    let list = null;
    let code = null;
    const closeList = () => { list = null; };
    const closeCode = () => {
      if (!code) return;
      host.append(codeBlock(code.language, code.lines.join('\n')));
      code = null;
    };
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index];
      if (/^```/.test(line)) {
        if (code) closeCode();
        else {
          closeList();
          code = { language: line.slice(3).trim(), lines: [] };
        }
        continue;
      }
      if (code) { code.lines.push(line); continue; }
      if (!line.trim()) { closeList(); continue; }
      if (/^\s*\|.*\|\s*$/.test(line) && /^\s*\|[\s:|-]+\|\s*$/.test(lines[index + 1] || '')) {
        closeList();
        const rows = [splitTableRow(line)];
        let tableIndex = index + 2;
        while (tableIndex < lines.length && /^\s*\|.*\|\s*$/.test(lines[tableIndex])) rows.push(splitTableRow(lines[tableIndex++]));
        host.append(markdownTable(rows));
        index = tableIndex - 1;
        continue;
      }
      const heading = /^(#{1,3})\s+(.+)$/.exec(line);
      if (heading) { closeList(); host.append(make(`h${heading[1].length}`, { html: inlineMarkdown(heading[2]) })); continue; }
      const bullet = /^\s*[-*]\s+(.+)$/.exec(line);
      const ordered = /^\s*\d+[.)]\s+(.+)$/.exec(line);
      if (bullet || ordered) {
        const tag = bullet ? 'ul' : 'ol';
        if (!list || list.tagName.toLowerCase() !== tag) { closeList(); list = make(tag); host.append(list); }
        list.append(make('li', { html: inlineMarkdown((bullet || ordered)[1]) }));
        continue;
      }
      if (/^>\s?/.test(line)) { closeList(); host.append(make('blockquote', { html: inlineMarkdown(line.replace(/^>\s?/, '')) })); continue; }
      if (/^---+$/.test(line.trim())) { closeList(); host.append(make('hr')); continue; }
      closeList(); host.append(make('p', { html: inlineMarkdown(line) }));
    }
    closeCode();
    return host;
  }

  function fileSize(bytes) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1048576) return `${(bytes / 1024).toFixed(0)} KB`;
    return `${(bytes / 1048576).toFixed(1)} MB`;
  }

  function titleFrom(value) {
    const clean = text(value).replace(/\s+/g, ' ').trim().replace(/^[\s"'`]+/, '');
    if (!clean) return 'New conversation';
    const first = clean.split(/[.!?\n]/)[0].trim();
    const words = first.split(' ');
    return `${words.slice(0, 7).join(' ')}${words.length > 7 ? '…' : ''}`.slice(0, 80);
  }

  function relTime(timestamp) {
    const seconds = Math.max(0, (now() - timestamp) / 1000);
    if (seconds < 60) return 'just now';
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
    if (seconds < 604800) return `${Math.floor(seconds / 86400)}d ago`;
    return new Date(timestamp).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  }

  function copyText(value) {
    const valueText = text(value);
    if (navigator.clipboard?.writeText) {
      return navigator.clipboard.writeText(valueText).then(() => true).catch(() => false);
    }
    const area = make('textarea', { style: { position: 'fixed', opacity: '0' }, text: valueText });
    document.body.append(area); area.select();
    let result = false;
    try { result = document.execCommand('copy'); } catch {}
    area.remove();
    return Promise.resolve(result);
  }

  const Settings = {
    values: {
      theme: 'system', scale: 'm', density: 'comfortable', motion: true,
      enterSends: true, persist: true,
    },
    load() { this.values = { ...this.values, ...(store.get('solat.v2.settings', {}) || {}) }; this.apply(); },
    get(key) { return this.values[key]; },
    set(key, value) { this.values[key] = value; store.set('solat.v2.settings', this.values); this.apply(); },
    apply() {
      root.dataset.theme = this.values.theme;
      root.dataset.scale = this.values.scale;
      root.dataset.density = this.values.density;
      root.dataset.motion = this.values.motion ? 'on' : 'off';
      const themeButtons = $$('#themeSeg button');
      const scaleButtons = $$('#scaleSeg button');
      const densityButtons = $$('#densitySeg button');
      for (const button of themeButtons) button.setAttribute('aria-pressed', String(button.dataset.v === this.values.theme));
      for (const button of scaleButtons) button.setAttribute('aria-pressed', String(button.dataset.v === this.values.scale));
      for (const button of densityButtons) button.setAttribute('aria-pressed', String(button.dataset.v === this.values.density));
      for (const [id, key] of [['motionSwitch', 'motion'], ['enterSwitch', 'enterSends'], ['persistSwitch', 'persist']]) {
        const button = document.getElementById(id); if (button) button.setAttribute('aria-checked', String(this.values[key]));
      }
      const hint = $('#hint');
      if (hint) hint.innerHTML = this.values.enterSends ? '<kbd>Enter</kbd> to send · <kbd>Shift</kbd>+<kbd>Enter</kbd> for a new line' : '<kbd>Ctrl</kbd>+<kbd>Enter</kbd> to send · <kbd>Enter</kbd> for a new line';
      const themeButton = $('#themeBtn');
      if (themeButton && !themeButton.classList.contains('ui-mode-toggle')) {
        themeButton.textContent = '';
        themeButton.append(icon(this.values.theme === 'dark' ? 'moon' : this.values.theme === 'light' ? 'sun' : 'monitor'));
        themeButton.title = `Theme: ${this.values.theme}`;
      }
    },
  };

  const State = {
    threads: [], activeId: null, listeners: new Set(),
    get active() { return this.threads.find(thread => thread.id === this.activeId) || null; },
    emit(reason = 'state') { this.persist(); for (const listener of this.listeners) listener(reason); },
    subscribe(listener) { this.listeners.add(listener); return () => this.listeners.delete(listener); },
    persist() {
      if (!Settings.get('persist')) return;
      store.set('solat.v2.threads', { v: 2, activeId: this.activeId, threads: this.threads });
      const sessionMap = {};
      for (const thread of this.threads) {
        const sessionId = sessionFor(thread.id);
        sessionMap[thread.id] = sessionId;
        window.solat?.saveConversation?.({ sessionId, thread }).catch(() => {});
      }
      store.set('solat.v2.conversation.sessions', sessionMap);
    },
    load() {
      const saved = store.get('solat.v2.threads', null);
      this.threads = Array.isArray(saved?.threads) ? saved.threads : [];
      this.threads = this.threads.map(thread => ({
        id: text(thread.id) || uid('thread'), title: text(thread.title) || 'New conversation',
        createdAt: Number(thread.createdAt) || now(), updatedAt: Number(thread.updatedAt) || now(),
        messages: Array.isArray(thread.messages) ? thread.messages : [],
        projectId: text(thread.projectId) || null,
      }));
      this.activeId = this.threads.some(thread => thread.id === saved?.activeId) ? saved.activeId : this.threads[0]?.id || null;
      if (!this.threads.length) this.create(false);
    },
    async restoreDurable() {
      if (!window.solat?.loadConversation) return;
      const sessionMap = store.get('solat.v2.conversation.sessions', {});
      if (!sessionMap || typeof sessionMap !== 'object') return;
      let restoredWithMessages = null;
      for (const [threadId, sessionId] of Object.entries(sessionMap)) {
        try {
          const restored = await window.solat.loadConversation({ sessionId });
          const thread = restored?.thread;
          if (!thread) continue;
          const current = this.threads.find(item => item.id === threadId);
          if (!current) {
            this.threads.push({ ...thread, id: threadId, messages: Array.isArray(thread.messages) ? thread.messages : [] });
          } else if (Number(thread.updatedAt) > Number(current.updatedAt)) {
            Object.assign(current, { ...thread, id: threadId, messages: Array.isArray(thread.messages) ? thread.messages : [] });
          }
          if (Array.isArray(thread.messages) && thread.messages.length && (!restoredWithMessages || Number(thread.updatedAt) > Number(restoredWithMessages.updatedAt))) restoredWithMessages = { ...thread, id: threadId };
        } catch {
          // Durable recovery must not prevent the normal local conversation path.
        }
      }
      this.threads.sort((a, b) => Number(b.updatedAt) - Number(a.updatedAt));
      if (!this.threads.some(thread => thread.id === this.activeId)) this.activeId = this.threads[0]?.id || null;
      if (restoredWithMessages && !this.threads.find(thread => thread.id === this.activeId)?.messages?.length) this.activeId = restoredWithMessages.id;
      this.persist();
      this.emit('durable-restore');
    },
    create(emit = true) {
      const timestamp = now();
      const thread = { id: uid('thread'), title: 'New conversation', createdAt: timestamp, updatedAt: timestamp, messages: [], projectId: Projects.activeId || null };
      this.threads.unshift(thread); this.activeId = thread.id;
      if (emit) this.emit('active');
      return thread;
    },
    select(id) { if (this.threads.some(thread => thread.id === id)) { this.activeId = id; this.emit('active'); } },
    rename(id, title) {
      const thread = this.threads.find(item => item.id === id); if (!thread) return;
      thread.title = text(title).trim() || 'New conversation'; thread.updatedAt = now(); this.emit('threads');
    },
    add(id, message) {
      const thread = this.threads.find(item => item.id === id); if (!thread) return null;
      const next = { id: uid('message'), ts: now(), ...message };
      thread.messages.push(next); thread.updatedAt = next.ts; this.emit('messages'); return next;
    },
    updateMessage(id, messageId, patch) {
      const thread = this.threads.find(item => item.id === id); if (!thread) return null;
      const message = thread.messages.find(item => item.id === messageId); if (!message) return null;
      Object.assign(message, patch, { ts: now() }); thread.updatedAt = message.ts; this.emit('messages'); return message;
    },
    removeMessage(id, messageId) {
      const thread = this.threads.find(item => item.id === id); if (!thread) return null;
      const index = thread.messages.findIndex(message => message.id === messageId); if (index < 0) return null;
      const [message] = thread.messages.splice(index, 1); thread.updatedAt = now(); this.emit('messages'); return message;
    },
    truncateAfter(id, messageId) {
      const thread = this.threads.find(item => item.id === id); if (!thread) return;
      const index = thread.messages.findIndex(message => message.id === messageId);
      if (index >= 0) thread.messages = thread.messages.slice(0, index); thread.updatedAt = now(); this.emit('messages');
    },
    remove(id) {
      const index = this.threads.findIndex(thread => thread.id === id); if (index < 0) return null;
      const [thread] = this.threads.splice(index, 1);
      if (!this.threads.length) this.create(false);
      else if (this.activeId === id) this.activeId = this.threads[Math.min(index, this.threads.length - 1)].id;
      this.emit('active'); return { thread, index };
    },
    restore(thread, index) { this.threads.splice(Math.min(index, this.threads.length), 0, thread); this.activeId = thread.id; this.emit('active'); },
  };

  const Projects = {
    items: [], activeId: null,
    load() {
      const saved = store.get('solat.v2.projects', {});
      this.items = Array.isArray(saved?.items) ? saved.items.map(item => ({ id: text(item.id) || uid('project'), title: text(item.title).trim() || 'Untitled project', createdAt: Number(item.createdAt) || now() })) : [];
      this.activeId = this.items.some(item => item.id === saved?.activeId) ? saved.activeId : null;
    },
    persist() { store.set('solat.v2.projects', { v: 1, activeId: this.activeId, items: this.items }); },
    create() {
      const project = { id: uid('project'), title: 'Untitled project', createdAt: now() };
      this.items.unshift(project); this.activeId = project.id;
      if (State.active) State.active.projectId = project.id;
      this.persist(); State.emit('projects'); this.render(); this.beginRename(project);
    },
    open(project) {
      this.activeId = project.id; this.persist();
      const thread = [...State.threads].sort((a, b) => b.updatedAt - a.updatedAt).find(item => item.projectId === project.id);
      if (thread) State.select(thread.id);
      else { const created = State.create(false); created.projectId = project.id; State.emit('active'); }
      if (matchMedia('(max-width: 900px)').matches) closeSidebar();
    },
    assignActive(project) {
      if (!State.active) return;
      State.active.projectId = project.id; this.activeId = project.id; this.persist(); State.emit('projects'); this.render();
      Toast.show(`Conversation moved to ${project.title}`, { icon: 'folder' });
    },
    beginRename(project) {
      const row = $(`[data-project-id="${project.id}"]`); const label = row?.querySelector('.library-name');
      if (!row || !label) return;
      const input = make('input', { class: 'library-rename', value: project.title, 'aria-label': 'Project name', maxlength: '80' });
      label.replaceWith(input); input.focus(); input.select();
      const finish = save => {
        if (!input.isConnected) return;
        const next = text(input.value).trim();
        if (save && next) project.title = next;
        this.persist(); this.render();
      };
      input.addEventListener('keydown', event => { if (event.key === 'Enter') { event.preventDefault(); finish(true); } if (event.key === 'Escape') { event.preventDefault(); finish(false); } });
      input.addEventListener('blur', () => finish(true));
    },
    async remove(project) {
      if (!await askConfirm('Delete this project?', `“${project.title}” will be removed. Its conversations and files will remain on this device.`)) return;
      this.items = this.items.filter(item => item.id !== project.id);
      for (const thread of State.threads) if (thread.projectId === project.id) thread.projectId = null;
      if (this.activeId === project.id) this.activeId = null;
      this.persist(); State.emit('projects'); this.render(); Toast.show('Project deleted; conversations were kept', { icon: 'trash' });
    },
    render() {
      const host = $('#projectList'); if (!host) return; host.textContent = '';
      if (!this.items.length) {
        host.append(make('div', { class: 'library-empty' }, make('b', { text: 'No projects yet' }), make('span', { text: 'Create one to group related conversations.' })));
        return;
      }
      for (const project of this.items) {
        const count = State.threads.filter(thread => thread.projectId === project.id).length;
        const open = make('button', { type: 'button', class: 'subrow library-row', 'data-project-id': project.id, 'aria-current': this.activeId === project.id ? 'true' : 'false' }, icon('folder'), make('span', { class: 'library-name', text: project.title }), make('span', { class: 'library-meta', text: String(count) }));
        open.addEventListener('click', () => this.open(project));
        const more = make('button', { type: 'button', class: 'iconbtn sm library-more', 'aria-label': `Project options for ${project.title}` }, icon('more'));
        more.addEventListener('click', event => { event.stopPropagation(); Menu.open(more, [
          { label: 'Open project', icon: 'folder', run: () => this.open(project) },
          { label: 'Add current conversation', icon: 'chat', run: () => this.assignActive(project) },
          { label: 'Rename', icon: 'pencil', run: () => this.beginRename(project) }, '-',
          { label: 'Delete project', icon: 'trash', danger: true, run: () => this.remove(project) },
        ]); });
        host.append(make('div', { class: 'library-item' }, open, more));
      }
    },
  };

  const LibraryFiles = {
    db: null,
    async openDb() {
      if (this.db) return this.db;
      if (!globalThis.indexedDB) throw new Error('Permanent file storage is unavailable in this runtime.');
      this.db = await new Promise((resolve, reject) => {
        const request = indexedDB.open('solat-v2-library', 1);
        request.onupgradeneeded = () => request.result.createObjectStore('files', { keyPath: 'id' });
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error || new Error('File library could not be opened.'));
      });
      return this.db;
    },
    async request(mode, operation) {
      const db = await this.openDb();
      return new Promise((resolve, reject) => {
        const tx = db.transaction('files', mode); const storeNode = tx.objectStore('files'); const request = operation(storeNode);
        let result;
        request.onsuccess = () => { result = request.result; };
        request.onerror = () => reject(request.error || new Error('File operation failed.'));
        tx.oncomplete = () => resolve(result);
        tx.onerror = () => reject(tx.error || new Error('File transaction failed.'));
        tx.onabort = () => reject(tx.error || new Error('File transaction was cancelled.'));
      });
    },
    list() { return this.request('readonly', node => node.getAll()); },
    get(id) { return this.request('readonly', node => node.get(id)); },
    put(record) { return this.request('readwrite', node => node.put(record)); },
    remove(id) { return this.request('readwrite', node => node.delete(id)); },
    async import(files) {
      let added = 0;
      const addedIds = [];
      for (const file of files) {
        if (file.size > 20_000_000) { Toast.show(`${file.name} is over the 20 MB limit`, { icon: 'alert' }); continue; }
        const id = uid('file');
        await this.put({ id, name: file.name, type: file.type || 'application/octet-stream', size: file.size, createdAt: now(), blob: file.slice(0, file.size, file.type) });
        addedIds.push(id);
        added += 1;
      }
      await this.render();
      const verified = await Promise.all(addedIds.map(id => this.get(id)));
      if (verified.some(record => !record)) throw new Error('A saved file could not be read back from local storage.');
      if (added) Toast.show(`${added} file${added === 1 ? '' : 's'} saved to Files`, { icon: 'file' });
    },
    toFile(record) { return new File([record.blob], record.name, { type: record.type, lastModified: record.createdAt }); },
    async attach(record) { Composer.attach([this.toFile(record)]); Composer.focus(); if (matchMedia('(max-width: 900px)').matches) closeSidebar(); },
    open(record) {
      const url = URL.createObjectURL(record.blob); const opened = window.open(url, '_blank', 'noopener');
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
      if (!opened) Toast.show('The file preview was blocked by this runtime.', { icon: 'alert' });
    },
    download(record) { downloadBlob(record.blob, record.name); },
    async confirmRemove(record) {
      if (!await askConfirm('Delete this file?', `“${record.name}” will be removed from SOLAT Files. The original file outside SOLAT is not changed.`)) return;
      await this.remove(record.id); await this.render(); Toast.show('File removed from SOLAT Files', { icon: 'trash' });
    },
    async render() {
      const host = $('#fileLibraryList'); if (!host) return; host.textContent = '';
      try {
        const records = (await this.list()).sort((a, b) => b.createdAt - a.createdAt);
        if (!records.length) {
          host.append(make('div', { class: 'library-empty' }, make('b', { text: 'No saved files' }), make('span', { text: 'Add a file once, then reuse it in any chat.' })));
          return;
        }
        for (const record of records) {
          const use = make('button', { type: 'button', class: 'subrow library-row', 'data-library-file': record.id, title: `Attach ${record.name}` }, icon('file'), make('span', { class: 'library-name mono', text: record.name }), make('span', { class: 'library-meta', text: fileSize(record.size) }));
          use.addEventListener('click', () => this.attach(record));
          const more = make('button', { type: 'button', class: 'iconbtn sm library-more', 'aria-label': `File options for ${record.name}` }, icon('more'));
          more.addEventListener('click', event => { event.stopPropagation(); Menu.open(more, [
            { label: 'Attach to message', icon: 'clip', run: () => this.attach(record) },
            { label: 'Open preview', icon: 'eye', run: () => this.open(record) },
            { label: 'Download copy', icon: 'download', run: () => this.download(record) }, '-',
            { label: 'Delete from Files', icon: 'trash', danger: true, run: () => this.confirmRemove(record) },
          ]); });
          host.append(make('div', { class: 'library-item' }, use, more));
        }
      } catch (error) {
        host.append(make('div', { class: 'library-empty error' }, make('b', { text: 'Files unavailable' }), make('span', { text: error.message })));
      }
    },
  };

  const Toast = {
    show(message, options = {}) {
      const host = $('#toasts'); if (!host) return;
      const toast = make('div', { class: 'toast', role: 'status' }, icon(options.icon || 'check'), make('span', { text: message }));
      if (options.action) {
        const action = make('button', { type: 'button', text: options.action });
        action.addEventListener('click', () => { options.onAction?.(); toast.remove(); }); toast.append(action);
      }
      host.append(toast);
      setTimeout(() => { toast.classList.add('out'); setTimeout(() => toast.remove(), 220); }, options.timeout || 3600);
    },
  };

  const Overlay = {
    current: null, previous: null,
    open(node, { focus = null } = {}) {
      if (!node) return;
      this.close(); this.current = node; this.previous = document.activeElement;
      $('#scrim')?.classList.add('open'); node.classList.add('open');
      node.setAttribute('aria-hidden', 'false');
      requestAnimationFrame(() => (focus || node.querySelector('button,input,textarea,[tabindex]'))?.focus?.());
    },
    close() {
      if (!this.current) return;
      const node = this.current; node.classList.remove('open'); node.setAttribute('aria-hidden', 'true');
      this.current = null; $('#scrim')?.classList.remove('open'); this.previous?.focus?.(); this.previous = null;
    },
  };

  const Menu = {
    node: $('#menu'), anchor: null,
    close() { this.node?.classList.remove('open'); this.anchor = null; },
    open(anchor, entries) {
      if (!this.node || !anchor) return;
      this.close(); this.anchor = anchor; this.node.textContent = '';
      for (const entry of entries) {
        if (entry === '-') { this.node.append(make('hr')); continue; }
        const button = make('button', { type: 'button', class: entry.danger ? 'danger' : '', role: 'menuitem' }, icon(entry.icon || 'spark'), make('span', { text: entry.label }));
        if (entry.checked) button.append(make('span', { class: 'tick', text: '✓' }));
        button.addEventListener('click', () => { this.close(); entry.run?.(); }); this.node.append(button);
      }
      const rect = anchor.getBoundingClientRect();
      this.node.style.left = `${Math.max(8, Math.min(innerWidth - this.node.offsetWidth - 8, rect.right - 196))}px`;
      this.node.style.top = `${Math.min(innerHeight - 12, rect.bottom + 5)}px`;
      this.node.classList.add('open');
      requestAnimationFrame(() => this.node.querySelector('button')?.focus());
    },
  };

  function askConfirm(title, body, confirmLabel = 'Delete') {
    const dialog = $('#confirm'); if (!dialog) return Promise.resolve(false);
    $('#confirmTitle').textContent = title; $('#confirmBody').textContent = body; $('#confirmOk').textContent = confirmLabel;
    return new Promise(resolve => {
      const finish = result => { dialog.removeEventListener('solat:confirm', onConfirm); Overlay.close(); resolve(result); };
      const onConfirm = event => finish(event.detail === 'ok');
      dialog.addEventListener('solat:confirm', onConfirm);
      Overlay.open(dialog, { focus: $('#confirmCancel') });
    });
  }

  function setStatus(kind, label, detail = '') {
    const node = $('#status'); if (!node) return;
    node.dataset.state = kind; $('#statusText').textContent = label;
    if (detail) node.title = detail;
  }

  function errorText(error) {
    const code = error?.code || '';
    if (code === 'desktop_bridge_unavailable') return 'SOLAT desktop connection is unavailable in this preview. Open the desktop app to send a message.';
    if (code === 'not_configured') return 'Qwen Cloud is not configured. Add SOLAT_QWEN_API_KEY to the local environment.';
    if (code === 'timeout') return 'The model provider timed out. Try again.';
    if (code === 'network_error') return 'Could not connect to the model provider.';
    if (code === 'malformed_response') return 'The model returned an unreadable response.';
    return error?.message || 'The request failed for an unknown reason.';
  }

  function visibleMessageText(message) {
    const content = text(message?.content);
    if (message?.error && /Cannot read properties of undefined \(reading ['"]send['"]\)/i.test(content)) {
      return errorText({ code: 'desktop_bridge_unavailable' });
    }
    return content;
  }

  async function ensureStoredAttachment(attachment, sessionId) {
    const item = attachment?.file ? attachment : { file: attachment };
    if (item.stored) return item.stored;
    if (!item.file || typeof item.file.arrayBuffer !== 'function') throw new Error('The attachment is unavailable.');
    if (!item.storagePromise) item.storagePromise = (async () => window.solat.storeOriginalAsset({
      requestId: uid('asset'), sessionId, fileName: item.file.name, mimeType: item.file.type,
      bytes: new Uint8Array(await item.file.arrayBuffer()),
    }))().then(stored => { item.stored = stored; return stored; }).finally(() => { item.storagePromise = null; });
    return item.storagePromise;
  }

  function imagePreviewDimensions(url) {
    return new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve({ width: image.naturalWidth, height: image.naturalHeight });
      image.onerror = () => reject(new Error('The image preview dimensions are unavailable.'));
      image.src = url;
    });
  }

  const Chat = {
    pinned: true, controller: null, requestId: 0,
    render() {
      const thread = State.active; const stream = $('#stream'); if (!stream) return;
      const emptyMode = !thread?.messages.length;
      root.classList.remove('home-mode');
      root.classList.toggle('empty-mode', emptyMode);
      const composerInput = $('#input'); if (composerInput) composerInput.placeholder = 'Message SOLAT...';
      stream.textContent = ''; $('#chatTitle').textContent = thread?.title || 'New conversation';
      if (emptyMode) { this.renderWelcome(); this.updateJump(); return; }
      let day = null;
      for (const message of thread.messages) {
        const label = new Date(message.ts).toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' });
        if (label !== day) { stream.append(make('div', { class: 'day', text: label })); day = label; }
        stream.append(this.node(message));
      }
      if (this.controller?.threadId === thread.id && !this.controller.stopped) {
        stream.append(this.thinkingNode());
      }
      requestAnimationFrame(() => { $('#log').scrollTop = $('#log').scrollHeight; this.updateJump(); });
    },
    renderWelcome() {
      const stream = $('#stream'); if (!stream || stream.children.length) return;
      const entries = [
        ['check', 'Plan', 'Turn a rough goal into milestones, risks, and next actions.', 'Help me turn this idea into a practical project plan with milestones, risks, and the first three actions.'],
        ['search', 'Research', 'Compare reliable evidence and explain what matters.', 'Research this topic, compare reliable sources, and give me a concise evidence-based briefing: '],
        ['spark', 'Create', 'Shape an idea into a clear, memorable first draft.', 'Help me create a strong first draft. Start by asking what audience, format, and outcome I want.'],
      ];
      const grid = make('div', { class: 'inner-starters' });
      for (const [index, [symbol, heading, subtitle, suggestion]] of entries.entries()) {
        const button = make('button', { type: 'button', class: 'inner-starter', 'aria-label': `${heading}: ${subtitle}` }, make('span', { class: 'inner-starter-index', text: String(index + 1).padStart(2, '0') }), icon(symbol), make('span', { class: 'inner-starter-copy' }, make('b', { text: heading }), make('span', { text: subtitle })), icon('send'));
        button.classList.add(`inner-starter-${heading.toLowerCase()}`);
        const starterArt = { Plan: 'persona-plan-target.jfif', Research: 'persona-research-card.jfif', Create: 'persona-research-star-transparent.png' }[heading];
        if (starterArt) {
          button.replaceChild(make('img', { class: 'inner-starter-art', src: `./assets/${starterArt}`, alt: '', 'aria-hidden': 'true' }), button.children[1]);
        }
        button.addEventListener('click', () => {
          Composer.setValue(suggestion);
        }); grid.append(button);
      }
      stream.append(make('section', { class: 'inner-empty', 'aria-labelledby': 'emptyTitle' },
        make('figure', { class: 'inner-art', 'aria-hidden': 'true' }, make('img', { src: './assets/ren-amamiya-joker.jfif', alt: '', loading: 'eager', decoding: 'async' })),
        make('div', { class: 'inner-empty-signal' }, make('span', { class: 'inner-live-dot' }), 'SOLAT // READY'),
        make('h2', { id: 'emptyTitle' }, 'What are we ', make('em', { text: 'building?' })),
        make('p', { text: 'Start with a direct message or choose a working mode. Everything stays inside this conversation.' }),
        grid,
      ));
    },
    node(message) {
      if (message.role === 'system') return make('div', { class: 'note', text: message.content });
      const failed = message.role === 'assistant' && message.error;
      const agentStatus = message.responseMeta?.agentStatus;
      const article = make('article', { class: `msg ${message.role}${failed ? ' error' : ''}${message.role === 'user' && message.source === 'voice' ? ' voice' : ''}${agentStatus ? ` agent-${agentStatus}` : ''}`, 'data-id': message.id, tabindex: '-1' });
      const label = message.role === 'user' ? (message.source === 'voice' ? 'You · voice' : 'You') : failed ? 'Delivery failed' : 'SOLAT';
      article.append(make('div', { class: 'who-line' }, label, make('time', { text: new Date(message.ts).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }) })));
      const visibleContent = visibleMessageText(message);
      const sourceBlock = !failed ? splitSourceBlock(visibleContent) : null;
      const answerText = sourceBlock?.body || visibleContent;
      const bubble = make('div', { class: 'bubble' }, renderMarkdown(answerText));
      const toolSources = responseSources(message.responseMeta?.sources);
      // Provider prose can contain plausible-looking URLs. Only URLs returned
      // by the validated search tool are rendered as links or disclosures.
      if (message.role === 'assistant') restrictAssistantLinks(bubble, toolSources);
      const sources = toolSources;
      if (sources.length) bubble.append(sourceDisclosure({ sources, blockedCount: 0 }));
      article.append(bubble);
      if (message.role === 'assistant' && message.responseMeta?.agentFile) article.append(AgentUI.fileCard(message));
      if (message.role === 'assistant' && message.responseMeta) {
        const provider = text(message.responseMeta.provider || 'model');
        const model = text(message.responseMeta.model || '');
        const mode = text(message.responseMeta.mode || 'model');
        const status = text(message.responseMeta.webSearchStatus || '').trim();
        const summary = message.responseMeta.searchSummary || {};
        const requestedPlatforms = Array.isArray(summary.requested_platforms) ? summary.requested_platforms.filter(Boolean) : [];
        const platformsWithEvidence = Array.isArray(summary.requested_platforms_with_evidence) ? summary.requested_platforms_with_evidence.filter(Boolean) : [];
        const scope = Array.isArray(summary.source_scopes) && summary.source_scopes.length
          ? summary.source_scopes.join(', ')
          : Array.isArray(message.responseMeta.searchEvidence) ? text(message.responseMeta.searchEvidence.at(-1)?.source_scope || '') : '';
        const suffix = `${status && status !== 'not_requested' ? ` · ${status}` : ''}${scope ? ` · source scope: ${scope}` : ''}`;
        if (Array.isArray(message.responseMeta.searchEvidence) && message.responseMeta.searchEvidence.length) {
          // A later bounded scope can be empty after an earlier scope found
          // usable evidence. Prefer the newest evidence-bearing run for the
          // compact label, while the aggregate summary still exposes all runs.
          const latestEvidence = [...message.responseMeta.searchEvidence].reverse().find(item => item?.status === 'ready' || item?.quality?.authority_level && item.quality.authority_level !== 'none') || message.responseMeta.searchEvidence.at(-1);
          const count = sources.length;
          const noun = count === 1 ? 'source' : 'sources';
          const quality = latestEvidence.quality || {};
          const authorityLevel = quality.authority_level || (summary.source_count > 0 ? summary.source_authority_level : '');
          const authorityLabel = authorityLevel === 'social_discovery' ? ' · social discovery' : authorityLevel === 'video_discovery' ? ' · video discovery' : authorityLevel === 'encyclopedic' ? ' · encyclopedic' : authorityLevel === 'ai_summary' ? ' · AI summary' : authorityLevel === 'mixed_with_encyclopedic' ? ' · mixed sources' : authorityLevel === 'approved_web' ? ' · approved web sources' : '';
          const qualityNote = quality.ambiguity === 'comparison_split_evidence' ? ' · separate evidence for compared names' : quality.status === 'filtered' ? ' · unrelated results filtered' : quality.status === 'insufficient_relevance' ? ' · relevance not sufficient' : '';
          const displayStatus = status || text(latestEvidence.status || 'unknown');
          latestEvidence.status = `${displayStatus}${authorityLabel}`;
          const scopeNote = Array.isArray(summary.source_scopes) && summary.source_scopes.length > 1 ? ` · ${summary.source_scopes.length} source scopes` : '';
          const priorityScopes = Array.isArray(summary.source_scope_priority) ? summary.source_scope_priority.filter(Boolean) : [];
          const priorityNote = priorityScopes.length > 1 ? ` · priority: ${priorityScopes.join(' > ')}` : '';
          const requestedScopeNote = summary.requested_source_scope_status === 'incomplete' ? ' · requested source scope incomplete' : '';
          const comparisonNote = summary.comparison_evidence_status === 'incomplete' ? ' · comparison evidence incomplete' : '';
          const corroboration = quality.corroboration || (summary.source_count > 0 ? summary.source_corroboration : '');
          const agreementStatus = quality.agreement_status || (summary.source_count > 0 ? summary.source_agreement_status : '');
          const corroborationNote = corroboration === 'multi_host'
            ? ` · multiple source hosts${agreementStatus === 'not_assessed' ? ' · agreement not assessed' : ''}`
            : corroboration === 'single_host'
              ? ' · one source host'
              : '';
          article.append(make('div', { class: 'source-count', 'data-source-count': '', text: `Search · ${count} ${noun} · ${latestEvidence.status || 'unknown'}${scopeNote}${priorityNote}${requestedScopeNote}${comparisonNote}${qualityNote}${corroborationNote}` }));
          if (requestedPlatforms.length) {
            const platformStatus = summary.requested_platform_status === 'incomplete' ? 'incomplete' : 'complete';
            article.append(make('div', { class: 'source-count', 'data-platform-coverage': '', text: `Platforms · ${platformsWithEvidence.length}/${requestedPlatforms.length} · ${platformStatus}` }));
          }
        } else if (summary.search_requested) {
          const searchState = status || 'available_not_used';
          const note = searchState === 'available_not_used'
            ? 'Search · tool available but not used · no validated sources'
            : `Search · ${searchState} · no validated sources`;
          article.append(make('div', { class: 'source-count', 'data-source-count': '', text: note }));
          if (requestedPlatforms.length) {
            article.append(make('div', { class: 'source-count', 'data-platform-coverage': '', text: `Platforms · 0/${requestedPlatforms.length} · incomplete` }));
          }
        }
        article.append(make('div', { class: 'response-origin', 'data-mode': mode, text: model ? `${model} · ${provider}${suffix}` : `${provider}${suffix}` }));
      }
      article.append(this.actions(message));
      return article;
    },
    thinkingNode() {
      return make('article', { class: 'msg assistant enter thinking-message', 'data-thinking': 'true' },
        make('div', { class: 'who-line' }, 'SOLAT // PROCESSING'),
        make('div', { class: 'bubble thinking-bubble' },
          make('div', { class: 'thinking', role: 'status', 'aria-label': 'SOLAT is thinking' },
            make('span', { class: 'thinking-label', text: 'Thinking' }),
            make('span', { class: 'thinking-signal', 'aria-hidden': 'true' }, make('i'), make('i'), make('i')))));
    },
    actions(message) {
      const row = make('div', { class: 'actions' });
      const action = (label, symbol, handler, pressed = false, { disabled = false, title = label } = {}) => {
        const button = make('button', {
          type: 'button', class: `act${!label ? ' icon-only' : ''}`,
          'aria-label': label, title, 'aria-pressed': pressed ? 'true' : 'false',
          ...(disabled ? { disabled: true, 'aria-disabled': 'true' } : {}),
        }, icon(symbol), label ? make('span', { text: label }) : null);
        if (!disabled) button.addEventListener('click', () => handler(button));
        return button;
      };
      row.append(action('Copy', 'copy', async button => {
        const ok = await copyText(message.content); button.textContent = ''; button.append(icon(ok ? 'check' : 'alert'), make('span', { text: ok ? 'Copied' : 'Copy failed' })); button.classList.toggle('done', ok);
        setTimeout(() => { button.textContent = ''; button.append(icon('copy'), make('span', { text: 'Copy' })); button.classList.remove('done'); }, 1700);
      }));
      if (message.role === 'user') {
        row.append(action('Edit', 'pencil', () => { State.truncateAfter(State.activeId, message.id); Composer.setValue(message.content); }));
      } else {
        row.append(action('Retry', 'refresh', () => this.retry(message.id)));
        if (message.responseMeta?.agentActionPending) {
          const active = AgentUI.canReview(message);
          row.append(action(
            active ? 'Review Agent' : 'Action unavailable',
            'cpu',
            () => AgentUI.openPending(message),
            false,
            { disabled: !active, title: active ? 'Review Agent' : 'This Agent plan has already finished, been cancelled, or been replaced.' },
          ));
        }
        if (message.responseMeta?.mode === 'agent_progress' && message.responseMeta?.computerTaskId
          && !['COMPLETED', 'FAILED', 'CANCELLED', 'UNSUPPORTED', 'NEEDS_CLARIFICATION'].includes(String(message.responseMeta.agentStatus || '').toUpperCase())) {
          row.append(action('Cancel task', 'x', async button => {
            button.disabled = true;
            try {
              await window.solat.computerTaskCancel({
                sessionId: message.responseMeta.computerTaskSessionId || sessionFor(State.activeId),
                taskId: message.responseMeta.computerTaskId,
              });
              Toast.show('Computer task cancelled.', { icon: 'check' });
            } catch (error) {
              button.disabled = false;
              Toast.show(`Cancel failed: ${errorText(error)}`, { icon: 'alert' });
            }
          }, false, { title: 'Stop this Computer Use task' }));
        }
        row.append(action('Helpful', 'up', button => this.feedback(message, 'up', button), message.feedback === 'up'));
        row.append(action('Not helpful', 'down', button => this.feedback(message, 'down', button), message.feedback === 'down'));
      }
      return row;
    },
    feedback(message, kind, button) {
      message.feedback = message.feedback === kind ? null : kind;
      $$('.act[aria-pressed="true"]', button.parentElement).forEach(item => item.setAttribute('aria-pressed', 'false'));
      if (message.feedback) button.setAttribute('aria-pressed', 'true');
      State.emit('feedback'); Toast.show(message.feedback === 'down' ? 'Noted. Try Retry for a different answer.' : 'Thanks — noted.', { icon: message.feedback === 'down' ? 'down' : 'check' });
    },
    retry(messageId) {
      const thread = State.active; if (!thread || busy) return;
      const index = thread.messages.findIndex(message => message.id === messageId); if (index < 0) return;
      const user = [...thread.messages.slice(0, index)].reverse().find(message => message.role === 'user');
      if (!user) return;
      thread.messages = thread.messages.slice(0, index); State.emit('messages'); Composer.setValue(user.content); Composer.submit();
    },
    send(content, attachments = [], options = {}) {
      return submitUnifiedTurn({ kind: 'text', content, attachments, options });
    },
    submitVoiceTurn(transcript, voice = {}) {
      return submitUnifiedTurn({ kind: 'voice', content: transcript, attachments: [], options: {}, voice });
    },
    stop() {
      if (!this.controller) return;
      const stoppingRequestId = this.controller.solatRequestId || '';
      this.controller.stopped = true; this.requestId += 1; this.controller = null; Composer.setBusy(false); setStatus('ready', 'Ready');
      abandonSpeechStream(stoppingRequestId);
      void Voice?.stop();
      this.render();
      Toast.show('Stop requested. The provider request may finish in the background.', { icon: 'alert' });
    },
    updateJump() { const log = $('#log'); const distance = log.scrollHeight - log.scrollTop - log.clientHeight; $('#jump')?.classList.toggle('show', !this.pinned && distance > 120); $('#chatHeader')?.classList.toggle('stuck', log.scrollTop > 6); },
  };

  // Unified SOLAT input boundary. Typed text and finalized voice turns share
  // one internal submission path into the core; the composer and chat log are
  // views of that turn, never the transport. Voice input keeps its own source
  // label and never pretends to be typed Red-side text.
  let speechStream = null;
  function queueSpokenChunk(requestId, rawChunk) {
    const clean = text(rawChunk).trim();
    if (!clean || !Voice?.active) return;
    Voice.queueSpeechChunk(requestId, clean);
  }
  function handleAssistantDelta(payload) {
    if (!payload || payload.schema_version !== 'solat.assistant-delta.v1') return;
    const stream = speechStream;
    if (!stream || stream.requestId !== payload.requestId) return;
    if (!stream.started) {
      stream.started = true;
      if (!Voice?.beginSpeechStream(stream.requestId, voiceLanguageFor(payload.delta))) return;
    }
    for (const chunk of stream.chunker.push(String(payload.delta || ''))) queueSpokenChunk(stream.requestId, chunk);
  }
  function abandonSpeechStream(requestId) {
    if (speechStream?.requestId === requestId) speechStream = null;
  }
  function finalizeSpeechStream(requestId, result) {
    const stream = speechStream;
    if (!stream || stream.requestId !== requestId) return;
    speechStream = null;
    if (Voice?.active) {
      if (stream.started) {
        for (const chunk of stream.chunker.flush()) queueSpokenChunk(requestId, chunk);
        Voice.endSpeechStream(requestId);
      } else {
        void Voice.speak(text(result.assistant), voiceLanguageFor(result.assistant), requestId);
      }
    }
  }
  async function submitUnifiedTurn({ kind, content, attachments, options = {}, voice = {} }) {
      const inputKind = kind === 'voice' ? 'voice' : 'text';
      const thread = State.active || State.create();
      const activityStartedAt = performance.now();
      const visible = attachments.length ? `${content ? `${content}\n\n` : ''}${attachments.map(item => `\`${(item?.file || item).name}\``).join(' · ')}` : content;
      const voiceSource = inputKind === 'voice' ? voice : options;
      const voiceSessionId = String(voiceSource?.voiceSessionId || '').trim();
      const voiceUtteranceId = String(voiceSource?.voiceUtteranceId || '').trim();
      const voiceFinalAtMs = Number(voiceSource?.voiceFinalAtMs);
      const voiceMetadata = voiceSessionId.length > 0 && voiceSessionId.length <= 160
        && voiceUtteranceId.length > 0 && voiceUtteranceId.length <= 160
        ? {
          voiceSessionId,
          voiceUtteranceId,
          ...(Number.isSafeInteger(voiceFinalAtMs) && voiceFinalAtMs >= 0 && voiceFinalAtMs <= 9_999_999_999_999 ? { voiceFinalAtMs } : {}),
        } : {};
      const user = State.add(thread.id, { role: 'user', content: visible, source: inputKind, attachments: attachments.map(item => (item?.file || item).name), assetIds: [] });
      if (thread.title === 'New conversation') State.rename(thread.id, titleFrom(content || (attachments[0]?.file || attachments[0])?.name));
      const sequence = ++Chat.requestId; Chat.controller = { stopped: false, sequence, threadId: thread.id };
      setStatus('busy', 'Responding'); Composer.setBusy(true); Chat.render();
      let result; let shouldRender = false;
      try {
        const threadSessionId = sessionFor(thread.id);
        const assetIds = [];
        if (!window.solat?.send) throw Object.assign(new Error('SOLAT desktop connection is unavailable.'), { code: 'desktop_bridge_unavailable' });
        if (attachments.length && !window.solat?.storeOriginalAsset) throw Object.assign(new Error('Original asset storage is unavailable; the file was not sent.'), { code: 'asset_storage_unavailable' });
        for (const item of attachments) {
          const stored = await ensureStoredAttachment(item, threadSessionId);
          assetIds.push(stored.assetId);
        }
        user.assetIds = assetIds; State.emit('messages');
        const requestId = uid('request');
        AgentUI.beginRequest({ threadId: thread.id, sessionId: threadSessionId, requestId });
        if (Chat.controller?.sequence === sequence) Chat.controller.solatRequestId = requestId;
        if (Voice?.active && window.SolatSpeechChunker?.createSpeechChunker) {
          speechStream = { requestId, chunker: window.SolatSpeechChunker.createSpeechChunker(), started: false };
        }
        result = await window.solat.send({ requestId, sessionId: threadSessionId, content: visible, musicContext: Music.song() || null, attachments: attachments.map(item => (item?.file || item).name), assetIds, agentMode: true, agentCommand: AgentUI.commandFromText(visible), inputSource: inputKind, streamResponse: Boolean(Voice?.active), ...voiceMetadata });
        if (Chat.controller?.stopped || sequence !== Chat.requestId) return;
        let assistant = State.add(thread.id, {
          role: 'assistant',
          content: text(result.assistant),
          responseMeta: {
            provider: result.provider,
            model: result.model,
            mode: result.mode || result.responseMeta?.mode || 'model',
            routing: result.routing && typeof result.routing === 'object' ? result.routing : null,
            timing: result.timing && typeof result.timing === 'object' ? result.timing : null,
            webSearchStatus: result.webSearchStatus || result.responseMeta?.webSearchStatus || 'not_requested',
            searchRecoveryUsed: Boolean(result.searchRecoveryUsed || result.responseMeta?.searchRecoveryUsed),
            sources: Array.isArray(result.sources) ? result.sources : [],
            searchEvidence: Array.isArray(result.searchEvidence) ? result.searchEvidence : [],
            searchSummary: result.searchSummary && typeof result.searchSummary === 'object' ? result.searchSummary : null,
            agentMode: Boolean(result.agentMode), agentCommand: result.agentCommand || null,
            agentActionPending: Array.isArray(result.agentActions) && result.agentActions.length > 0,
          },
        });
        assistant = AgentUI.reconcileComputerTaskResponse({
          threadId: thread.id, sessionId: threadSessionId, requestId, message: assistant,
        }) || assistant;
        if (Array.isArray(result.agentActions) && result.agentActions.length) {
          await AgentUI.receive(result.agentActions, { threadId: thread.id, sessionId: threadSessionId, messageId: assistant.id, requestId });
        }
        shouldRender = true;
        if (Voice?.active || isSolatVoiceSceneActive()) {
          setSolatVoicePreview(result.assistant);
        }
        finalizeSpeechStream(requestId, result);
        setStatus('ready', 'Ready', `${result.provider || 'provider'} / ${result.model || 'model'}`);
        return assistant;
      } catch (error) {
        if (Chat.controller?.stopped || sequence !== Chat.requestId) return;
        abandonSpeechStream(requestId);
        State.add(thread.id, { role: 'assistant', content: errorText(error), error: true });
        if (Voice?.active || isSolatVoiceSceneActive()) {
          setSolatVoicePreview(`SOLAT ERROR\n${errorText(error)}`);
        }
        if (Voice?.active) Voice.setState('error', { code: error?.code || 'provider_error' });
        shouldRender = true; setStatus('error', 'Error'); await refreshStatus();
      } finally {
        if (sequence === Chat.requestId) {
          const minimumActivityMs = Settings.get('motion') ? 620 : 0;
          const remainingActivityMs = minimumActivityMs - (performance.now() - activityStartedAt);
          if (shouldRender && remainingActivityMs > 0) await new Promise(resolve => setTimeout(resolve, remainingActivityMs));
          Chat.controller = null; Composer.setBusy(false);
          // Clear the busy state before rendering the completed turn. Otherwise
          // the just-finished request leaves an orphaned thinking bubble behind.
          if (shouldRender && State.activeId === thread.id) Chat.render();
        }
      }
  }

  const sessionIds = new Map();
  function sessionFor(threadId) {
    let id = sessionIds.get(threadId);
    if (!id) {
      id = store.get(sessionStorageKey(threadId), null) || createSessionId();
      sessionIds.set(threadId, id);
      store.set(sessionStorageKey(threadId), id);
    }
    return id;
  }
  let busy = false;
  const chatIdleWaiters = new Set();
  function waitForChatIdle() {
    if (!busy) return Promise.resolve();
    return new Promise(resolve => chatIdleWaiters.add(resolve));
  }
  let Voice = null;
  async function toggleVoiceInput() {
    const starting = !(Voice?.active && ['listening', 'user_speaking', 'transcribing'].includes(Voice.state));
    try {
      await Voice.toggle(sessionFor((State.active || State.create()).id));
      setSolatVoicePreview(starting ? SOLAT_VOICE_READY : SOLAT_VOICE_INTRO);
    } catch (error) {
      Toast.show(error?.message || 'Voice input could not start.', { icon: 'alert', timeout: 5200 });
      setStatus('error', 'Voice unavailable');
    }
  }

  const Threads = {
    query: '',
    bucket(timestamp) {
      const day = new Date(timestamp); const today = new Date();
      const midnight = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
      if (timestamp >= midnight) return 'Today'; if (timestamp >= midnight - 864e5) return 'Yesterday'; if (timestamp >= midnight - 7 * 864e5) return 'Previous 7 days'; return day.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
    },
    render() {
      const host = $('#threadGroups'); if (!host) return; host.textContent = '';
      const query = this.query.trim().toLowerCase();
      const threads = [...State.threads].sort((a, b) => b.updatedAt - a.updatedAt).filter(thread => !query || thread.title.toLowerCase().includes(query) || thread.messages.some(message => text(message.content).toLowerCase().includes(query)));
      if (!threads.length) { host.append(make('div', { class: 'side-empty' }, make('b', { text: query ? 'No matches' : 'No conversations yet' }), query ? 'Try another word.' : 'Start one and it will appear here.')); return; }
      let group = null; let list = null;
      for (const thread of threads) {
        const bucket = this.bucket(thread.updatedAt);
        if (bucket !== group) { group = bucket; host.append(make('div', { class: 'group-label', text: bucket })); list = make('ul', { class: 'thread-list', role: 'list' }); host.append(list); }
        const item = make('li', { class: 'thread-item' });
        const button = make('button', { class: 'thread', type: 'button', 'aria-current': State.activeId === thread.id ? 'true' : 'false', title: thread.title }, make('span', { class: 't-title', text: thread.title }));
        button.addEventListener('click', () => { State.select(thread.id); if (matchMedia('(max-width: 900px)').matches) closeSidebar(); });
        button.addEventListener('keydown', event => { if (event.key === 'F2') { event.preventDefault(); renameThread(thread); } });
        const menuButton = make('button', { class: 'iconbtn sm t-menu', type: 'button', 'aria-label': `Options for ${thread.title}`, 'aria-haspopup': 'menu' }, icon('more'));
        menuButton.addEventListener('click', event => { event.stopPropagation(); Menu.open(menuButton, [
          { label: 'Rename', icon: 'pencil', run: () => renameThread(thread) },
          { label: 'Duplicate', icon: 'copy', run: () => duplicateThread(thread) },
          { label: 'Export as Markdown', icon: 'download', run: () => exportThread(thread) }, '-',
          { label: 'Delete', icon: 'trash', danger: true, run: () => deleteThread(thread) },
        ]); });
        item.append(button, menuButton); list.append(item);
      }
    },
  };

  function renameThread(thread) {
    const button = $('#chatTitle'); if (!button || State.activeId !== thread.id) return renameActive();
    const input = make('input', { class: 'thread-rename', value: thread.title, 'aria-label': 'Conversation name', style: 'flex:1;min-width:0' });
    button.replaceWith(input); input.focus(); input.select();
    const done = ok => { if (!input.isConnected) return; input.replaceWith(button); if (ok) State.rename(thread.id, input.value); else button.textContent = thread.title; };
    input.addEventListener('keydown', event => { if (event.key === 'Enter') { event.preventDefault(); done(true); } if (event.key === 'Escape') { event.preventDefault(); done(false); } }); input.addEventListener('blur', () => done(true));
  }

  function renameActive() { if (State.active) renameThread(State.active); }
  function duplicateThread(thread) {
    const copy = JSON.parse(JSON.stringify(thread)); copy.id = uid('thread'); copy.title = `${thread.title} (copy)`; copy.updatedAt = now(); copy.messages.forEach(message => { message.id = uid('message'); }); State.threads.unshift(copy); State.activeId = copy.id; State.emit('active'); Toast.show('Conversation duplicated', { icon: 'copy' });
  }
  function exportThread(thread) {
    const lines = [`# ${thread.title}`, '', `_Exported from SOLAT on ${new Date().toLocaleString()}_`, ''];
    for (const message of thread.messages) if (message.role !== 'system') lines.push(`## ${message.role === 'user' ? 'You' : 'SOLAT'} — ${new Date(message.ts).toLocaleString()}`, '', message.content, '');
    downloadBlob(new Blob([lines.join('\n')], { type: 'text/markdown;charset=utf-8' }), `${(thread.title.replace(/[^\w\d -]+/g, '').trim() || 'conversation').slice(0, 60)}.md`); Toast.show('Exported as Markdown', { icon: 'download' });
  }
  async function deleteThread(thread) {
    if (!await askConfirm('Delete this conversation?', `“${thread.title}” and its messages will be removed from this device.`)) return;
    const snapshot = State.remove(thread.id); if (!snapshot) return;
    Toast.show('Conversation deleted', { icon: 'trash', action: 'Undo', timeout: 6000, onAction: () => { State.restore(snapshot.thread, snapshot.index); Toast.show('Conversation restored'); } });
  }
  function downloadBlob(blob, name) {
    const link = document.createElement('a'); link.href = URL.createObjectURL(blob); link.download = name; link.click(); setTimeout(() => URL.revokeObjectURL(link.href), 1000);
  }

  const Composer = {
    attachments: [], limit: 8000, launching: false,
    init() {
      const input = $('#input'); const form = $('#composer');
      input.addEventListener('input', () => { AgentUI.handleInput(input.value); this.sync(); }); input.addEventListener('focus', () => { form.classList.add('focused'); this.syncMode('INPUT ACTIVE'); }); input.addEventListener('blur', () => { form.classList.remove('focused'); setTimeout(() => AgentUI.closeMenu(), 120); this.syncMode(); });
      input.addEventListener('keydown', event => {
        const modifier = event.metaKey || event.ctrlKey;
        if (event.key === '@' && !modifier) requestAnimationFrame(() => AgentUI.openMenu());
        if (event.key === 'Enter' && !event.shiftKey && (Settings.get('enterSends') ? !modifier : modifier)) { event.preventDefault(); this.submit(); }
        if (event.key === 'ArrowUp' && !input.value.trim()) { const previous = [...(State.active?.messages || [])].reverse().find(message => message.role === 'user'); if (previous) { event.preventDefault(); this.setValue(previous.content); } }
      });
      // Composer.submit owns the busy-state decision. An active Computer Use
      // task treats a new message as owner steering; ordinary model responses
      // still keep the existing Stop behaviour.
      form.addEventListener('submit', event => { event.preventDefault(); this.submit(); });
      $('#attachBtn')?.addEventListener('click', () => $('#fileInput')?.click()); $('#fileInput')?.addEventListener('change', event => { this.attach([...event.target.files]); event.target.value = ''; });
      let depth = 0; const wrap = $('#composerWrap');
      wrap.addEventListener('dragenter', event => { event.preventDefault(); if (++depth === 1) form.classList.add('dropping'); }); wrap.addEventListener('dragover', event => event.preventDefault()); wrap.addEventListener('dragleave', () => { if (--depth <= 0) { depth = 0; form.classList.remove('dropping'); } });
      wrap.addEventListener('drop', event => {
        event.preventDefault(); depth = 0; form.classList.remove('dropping');
        const files = [...(event.dataTransfer?.files || [])];
        const hasWebSource = [...(event.dataTransfer?.types || [])].some(type => type === 'text/html' || type === 'text/uri-list');
        const image = hasWebSource ? files.find(file => file.type?.startsWith?.('image/')) : null;
        if (image) void this.importChromeImage(image, event.dataTransfer);
        else {
          this.attach(files);
          if (!files.length && hasWebSource) Toast.show('Chrome did not provide image bytes. Right-click Copy image, then press Ctrl+V in SOLAT.', { icon: 'alert', timeout: 6000 });
        }
      });
      document.addEventListener('paste', event => {
        const image = [...(event.clipboardData?.files || [])].find(file => file.type?.startsWith?.('image/'));
        if (!image) return;
        event.preventDefault();
        void this.importChromeImage(image, event.clipboardData);
      });
      this.initMic(); this.sync();
    },
    chromeSource(transfer) {
      const html = String(transfer?.getData?.('text/html') || '');
      if (html) {
        try {
          const imageSource = new DOMParser().parseFromString(html, 'text/html').querySelector('img[src]')?.src;
          if (imageSource) return imageSource;
        } catch {}
      }
      return String(transfer?.getData?.('text/uri-list') || '').split(/\r?\n/u).map(line => line.trim()).find(line => line && !line.startsWith('#')) || '';
    },
    async importChromeImage(file, transfer) {
      if (!file || !State.activeId || !window.solat?.chromeAssetImport) return Toast.show('Chrome image transfer is unavailable.', { icon: 'alert' });
      if (file.size > 8 * 1024 * 1024) return Toast.show('Chrome image is over the 8 MB SpatialAsset limit.', { icon: 'alert' });
      try {
        const bytes = new Uint8Array(await file.arrayBuffer());
        await window.solat.chromeAssetImport({
          sessionId: this.sessionId?.() || sessionFor(State.activeId),
          bytes,
          mimeType: file.type,
          label: String(file.name || 'Chrome image').slice(0, 240),
          sourceUrl: this.chromeSource(transfer) || undefined,
        });
      } catch (error) {
        Toast.show(error?.message || 'Chrome image could not enter SpatialAsset mode.', { icon: 'alert', timeout: 6000 });
      }
    },
    setValue(value) { $('#input').value = text(value); AgentUI.syncInputAppearance($('#input').value); this.sync(); this.focus(); },
    getAttachments() { return this.attachments.slice(); },
    focus() { const input = $('#input'); input.focus(); input.setSelectionRange(input.value.length, input.value.length); },
    syncMode(forced = '') {
      const node = $('.composer-mode'); if (!node) return;
      const value = $('#input').value; const command = AgentUI.commandFromText(value);
      const mode = forced || (busy ? 'SOLAT RESPONDING' : (value.trim() || this.attachments.length) ? 'MESSAGE ARMED' : 'COMMAND READY');
      node.textContent = `${mode}${AgentUI.isEnabled() ? ' · AGENT ON' : ''}${command ? ` · ${command}` : ''}`;
    },
    sync() {
      const input = $('#input'); const length = input.value.length; input.style.height = 'auto'; input.style.height = `${Math.min(input.scrollHeight, Math.round(innerHeight * .44))}px`;
      AgentUI.syncInputAppearance(input.value);
      const counter = $('#counter'); counter.textContent = length > 400 ? `${length.toLocaleString()} / ${this.limit.toLocaleString()}` : ''; counter.className = `counter${length > this.limit ? ' over' : length > this.limit * .85 ? ' warn' : ''}`;
      if (!busy) $('#sendBtn').disabled = !(input.value.trim() || this.attachments.length) || length > this.limit;
      this.syncMode();
    },
    setBusy(on) {
      busy = on; const button = $('#sendBtn'); button.disabled = false; button.classList.toggle('stop', on); button.setAttribute('aria-label', on ? 'Stop responding' : 'Send message'); button.replaceChildren(icon(on ? 'stop' : 'send'), make('span', { class: 'send-label', text: on ? 'Stop' : 'Send' })); $('#composer').classList.toggle('live', on); this.syncMode(); if (on) Voice?.markThinking(); if (!on) { this.sync(); const waiters = [...chatIdleWaiters]; chatIdleWaiters.clear(); waiters.forEach(resolve => resolve()); }
    },
    attach(files) {
      const room = 6 - this.attachments.length; if (room <= 0) return Toast.show('Up to 6 files per message', { icon: 'alert' });
      const supportedTypes = new Set([
        'application/pdf',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'text/plain', 'text/csv', 'application/csv', 'application/json', 'text/json',
        'image/jpeg', 'image/png', 'image/gif', 'image/webp',
      ]);
      for (const file of files.slice(0, room)) {
        if (!supportedTypes.has(file.type)) { Toast.show(`${file.name} is not a supported file`, { icon: 'alert' }); continue; }
        if (file.size > 20_000_000) { Toast.show(`${file.name} is over the 20 MB limit`, { icon: 'alert' }); continue; }
        this.attachments.push({ file, previewUrl: file.type.startsWith('image/') ? URL.createObjectURL(file) : null, status: 'selected' });
      }
      this.renderAttachments(); this.sync();
    },
    renderAttachments() {
      const host = $('#attachments'); host.textContent = ''; host.hidden = !this.attachments.length;
      this.attachments.forEach((item, index) => {
        const remove = make('button', { type: 'button', class: 'iconbtn sm', 'aria-label': `Remove ${item.file.name}` }, icon('x')); remove.addEventListener('click', () => { if (item.previewUrl) URL.revokeObjectURL(item.previewUrl); this.attachments.splice(index, 1); this.renderAttachments(); this.sync(); });
        const preview = item.previewUrl ? make('img', { class: 'thumb', src: item.previewUrl, alt: '', title: 'Hold and move to use this image as a SpatialAsset' }) : icon('file');
        if (item.previewUrl) preview._solatSpatialAttachment = item;
        if (item.previewUrl) preview.addEventListener('pointerdown', event => { event.preventDefault(); event.stopPropagation(); void SpatialAssets.beginFromAttachment(item, event); });
        host.append(make('span', { class: 'chip' }, preview, make('span', { class: 'nm', text: item.file.name, title: item.file.name }), make('span', { class: 'sz', text: fileSize(item.file.size) }), make('span', { class: 'upload-state selected', text: 'selected' }), remove));
      });
    },
    async submit() {
      const input = $('#input'); const content = input.value.trim();
      if (busy && !AgentUI.canInterruptCurrent()) return Chat.stop();
      if (!content && !this.attachments.length) return;
      if (this.launching) return;
      if (content.length > this.limit) return Toast.show('Message is too long to send', { icon: 'alert' });
      this.launching = true;
      try { await playSendTransition(); } finally { this.launching = false; }
      const files = [...this.attachments]; input.value = ''; this.attachments = []; this.renderAttachments(); this.sync(); Music.schedule(); Chat.send(content, files);
    },
    initMic() {
      const button = $('#micBtn');
      button.addEventListener('click', () => { void toggleVoiceInput(); });
    },
  };

  const AgentUI = {
    enabled: true, pending: null, queue: [], plan: null, busy: false, workingMessageId: null, lastCommandSelectionAt: 0,
    interruptedSessions: new Set(),
    progressMessages: new Map(), activeTaskBySession: new Map(), latestRevisionByTask: new Map(), latestRequestBySession: new Map(), terminalTaskTombstones: new Map(), unsubscribeComputerEvents: null,
    isEnabled() { return true; },
    canInterruptCurrent() {
      const thread = State.active;
      // The toggle controls starting new tasks, not control of a task that is
      // already running. Keep owner steering available until it is terminal.
      return Boolean(thread && this.activeTaskBySession.has(sessionFor(thread.id)));
    },
    canReview(message) {
      return Boolean(this.pending && !this.busy && this.pending.messageId === message?.id);
    },
    commands: Object.freeze(['@create-file', '@computer-use']),
    available() { return Boolean(window.solat?.agentInspect && window.solat?.agentApprove && window.solat?.agentRun && window.solat?.agentCancel); },
    syncCommandMenu() {
      $('#composer')?.classList.add('agent-on');
      const selected = this.commandFromText($('#input')?.value || '');
      $$('[data-agent-command]').forEach(item => {
        const active = item.dataset.agentCommand === selected;
        item.setAttribute('aria-checked', String(active));
        item.classList.toggle('active', active);
      });
    },
    handleInput(value) {
      const current = String(value || '');
      const menu = $('#agentCommandMenu');
      if (/(?:^|\s)@[a-z-]*$/iu.test(current)) this.openMenu();
      else if (menu && !menu.hidden) this.closeMenu();
      this.syncInputAppearance(current);
    },
    commandFromText(value) {
      const tokens = String(value || '').match(/(?:^|\s)(@(create-file|computer-use))(?=\s|$)/giu);
      if (!tokens?.length) return null;
      const token = tokens.at(-1).trim().toLowerCase();
      return this.commands.includes(token) ? token.slice(1) : null;
    },
    syncInputAppearance(value = $('#input')?.value || '') {
      $('#input')?.classList.toggle('has-agent-command', Boolean(this.commandFromText(value)));
    },
    openMenu() {
      const menu = $('#agentCommandMenu'); if (!menu) return;
      // The command palette must not be clipped by the composer or its
      // scrolling parents.  Keep a single element, but render it at body
      // level whenever it is used, like a popover.
      if (menu.parentElement !== document.body) document.body.append(menu);
      const input = $('#input');
      if (input) {
        const bounds = input.getBoundingClientRect();
        menu.style.left = `${Math.max(12, Math.round(bounds.left))}px`;
        menu.style.top = `${Math.max(12, Math.round(bounds.top - 116))}px`;
      }
      menu.removeAttribute('hidden'); menu.hidden = false; menu.style.visibility = 'visible'; this.syncCommandMenu();
    },
    closeMenu() { const menu = $('#agentCommandMenu'); if (menu && !menu.hidden) { menu.hidden = true; menu.style.left = ''; menu.style.top = ''; menu.style.visibility = ''; this.syncCommandMenu(); } },
    select(command) {
      if (!['create-file', 'computer-use'].includes(command)) return;
      const now = Date.now();
      // A pointerdown is intentionally handled before the textarea blur. The
      // browser will then also emit click; ignore only that synthetic follow-up
      // so one user press cannot insert two command tokens.
      if (now - this.lastCommandSelectionAt < 350) return;
      this.lastCommandSelectionAt = now;
      const input = $('#input'); if (!input) return;
      const start = Number.isInteger(input.selectionStart) ? input.selectionStart : input.value.length;
      const end = Number.isInteger(input.selectionEnd) ? input.selectionEnd : start;
      const before = input.value.slice(0, start); const after = input.value.slice(end);
      const partial = before.match(/(^|\s)@[a-z-]*$/iu);
      const tokenStart = partial ? start - partial[0].length + partial[1].length : start;
      const spacer = partial || !before || /\s$/u.test(before) ? '' : ' ';
      const token = `@${command} `;
      input.value = `${before.slice(0, tokenStart)}${spacer}${token}${after}`;
      const caret = tokenStart + spacer.length + token.length;
      input.focus(); input.setSelectionRange(caret, caret);
      this.closeMenu(); this.syncInputAppearance(input.value); this.syncCommandMenu(); Composer.sync();
      Toast.show(`@${command} inserted.`, { icon: 'cpu', timeout: 1800 });
    },
    status(message) { const node = $('#agentStatus'); if (node) node.textContent = message; },
    progressMessageKey(taskId, requestId = null) {
      return `${String(taskId || '')}:${String(requestId || '')}`;
    },
    beginRequest({ sessionId, requestId }) {
      if (!sessionId || !requestId) return;
      this.latestRequestBySession.set(sessionId, requestId);
      const belongsToSession = action => action?.sessionId === sessionId;
      if (belongsToSession(this.pending)) {
        this.finalizeRequestMessage('replaced');
        this.pending = null; this.plan = null; this.busy = false; this.workingMessageId = null; Overlay.close();
      }
      this.queue = this.queue.filter(action => !belongsToSession(action));
      this.render();
    },
    rememberTerminalTask(taskId, { revision = 0, requestId = null } = {}) {
      if (!taskId) return;
      const previous = this.terminalTaskTombstones.get(taskId);
      this.terminalTaskTombstones.delete(taskId);
      this.terminalTaskTombstones.set(taskId, {
        revision: Math.max(Number(previous?.revision || 0), Number(revision || 0)),
        requestId: requestId || previous?.requestId || null,
      });
      while (this.terminalTaskTombstones.size > 512) this.terminalTaskTombstones.delete(this.terminalTaskTombstones.keys().next().value);
    },
    reconcileComputerTaskResponse({ threadId, sessionId, requestId, message }) {
      if (!threadId || !sessionId || !requestId || !message) return message;
      const thread = State.threads.find(item => item.id === threadId);
      const progress = thread?.messages?.find(item => item.responseMeta?.mode === 'agent_progress'
        && item.responseMeta?.computerTaskSessionId === sessionId
        && item.responseMeta?.computerTaskRequestId === requestId);
      if (!progress || progress.id === message.id) return message;
      const computerMeta = {
        computerTaskId: progress.responseMeta?.computerTaskId,
        computerTaskSessionId: sessionId,
        computerTaskRequestId: requestId,
        computerTaskRevision: progress.responseMeta?.computerTaskRevision,
      };
      const merged = State.updateMessage(threadId, progress.id, {
        content: message.content,
        error: message.error,
        responseMeta: { ...message.responseMeta, ...computerMeta },
      });
      State.removeMessage(threadId, message.id);
      return merged || message;
    },
    receiveComputerTaskEvent(event) {
      if (!event || event.schema_version !== 'solat.computer-task-event.v1' || !event.task_id || !event.session_id) return;
      const terminal = ['completed', 'failed', 'cancelled', 'unsupported', 'needs_clarification'].includes(event.type);
      if (!terminal) globalThis.window?.solatVoiceController?.markActing();
      const revision = Number(event.revision || 0);
      if (this.terminalTaskTombstones.has(event.task_id)) return;
      const latestRequest = this.latestRequestBySession.get(event.session_id);
      const activeTask = this.activeTaskBySession.get(event.session_id);
      if (latestRequest && event.request_id && event.request_id !== latestRequest) {
        // A stale terminal event may retire only its own active task. It must
        // never create/update chat content belonging to the newer request.
        if (terminal && activeTask === event.task_id) {
          this.activeTaskBySession.delete(event.session_id);
          this.latestRevisionByTask.set(event.task_id, Math.max(this.latestRevisionByTask.get(event.task_id) || 0, revision));
          this.rememberTerminalTask(event.task_id, { revision, requestId: event.request_id });
        }
        return;
      }
      if (activeTask && activeTask !== event.task_id && event.type !== 'started') return;
      // Only a started event may establish a task. This prevents an evicted,
      // delayed progress event from resurrecting a terminal task.
      if (!activeTask && !terminal && event.type !== 'started') return;
      const latestRevision = this.latestRevisionByTask.get(event.task_id) || 0;
      if (revision < latestRevision) return;
      this.latestRevisionByTask.set(event.task_id, revision);
      const thread = State.threads.find(item => sessionFor(item.id) === event.session_id);
      if (!thread) return;
      if (event.type === 'cancelled' && Chat.controller?.solatRequestId === event.request_id) {
        // The durable computer task is already cancelled, so do not keep the
        // composer and thinking bubble blocked on a late model response. The
        // matching in-flight send is retired and its eventual result ignored.
        Chat.controller.stopped = true;
        Chat.requestId += 1;
        Chat.controller = null;
        Composer.setBusy(false);
        setStatus('ready', 'Ready');
      }
      if (terminal) {
        if (this.activeTaskBySession.get(event.session_id) === event.task_id) this.activeTaskBySession.delete(event.session_id);
      } else {
        this.activeTaskBySession.set(event.session_id, event.task_id);
      }
      const label = event.summary || ({
        started: 'SOLAT is planning the computer task.', planning: 'SOLAT is choosing the next step.',
        step_selected: 'SOLAT selected the next computer step.', observation_ready: 'SOLAT received a verified screen observation.',
        approval_required: 'The next computer action needs your approval.', action_verified: 'The approved action was verified.',
        replanned: 'SOLAT received your newer instruction and is replanning.', completed: 'Computer task completed.',
        failed: 'Computer task failed.', cancelled: 'Computer task cancelled.',
      }[event.type] || 'Computer task updated.');
      const content = event.tool ? `${label}\n\nStep: \`${event.tool}\`` : label;
      const progressKey = this.progressMessageKey(event.task_id, event.request_id);
      const existingId = this.progressMessages.get(progressKey);
      const responseMeta = {
        provider: 'SOLAT Agent', model: 'continuous computer task', mode: 'agent_progress',
        agentMode: true, agentStatus: event.status, computerTaskId: event.task_id,
        computerTaskSessionId: event.session_id, computerTaskRequestId: event.request_id, computerTaskRevision: event.revision,
        webSearchStatus: 'not_requested', sources: [], searchEvidence: [],
      };
      if (existingId && State.updateMessage(thread.id, existingId, { content, responseMeta })) {
        // Keep one live progress item per task instead of flooding the chat.
      } else {
        const message = State.add(thread.id, { role: 'assistant', content, responseMeta });
        if (message?.id) this.progressMessages.set(progressKey, message.id);
      }
      this.status(label);
      if (State.activeId === thread.id) Chat.render();
      if (terminal) {
        this.rememberTerminalTask(event.task_id, { revision, requestId: event.request_id });
      }
    },
    finalizeRequestMessage(status) {
      const pending = this.pending;
      if (!pending?.threadId || !pending?.messageId) return;
      const thread = State.threads.find(item => item.id === pending.threadId);
      const message = thread?.messages?.find(item => item.id === pending.messageId);
      if (!message?.responseMeta) return;
      State.updateMessage(pending.threadId, pending.messageId, {
        responseMeta: {
          ...message.responseMeta,
          agentActionPending: false,
          agentActionStatus: status,
        },
      });
    },
    actionPreview(action) {
      const args = action?.arguments && typeof action.arguments === 'object' ? action.arguments : {};
      const preview = { tool: action?.tool || 'unknown' };
      for (const key of ['path', 'export_name', 'expected_sha256', 'app_id', 'query', 'hwnd', 'selector', 'verify_selector', 'verify_state', 'verify_value']) if (args[key] !== undefined) preview[key] = args[key];
      if (typeof args.content === 'string') {
        preview.content_length = args.content.length; preview.content_preview = args.content.slice(0, 1200);
        if (args.content.length > 1200) preview.content_truncated = true;
      }
      if (typeof args.value === 'string') {
        preview.value_length = args.value.length; preview.value_preview = args.value.slice(0, 1200);
        if (args.value.length > 1200) preview.value_truncated = true;
      }
      return preview;
    },
    actionScopeLine(scope) {
      if (!scope || typeof scope !== 'object') return '';
      const parts = [];
      if (Array.isArray(scope.allowed_apps) && scope.allowed_apps.length) parts.push(`apps: ${scope.allowed_apps.map(app => text(app)).join(', ')}`);
      if (Array.isArray(scope.allowed_sites) && scope.allowed_sites.length) parts.push(`sites: ${scope.allowed_sites.map(site => text(site).replaceAll('_', ' ')).join(', ')}`);
      if (Array.isArray(scope.allowed_targets) && scope.allowed_targets.length) {
        parts.push(`windows: ${scope.allowed_targets.map(target => `${text(target?.process_name)} — ${text(target?.window_title)}`).join('; ')}`);
      } else if (Array.isArray(scope.allowed_hwnds) && scope.allowed_hwnds.length) {
        parts.push(`windows: ${scope.allowed_hwnds.length} observed window handle(s)`);
      }
      return parts.join(' · ');
    },
    actionSummary(action) {
      const args = action?.arguments && typeof action.arguments === 'object' ? action.arguments : {};
      if (action?.approval_scope === 'computer_task') {
        const firstAction = JSON.stringify(this.actionPreview(action));
        // The dialog must state what the approval actually covers. The scope
        // comes from the pending action itself, never from goal keywords.
        const scopeLine = this.actionScopeLine(action.granted_scope) || 'only this single verified action';
        const goal = text(action.task_goal).slice(0, 500);
        return `Authorize this bounded Computer Use task once.\nApproved scope: ${scopeLine}\nTask: ${goal}\n\nFirst action: ${firstAction}`;
      }
      switch (action?.tool) {
        case 'filesystem_create': return `Create “${text(args.path || 'new file')}” with ${Number(args.content?.length || 0).toLocaleString()} characters of generated content.`;
        case 'filesystem_update': return `Update “${text(args.path || 'workspace file')}” after checking that it has not changed.`;
        case 'filesystem_export': return `Save a downloadable copy of “${text(args.path || 'workspace file')}”.`;
        case 'computer_launch_app': return `Open ${text(args.app_id || 'the selected app')}.`;
        case 'computer_open_website': return `Open ${text(String(args.site || '').replaceAll('_', ' ') || 'the selected website')} in Chrome.`;
        case 'computer_play_youtube_music': return `Open YouTube and play the search result for “${text(args.query || '')}”.`;
        case 'computer_invoke': return 'Use the selected on-screen control, then verify the expected result.';
        case 'computer_set_value': return 'Fill the selected non-sensitive on-screen field, then verify it.';
        case 'computer_press_enter': return 'Submit the selected non-sensitive field with Enter, then verify the resulting page title.';
        default: return 'Review the requested Agent action before it runs.';
      }
    },
    stepSummary(step) {
      const labels = {
        filesystem_create: 'Create file', filesystem_update: 'Update file', filesystem_undo: 'Undo file edit', filesystem_export: 'Prepare download',
        computer_launch_app: 'Open app', computer_open_website: 'Open website', computer_play_youtube_music: 'Play YouTube music',
        computer_list_windows: 'Read visible windows', computer_inspect: 'Read screen controls', computer_invoke: 'Use screen control', computer_set_value: 'Fill screen field', computer_press_enter: 'Submit screen field',
      };
      return `${labels[step?.tool] || 'Agent action'} — ${step?.status || 'Queued'}`;
    },
    outcomeText(plan) {
      const step = plan?.steps?.[0]; const output = step?.output || {};
      if (plan?.status !== 'SUCCEEDED') return `Agent action failed: ${plan?.failure?.message || plan?.status || 'unknown failure'}`;
      if (String(step?.tool || '').startsWith('filesystem_')) {
        const operation = output.operation || step.tool.replace('filesystem_', '');
        const location = output.relative_path ? ` \`${output.relative_path}\`` : '';
        const hash = output.sha256 ? `\nSHA-256: \`${output.sha256}\`` : '';
        return `Agent verified the file ${operation}${location}.${hash}`;
      }
      if (String(step?.tool || '').startsWith('computer_')) {
        if (output.operation === 'launch_app' && output.launched === true) return `Agent verified ${output.app_id || output.process_name || 'the application'} was launched.`;
        if (output.operation === 'play_youtube_music' && output.verified === true) return `Agent verified Chrome searched YouTube for “${output.query}”, opened “${output.selected_result}”, and music playback is active.`;
        const target = output.target?.process_name ? ` in ${output.target.process_name}` : '';
        const evidence = output.verification ? ` Verified ${output.verification.selector} (${output.verification.state}).` : '';
        return `Agent verified ${output.operation || step.tool}${target}.${evidence}`;
      }
      return 'Agent action completed with verified tool output.';
    },
    artifactFromPlan(plan) {
      const step = plan?.steps?.[0]; const output = step?.output || {};
      if (plan?.status !== 'SUCCEEDED' || !String(step?.tool || '').startsWith('filesystem_') || !output.relative_path || !output.sha256) return null;
      return {
        schemaVersion: 'solat.agent-chat-file.v1', status: 'ready', operation: output.operation || step.tool.replace('filesystem_', ''),
        relativePath: output.relative_path, sha256: output.sha256, sizeBytes: Number(output.size_bytes) || 0,
        sessionId: this.pending?.sessionId || '',
      };
    },
    startWorkingMessage() {
      if (!String(this.pending?.tool || '').startsWith('filesystem_') || !this.pending?.threadId) return;
      const relativePath = text(this.pending?.arguments?.path || 'workspace file');
      const message = State.add(this.pending.threadId, {
        role: 'assistant', content: `Creating \`${relativePath}\`…`,
        responseMeta: { provider: 'SOLAT Agent', model: 'workspace tool', mode: 'agent_working', webSearchStatus: 'not_requested', sources: [], searchEvidence: [], agentMode: true, agentFile: { schemaVersion: 'solat.agent-chat-file.v1', status: 'working', operation: this.pending.tool.replace('filesystem_', ''), relativePath } },
      });
      this.workingMessageId = message?.id || null;
    },
    addChatResult(content, error = false, artifact = null, statusOverride = null, taskStatus = null) {
      const threadId = this.pending?.threadId; if (!threadId) return;
      const computerTaskId = this.pending?.computerTaskId;
      const responseMeta = {
        provider: 'SOLAT Agent', model: 'verified tool result', mode: error ? 'agent_failure' : 'agent_verified',
        agentStatus: statusOverride || (error ? 'failed' : 'verified'), webSearchStatus: 'not_requested',
        sources: [], searchEvidence: [], agentMode: true,
        ...(computerTaskId ? {
          computerTaskId,
          computerTaskSessionId: this.pending?.sessionId,
          computerTaskRequestId: this.pending?.requestId,
          computerTaskRevision: this.latestRevisionByTask.get(computerTaskId) || 0,
        } : {}),
        ...(artifact ? { agentFile: artifact } : {}),
      };
      const progressKey = computerTaskId
        ? this.progressMessageKey(computerTaskId, this.pending?.requestId)
        : null;
      const progressMessageId = progressKey ? this.progressMessages.get(progressKey) : null;
      const terminalTask = ['COMPLETED', 'FAILED', 'CANCELLED', 'UNSUPPORTED', 'NEEDS_CLARIFICATION'].includes(String(taskStatus || '').toUpperCase());
      if (computerTaskId && this.pending?.messageId && State.updateMessage(threadId, this.pending.messageId, { content, error, responseMeta })) {
        if (progressMessageId && progressMessageId !== this.pending.messageId) State.removeMessage(threadId, progressMessageId);
        this.progressMessages.delete(progressKey);
        if (terminalTask) {
          if (this.activeTaskBySession.get(this.pending.sessionId) === computerTaskId) this.activeTaskBySession.delete(this.pending.sessionId);
          this.rememberTerminalTask(computerTaskId, {
            revision: this.latestRevisionByTask.get(computerTaskId) || 0,
            requestId: this.pending.requestId,
          });
        }
        return;
      }
      if (this.workingMessageId && State.updateMessage(threadId, this.workingMessageId, { content, error, responseMeta })) return;
      State.add(threadId, { role: 'assistant', content, error, responseMeta });
    },
    fileCard(message) {
      const artifact = message.responseMeta?.agentFile || {}; const working = artifact.status === 'working';
      const name = text(artifact.relativePath || 'Workspace file');
      const meta = working ? `Creating ${artifact.operation || 'file'}…` : `${Number(artifact.sizeBytes || 0).toLocaleString()} bytes · verified`;
      const card = make(working ? 'div' : 'button', { class: `agent-file-card${working ? ' is-working' : ''}`, ...(working ? { role: 'status', 'aria-live': 'polite' } : { type: 'button', 'aria-label': `Open ${name} in SOLAT` }) },
        icon('file'), make('span', { class: 'agent-file-copy' }, make('b', { text: name }), make('span', { text: meta })),
        working ? make('span', { class: 'agent-file-dots', 'aria-hidden': 'true' }, make('i'), make('i'), make('i')) : make('span', { class: 'agent-file-open', text: 'Open' }));
      if (!working) card.addEventListener('click', () => this.openArtifact(message));
      return card;
    },
    async openArtifact(message) {
      const artifact = message.responseMeta?.agentFile;
      if (!artifact || artifact.status !== 'ready' || !window.solat?.agentReadArtifact) return Toast.show('This file preview is unavailable.', { icon: 'alert' });
      const dialog = make('dialog', { class: 'music-surface agent-artifact-viewer', 'aria-label': `Preview ${artifact.relativePath}` });
      const close = make('button', { type: 'button', class: 'iconbtn', 'aria-label': 'Close file preview' }, icon('x'));
      const meta = make('p', { class: 'muted', text: 'Opening verified workspace file…' });
      const content = make('pre', { class: 'agent-artifact-content', text: 'Loading…' });
      const preview = make('iframe', { class: 'agent-artifact-preview', title: `Rendered preview of ${artifact.relativePath}`, sandbox: '' });
      const codeButton = make('button', { type: 'button', class: 'button sm active', text: 'Code', 'aria-pressed': 'true' });
      const previewButton = make('button', { type: 'button', class: 'button sm', text: 'Preview', 'aria-pressed': 'false' });
      const downloadButton = make('button', { type: 'button', class: 'button sm', text: 'Download' });
      const toolbar = make('div', { class: 'agent-artifact-toolbar', role: 'toolbar', 'aria-label': 'File view options' }, codeButton, previewButton, downloadButton);
      const canRender = /\.html?$/iu.test(artifact.relativePath);
      const setView = view => {
        const showPreview = view === 'preview' && canRender;
        content.hidden = showPreview;
        preview.hidden = !showPreview;
        codeButton.classList.toggle('active', !showPreview); codeButton.setAttribute('aria-pressed', String(!showPreview));
        previewButton.classList.toggle('active', showPreview); previewButton.setAttribute('aria-pressed', String(showPreview));
      };
      codeButton.addEventListener('click', () => setView('code'));
      previewButton.addEventListener('click', () => setView('preview'));
      previewButton.disabled = !canRender;
      previewButton.title = canRender ? 'Render this HTML safely inside SOLAT' : 'Preview is available for HTML files only';
      downloadButton.addEventListener('click', async () => {
        if (!window.solat?.agentExportArtifact) return Toast.show('Download is unavailable in this runtime.', { icon: 'alert' });
        downloadButton.disabled = true;
        try {
          const exportName = artifact.relativePath.split('/').at(-1);
          const downloaded = await window.solat.agentExportArtifact({ sessionId: artifact.sessionId, relativePath: artifact.relativePath, expectedSha256: artifact.sha256, exportName });
          Toast.show(`Saved ${downloaded.export_name} to SOLAT Downloads.`, { icon: 'check' });
        } catch (error) { Toast.show(`Download failed: ${errorText(error)}`, { icon: 'alert' }); }
        finally { downloadButton.disabled = false; }
      });
      close.addEventListener('click', () => dialog.close()); dialog.addEventListener('close', () => dialog.remove(), { once: true });
      dialog.append(make('div', { class: 'music-surface-head' }, make('strong', { text: artifact.relativePath }), close), meta, toolbar, content, preview);
      document.body.append(dialog); dialog.showModal();
      try {
        const result = await window.solat.agentReadArtifact({ sessionId: artifact.sessionId, relativePath: artifact.relativePath, expectedSha256: artifact.sha256 });
        meta.textContent = `${result.size_bytes.toLocaleString()} bytes · ${result.sha256}${result.truncated ? ' · preview truncated' : ''}`;
        content.textContent = result.content;
        if (canRender) preview.srcdoc = result.content;
        setView('code');
      } catch (error) { meta.textContent = `File preview failed: ${errorText(error)}`; content.textContent = ''; }
    },
    async receive(actions, context) {
      if (context?.requestId && this.latestRequestBySession.get(context.sessionId) !== context.requestId) return;
      const accepted = actions.filter(action => action?.status === 'confirmation_required' && action.idempotency_key && action.approval_token);
      // A ComputerTaskLoop start is a newer owner instruction. The backend has
      // already cancelled its old durable plan; remove its stale dialog here
      // too so the user cannot accidentally review a superseded action.
      const replacement = accepted.find(action => action?.computerTaskId);
      if (replacement) {
        const sameTaskScope = action => action?.computerTaskId
          && action.sessionId === context.sessionId
          && action.idempotency_key !== replacement.idempotency_key;
        const stale = [this.pending, ...this.queue].filter(sameTaskScope);
        for (const action of stale) {
          try { await window.solat?.agentCancel?.({ sessionId: action.sessionId, idempotencyKey: action.idempotency_key }); }
          catch { /* Backend cancellation is idempotent; never block the new instruction. */ }
        }
        if (sameTaskScope(this.pending)) {
          this.pending = null; this.plan = null; Overlay.close();
          Toast.show('Previous Computer Use action was replaced by your newer instruction.', { icon: 'alert' });
        }
        this.queue = this.queue.filter(action => !sameTaskScope(action));
      }
      this.queue.push(...accepted.map(action => ({ ...action, ...context })));
      if (!this.pending) await this.activateNext();
    },
    async activateNext() {
      this.pending = this.queue.shift() || null; this.plan = null;
      if (!this.pending) { this.render(); return; }
      try {
        this.plan = await window.solat.agentInspect({ sessionId: this.pending.sessionId, idempotencyKey: this.pending.idempotency_key });
        this.status(this.pending.approval_scope === 'computer_task'
          ? 'Approve this bounded Computer Use task once. Safe in-scope steps will then continue automatically.'
          : 'This action changes a file or app. Review it before approval.');
      } catch (error) { this.status(`The pending action could not be inspected: ${errorText(error)}`); }
      this.render(); Overlay.open($('#agentDialog'), { focus: $('#agentApproveBtn') });
    },
    openPending(message) {
      if (!this.pending || this.pending.messageId !== message.id) return Toast.show('This Agent action is no longer pending.', { icon: 'alert' });
      this.render(); Overlay.open($('#agentDialog'), { focus: $('#agentApproveBtn') });
    },
    close() { Overlay.close(); },
    async awaitComputerTaskContinuation(continuation, pending) {
      const settled = continuation.then(
        value => ({ kind: 'settled', value }),
        error => ({ kind: 'failed', error }),
      );
      if (!window.solat?.computerTaskInspect) {
        const outcome = await settled;
        if (outcome.kind === 'failed') throw outcome.error;
        return outcome.value;
      }
      const terminal = new Set(['COMPLETED', 'FAILED', 'CANCELLED', 'UNSUPPORTED', 'NEEDS_CLARIFICATION']);
      const observedTerminal = (async () => {
        for (let attempt = 0; attempt < 80; attempt += 1) {
          await new Promise(resolve => setTimeout(resolve, 250));
          try {
            const nextTask = await window.solat.computerTaskInspect({
              sessionId: pending.sessionId,
              taskId: pending.computerTaskId,
            });
            if (terminal.has(String(nextTask?.status || '').toUpperCase())) {
              const plan = await window.solat.agentInspect({
                sessionId: pending.sessionId,
                idempotencyKey: pending.idempotency_key,
              });
              return { kind: 'observed_terminal', value: { plan, next_task: nextTask } };
            }
          } catch {
            // The original atomic IPC remains authoritative while a read-only
            // status sample is briefly unavailable during task creation.
          }
        }
        return settled;
      })();
      const outcome = await Promise.race([settled, observedTerminal]);
      if (outcome.kind === 'failed') throw outcome.error;
      return outcome.value;
    },
    async approve() {
      if (!this.pending || this.busy) return;
      const pending = this.pending;
      const animationStartedAt = performance.now();
      this.busy = true; this.startWorkingMessage(); this.status('Approving and running the verified plan…'); this.render();
      let nextTask = null;
      try {
        let result;
        if (pending.computerTaskId && window.solat?.computerTaskApproveAndContinue) {
          // Start the atomic owner-scoped approval, then immediately return the
          // user to chat while the bounded continuation runs in main.
          const continuation = window.solat.computerTaskApproveAndContinue({
            sessionId: pending.sessionId, taskId: pending.computerTaskId,
            idempotencyKey: pending.idempotency_key, approvalToken: pending.approval_token,
          });
          this.status('Task authorized · continuing with verified in-scope steps');
          Overlay.close();
          const approved = await this.awaitComputerTaskContinuation(continuation, pending);
          result = { plan: approved.plan };
          nextTask = approved.next_task;
        } else {
          await window.solat.agentApprove({ sessionId: pending.sessionId, idempotencyKey: pending.idempotency_key, approvalToken: pending.approval_token });
          result = await window.solat.agentRun({ sessionId: pending.sessionId, idempotencyKey: pending.idempotency_key });
        }
        // A newer owner instruction may replace this approval while its action
        // is in flight. Never let the stale result overwrite the newer UI.
        if (this.pending !== pending) return;
        this.plan = result.plan;
        const remainingAnimationMs = 600 - (performance.now() - animationStartedAt);
        if (remainingAnimationMs > 0) await new Promise(resolve => setTimeout(resolve, remainingAnimationMs));
        let message = this.outcomeText(this.plan);
        if (this.plan?.status === 'SUCCEEDED' && pending.computerTaskId && window.solat?.computerTaskContinue) {
          // The owner approved the bounded task, not every individual click.
          // Close the modal before the continuation loop so chat remains
          // visible and the user can interrupt or cancel while SOLAT works.
          if (!nextTask) nextTask = await window.solat.computerTaskContinue({ sessionId: pending.sessionId, taskId: pending.computerTaskId, idempotencyKey: pending.idempotency_key });
          if (this.pending !== pending) return;
          if (nextTask?.pending_action?.action) {
            this.queue.unshift({
              ...nextTask.pending_action.action,
              tool: nextTask.pending_action.tool,
              computerTaskId: nextTask.task_id,
              threadId: pending.threadId,
              sessionId: pending.sessionId,
              requestId: pending.requestId,
              messageId: pending.messageId,
            });
            message = `${message}\n\n${nextTask.summary || 'SOLAT checked the result and prepared the next step.'}`;
          } else if (nextTask?.summary) {
            message = `${message}\n\n${nextTask.summary}`;
          }
        }
        const taskStatus = pending.computerTaskId ? String(nextTask?.status || 'RUNNING').toUpperCase() : (this.plan?.status === 'SUCCEEDED' ? 'COMPLETED' : 'FAILED');
        const taskFailed = taskStatus === 'FAILED' || this.plan?.status !== 'SUCCEEDED';
        this.addChatResult(message, taskFailed, this.artifactFromPlan(this.plan), null, taskStatus);
        const statusLabel = {
          COMPLETED: 'Completed · verified', FAILED: 'Computer task failed', CANCELLED: 'Computer task cancelled',
          NEEDS_CLARIFICATION: 'Computer task needs clarification', AWAITING_APPROVAL: 'Additional approval required',
          RUNNING: 'Step verified · continuing',
        }[taskStatus] || 'Step verified · continuing';
        this.status(statusLabel); this.render();
        if (taskStatus === 'COMPLETED') Toast.show('Agent task verified and completed.', { icon: 'check' });
        else if (taskStatus === 'AWAITING_APPROVAL') Toast.show('Additional approval is required because the task scope changed.', { icon: 'alert' });
      } catch (error) {
        if (this.pending !== pending) return;
        const message = `Agent action failed: ${errorText(error)}`; this.status(message); this.addChatResult(message, true, null, 'failed', 'FAILED');
      } finally {
        if (this.pending !== pending) { this.busy = false; this.workingMessageId = null; this.render(); return; }
        const hasNextPending = Boolean(nextTask?.pending_action?.action);
        this.finalizeRequestMessage(this.plan?.status === 'SUCCEEDED' ? (hasNextPending ? 'awaiting_approval' : (nextTask?.status?.toLowerCase() || 'completed')) : 'failed');
        this.busy = false; this.workingMessageId = null; this.pending = null; this.render(); Overlay.close(); await this.activateNext();
      }
    },
    async cancel() {
      if (!this.pending || this.busy) return this.close();
      this.busy = true; this.status('Cancelling the pending action…'); this.render();
      try {
        this.plan = await window.solat.agentCancel({ sessionId: this.pending.sessionId, idempotencyKey: this.pending.idempotency_key });
        if (this.pending.computerTaskId && window.solat?.computerTaskCancel) {
          await window.solat.computerTaskCancel({ sessionId: this.pending.sessionId, taskId: this.pending.computerTaskId });
        }
        this.addChatResult('Agent action cancelled. No pending file or computer change was completed.', false, null, 'cancelled', 'CANCELLED');
        Toast.show('Agent action cancelled.', { icon: 'check' });
      } catch (error) { this.status(`Cancellation failed: ${errorText(error)}`); return; }
      finally {
        this.busy = false;
        if (this.plan?.status === 'CANCELLED') {
          this.finalizeRequestMessage('cancelled');
          this.pending = null; Overlay.close(); await this.activateNext();
        }
        this.render();
      }
    },
    render() {
      const steps = $('#agentSteps'); if (steps) {
        steps.textContent = '';
        const current = this.plan?.steps?.length ? this.plan.steps : this.pending ? [{ tool: this.pending.tool, status: 'PAUSED_APPROVAL' }] : [];
        for (const step of current) steps.append(make('li', { text: this.stepSummary(step) }));
      }
      const result = $('#agentResult'); if (result) {
        const value = this.pending ? this.actionSummary(this.pending) : this.plan?.failure?.message || (this.plan ? `Plan status: ${this.plan.status}` : '');
        result.hidden = !value; result.textContent = value;
      }
      const approve = $('#agentApproveBtn'); const cancel = $('#agentCancelBtn');
      const progress = $('#agentProgress'); const progressLabel = $('#agentProgressLabel');
      if (progress) progress.hidden = !this.busy;
      if (progressLabel && this.busy) progressLabel.textContent = String(this.pending?.tool || '').startsWith('filesystem_') ? `Creating ${text(this.pending?.arguments?.path || 'file')}…` : 'Running approved Agent action…';
      if (approve) {
        approve.hidden = !this.pending; approve.disabled = this.busy;
        approve.textContent = this.pending?.approval_scope === 'computer_task' ? 'Approve task and continue' : 'Approve and run';
      }
      if (cancel) { cancel.textContent = this.pending ? 'Cancel action' : 'Close'; cancel.disabled = this.busy; }
    },
    async reportInterrupted(threadId) {
      if (!window.solat?.agentInterruptedPlans || !threadId) return;
      const sessionId = sessionFor(threadId);
      if (this.interruptedSessions.has(sessionId)) return;
      this.interruptedSessions.add(sessionId);
      try {
        const report = await window.solat.agentInterruptedPlans({ sessionId });
        const plans = Array.isArray(report?.plans) ? report.plans : [];
        if (!plans.length) return;
        const shown = plans.slice(0, 5);
        const lines = shown.map(plan => `- \`${text(plan.tool) || 'agent action'}\` was ${plan.status_at_interrupt === 'PAUSED_APPROVAL' ? 'waiting for approval' : 'in progress'}`);
        if (plans.length > shown.length) lines.push(`- …and ${plans.length - shown.length} more`);
        State.add(threadId, {
          role: 'assistant',
          content: `SOLAT restarted before these Agent actions finished, so they were interrupted and not run again automatically:\n${lines.join('\n')}\nAsk again if you still want them.`,
          responseMeta: {
            provider: 'SOLAT Agent', model: 'interrupted task report', mode: 'agent_interrupted',
            agentMode: true, agentStatus: 'interrupted', webSearchStatus: 'not_requested', sources: [], searchEvidence: [],
          },
        });
      } catch { /* Interrupted-task reporting must never block the conversation. */ }
    },
    init() {
      const commandMenu = $('#agentCommandMenu');
      if (commandMenu && commandMenu.parentElement !== document.body) document.body.append(commandMenu);
      const chooseCommand = event => {
        const command = event.target.closest('[data-agent-command]')?.dataset.agentCommand;
        if (!command) return;
        if (event.type === 'pointerdown') event.preventDefault();
        this.select(command);
      };
      // `pointerdown` wins the race against textarea blur. Keyboard users
      // still activate the same control through click.
      $('#agentCommandMenu')?.addEventListener('pointerdown', chooseCommand);
      $('#agentCommandMenu')?.addEventListener('click', chooseCommand);
      $('#agentApproveBtn')?.addEventListener('click', () => this.approve());
      $('#agentCancelBtn')?.addEventListener('click', () => this.cancel());
      $('[data-agent-close]')?.addEventListener('click', () => this.close());
      if (window.solat?.onComputerTaskEvent) this.unsubscribeComputerEvents = window.solat.onComputerTaskEvent(event => this.receiveComputerTaskEvent(event));
      // Restart interrupts the in-memory computer task loop. Surface durable
      // plans that were left behind on the active thread, once per session.
      State.subscribe(reason => {
        if (reason !== 'active' && reason !== 'durable-restore') return;
        const thread = State.active;
        if (thread) this.reportInterrupted(thread.id);
      });
      if (State.active) this.reportInterrupted(State.active.id);
      this.syncCommandMenu(); this.render();
    },
  };

  const Music = {
    timer: null, latestDecks: new Map(), song() { return text($('#musicInput')?.value).trim(); },
    rememberDeck(threadId, entry) {
      const previous = this.latestDecks.get(threadId);
      const history = [...(previous?.history || []), { result: entry.result, sessionId: entry.sessionId, exported: null }];
      this.latestDecks.set(threadId, { ...entry, history, exported: null });
      return this.latestDecks.get(threadId);
    },
    init() {
      const input = $('#musicInput'); if (!input) return;
      input.value = store.get('solat.v2.music.song', ''); input.addEventListener('input', () => { store.set('solat.v2.music.song', input.value); this.schedule(); }); this.schedule();
      $('#musicPreview')?.addEventListener('click', event => { const button = event.target.closest('[data-music-action]'); if (button) this.action(button.dataset.musicAction); });
    },
    async restoreHistory() {
      if (!window.solat?.loadCreativeHistory) return;
      for (const thread of State.threads) {
        try {
          const sessionId = sessionFor(thread.id);
          const restored = await window.solat.loadCreativeHistory({ sessionId });
          const history = Array.isArray(restored?.history) ? restored.history : [];
          const latest = history.at(-1);
          if (latest?.result) this.latestDecks.set(thread.id, { result: latest.result, sessionId, history, exported: latest.exported || null, inspection: latest.inspection || null });
        } catch {
          // A missing or malformed local history must not block normal chat.
        }
      }
      this.render();
    },
    schedule() { clearTimeout(this.timer); this.timer = setTimeout(() => this.render(), 180); },
    render() {
      const preview = $('#musicPreview'); const song = this.song(); if (!preview) return;
      if (!song) { preview.textContent = ''; preview.classList.remove('on'); return; }
      preview.classList.add('on'); preview.textContent = '';
      const card = make('div', { class: 'music-compact' }, make('div', {}, make('b', { text: song }), ' · music context ready'), make('span', { class: 'muted', text: 'Music can now guide the structured editable-deck workflow. Review the plan before export.' }));
      const current = State.active ? this.latestDecks.get(State.active.id) : null;
      const actions = [
        ['details', 'Review music context', 'data-music-open-details'],
        ['emotion', 'Review emotion', 'data-music-review-emotion'],
        ['intensity', 'Choose intensity', 'data-music-select-intensity'],
        ['deck', 'Generate deck', 'data-music-generate-deck'],
        ['slides', 'Preview slides', 'data-music-preview-slides'],
        ['revise', 'Revise slides', 'data-music-revise-slides'],
        ['history', 'Revision history', 'data-music-revision-history'],
        ['image', 'Generate image', 'data-music-generate-image'],
        ['export', 'Export deck', 'data-music-export-format'],
        ['alternatives', 'View alternatives', 'data-music-view-alternatives'],
        ['direction', 'Edit direction', 'data-music-edit-direction'],
      ];
      if (current?.exported?.htmlPath) {
        actions.splice(9, 0, ['open', 'Open exported HTML', 'data-music-open-export']);
        actions.splice(10, 0, ['inspect', 'Inspect export', 'data-music-inspect-export']);
      }
      for (const [action, label, legacyMarker] of actions) card.append(make('button', { type: 'button', class: 'music-action', 'data-music-action': action, [legacyMarker]: '', text: label }));
      preview.append(card);
    },
    async generateDeck() {
      const thread = State.active || State.create();
      const previousUser = [...(thread.messages || [])].reverse().find(message => message.role === 'user');
      const goalInput = make('textarea', { rows: '3', required: '', placeholder: 'What should the deck help the audience understand?', text: previousUser?.content || '' });
      const audienceInput = make('input', { type: 'text', required: '', placeholder: 'Audience, e.g. Grade 10 classroom' });
      const slideInput = make('input', { type: 'number', min: '1', max: '12', value: '8', required: '' });
      const dialog = make('dialog', { class: 'music-surface', 'data-solat-deck-generator': '', 'aria-label': 'SOLAT generate editable deck' });
      const close = make('button', { type: 'button', class: 'music-action', text: 'Close' });
      const form = make('form', { method: 'dialog' });
      const submit = make('button', { type: 'submit', class: 'music-action', text: 'Generate structured plan' });
      const resultHost = make('div', { class: 'music-result', 'aria-live': 'polite' });
      close.addEventListener('click', () => dialog.close());
      dialog.addEventListener('close', () => dialog.remove(), { once: true });
      form.append(
        make('label', {}, 'Goal', goalInput),
        make('label', {}, 'Audience', audienceInput),
        make('label', {}, 'Slides (1–12)', slideInput),
        submit,
      );
      dialog.append(make('div', { class: 'music-surface-head' }, make('strong', { text: 'Generate editable deck plan' }), close), make('p', { class: 'muted', text: `Music anchor: ${this.song()}` }), form, resultHost);
      form.addEventListener('submit', async event => {
        event.preventDefault();
        if (!window.solat?.createDeck) { resultHost.textContent = 'Creative workflow is unavailable in this runtime.'; return; }
        submit.disabled = true; resultHost.textContent = 'Creating brief, Emotion DNA, narrative, design system, and editable document…';
        try {
          const sessionId = sessionFor(thread.id);
          const result = await window.solat.createDeck({
            requestId: uid('deck'), sessionId, goal: goalInput.value, audience: audienceInput.value,
            language: document.documentElement.lang || 'en', songReference: this.song(), slideCount: Number(slideInput.value),
            assets: Array.isArray(previousUser?.assetIds) ? previousUser.assetIds : [],
          });
          const artifacts = result.artifacts || {};
          this.rememberDeck(thread.id, { result, sessionId });
          resultHost.textContent = `Plan ready: ${artifacts.document?.slides?.length || 0} editable slides · status ${result.status}. Visual quality still requires manual review.`;
          State.add(thread.id, { role: 'assistant', content: `Creative plan ready for review: ${artifacts.document?.slides?.length || 0} editable slides, Emotion DNA confidence ${artifacts.emotion?.confidence ?? 'unknown'}.`, responseMeta: { provider: result.provider, model: result.model, mode: 'creative_workflow', projectId: result.projectId, jobId: result.jobId, traceId: result.traceId } });
          this.render();
        } catch (error) {
          resultHost.textContent = error?.message || 'The creative workflow failed.';
      } finally {
          submit.disabled = false;
        }
      });
      document.body.append(dialog); dialog.showModal(); goalInput.focus();
    },
    async exportDeck() {
      const thread = State.active;
      const stored = thread ? this.latestDecks.get(thread.id) : null;
      if (!stored) return Toast.show('Generate and review an editable deck plan before exporting.', { icon: 'alert', timeout: 4200 });
      if (stored.result.status !== 'READY_FOR_EDIT') return Toast.show(`This plan is ${stored.result.status}; review or revise it before export.`, { icon: 'alert', timeout: 5200 });
      if (!window.solat?.exportHtml) return Toast.show('Editable export is unavailable in this runtime.', { icon: 'alert', timeout: 4200 });
      try {
        const exported = await window.solat.exportHtml({ sessionId: stored.sessionId, creativeId: stored.result.id });
        const exportedState = { htmlPath: exported.htmlPath, manifestPath: exported.manifestPath, revision: exported.revision };
        const history = [...(stored.history || [])];
        if (history.length) history[history.length - 1] = { ...history[history.length - 1], exported: exportedState };
        this.latestDecks.set(thread.id, { ...stored, exported: exportedState, history });
        State.add(thread.id, { role: 'assistant', content: `Editable HTML exported for review: ${exported.htmlPath}`, responseMeta: { mode: 'editable_export', format: exported.format, documentId: exported.documentId, revision: exported.revision } });
        this.render();
        Toast.show('Editable HTML export created.', { icon: 'download', timeout: 4200 });
      } catch (error) {
        Toast.show(error?.message || 'The editable export failed.', { icon: 'alert', timeout: 5200 });
      }
    },
    async openExport() {
      const thread = State.active;
      const stored = thread ? this.latestDecks.get(thread.id) : null;
      const htmlPath = stored?.exported?.htmlPath;
      if (!htmlPath) return Toast.show('Export an editable deck before opening it.', { icon: 'alert', timeout: 4200 });
      if (!window.solat?.openExport) return Toast.show('Opening exported files is unavailable in this runtime.', { icon: 'alert', timeout: 4200 });
      try {
        await window.solat.openExport({ htmlPath });
        Toast.show('Opened the editable HTML export.', { icon: 'download', timeout: 4200 });
      } catch (error) {
        Toast.show(error?.message || 'The exported HTML could not be opened.', { icon: 'alert', timeout: 5200 });
      }
    },
    async inspectExport() {
      const thread = State.active;
      const stored = thread ? this.latestDecks.get(thread.id) : null;
      const htmlPath = stored?.exported?.htmlPath;
      if (!htmlPath) return Toast.show('Export an editable deck before inspecting it.', { icon: 'alert', timeout: 4200 });
      if (!window.solat?.inspectExport) return Toast.show('Export inspection is unavailable in this runtime.', { icon: 'alert', timeout: 4200 });
      try {
        const result = await window.solat.inspectExport({ htmlPath, sessionId: stored.sessionId, creativeId: stored.result.id });
        const inspection = result.inspection;
        const history = [...(stored.history || [])];
        if (history.length) history[history.length - 1] = { ...history[history.length - 1], inspection };
        this.latestDecks.set(thread.id, { ...stored, inspection, history });
        const assetText = inspection.assetRefs.length ? inspection.assetRefs.join(', ') : 'none';
        State.add(thread.id, { role: 'assistant', content: `Export inspection: ${inspection.status} · ${inspection.slideCount} slides · ${inspection.elementCount} elements · ${inspection.editableCount} editable · assets: ${assetText}.`, responseMeta: { mode: 'export_inspection', status: inspection.status, issues: inspection.issues } });
        this.render();
        const dialog = make('dialog', { class: 'music-surface', 'data-solat-export-inspection': '', 'aria-label': 'SOLAT export inspection' });
        const close = make('button', { type: 'button', class: 'music-action', text: 'Close' });
        close.addEventListener('click', () => dialog.close());
        dialog.addEventListener('close', () => dialog.remove(), { once: true });
        const issues = inspection.issues.length ? inspection.issues.map(issue => `${issue.code}: ${issue.detail}`).join(' | ') : 'No structural issues found.';
        dialog.append(
          make('div', { class: 'music-surface-head' }, make('strong', { text: 'Export inspection' }), close),
          make('p', { class: 'muted', text: `Status: ${inspection.status}. Slides: ${inspection.slideCount}. Elements: ${inspection.elementCount}. Editable: ${inspection.editableCount}. Locked: ${inspection.lockedCount}.` }),
          make('p', { class: 'muted', text: `Assets: ${assetText}.` }),
          make('p', { class: 'muted', text: `Issues: ${issues} Visual quality remains MANUAL REVIEW REQUIRED.` }),
        );
        document.body.append(dialog); dialog.showModal();
        Toast.show(`Export inspection ${inspection.status}.`, { icon: inspection.status === 'PASS' ? 'check' : 'alert', timeout: 4200 });
      } catch (error) {
        Toast.show(error?.message || 'The exported HTML could not be inspected.', { icon: 'alert', timeout: 5200 });
      }
    },
    revisionHistory() {
      const thread = State.active;
      const stored = thread ? this.latestDecks.get(thread.id) : null;
      if (!stored?.history?.length) return Toast.show('Generate a deck before viewing revision history.', { icon: 'alert', timeout: 4200 });
      const dialog = make('dialog', { class: 'music-surface', 'data-solat-revision-history': '', 'aria-label': 'SOLAT creative revision history' });
      const close = make('button', { type: 'button', class: 'music-action', text: 'Close' });
      close.addEventListener('click', () => dialog.close());
      dialog.addEventListener('close', () => dialog.remove(), { once: true });
      const list = make('ol', { class: 'music-result' });
      for (const [index, entry] of stored.history.entries()) {
        const result = entry.result;
        const relation = result.revisionOf ? `derived from ${result.revisionOf}` : 'original plan';
        const exported = entry.exported ? ' · exported HTML available' : '';
        list.append(make('li', { text: `Revision ${index + 1}: ${result.id} · ${result.status} · ${relation}${exported}` }));
      }
      dialog.append(
        make('div', { class: 'music-surface-head' }, make('strong', { text: 'Revision history' }), close),
        make('p', { class: 'muted', text: 'Every revision is a new immutable creative result. The earlier plan is never overwritten.' }),
        list,
      );
      document.body.append(dialog); dialog.showModal();
    },
    previewDeck() {
      const thread = State.active;
      const stored = thread ? this.latestDecks.get(thread.id) : null;
      if (!stored) return Toast.show('Generate an editable deck plan before previewing it.', { icon: 'alert', timeout: 4200 });
      const artifacts = stored.result.artifacts || {};
      const slides = artifacts.document?.slides || [];
      const dialog = make('dialog', { class: 'music-surface', 'data-solat-slide-preview': '', 'aria-label': 'SOLAT editable deck preview' });
      const close = make('button', { type: 'button', class: 'music-action', text: 'Close' });
      close.addEventListener('click', () => dialog.close());
      dialog.addEventListener('close', () => dialog.remove(), { once: true });
      const list = make('ol', { class: 'music-result' });
      for (const slide of slides) list.append(make('li', { text: `${slide.slide_id}: ${slide.role || 'slide'} · ${slide.elements?.length || 0} editable elements` }));
      dialog.append(
        make('div', { class: 'music-surface-head' }, make('strong', { text: 'Editable deck plan' }), close),
        make('p', { class: 'muted', text: `Status: ${stored.result.status}. Emotion confidence: ${artifacts.emotion?.confidence ?? 'unknown'}.` }),
        list,
        make('p', { class: 'muted', text: 'Geometry and export validity were checked. Visual quality still requires manual review.' }),
      );
      document.body.append(dialog); dialog.showModal();
    },
    async reviseDeck() {
      const thread = State.active;
      const stored = thread ? this.latestDecks.get(thread.id) : null;
      if (!stored) return Toast.show('Generate an editable deck plan before revising it.', { icon: 'alert', timeout: 4200 });
      const instruction = window.prompt('What should change in the new derived revision?');
      if (!instruction?.trim()) return;
      const priorBrief = stored.result.artifacts?.brief || {};
      try {
        const sessionId = `${stored.sessionId}-revision-${uid('r')}`;
        const result = await window.solat.createDeck({
          requestId: uid('revision'), sessionId, revisionOf: stored.result.id, revisionInstruction: instruction.trim(),
          goal: `${priorBrief.goal || 'Revise the deck.'}\nRevision request: ${instruction.trim()}`,
          audience: priorBrief.audience || 'General audience', language: priorBrief.language || 'en',
          slideCount: Number(priorBrief.slide_count) || 8, assets: priorBrief.asset_ids || [],
        });
        this.rememberDeck(thread.id, { result, sessionId });
        State.add(thread.id, { role: 'assistant', content: `Derived revision ready: ${result.artifacts?.document?.slides?.length || 0} editable slides. The prior plan remains unchanged.`, responseMeta: { provider: result.provider, model: result.model, mode: 'creative_revision', projectId: result.projectId, jobId: result.jobId, traceId: result.traceId } });
        this.render();
      } catch (error) { Toast.show(error?.message || 'The derived revision failed.', { icon: 'alert', timeout: 5200 }); }
    },
    action(action) {
      if (action === 'deck') return this.generateDeck();
      if (action === 'export') return this.exportDeck();
      if (action === 'slides') return this.previewDeck();
      if (action === 'revise') return this.reviseDeck();
      if (action === 'history') return this.revisionHistory();
      if (action === 'open') return this.openExport();
      if (action === 'inspect') return this.inspectExport();
      const markerByAction = {
        details: 'data-solat-music-details',
        emotion: 'data-solat-emotion-review',
        intensity: 'data-solat-creative-direction',
        deck: 'data-solat-slide-preview',
        slides: 'data-solat-slide-preview',
        revise: 'data-solat-slide-revision',
        image: 'data-solat-image-generator',
        alternatives: 'data-solat-creative-alternatives',
        direction: 'data-solat-creative-direction',
      };
      const marker = markerByAction[action];
      if (marker) {
        const dialog = make('dialog', { class: 'music-surface', [marker]: '', 'aria-label': `SOLAT ${action} surface` });
        const title = action === 'details' ? 'Music context' : action === 'intensity' ? 'Creative intensity' : `Music ${action}`;
        const close = make('button', { type: 'button', class: 'music-action', text: 'Close' });
        close.addEventListener('click', () => dialog.close());
        dialog.addEventListener('close', () => dialog.remove(), { once: true });
        dialog.append(make('div', { class: 'music-surface-head' }, make('strong', { text: title }), close), make('p', { class: 'muted', text: 'This V2 control is present and safely wired. The service layer is intentionally not connected in Milestone 1, so no result is fabricated.' }));
        document.body.append(dialog);
        dialog.showModal();
        return;
      }
      Toast.show(`${action} is reserved for the post-Milestone 1 service layer. No fake result was created.`, { icon: 'spark', timeout: 4800 });
    },
  };

  const Palette = {
    items: [], index: 0,
    commands() {
      return [
        { label: 'New conversation', icon: 'plus', run: newConversation },
        { label: 'Toggle light and dark', icon: 'moon', run: () => cycleTheme(true) },
        { label: 'Open settings', icon: 'settings', run: () => openSettings('general') },
        { label: 'Provider status', icon: 'shield', run: () => openSettings('keys') },
        { label: 'Chrome Control setup', icon: 'monitor', run: () => setTimeout(() => ChromeControlSetup.open(), 0) },
        { label: 'Keyboard shortcuts', icon: 'keyboard', run: () => Overlay.open($('#shortcuts')) },
        // Defer the replacement overlay until the palette click has fully
        // finished; otherwise Electron can deliver the release to the newly
        // opened sheet and close it in the same pointer gesture.
        { label: 'V3–V6 tutorial', icon: 'help', run: () => setTimeout(() => Overlay.open($('#tutorialV3V6')), 0) },
        { label: 'Export this conversation', icon: 'download', run: () => State.active && exportThread(State.active) },
        { label: 'Rename this conversation', icon: 'pencil', run: renameActive },
        { label: 'Copy the last response', icon: 'copy', run: async () => { const response = [...(State.active?.messages || [])].reverse().find(message => message.role === 'assistant'); if (!response) return Toast.show('Nothing to copy yet', { icon: 'alert' }); Toast.show(await copyText(response.content) ? 'Response copied' : 'Copy failed', { icon: 'copy' }); } },
        { label: 'Undo last interaction reference', icon: 'undo', run: async () => {
          if (!State.activeId || !window.solat?.multimodalUndo) return Toast.show('No interaction memory is available.', { icon: 'alert' });
          try {
            await window.solat.multimodalUndo({ sessionId: sessionFor(State.activeId) });
            Toast.show('The last voice, pointer, hand, screen, or asset reference was removed from interaction memory.', { icon: 'check', timeout: 4400 });
          } catch (error) { Toast.show(error?.message || 'The last interaction reference could not be undone.', { icon: 'alert', timeout: 5200 }); }
        } },
        { label: 'Delete this conversation', icon: 'trash', run: () => State.active && deleteThread(State.active), danger: true },
      ];
    },
    open() { const input = $('#palInput'); input.value = ''; this.build(''); Overlay.open($('#palette'), { focus: input }); },
    build(query) {
      const needle = query.trim().toLowerCase(); const commands = this.commands().filter(command => !needle || command.label.toLowerCase().includes(needle));
      const threads = [...State.threads].sort((a, b) => b.updatedAt - a.updatedAt).filter(thread => !needle || thread.title.toLowerCase().includes(needle) || thread.messages.some(message => text(message.content).toLowerCase().includes(needle))).slice(0, needle ? 8 : 5).map(thread => ({ label: thread.title, sub: relTime(thread.updatedAt), icon: 'chat', run: () => State.select(thread.id) }));
      this.items = needle ? [...commands, ...threads] : [...threads, ...commands]; this.index = 0; const list = $('#palList'); list.textContent = '';
      if (!this.items.length) return list.append(make('div', { class: 'pal-empty' }, make('b', { text: 'Nothing matches' }), make('span', { text: `“${query}”` })));
      const groups = needle ? [['Commands', commands], ['Conversations', threads]] : [['Recent', threads], ['Commands', commands]];
      for (const [label, entries] of groups) { if (!entries.length) continue; list.append(make('div', { class: 'pal-group', text: label })); for (const entry of entries) { const index = this.items.indexOf(entry); const button = make('button', { type: 'button', class: 'pal-item', role: 'option', 'data-index': index, 'data-active': index === this.index ? 'true' : 'false' }, icon(entry.icon), make('span', { class: 'lbl', text: entry.label }), entry.sub ? make('span', { class: 'sub', text: entry.sub }) : null); button.addEventListener('click', () => { Overlay.close(); entry.run(); }); button.addEventListener('pointermove', () => this.highlight(index)); list.append(button); } }
    },
    highlight(index) { if (!this.items.length) return; this.index = (index + this.items.length) % this.items.length; $$('.pal-item', $('#palList')).forEach(button => button.dataset.active = String(Number(button.dataset.index) === this.index)); },
    init() { const input = $('#palInput'); input.addEventListener('input', () => this.build(input.value)); input.addEventListener('keydown', event => { if (event.key === 'ArrowDown') { event.preventDefault(); this.highlight(this.index + 1); } else if (event.key === 'ArrowUp') { event.preventDefault(); this.highlight(this.index - 1); } else if (event.key === 'Enter') { event.preventDefault(); const item = this.items[this.index]; if (item) { Overlay.close(); item.run(); } } }); },
  };

  const ChromeControlSetup = {
    busy: false,
    statusText(status) {
      if (status?.connected === true || status?.status === 'connected') return status?.full_control === true
        ? 'Connected — Full Chrome Control is ready across normal tabs.'
        : 'Connected — Chrome Control is ready.';
      if (status?.paired === true || status?.status === 'paired') return 'Paired — waiting for the Chrome extension to connect.';
      return 'Not connected — install the extension, then pair it from here.';
    },
    renderTabs(list) {
      const host = $('#chromeControlTabs');
      if (!host) return;
      host.replaceChildren();
      const tabs = Array.isArray(list?.tabs) ? list.tabs : [];
      if (!tabs.length) {
        host.append(make('p', { class: 'set-note', text: 'No controllable Chrome tabs are visible yet.' }));
        return;
      }
      for (const tab of tabs) {
        const privateTab = tab?.controllable !== true;
        const copy = make('span', { class: 'chrome-tab-copy' },
          make('b', { text: privateTab ? 'Private or unsupported tab' : (tab.title || 'Untitled Chrome tab') }),
          make('span', { text: privateTab ? 'Human-only · content and URL hidden' : (tab.url || '') }));
        const button = make('button', { class: 'btn', type: 'button', text: tab.active ? 'Active' : 'Switch', disabled: privateTab ? '' : null });
        if (!privateTab) button.addEventListener('click', event => this.run(event.currentTarget, async () => {
          if (!State.activeId) throw new Error('Open or create a conversation first.');
          const surface = await window.solat.chromeControlSwitchTab({ sessionId: sessionFor(State.activeId), tabRef: tab.tab_ref });
          BrowserWorkspace.surface = surface || BrowserWorkspace.surface;
        }, 'Chrome tab switched and attached to this conversation.'));
        host.append(make('div', { class: 'chrome-tab-row' }, copy, button));
      }
    },
    async refresh() {
      const label = $('#chromeControlStatus');
      try {
        const status = await window.solat.chromeControlStatus({});
        label.textContent = this.statusText(status);
        label.dataset.state = status?.connected === true || status?.status === 'connected' ? 'connected' : 'offline';
        $('#chromeControlAdopt').disabled = label.dataset.state !== 'connected' || !State.activeId;
        if (label.dataset.state === 'connected' && State.activeId && window.solat?.chromeControlTabs) {
          this.renderTabs(await window.solat.chromeControlTabs({ sessionId: sessionFor(State.activeId) }));
        } else this.renderTabs({ tabs: [] });
      } catch (error) {
        label.textContent = error?.message || 'Chrome Control status is unavailable.';
        label.dataset.state = 'error';
        $('#chromeControlAdopt').disabled = true;
        this.renderTabs({ tabs: [] });
      }
    },
    open() {
      if (!window.solat?.chromeControlStatus) return Toast.show('Chrome Control is unavailable in this build.', { icon: 'alert' });
      Overlay.open($('#chromeControlSetup'));
      void this.refresh();
    },
    async run(button, action, success) {
      if (this.busy) return;
      this.busy = true;
      button.disabled = true;
      try {
        await action();
        Toast.show(success, { icon: 'check', timeout: 4800 });
      } catch (error) {
        Toast.show(error?.message || 'Chrome Control action failed.', { icon: 'alert', timeout: 6000 });
      } finally {
        this.busy = false;
        button.disabled = false;
        await this.refresh();
      }
    },
    init() {
      $('#chromeControlReveal')?.addEventListener('click', event => this.run(event.currentTarget, () => window.solat.chromeControlRevealExtension({}), 'Extension folder opened. In Chrome, use Extensions → Developer mode → Load unpacked.'));
      $('#chromeControlPair')?.addEventListener('click', event => this.run(event.currentTarget, () => window.solat.chromeControlPair({}), 'Pairing page opened in Chrome.'));
      $('#chromeControlAdopt')?.addEventListener('click', event => this.run(event.currentTarget, async () => {
        if (!State.activeId) throw new Error('Open or create a conversation first.');
        const surface = await window.solat.chromeControlAdoptActive({ sessionId: sessionFor(State.activeId) });
        BrowserWorkspace.surface = surface || BrowserWorkspace.surface;
      }, 'The current Chrome tab is now attached to this conversation.'));
      $('#chromeControlRefresh')?.addEventListener('click', () => this.refresh());
    },
  };

  const providerCatalog = [
    ['qwen', 'Alibaba Cloud Model Studio', 'Qwen 3.7 Flash runs the agent; Qwen 3.7 Plus advises only when stronger reasoning is needed.'],
    ['openai', 'OpenAI', 'Available as a future adapter; no browser key is stored.'],
    ['anthropic', 'Anthropic', 'Available as a future adapter; no browser key is stored.'],
    ['google', 'Google Gemini', 'Available as a future adapter; no browser key is stored.'],
    ['openrouter', 'OpenRouter', 'Available as a future adapter; no browser key is stored.'],
    ['custom', 'Custom endpoint', 'OpenAI-compatible adapter slot; not enabled by this milestone.'],
  ];

  function renderProviders() {
    const host = $('#provList'); if (!host) return; host.textContent = '';
    for (const [id, name, description] of providerCatalog) {
      const button = make('button', { type: 'button', class: 'btn', text: id === 'qwen' ? 'Configured in .env' : 'Future adapter' });
      button.addEventListener('click', () => Toast.show(id === 'qwen' ? 'Qwen Cloud is configured outside the UI; the key is never echoed here.' : `${name} is not enabled in this milestone.`, { icon: id === 'qwen' ? 'shield' : 'help', timeout: 4200 }));
      host.append(make('div', { class: 'setting' }, make('span', { class: 'label' }, make('b', { text: name }), make('span', { text: description })), button));
    }
    const count = $('#keyCount'); if (count) { count.hidden = false; count.textContent = '1'; }
    const statusRequest = window.solat?.status?.();
    if (statusRequest) statusRequest.then(state => {
      const search = state?.search || {};
      const label = search.configured ? `${search.provider} ready · ${Array.isArray(search.sourceScopes) ? search.sourceScopes.length : 0} source scopes` : 'Not configured';
      host.append(make('div', { class: 'setting', 'data-search-provider-status': '' }, make('span', { class: 'label' }, make('b', { text: 'Search sources' }), make('span', { text: 'Search is model-selected and filtered to approved hosts.' })), make('span', { class: 'setting-value', text: label })));
    }).catch(() => {
      host.append(make('div', { class: 'setting', 'data-search-provider-status': '' }, make('span', { class: 'label' }, make('b', { text: 'Search sources' }), make('span', { text: 'Search status could not be read.' }))));
    });
  }

  function openSettings(panel = 'general') {
    SettingsUI.show(panel); Overlay.open($('#settings')); renderProviders();
  }
  const SettingsUI = {
    show(panel) {
      $$('.set-tab').forEach(tab => { const selected = tab.dataset.panel === panel; tab.setAttribute('aria-selected', String(selected)); tab.tabIndex = selected ? 0 : -1; });
      $$('.set-panel').forEach(section => { const selected = section.id === `panel-${panel}`; section.hidden = !selected; section.classList.toggle('on', selected); });
    },
    init() {
      const tabs = $$('.set-tab'); tabs.forEach((tab, index) => { tab.addEventListener('click', () => this.show(tab.dataset.panel)); tab.addEventListener('keydown', event => { const delta = ['ArrowRight', 'ArrowDown'].includes(event.key) ? 1 : ['ArrowLeft', 'ArrowUp'].includes(event.key) ? -1 : 0; if (!delta) return; event.preventDefault(); const next = tabs[(index + delta + tabs.length) % tabs.length]; next.focus(); this.show(next.dataset.panel); }); });
      for (const [id, key] of [['themeSeg', 'theme'], ['scaleSeg', 'scale'], ['densitySeg', 'density']]) $(`#${id}`)?.addEventListener('click', event => { const button = event.target.closest('button[data-v]'); if (button) Settings.set(key, button.dataset.v); });
      for (const [id, key, message] of [['motionSwitch', 'motion', 'Animation'], ['enterSwitch', 'enterSends', 'Enter sending'], ['persistSwitch', 'persist', 'History saving']]) $(`#${id}`)?.addEventListener('click', () => { Settings.set(key, !Settings.get(key)); Toast.show(`${message} ${Settings.get(key) ? 'on' : 'off'}`, { icon: Settings.get(key) ? 'check' : 'alert' }); });
      $('#keysFromSettings')?.addEventListener('click', () => Overlay.open($('#shortcuts')));
      $('#exportAllBtn')?.addEventListener('click', () => downloadBlob(new Blob([JSON.stringify({ v: 2, exportedAt: new Date().toISOString(), threads: State.threads }, null, 2)], { type: 'application/json' }), 'solat-conversations.json'));
      $('#wipeBtn')?.addEventListener('click', async () => { if (!await askConfirm('Delete all conversations?', 'Every conversation stored on this device will be removed. Preferences are kept.', 'Delete everything')) return; State.threads = []; State.create(); State.emit('active'); Toast.show('All conversations deleted', { icon: 'trash' }); });
      $('#resetBtn')?.addEventListener('click', async () => { if (!await askConfirm('Reset SOLAT V2?', 'This removes local conversations and preferences. It does not delete repository files.', 'Reset')) return; store.remove('solat.v2.threads'); store.remove('solat.v2.settings'); store.remove('solat.v2.music.song'); location.reload(); });
    },
  };

  async function newConversation({ animate = true } = {}) {
    if (animate) await playNewChatTransition();
    const empty = State.threads.find(thread => !thread.messages.length);
    if (empty) State.select(empty.id); else State.create();
    closeSidebar(); Composer.focus();
  }
  function cycleTheme(toggle = false) { const current = Settings.get('theme'); const next = toggle ? (current === 'dark' ? 'light' : 'dark') : ['light', 'dark', 'system'][(Math.max(0, ['light', 'dark', 'system'].indexOf(current)) + 1) % 3]; Settings.set('theme', next); Toast.show(next === 'system' ? 'Matching your system theme' : `${next[0].toUpperCase()}${next.slice(1)} theme`, { icon: next === 'dark' ? 'moon' : 'sun' }); }
  function openSidebar() { $('#sidebar')?.classList.add('open'); $('#navToggle')?.setAttribute('aria-expanded', 'true'); $('#scrim')?.classList.add('open'); requestAnimationFrame(() => $('#search')?.focus()); }
  function closeSidebar() { $('#sidebar')?.classList.remove('open'); $('#navToggle')?.setAttribute('aria-expanded', 'false'); if (!Overlay.current) $('#scrim')?.classList.remove('open'); }

  function spawnInkHit(event) {
    if (!Settings.get('motion') || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    if (event.button != null && event.button !== 0) return;
    if (root.classList.contains('home-mode') && event.target.closest('.starter, .master-nav button, .send')) return;
    const hit = make('span', { class: 'ink-hit', 'aria-hidden': 'true' });
    hit.style.setProperty('--hit-x', `${event.clientX}px`);
    hit.style.setProperty('--hit-y', `${event.clientY}px`);
    for (let index = 0; index < 7; index += 1) {
      const shard = make('i', { class: 'ink-shard' });
      shard.style.setProperty('--a', `${index * (360 / 7) + Math.random() * 16 - 8}deg`);
      shard.style.setProperty('--d', `${30 + Math.random() * 38}px`);
      hit.append(shard);
    }
    document.body.append(hit);
    hit.addEventListener('animationend', () => hit.remove(), { once: true });
    setTimeout(() => hit.remove(), 800);
  }

  function wireSolatCursor() {
    const cursor = $('#solatCursor');
    if (!cursor || !matchMedia('(pointer: fine)').matches) return;
    let frame = 0; let x = -80; let y = -80;
    const paint = () => {
      cursor.style.setProperty('--cursor-x', `${x - 3}px`);
      cursor.style.setProperty('--cursor-y', `${y - 3}px`);
      frame = 0;
    };
    document.addEventListener('pointermove', event => {
      x = event.clientX; y = event.clientY;
      const root = document.documentElement;
      const halfWidth = Math.max(window.innerWidth / 2, 1);
      const halfHeight = Math.max(window.innerHeight / 2, 1);
      root.style.setProperty('--pointer-x', `${((x - halfWidth) / halfWidth) * 12}`);
      root.style.setProperty('--pointer-y', `${((y - halfHeight) / halfHeight) * 9}`);
      cursor.classList.add('on');
      if (!frame) frame = requestAnimationFrame(paint);
    }, { passive: true });
    document.addEventListener('pointerdown', () => cursor.classList.add('hit'), { passive: true });
    document.addEventListener('pointerup', () => cursor.classList.remove('hit'), { passive: true });
    document.documentElement.addEventListener('mouseleave', () => cursor.classList.remove('on'));
  }

  function playSendTransition() {
    const layer = $('#sendTransition');
    const shouldAnimate = Settings.get('motion') && !matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (!layer || !shouldAnimate) return Promise.resolve();
    layer.classList.remove('launch');
    void layer.offsetWidth;
    layer.classList.add('launch');
    return new Promise(resolve => setTimeout(() => {
      layer.classList.remove('launch');
      resolve();
    }, 720));
  }

  function playNewChatTransition() {
    const layer = $('#newChatTransition');
    const shouldAnimate = Settings.get('motion') && !matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (!layer || !shouldAnimate) return Promise.resolve();
    layer.classList.remove('reset');
    void layer.offsetWidth;
    layer.classList.add('reset');
    return new Promise(resolve => setTimeout(() => {
      layer.classList.remove('reset');
      resolve();
    }, 860));
  }

  let solatVoiceActivityTimer = null;
  const SOLAT_VOICE_INTRO = 'VOICE IDLE\nAI–HUMAN WORKSPACE\nPlease press the Memento icon to interact with SOLAT.';
  const SOLAT_VOICE_READY = 'SOLAT READY\nVoice link active. Speak naturally to SOLAT.';
  function setSolatVoicePreview(value) {
    const preview = $('#solatVoicePreviewText');
    if (preview) preview.textContent = text(value || '');
  }

  function isSolatVoiceSceneActive() {
    return Boolean($('#solatVoiceScene')?.classList.contains('active'));
  }
  function setSolatVoiceActivity(next, timeout = 0) {
    const scene = $('#solatVoiceScene');
    if (!scene) return;
    if (solatVoiceActivityTimer !== null) window.clearTimeout(solatVoiceActivityTimer);
    solatVoiceActivityTimer = null;
    const state = ['idle', 'listening', 'user_speaking', 'transcribing', 'thinking', 'acting', 'speaking', 'interrupted', 'error'].includes(next) ? next : 'idle';
    const activity = state === 'speaking' ? 'answer' : ['transcribing', 'thinking', 'acting'].includes(state) ? 'thinking' : 'idle';
    scene.dataset.voiceState = state;
    scene.dataset.voiceActivity = activity;
    scene.classList.toggle('voice-speaking', activity === 'answer');
    const stateLabel = $('#solatVoiceStateLabel');
    const displayState = state === 'user_speaking' ? 'USER SPEAKING' : state === 'speaking' ? 'SOLAT SPEAKING' : state.replace('_', ' ').toUpperCase();
    if (stateLabel) stateLabel.textContent = `VOICE / ${displayState}`;
    const athenaState = $('#solatAthenaState');
    if (athenaState) athenaState.textContent = state.replace('_', ' ');
    if (timeout > 0) {
      solatVoiceActivityTimer = window.setTimeout(() => setSolatVoiceActivity('idle'), timeout);
    }
  }

  function voiceLanguageFor(value) {
    const spokenText = text(value);
    if (/[\u0E00-\u0E7F]/u.test(spokenText)) return 'th';
    return navigator.language || 'auto';
  }

  function enterSolatVoiceMode() {
    const scene = $('#solatVoiceScene');
    const video = $('#solatVoiceVideo');
    const loopVideo = $('#solatVoiceLoop');
    if (!scene || !video || !loopVideo) return;
    if (video.dataset.playing === 'true') return;
    setSolatVoicePreview(SOLAT_VOICE_INTRO);
    video.dataset.playing = 'true';
    setSolatVoiceActivity(busy ? 'thinking' : 'idle');
    document.documentElement.classList.add('solat-voice-active');
    scene.classList.remove('video-ready', 'loop-ready', 'exiting');
    $('#solatExitCover')?.classList.remove('active', 'returning');
    scene.classList.add('active');
    scene.setAttribute('aria-hidden', 'false');
    let watchdog = null;
    const clearPlaybackGuards = () => {
      if (watchdog !== null) window.clearTimeout(watchdog);
      if (scene._voiceWatchdog) window.clearTimeout(scene._voiceWatchdog);
      watchdog = null;
      scene._voiceWatchdog = null;
    };
    const holdIntroFinalFrame = () => {
      if (video.dataset.playing !== 'true') return;
      video.dataset.playing = 'false';
      clearPlaybackGuards();
      loopVideo.pause();
      video.pause();
      video.onplaying = null;
      if (Number.isFinite(video.duration) && video.currentTime < video.duration - 0.1) {
        video.currentTime = Math.max(0, video.duration - 0.05);
      }
      scene.classList.remove('loop-ready');
      scene.classList.add('active', 'video-ready');
      scene.setAttribute('aria-hidden', 'false');
    };
    const startFinalLoop = () => {
      if (video.dataset.playing !== 'true') return;
      clearPlaybackGuards();
      video.pause();
      video.onplaying = null;
      loopVideo.pause();
      loopVideo.currentTime = 0;
      loopVideo.loop = true;
      loopVideo.onplaying = () => {
        video.dataset.playing = 'false';
        scene.classList.add('active', 'video-ready', 'loop-ready');
        scene.setAttribute('aria-hidden', 'false');
        loopVideo.onplaying = null;
      };
      loopVideo.onerror = holdIntroFinalFrame;
      loopVideo.play().catch(holdIntroFinalFrame);
    };
    const failAndRestore = () => {
      if (video.dataset.playing !== 'true') return;
      video.dataset.playing = 'false';
      clearPlaybackGuards();
      loopVideo.pause();
      video.pause();
      video.onplaying = null;
      scene.classList.remove('video-ready', 'loop-ready');
      scene.classList.remove('active');
      scene.setAttribute('aria-hidden', 'true');
      document.documentElement.classList.remove('solat-voice-active');
      void Voice?.exit();
    };
    watchdog = window.setTimeout(startFinalLoop, 45000);
    scene._voiceWatchdog = watchdog;
    video.onended = startFinalLoop;
    video.onerror = failAndRestore;
    video.onplaying = () => scene.classList.add('video-ready');
    loopVideo.pause();
    loopVideo.currentTime = 0;
    video.pause();
    video.currentTime = 0;
    video.play().catch(() => {
      failAndRestore();
      Toast.show('The SOLAT transition could not start.', { icon: 'alert' });
    });
  }

  function exitSolatVoiceMode() {
    const scene = $('#solatVoiceScene');
    const video = $('#solatVoiceVideo');
    const loopVideo = $('#solatVoiceLoop');
    if (!scene || !video || !loopVideo) return;
    const exitCover = $('#solatExitCover');
    exitCover?.classList.add('active', 'returning');
    void exitCover?.offsetWidth;
    scene.classList.add('exiting');
    void scene.offsetWidth;
    if (scene._voiceWatchdog) window.clearTimeout(scene._voiceWatchdog);
    if (solatVoiceActivityTimer !== null) window.clearTimeout(solatVoiceActivityTimer);
    solatVoiceActivityTimer = null;
    scene._voiceWatchdog = null;
    video.dataset.playing = 'false';
    video.pause();
    loopVideo.pause();
    video.onplaying = null;
    video.onended = null;
    video.onerror = null;
    loopVideo.onplaying = null;
    loopVideo.onerror = null;
    video.currentTime = 0;
    loopVideo.currentTime = 0;
    scene.classList.remove('active', 'video-ready', 'loop-ready', 'voice-speaking');
    setSolatVoicePreview(SOLAT_VOICE_INTRO);
    scene.dataset.voiceActivity = 'idle';
    scene.dataset.voiceState = 'idle';
    scene.setAttribute('aria-hidden', 'true');
    document.documentElement.classList.remove('solat-voice-active');
    void Voice?.exit();
    setUiMode('classic', false);
    window.setTimeout(() => {
      scene.classList.remove('exiting');
      exitCover?.classList.remove('active', 'returning');
    }, 1900);
  }

  async function refreshStatus() {
    if (!window.solat?.status) return setStatus('error', 'Unavailable', 'Secure desktop IPC is unavailable.');
    try {
      const state = await window.solat.status();
      const currentMode = state.modelMode || 'auto';
      const active = (state.modelModes || []).find(item => item.id === currentMode);
      const detail = currentMode === 'auto' ? 'Qwen 3.7 Flash runs the agent; Plus supplies bounded advice only when stronger reasoning is needed.' : `${state.provider || 'provider'} / ${state.model || 'model unavailable'}`;
      // Configuration is not a live provider probe. Do not claim runtime
      // readiness until an actual request succeeds.
      setStatus(state.configured ? 'ready' : 'error', state.configured ? 'Configured' : 'Not configured', detail);
      $('#modelName').textContent = active?.label || state.model || 'Auto';
      return state;
    } catch {
      setStatus('error', 'Unavailable', 'Provider status could not be read.');
      return null;
    }
  }

  async function chooseModelMode() {
    const state = await refreshStatus();
    if (!state || !window.solat?.setModelMode) return;
    const modes = Array.isArray(state.modelModes) ? state.modelModes : [];
    Menu.open($('#modelBtn'), modes.map(mode => ({
      label: mode.label,
      icon: mode.id === 'auto' ? 'spark' : 'cpu',
      checked: mode.id === state.modelMode,
      run: async () => {
        try {
          await window.solat.setModelMode(mode.id);
          await refreshStatus();
          Toast.show(`${mode.label} selected`, { icon: 'check' });
        } catch (error) {
          Toast.show(error?.message || 'Model mode could not be changed.', { icon: 'shield' });
        }
      },
    })));
  }

  const Spatial = {
    active: false,
    unsubscribe: null,
    unsubscribeShortcut: null,
    async open(gesture = 'lasso') {
      if (this.active) return;
      if (!window.solat?.spatialOpen || !State.activeId) return Toast.show('Spatial input is unavailable.', { icon: 'alert' });
      this.active = true;
      $('#spatialBtn')?.setAttribute('aria-pressed', 'true');
      try {
        await window.solat.spatialOpen({
          sessionId: sessionFor(State.activeId),
          contextId: Voice?.active ? Voice.voiceSessionId : uid('spatial-context'),
          gesture,
        });
      } catch (error) {
        this.active = false;
        $('#spatialBtn')?.setAttribute('aria-pressed', 'false');
        Toast.show(error?.message || 'Spatial input could not start.', { icon: 'alert', timeout: 5200 });
      }
    },
    init() {
      if (!window.solat?.onSpatialEvent) return;
      this.unsubscribe = window.solat.onSpatialEvent(event => {
        this.active = false;
        $('#spatialBtn')?.setAttribute('aria-pressed', 'false');
        if (event?.status === 'cancelled') return;
        const labels = { circle: 'Circle', x: 'X mark', arrow: 'Arrow', highlight: 'Highlight', freehand: 'Freehand mark', lasso: 'Lasso', click: 'Point', drag: 'Drag path' };
        Toast.show(`${labels[event?.gesture] || 'Spatial mark'} attached. Say “อันนี้” or “ตรงนี้” in your next message.`, { icon: 'check', timeout: 4400 });
        Composer.focus();
      });
      if (window.solat?.onSpatialShortcut) this.unsubscribeShortcut = window.solat.onSpatialShortcut(payload => {
        if (payload?.available === false) return Toast.show('Ctrl+Shift+Space is already used by another application. Use the Spatial button in SOLAT.', { icon: 'alert', timeout: 5200 });
        void this.open('lasso');
      });
    },
  };

  const BrowserWorkspace = {
    surface: null,
    unsubscribe: null,
    assetUnsubscribe: null,
    async open() {
      if (!window.solat?.browserOpen || !State.activeId) return Toast.show('Browser Workspace is unavailable.', { icon: 'alert' });
      try {
        this.surface = await window.solat.browserOpen({
          sessionId: sessionFor(State.activeId),
          url: 'https://www.pinterest.com/',
          mode: 'focused',
        });
        $('#browserBtn')?.setAttribute('aria-pressed', 'true');
      } catch (error) {
        Toast.show(error?.message || 'Browser Workspace could not open.', { icon: 'alert', timeout: 5200 });
      }
    },
    init() {
      if (!window.solat?.onBrowserWorkspaceEvent) return;
      this.unsubscribe = window.solat.onBrowserWorkspaceEvent(event => {
        if (event?.surface) {
          this.surface = event.surface;
          if (SpatialAssets?.held) void SpatialAssets.useBrowserSurface();
        }
        if (event?.type === 'closed') {
          this.surface = null;
          $('#browserBtn')?.setAttribute('aria-pressed', 'false');
          if (SpatialAssets?.held) void SpatialAssets.useBlueSurface({ x: innerWidth / 2, y: innerHeight / 2, display_id: 'main-window' });
        } else if (event?.type === 'takeover') {
          Toast.show('You control the Browser Workspace. Return control before SOLAT continues.', { icon: 'shield', timeout: 4400 });
        }
      });
      if (window.solat?.onBrowserAssetSelected) this.assetUnsubscribe = window.solat.onBrowserAssetSelected(payload => {
        void SpatialAssets.adoptBrowserSelection(payload);
      });
    },
  };

  const SpatialAssets = {
    held: null,
    currentSurface: null,
    previewUrl: null,
    pendingMove: null,
    moveRunning: false,
    selectedAssetId: null,
    insertions: [],
    sessionId() { return State.activeId ? sessionFor(State.activeId) : ''; },
    heldSessionId() { return this.held?.session_id || this.sessionId(); },
    blueSurface() {
      return { surface_id: 'blue-workspace-main', kind: 'blue_workspace', tab_id: State.activeId || null, revision: 0 };
    },
    browserSurface() {
      const surface = BrowserWorkspace.surface;
      if (!surface?.surface_id) return null;
      return { surface_id: surface.surface_id, kind: 'browser_workspace', tab_id: surface.tab_id || null, revision: Number(surface.navigation_revision || surface.revision || 0) };
    },
    pointer(event) { return { x: event.clientX, y: event.clientY, display_id: 'main-window' }; },
    async register({ assetId, spatialCapability, spatialAssetId, label, width, height, previewUrl = null }) {
      if (!window.solat?.spatialAssetRegister || !this.sessionId()) throw new Error('Spatial assets are unavailable.');
      const asset = await window.solat.spatialAssetRegister({ sessionId: this.sessionId(), assetId, spatialCapability, spatialAssetId, label, width, height });
      if (previewUrl) this.previewUrl = previewUrl;
      return asset;
    },
    async beginFromAttachment(item, event) {
      if (!item?.previewUrl || !this.sessionId()) return;
      try {
        const stored = await ensureStoredAttachment(item, this.sessionId());
        if (!item.spatialAsset) {
          const dimensions = await imagePreviewDimensions(item.previewUrl);
          item.spatialAsset = await this.register({
            assetId: stored.assetId, spatialCapability: stored.spatialCapability, label: item.file.name,
            width: dimensions.width, height: dimensions.height, previewUrl: item.previewUrl,
          });
        }
        await this.select(item.spatialAsset.spatial_asset_id, this.blueSurface());
        await this.begin({
          spatialAssetId: item.spatialAsset.spatial_asset_id,
          pointer: this.pointer(event), inputSource: event.pointerType === 'hand' ? 'hand' : event.pointerType === 'touch' ? 'touch' : 'mouse', previewUrl: item.previewUrl,
        });
      } catch (error) {
        Toast.show(error?.message || 'The image could not enter spatial mode.', { icon: 'alert', timeout: 5200 });
      }
    },
    async select(spatialAssetId, surface = this.blueSurface()) {
      const value = await window.solat.spatialAssetSelect({ sessionId: this.sessionId(), spatialAssetId, surface });
      this.selectedAssetId = spatialAssetId;
      return value;
    },
    async begin({ spatialAssetId, pointer, inputSource = 'mouse', transform, previewUrl = null, surface = this.blueSurface() }) {
      if (this.held) await this.cancel();
      const value = await window.solat.spatialAssetBegin({ sessionId: this.sessionId(), spatialAssetId, surface, pointer, inputSource, transform });
      this.held = value.ghost;
      this.currentSurface = surface;
      if (previewUrl) this.previewUrl = previewUrl;
      this.render(pointer);
      return value;
    },
    render(pointer = this.held?.pointer) {
      const ghost = $('#spatialAssetGhost'); const status = $('#spatialAssetStatus');
      if (!ghost || !status) return;
      if (!this.held) { ghost.hidden = true; status.hidden = true; return; }
      ghost.hidden = false; status.hidden = false;
      ghost.style.left = `${Number(pointer?.x || 0)}px`; ghost.style.top = `${Number(pointer?.y || 0)}px`;
      const transform = this.held.transform || { scale: 1, rotation_deg: 0 };
      ghost.style.transform = `translate(-50%, -50%) scale(${transform.scale}) rotate(${transform.rotation_deg}deg)`;
      if (this.previewUrl) ghost.replaceChildren(make('img', { src: this.previewUrl, alt: '' }));
      else ghost.replaceChildren(make('span', { text: 'IMAGE' }));
      const target = this.currentSurface?.kind === 'browser_workspace' ? 'Browser Workspace' : 'Blue Workspace';
      status.textContent = `Holding image · ${target} · release or click to insert · Esc to cancel`;
    },
    renderInsertions() {
      const layer = $('#spatialInsertionLayer'); if (!layer) return;
      layer.textContent = '';
      for (const insertion of this.insertions.filter(item => item.sessionId === this.sessionId())) {
        const image = make('img', { class: 'spatial-insertion-preview', src: insertion.previewUrl, alt: 'Inserted spatial reference' });
        image.dataset.insertionId = insertion.insertionId;
        image.style.left = `${Math.max(24, Math.min(innerWidth - 24, Number(insertion.pointer?.x || innerWidth / 2)))}px`;
        image.style.top = `${Math.max(76, Math.min(innerHeight - 24, Number(insertion.pointer?.y || innerHeight / 2)))}px`;
        image.style.transform = `translate(-50%, -50%) scale(${insertion.transform.scale}) rotate(${insertion.transform.rotation_deg}deg)`;
        layer.append(image);
      }
    },
    queueMove(pointer, transform = null) {
      if (!this.held) return;
      this.pendingMove = { pointer, transform };
      this.render(pointer);
      if (this.moveRunning) return;
      this.moveRunning = true;
      const flush = async () => {
        while (this.held && this.pendingMove) {
          const next = this.pendingMove; this.pendingMove = null;
          try {
            const value = await window.solat.spatialAssetMove({ sessionId: this.heldSessionId(), ghostId: this.held.ghost_id, pointer: next.pointer, ...(next.transform ? { transform: next.transform } : {}) });
            if (this.held) this.held = value.ghost;
          } catch (error) {
            Toast.show(error?.message || 'Spatial image movement failed.', { icon: 'alert' });
            await this.cancel();
          }
        }
        this.moveRunning = false;
      };
      void flush();
    },
    async switchSurface(targetSurface, pointer = this.held?.pointer) {
      if (!this.held || !targetSurface) return null;
      const value = await window.solat.spatialAssetSwitch({ sessionId: this.heldSessionId(), ghostId: this.held.ghost_id, targetSurface, pointer });
      this.held = value.ghost; this.currentSurface = targetSurface; this.render(pointer);
      return value;
    },
    async drop(pointer = this.held?.pointer) {
      if (!this.held) return null;
      const ghostId = this.held.ghost_id; const targetSurface = this.currentSurface || this.blueSurface();
      const previewUrl = this.previewUrl; const transform = this.held.transform || { scale: 1, rotation_deg: 0 }; const sessionId = this.heldSessionId();
      try {
        const value = await window.solat.spatialAssetDrop({ sessionId: this.heldSessionId(), ghostId, targetSurface, pointer });
        if (targetSurface.kind === 'blue_workspace' && previewUrl && value?.insertion?.insertion_id) {
          this.insertions.push({ sessionId, insertionId: value.insertion.insertion_id, previewUrl, pointer, transform });
          while (this.insertions.length > 20) this.insertions.shift();
          this.renderInsertions();
        }
        this.held = null; this.pendingMove = null; this.render();
        Toast.show('Image inserted. You can refer to it as “รูปที่เพิ่งแปะ”.', { icon: 'check', timeout: 4200 });
        return value;
      } catch (error) {
        Toast.show(error?.message || 'The image could not be inserted.', { icon: 'alert' });
        return null;
      }
    },
    async cancel() {
      if (!this.held) return;
      const ghostId = this.held.ghost_id; const sessionId = this.heldSessionId(); this.held = null; this.pendingMove = null; this.render();
      try { await window.solat?.spatialAssetCancel?.({ sessionId, ghostId }); } catch {}
    },
    async useBlueSurface(pointer = this.held?.pointer) { return this.switchSurface(this.blueSurface(), pointer); },
    async useBrowserSurface(pointer = this.held?.pointer) { return this.switchSurface(this.browserSurface(), pointer); },
    async adoptBrowserSelection(payload) {
      if (!payload?.ghost || payload.session_id !== this.sessionId() || payload.ghost.session_id !== this.sessionId()) return false;
      const bytes = payload.preview_bytes instanceof Uint8Array ? payload.preview_bytes : new Uint8Array(payload.preview_bytes || []);
      if (!bytes.length || bytes.length > 8 * 1024 * 1024 || payload.media_type !== 'image/png') return false;
      if (this.held && this.held.ghost_id !== payload.ghost.ghost_id) {
        try {
          await window.solat.spatialAssetCancel({ sessionId: this.heldSessionId(), ghostId: this.held.ghost_id });
        } catch (error) {
          try { await window.solat.spatialAssetCancel({ sessionId: payload.session_id, ghostId: payload.ghost.ghost_id }); } catch {}
          Toast.show(error?.message || 'Finish or cancel the current image before selecting another.', { icon: 'alert', timeout: 5200 });
          return false;
        }
      }
      if (this.previewUrl?.startsWith?.('blob:')) URL.revokeObjectURL(this.previewUrl);
      this.previewUrl = URL.createObjectURL(new Blob([bytes], { type: 'image/png' }));
      this.held = payload.ghost;
      this.currentSurface = payload.surface;
      this.selectedAssetId = payload.asset?.spatial_asset_id || payload.ghost.spatial_asset_id;
      this.render({ x: innerWidth / 2, y: innerHeight / 2, display_id: 'main-window' });
      Toast.show(payload.surface?.kind === 'blue_workspace'
        ? 'Chrome image ready. Move it in Blue and release or click to insert.'
        : 'Browser image selected. Close the Browser Workspace to continue holding it in Blue.', { icon: 'check', timeout: 5200 });
      return true;
    },
    handPoint(event) {
      const point = event?.points?.[0] || event?.pointer;
      if (!point) return null;
      const bounds = event?.display?.bounds || {};
      return {
        x: Number(point.x || 0) + Number(bounds.x || 0) - Number(window.screenX || 0),
        y: Number(point.y || 0) + Number(bounds.y || 0) - Number(window.screenY || 0),
        display_id: String(event?.display?.id || 'main-window'),
      };
    },
    async consumeHandEvent(event) {
      const pointer = this.handPoint(event);
      if (!pointer) return;
      if (!this.held && event?.phase === 'start' && ['point', 'pinch', 'grab'].includes(event?.gesture)) {
        const target = document.elementFromPoint(pointer.x, pointer.y)?.closest?.('.thumb');
        const item = target?._solatSpatialAttachment;
        if (item) await this.beginFromAttachment(item, { clientX: pointer.x, clientY: pointer.y, pointerType: 'hand' });
        return;
      }
      if (!this.held) return;
      if (event?.gesture === 'release' || event?.phase === 'end') return this.drop(pointer);
      const transform = event?.transform ? {
        scale: Number(event.transform.scale || this.held?.transform?.scale || 1),
        rotation_deg: Number(event.transform.rotation_degrees ?? event.transform.rotation_deg ?? this.held?.transform?.rotation_deg ?? 0),
      } : null;
      this.queueMove(pointer, transform);
    },
    init() {
      let activeThreadId = State.activeId;
      globalThis.SOLATSpatialAssets = Object.freeze({
        register: input => this.register(input), select: (...args) => this.select(...args), begin: input => this.begin(input),
        move: (pointer, transform) => this.queueMove(pointer, transform), switchToBlue: pointer => this.useBlueSurface(pointer),
        switchToBrowser: pointer => this.useBrowserSurface(pointer), drop: pointer => this.drop(pointer), cancel: () => this.cancel(),
      });
      document.addEventListener('pointermove', event => { if (this.held) this.queueMove(this.pointer(event)); }, { passive: true });
      document.addEventListener('pointerup', event => { if (this.held) void this.drop(this.pointer(event)); }, { passive: true });
      document.addEventListener('keydown', event => { if (event.key === 'Escape' && this.held) { event.preventDefault(); void this.cancel(); } }, true);
      State.subscribe(() => {
        if (activeThreadId === State.activeId) return;
        activeThreadId = State.activeId;
        if (this.held) void this.cancel();
        this.renderInsertions();
      });
      this.renderInsertions();
    },
  };

  const HandInput = {
    runtime: null,
    unsubscribe: null,
    active: false,
    async toggle() {
      if (this.active) return this.stop();
      if (!State.activeId || !window.solat?.handStart) return Toast.show('Hand tracking is unavailable.', { icon: 'alert' });
      try {
        if (!this.runtime) {
          const { HandTrackingRuntime } = await import('./hand-tracking-runtime.mjs');
          this.runtime = new HandTrackingRuntime({
            bridge: window.solat,
            onState: (state, error) => {
              this.active = state === 'tracking';
              $('#handBtn')?.setAttribute('aria-pressed', String(this.active));
              if (state === 'error') Toast.show(error?.message || 'Hand tracking stopped because the camera or detector failed.', { icon: 'alert', timeout: 5200 });
            },
          });
        }
        await this.runtime.start(sessionFor(State.activeId));
      } catch (error) {
        this.active = false;
        $('#handBtn')?.setAttribute('aria-pressed', 'false');
        Toast.show(error?.message || 'Hand tracking could not start.', { icon: 'alert', timeout: 5200 });
      }
    },
    async stop() {
      try { await this.runtime?.stop?.(); } finally {
        this.active = false;
        $('#handBtn')?.setAttribute('aria-pressed', 'false');
      }
    },
    init() {
      if (window.solat?.onHandEvent) this.unsubscribe = window.solat.onHandEvent(event => { void SpatialAssets.consumeHandEvent(event); });
      let activeThreadId = State.activeId;
      State.subscribe(() => {
        if (activeThreadId === State.activeId) return;
        activeThreadId = State.activeId;
        if (this.active) void this.stop();
      });
    },
  };

  function wire() {
    State.subscribe(() => { Threads.render(); Projects.render(); Chat.render(); updateStorageInfo(); });
    document.addEventListener('click', event => {
      const trigger = event.target.closest?.('#settingsBtn, #shortcutsBtn');
      if (!trigger) return;
      event.preventDefault(); event.stopImmediatePropagation(); closeSidebar();
      if (trigger.id === 'settingsBtn') openSettings('general');
      else Overlay.open($('#shortcuts'));
    }, true);
    $('#newChatBtn')?.addEventListener('click', newConversation); $('#brandHomeBtn')?.addEventListener('click', () => newConversation({ animate: true })); $('#navToggle')?.addEventListener('click', () => $('#sidebar').classList.contains('open') ? closeSidebar() : openSidebar()); $('#scrim')?.addEventListener('click', () => { Menu.close(); Overlay.close(); closeSidebar(); });
    $('#omniBtn')?.addEventListener('click', () => Palette.open());
    $('#spatialBtn')?.addEventListener('click', () => { void Spatial.open('lasso'); });
    $('#browserBtn')?.addEventListener('click', () => { void BrowserWorkspace.open(); });
    $('#handBtn')?.addEventListener('click', () => { void HandInput.toggle(); });
    $('#themeBtn')?.addEventListener('click', enterSolatVoiceMode);
    $('#solatVoiceMicButton')?.addEventListener('click', () => { void toggleVoiceInput(); });
    $('#solatVoiceExitButton')?.addEventListener('click', exitSolatVoiceMode);
    document.addEventListener('solat:voice-activity', event => {
      const detail = event.detail && typeof event.detail === 'object' ? event.detail : {};
      setSolatVoiceActivity(detail.state, Number.isFinite(detail.timeout) ? detail.timeout : 0);
    });
    $('#chatTitle')?.addEventListener('click', renameActive);
    $('#profileBtn')?.addEventListener('click', () => Menu.open($('#profileBtn'), [{ label: 'Appearance and settings', icon: 'settings', run: () => openSettings('general') }, { label: 'Provider status', icon: 'shield', run: () => openSettings('keys') }, { label: 'Keyboard shortcuts', icon: 'keyboard', run: () => Overlay.open($('#shortcuts')) }, '-', { label: 'Export this conversation', icon: 'download', run: () => State.active && exportThread(State.active) }]));
    $('#modelBtn')?.addEventListener('click', chooseModelMode);
    $('#chatMenuBtn')?.addEventListener('click', () => State.active && Menu.open($('#chatMenuBtn'), [{ label: 'Rename', icon: 'pencil', run: renameActive }, { label: 'Export as Markdown', icon: 'download', run: () => exportThread(State.active) }, { label: 'Print', icon: 'file', run: () => window.print() }, '-', { label: 'Delete conversation', icon: 'trash', danger: true, run: () => deleteThread(State.active) }]));
    const search = $('#search'); search?.addEventListener('input', () => { Threads.query = search.value; $('#searchField')?.classList.toggle('has-value', Boolean(search.value)); Threads.render(); }); search?.addEventListener('keydown', event => { if (event.key === 'Escape') { search.value = ''; Threads.query = ''; Threads.render(); } if (event.key === 'ArrowDown') { event.preventDefault(); $('.thread', $('#threadGroups'))?.focus(); } }); $('#searchClear')?.addEventListener('click', () => { search.value = ''; Threads.query = ''; Threads.render(); search.focus(); });
    for (const id of ['projToggle', 'filesToggle']) document.getElementById(id)?.addEventListener('click', event => { const button = event.currentTarget; const body = document.getElementById(button.getAttribute('aria-controls')); const open = button.getAttribute('aria-expanded') !== 'true'; button.setAttribute('aria-expanded', String(open)); if (body) body.hidden = !open; });
    $('#newProjectBtn')?.addEventListener('click', event => { event.stopPropagation(); Projects.create(); });
    $('#addFilesBtn')?.addEventListener('click', event => { event.stopPropagation(); $('#libraryFileInput')?.click(); });
    $('#libraryFileInput')?.addEventListener('change', async event => { await LibraryFiles.import([...event.target.files]); event.target.value = ''; });
    $$('.set-panel [data-close], [data-close]').forEach(button => button.addEventListener('click', () => Overlay.close())); $('#confirmCancel')?.addEventListener('click', () => $('#confirm').dispatchEvent(new CustomEvent('solat:confirm', { detail: 'cancel' }))); $('#confirmOk')?.addEventListener('click', () => $('#confirm').dispatchEvent(new CustomEvent('solat:confirm', { detail: 'ok' })));
    $('#log')?.addEventListener('scroll', () => { const log = $('#log'); Chat.pinned = log.scrollHeight - log.scrollTop - log.clientHeight < 90; Chat.updateJump(); }, { passive: true }); $('#jump')?.addEventListener('click', () => { Chat.pinned = true; $('#log').scrollTo({ top: $('#log').scrollHeight, behavior: Settings.get('motion') ? 'smooth' : 'auto' }); Chat.updateJump(); });
    document.addEventListener('pointerdown', spawnInkHit, { passive: true });
    document.addEventListener('click', event => { if (Menu.anchor && !Menu.node.contains(event.target) && !Menu.anchor.contains(event.target)) Menu.close(); }); document.addEventListener('keydown', event => { const modifier = event.metaKey || event.ctrlKey; const typing = ['INPUT', 'TEXTAREA'].includes(event.target.tagName) || event.target.isContentEditable; if (modifier && event.shiftKey && event.code === 'Space') { event.preventDefault(); void Spatial.open('lasso'); return; } if (modifier && event.key.toLowerCase() === 'g') { event.preventDefault(); Palette.open(); return; } if (modifier && event.shiftKey && event.key.toLowerCase() === 'o') { event.preventDefault(); newConversation(); return; } if (modifier && event.shiftKey && event.key.toLowerCase() === 'l') { event.preventDefault(); cycleTheme(true); return; } if (modifier && event.key.toLowerCase() === 'b') { event.preventDefault(); matchMedia('(max-width: 900px)').matches ? ($('#sidebar').classList.contains('open') ? closeSidebar() : openSidebar()) : $('#search')?.focus(); return; } if (event.key === 'Escape') { if (Menu.anchor) { Menu.close(); return; } if (Overlay.current) { Overlay.close(); return; } if ($('#sidebar').classList.contains('open')) closeSidebar(); else if (busy) Chat.stop(); return; } if (!typing && event.key === '/') { event.preventDefault(); Composer.focus(); } else if (!typing && event.key === '?') { event.preventDefault(); Overlay.open($('#shortcuts')); } else if (!typing && event.key === 'F2') { event.preventDefault(); renameActive(); } });
  }

  function updateStorageInfo() { const node = $('#storageInfo'); if (node) node.textContent = `${State.threads.length} conversation${State.threads.length === 1 ? '' : 's'} saved locally`; }

  function setUiMode(next, announce = true) {
    const mode = next === 'alternate' ? 'alternate' : 'classic';
    document.documentElement.dataset.uiMode = mode;
    const toggle = $('#themeBtn');
    if (toggle) {
      const alternate = mode === 'alternate';
      toggle.setAttribute('aria-pressed', String(alternate));
      toggle.setAttribute('aria-label', alternate ? 'Return to classic SOLAT interface' : 'Switch SOLAT interface');
      toggle.title = alternate ? 'Return to classic SOLAT interface' : 'Switch SOLAT interface';
    }
    localStorage.setItem('solat.ui.mode', mode);
    if (announce) Toast.show(alternate ? 'Alternate interface selected' : 'Classic interface selected', { icon: alternate ? 'spark' : 'check', timeout: 2200 });
  }

  if (window.SolatVoiceController) {
    Voice = new window.SolatVoiceController({
      bridge: window.solat,
      onState: state => {
        setSolatVoiceActivity(state);
        const listening = ['listening', 'user_speaking', 'transcribing'].includes(state);
        $('#micBtn')?.setAttribute('aria-pressed', String(listening));
        const voiceMic = $('#solatVoiceMicButton');
        if (voiceMic) {
          voiceMic.setAttribute('aria-pressed', String(listening));
          voiceMic.setAttribute('aria-label', listening ? 'Stop microphone' : 'Start microphone');
          voiceMic.setAttribute('title', listening ? 'Stop microphone' : 'Start microphone');
          const label = voiceMic.querySelector('.solat-voice-mic-label');
          if (label) label.textContent = listening ? 'MIC ON' : 'MIC';
        }
        const labels = { idle: 'Ready', listening: 'Listening', user_speaking: 'User speaking', transcribing: 'Transcribing', thinking: 'Thinking', acting: 'Acting', speaking: 'SOLAT speaking', interrupted: 'Interrupted', error: 'Voice error' };
        setStatus(state === 'error' ? 'error' : ['idle', 'listening'].includes(state) ? 'ready' : 'busy', labels[state] || 'Voice');
      },
      onPartial: transcript => {
        // Partial transcripts are provisional UI feedback only. They render in
        // the ephemeral voice preview, never into the Red typed composer, and
        // never become a chat turn.
        const value = String(transcript || '').trim();
        if (!value) return;
        if (isSolatVoiceSceneActive()) setSolatVoicePreview(value);
      },
      onFinalTranscript: async (transcript, utteranceId, metadata = {}) => {
        if (busy) await waitForChatIdle();
        if (!Voice?.active) return false;
        // A finalized utterance enters SOLAT through the unified input
        // boundary as a voice turn. It never simulates typing into the Red
        // composer or clicking Send, so the view is not the transport.
        await Chat.submitVoiceTurn(transcript, {
          voiceSessionId: metadata.voiceSessionId,
          voiceUtteranceId: utteranceId || metadata.utteranceId,
          voiceFinalAtMs: metadata.receivedAtMs,
        });
        return true;
      },
      onError: error => Toast.show(error?.message || 'Voice mode stopped with an error.', { icon: 'alert', timeout: 5200 }),
    });
    window.solatVoiceController = Voice;
    window.solat.onAssistantDelta?.(payload => handleAssistantDelta(payload));
  }
  Settings.load(); Projects.load(); State.load(); SettingsUI.init(); Palette.init(); ChromeControlSetup.init(); Composer.init(); AgentUI.init(); Music.init(); Spatial.init(); BrowserWorkspace.init(); SpatialAssets.init(); HandInput.init(); wire(); wireSolatCursor(); Threads.render(); Projects.render(); LibraryFiles.render(); Chat.render(); updateStorageInfo(); refreshStatus(); Music.restoreHistory(); State.restoreDurable();
  setUiMode('classic', false);
  $('#boot')?.classList.add('done'); $('#input')?.focus();
})();
