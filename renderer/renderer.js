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
      if (themeButton) {
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
    if (code === 'not_configured') return 'Model provider is not configured. Add the DeepSeek API key to the local environment.';
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
      const article = make('article', { class: `msg ${message.role}${failed ? ' error' : ''}`, 'data-id': message.id, tabindex: '-1' });
      const label = message.role === 'user' ? 'You' : failed ? 'Delivery failed' : 'SOLAT';
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
      const action = (label, symbol, handler, pressed = false) => {
        const button = make('button', { type: 'button', class: `act${!label ? ' icon-only' : ''}`, 'aria-label': label, title: label, 'aria-pressed': pressed ? 'true' : 'false' }, icon(symbol), label ? make('span', { text: label }) : null);
        button.addEventListener('click', () => handler(button)); return button;
      };
      row.append(action('Copy', 'copy', async button => {
        const ok = await copyText(message.content); button.textContent = ''; button.append(icon(ok ? 'check' : 'alert'), make('span', { text: ok ? 'Copied' : 'Copy failed' })); button.classList.toggle('done', ok);
        setTimeout(() => { button.textContent = ''; button.append(icon('copy'), make('span', { text: 'Copy' })); button.classList.remove('done'); }, 1700);
      }));
      if (message.role === 'user') {
        row.append(action('Edit', 'pencil', () => { State.truncateAfter(State.activeId, message.id); Composer.setValue(message.content); }));
      } else {
        row.append(action('Retry', 'refresh', () => this.retry(message.id)));
        if (message.responseMeta?.agentActionPending) row.append(action('Review Agent', 'cpu', () => AgentUI.openPending(message)));
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
    async send(content, attachments = []) {
      const thread = State.active || State.create();
      const activityStartedAt = performance.now();
      const visible = attachments.length ? `${content ? `${content}\n\n` : ''}${attachments.map(file => `\`${file.name}\``).join(' · ')}` : content;
      const user = State.add(thread.id, { role: 'user', content: visible, attachments: attachments.map(file => file.name), assetIds: [] });
      if (thread.title === 'New conversation') State.rename(thread.id, titleFrom(content || attachments[0]?.name));
      const sequence = ++this.requestId; this.controller = { stopped: false, sequence, threadId: thread.id };
      setStatus('busy', 'Responding'); Composer.setBusy(true); this.render();
      let result; let shouldRender = false;
      try {
        const threadSessionId = sessionFor(thread.id);
        const assetIds = [];
        if (!window.solat?.send) throw Object.assign(new Error('SOLAT desktop connection is unavailable.'), { code: 'desktop_bridge_unavailable' });
        if (attachments.length && !window.solat?.storeOriginalAsset) throw Object.assign(new Error('Original asset storage is unavailable; the file was not sent.'), { code: 'asset_storage_unavailable' });
        for (const file of attachments) {
          const stored = await window.solat.storeOriginalAsset({ requestId: uid('asset'), sessionId: threadSessionId, fileName: file.name, mimeType: file.type, bytes: new Uint8Array(await file.arrayBuffer()) });
          assetIds.push(stored.assetId);
        }
        user.assetIds = assetIds; State.emit('messages');
        result = await window.solat.send({ requestId: uid('request'), sessionId: threadSessionId, content: visible, musicContext: Music.song() || null, attachments: attachments.map(file => file.name), assetIds, agentMode: AgentUI.isEnabled(), agentCommand: AgentUI.commandFromText(visible) });
        if (this.controller?.stopped || sequence !== this.requestId) return;
        const assistant = State.add(thread.id, {
          role: 'assistant',
          content: text(result.assistant),
          responseMeta: {
            provider: result.provider,
            model: result.model,
            mode: result.mode || result.responseMeta?.mode || 'model',
            webSearchStatus: result.webSearchStatus || result.responseMeta?.webSearchStatus || 'not_requested',
            searchRecoveryUsed: Boolean(result.searchRecoveryUsed || result.responseMeta?.searchRecoveryUsed),
            sources: Array.isArray(result.sources) ? result.sources : [],
            searchEvidence: Array.isArray(result.searchEvidence) ? result.searchEvidence : [],
            searchSummary: result.searchSummary && typeof result.searchSummary === 'object' ? result.searchSummary : null,
            agentMode: Boolean(result.agentMode), agentCommand: result.agentCommand || null,
            agentActionPending: Array.isArray(result.agentActions) && result.agentActions.length > 0,
          },
        });
        if (Array.isArray(result.agentActions) && result.agentActions.length) {
          await AgentUI.receive(result.agentActions, { threadId: thread.id, sessionId: threadSessionId, messageId: assistant.id });
        }
        shouldRender = true;
        setStatus('ready', 'Ready', `${result.provider || 'provider'} / ${result.model || 'model'}`);
        return assistant;
      } catch (error) {
        if (this.controller?.stopped || sequence !== this.requestId) return;
        State.add(thread.id, { role: 'assistant', content: errorText(error), error: true });
        shouldRender = true; setStatus('error', 'Error'); await refreshStatus();
      } finally {
        if (sequence === this.requestId) {
          const minimumActivityMs = Settings.get('motion') ? 620 : 0;
          const remainingActivityMs = minimumActivityMs - (performance.now() - activityStartedAt);
          if (shouldRender && remainingActivityMs > 0) await new Promise(resolve => setTimeout(resolve, remainingActivityMs));
          this.controller = null; Composer.setBusy(false);
          // Clear the busy state before rendering the completed turn. Otherwise
          // the just-finished request leaves an orphaned thinking bubble behind.
          if (shouldRender && State.activeId === thread.id) this.render();
        }
      }
    },
    stop() {
      if (!this.controller) return;
      this.controller.stopped = true; this.requestId += 1; this.controller = null; Composer.setBusy(false); setStatus('ready', 'Ready');
      this.render();
      Toast.show('Stop requested. The provider request may finish in the background.', { icon: 'alert' });
    },
    updateJump() { const log = $('#log'); const distance = log.scrollHeight - log.scrollTop - log.clientHeight; $('#jump')?.classList.toggle('show', !this.pinned && distance > 120); $('#chatHeader')?.classList.toggle('stuck', log.scrollTop > 6); },
  };

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
      form.addEventListener('submit', event => { event.preventDefault(); if (busy) return Chat.stop(); this.submit(); });
      $('#attachBtn')?.addEventListener('click', () => $('#fileInput')?.click()); $('#fileInput')?.addEventListener('change', event => { this.attach([...event.target.files]); event.target.value = ''; });
      let depth = 0; const wrap = $('#composerWrap');
      wrap.addEventListener('dragenter', event => { event.preventDefault(); if (++depth === 1) form.classList.add('dropping'); }); wrap.addEventListener('dragover', event => event.preventDefault()); wrap.addEventListener('dragleave', () => { if (--depth <= 0) { depth = 0; form.classList.remove('dropping'); } });
      wrap.addEventListener('drop', event => { event.preventDefault(); depth = 0; form.classList.remove('dropping'); this.attach([...(event.dataTransfer?.files || [])]); });
      this.initMic(); this.sync();
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
      busy = on; const button = $('#sendBtn'); button.disabled = false; button.classList.toggle('stop', on); button.setAttribute('aria-label', on ? 'Stop responding' : 'Send message'); button.replaceChildren(icon(on ? 'stop' : 'send'), make('span', { class: 'send-label', text: on ? 'Stop' : 'Send' })); $('#composer').classList.toggle('live', on); this.syncMode(); if (!on) this.sync();
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
        host.append(make('span', { class: 'chip' }, item.previewUrl ? make('img', { class: 'thumb', src: item.previewUrl, alt: '' }) : icon('file'), make('span', { class: 'nm', text: item.file.name, title: item.file.name }), make('span', { class: 'sz', text: fileSize(item.file.size) }), make('span', { class: 'upload-state selected', text: 'selected' }), remove));
      });
    },
    async submit() {
      if (busy) return Chat.stop(); const input = $('#input'); const content = input.value.trim(); if (!content && !this.attachments.length) return;
      if (this.launching) return;
      if (content.length > this.limit) return Toast.show('Message is too long to send', { icon: 'alert' });
      this.launching = true;
      try { await playSendTransition(); } finally { this.launching = false; }
      const files = [...this.attachments]; input.value = ''; this.attachments = []; this.renderAttachments(); this.sync(); Music.schedule(); Chat.send(content, files);
    },
    initMic() {
      const button = $('#micBtn'); const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
      if (!Recognition) { button.addEventListener('click', () => Toast.show('This desktop build has no dictation support.', { icon: 'alert' })); return; }
      const recognition = new Recognition(); recognition.continuous = false; recognition.interimResults = true; recognition.lang = navigator.language || 'en-US'; let listening = false; let base = '';
      button.addEventListener('click', () => { if (listening) recognition.stop(); else { base = $('#input').value; recognition.start(); } });
      recognition.onstart = () => { listening = true; button.setAttribute('aria-pressed', 'true'); setStatus('busy', 'Listening'); };
      recognition.onend = () => { listening = false; button.setAttribute('aria-pressed', 'false'); if (!busy) setStatus('ready', 'Ready'); this.sync(); };
      recognition.onerror = event => { if (event.error !== 'aborted') Toast.show(`Dictation stopped: ${event.error}`, { icon: 'alert' }); };
      recognition.onresult = event => { let value = ''; for (let index = event.resultIndex; index < event.results.length; index += 1) value += event.results[index][0].transcript; $('#input').value = `${base.replace(/\s*$/, ' ')}${value}`; AgentUI.syncInputAppearance($('#input').value); this.sync(); };
    },
  };

  const AgentUI = {
    enabled: false, pending: null, queue: [], plan: null, busy: false, workingMessageId: null, lastCommandSelectionAt: 0,
    isEnabled() { return this.enabled; },
    commands: Object.freeze(['@create-file', '@computer-use']),
    available() { return Boolean(window.solat?.agentInspect && window.solat?.agentApprove && window.solat?.agentRun && window.solat?.agentCancel); },
    syncCommandMenu() {
      const button = $('#agentCommandBtn'); if (!button) return;
      button.setAttribute('aria-pressed', String(this.enabled));
      button.setAttribute('aria-label', this.enabled ? 'Disable Agent mode' : 'Enable Agent mode');
      button.title = this.enabled ? 'Agent mode is on' : 'Agent mode is off';
      button.classList.toggle('active', this.enabled);
      $('#composer')?.classList.toggle('agent-on', this.isEnabled());
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
    toggle() {
      if (!this.available()) return Toast.show('Agent controls are unavailable in this desktop build.', { icon: 'alert' });
      this.enabled = !this.enabled; this.syncCommandMenu(); Composer.syncMode();
      Toast.show(this.enabled ? 'Agent mode is on.' : 'Agent mode is off.', { icon: this.enabled ? 'cpu' : 'shield', timeout: 2400 });
    },
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
    addChatResult(content, error = false, artifact = null) {
      const threadId = this.pending?.threadId; if (!threadId) return;
      const responseMeta = { provider: 'SOLAT Agent', model: 'verified tool result', mode: error ? 'agent_failure' : 'agent_verified', webSearchStatus: 'not_requested', sources: [], searchEvidence: [], agentMode: true, ...(artifact ? { agentFile: artifact } : {}) };
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
      close.addEventListener('click', () => dialog.close()); dialog.addEventListener('close', () => dialog.remove(), { once: true });
      dialog.append(make('div', { class: 'music-surface-head' }, make('strong', { text: artifact.relativePath }), close), meta, content);
      document.body.append(dialog); dialog.showModal();
      try {
        const result = await window.solat.agentReadArtifact({ sessionId: artifact.sessionId, relativePath: artifact.relativePath, expectedSha256: artifact.sha256 });
        meta.textContent = `${result.size_bytes.toLocaleString()} bytes · ${result.sha256}${result.truncated ? ' · preview truncated' : ''}`;
        content.textContent = result.content;
      } catch (error) { meta.textContent = `File preview failed: ${errorText(error)}`; content.textContent = ''; }
    },
    async receive(actions, context) {
      const accepted = actions.filter(action => action?.status === 'confirmation_required' && action.idempotency_key && action.approval_token);
      this.queue.push(...accepted.map(action => ({ ...action, ...context })));
      if (!this.pending) await this.activateNext();
    },
    async activateNext() {
      this.pending = this.queue.shift() || null; this.plan = null;
      if (!this.pending) { this.render(); return; }
      try {
        this.plan = await window.solat.agentInspect({ sessionId: this.pending.sessionId, idempotencyKey: this.pending.idempotency_key });
        this.status('This action changes a file or app. Review it before approval.');
      } catch (error) { this.status(`The pending action could not be inspected: ${errorText(error)}`); }
      this.render(); Overlay.open($('#agentDialog'), { focus: $('#agentApproveBtn') });
    },
    openPending(message) {
      if (!this.pending || this.pending.messageId !== message.id) return Toast.show('This Agent action is no longer pending.', { icon: 'alert' });
      this.render(); Overlay.open($('#agentDialog'), { focus: $('#agentApproveBtn') });
    },
    close() { Overlay.close(); },
    async approve() {
      if (!this.pending || this.busy) return;
      const animationStartedAt = performance.now();
      this.busy = true; this.startWorkingMessage(); this.status('Approving and running the verified plan…'); this.render();
      try {
        await window.solat.agentApprove({ sessionId: this.pending.sessionId, idempotencyKey: this.pending.idempotency_key, approvalToken: this.pending.approval_token });
        const result = await window.solat.agentRun({ sessionId: this.pending.sessionId, idempotencyKey: this.pending.idempotency_key });
        this.plan = result.plan;
        const remainingAnimationMs = 600 - (performance.now() - animationStartedAt);
        if (remainingAnimationMs > 0) await new Promise(resolve => setTimeout(resolve, remainingAnimationMs));
        const message = this.outcomeText(this.plan); this.addChatResult(message, this.plan?.status !== 'SUCCEEDED', this.artifactFromPlan(this.plan));
        this.status(message); this.render();
        if (this.plan?.status === 'SUCCEEDED') Toast.show('Agent action verified and completed.', { icon: 'check' });
      } catch (error) {
        const message = `Agent action failed: ${errorText(error)}`; this.status(message); this.addChatResult(message, true);
      } finally {
        this.busy = false; this.workingMessageId = null; this.pending = null; this.render(); Overlay.close(); await this.activateNext();
      }
    },
    async cancel() {
      if (!this.pending || this.busy) return this.close();
      this.busy = true; this.status('Cancelling the pending action…'); this.render();
      try {
        this.plan = await window.solat.agentCancel({ sessionId: this.pending.sessionId, idempotencyKey: this.pending.idempotency_key });
        this.addChatResult('Agent action cancelled. No pending file or computer change was completed.');
        Toast.show('Agent action cancelled.', { icon: 'check' });
      } catch (error) { this.status(`Cancellation failed: ${errorText(error)}`); return; }
      finally {
        this.busy = false;
        if (this.plan?.status === 'CANCELLED') { this.pending = null; Overlay.close(); await this.activateNext(); }
        this.render();
      }
    },
    render() {
      const steps = $('#agentSteps'); if (steps) {
        steps.textContent = '';
        const current = this.plan?.steps?.length ? this.plan.steps : this.pending ? [{ tool: this.pending.tool, status: 'PAUSED_APPROVAL' }] : [];
        for (const step of current) steps.append(make('li', { text: `${step.tool} — ${step.status || 'QUEUED'}` }));
      }
      const result = $('#agentResult'); if (result) {
        const value = this.pending ? this.actionPreview(this.pending) : this.plan ? { status: this.plan.status, failure: this.plan.failure || null } : null;
        result.hidden = !value; result.textContent = value ? JSON.stringify(value, null, 2) : '';
      }
      const approve = $('#agentApproveBtn'); const cancel = $('#agentCancelBtn');
      const progress = $('#agentProgress'); const progressLabel = $('#agentProgressLabel');
      if (progress) progress.hidden = !this.busy;
      if (progressLabel && this.busy) progressLabel.textContent = String(this.pending?.tool || '').startsWith('filesystem_') ? `Creating ${text(this.pending?.arguments?.path || 'file')}…` : 'Running approved Agent action…';
      if (approve) { approve.hidden = !this.pending; approve.disabled = this.busy; }
      if (cancel) { cancel.textContent = this.pending ? 'Cancel action' : 'Close'; cancel.disabled = this.busy; }
    },
    init() {
      const commandMenu = $('#agentCommandMenu');
      if (commandMenu && commandMenu.parentElement !== document.body) document.body.append(commandMenu);
      $('#agentCommandBtn')?.addEventListener('click', () => this.toggle());
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
        { label: 'Keyboard shortcuts', icon: 'keyboard', run: () => Overlay.open($('#shortcuts')) },
        { label: 'Export this conversation', icon: 'download', run: () => State.active && exportThread(State.active) },
        { label: 'Rename this conversation', icon: 'pencil', run: renameActive },
        { label: 'Copy the last response', icon: 'copy', run: async () => { const response = [...(State.active?.messages || [])].reverse().find(message => message.role === 'assistant'); if (!response) return Toast.show('Nothing to copy yet', { icon: 'alert' }); Toast.show(await copyText(response.content) ? 'Response copied' : 'Copy failed', { icon: 'copy' }); } },
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

  const providerCatalog = [
    ['deepseek', 'DeepSeek', 'Used by the V2 core through the local environment.'],
    ['openai', 'OpenAI', 'Available as a future adapter; no browser key is stored.'],
    ['anthropic', 'Anthropic', 'Available as a future adapter; no browser key is stored.'],
    ['google', 'Google Gemini', 'Available as a future adapter; no browser key is stored.'],
    ['openrouter', 'OpenRouter', 'Available as a future adapter; no browser key is stored.'],
    ['custom', 'Custom endpoint', 'OpenAI-compatible adapter slot; not enabled by this milestone.'],
  ];

  function renderProviders() {
    const host = $('#provList'); if (!host) return; host.textContent = '';
    for (const [id, name, description] of providerCatalog) {
      const button = make('button', { type: 'button', class: 'btn', text: id === 'deepseek' ? 'Configured in .env' : 'Future adapter' });
      button.addEventListener('click', () => Toast.show(id === 'deepseek' ? 'DeepSeek is configured outside the UI; the key is never echoed here.' : `${name} is not enabled in this V2 milestone.`, { icon: id === 'deepseek' ? 'shield' : 'help', timeout: 4200 }));
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

  async function refreshStatus() {
    if (!window.solat?.status) return setStatus('error', 'Unavailable', 'Secure desktop IPC is unavailable.');
    try { const state = await window.solat.status(); const detail = `${state.provider || 'provider'} / ${state.model || 'model unavailable'}`; setStatus(state.configured ? 'ready' : 'error', state.configured ? 'Ready' : 'Not configured', detail); $('#modelName').textContent = state.model || 'SOLAT Core'; } catch { setStatus('error', 'Unavailable', 'Provider status could not be read.'); }
  }

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
    $('#themeBtn')?.addEventListener('click', () => {
      const current = document.documentElement.dataset.uiMode === 'alternate' ? 'alternate' : 'classic';
      setUiMode(current === 'alternate' ? 'classic' : 'alternate');
    });
    $('#chatTitle')?.addEventListener('click', renameActive);
    $('#profileBtn')?.addEventListener('click', () => Menu.open($('#profileBtn'), [{ label: 'Appearance and settings', icon: 'settings', run: () => openSettings('general') }, { label: 'Provider status', icon: 'shield', run: () => openSettings('keys') }, { label: 'Keyboard shortcuts', icon: 'keyboard', run: () => Overlay.open($('#shortcuts')) }, '-', { label: 'Export this conversation', icon: 'download', run: () => State.active && exportThread(State.active) }]));
    $('#modelBtn')?.addEventListener('click', () => Menu.open($('#modelBtn'), [{ label: 'SOLAT Core', icon: 'cpu', checked: true, run: () => Toast.show('SOLAT Core is the active V2 model boundary.', { icon: 'cpu' }) }]));
    $('#chatMenuBtn')?.addEventListener('click', () => State.active && Menu.open($('#chatMenuBtn'), [{ label: 'Rename', icon: 'pencil', run: renameActive }, { label: 'Export as Markdown', icon: 'download', run: () => exportThread(State.active) }, { label: 'Print', icon: 'file', run: () => window.print() }, '-', { label: 'Delete conversation', icon: 'trash', danger: true, run: () => deleteThread(State.active) }]));
    const search = $('#search'); search?.addEventListener('input', () => { Threads.query = search.value; $('#searchField')?.classList.toggle('has-value', Boolean(search.value)); Threads.render(); }); search?.addEventListener('keydown', event => { if (event.key === 'Escape') { search.value = ''; Threads.query = ''; Threads.render(); } if (event.key === 'ArrowDown') { event.preventDefault(); $('.thread', $('#threadGroups'))?.focus(); } }); $('#searchClear')?.addEventListener('click', () => { search.value = ''; Threads.query = ''; Threads.render(); search.focus(); });
    for (const id of ['projToggle', 'filesToggle']) document.getElementById(id)?.addEventListener('click', event => { const button = event.currentTarget; const body = document.getElementById(button.getAttribute('aria-controls')); const open = button.getAttribute('aria-expanded') !== 'true'; button.setAttribute('aria-expanded', String(open)); if (body) body.hidden = !open; });
    $('#newProjectBtn')?.addEventListener('click', event => { event.stopPropagation(); Projects.create(); });
    $('#addFilesBtn')?.addEventListener('click', event => { event.stopPropagation(); $('#libraryFileInput')?.click(); });
    $('#libraryFileInput')?.addEventListener('change', async event => { await LibraryFiles.import([...event.target.files]); event.target.value = ''; });
    $$('.set-panel [data-close], [data-close]').forEach(button => button.addEventListener('click', () => Overlay.close())); $('#confirmCancel')?.addEventListener('click', () => $('#confirm').dispatchEvent(new CustomEvent('solat:confirm', { detail: 'cancel' }))); $('#confirmOk')?.addEventListener('click', () => $('#confirm').dispatchEvent(new CustomEvent('solat:confirm', { detail: 'ok' })));
    $('#log')?.addEventListener('scroll', () => { const log = $('#log'); Chat.pinned = log.scrollHeight - log.scrollTop - log.clientHeight < 90; Chat.updateJump(); }, { passive: true }); $('#jump')?.addEventListener('click', () => { Chat.pinned = true; $('#log').scrollTo({ top: $('#log').scrollHeight, behavior: Settings.get('motion') ? 'smooth' : 'auto' }); Chat.updateJump(); });
    document.addEventListener('pointerdown', spawnInkHit, { passive: true });
    document.addEventListener('click', event => { if (Menu.anchor && !Menu.node.contains(event.target) && !Menu.anchor.contains(event.target)) Menu.close(); }); document.addEventListener('keydown', event => { const modifier = event.metaKey || event.ctrlKey; const typing = ['INPUT', 'TEXTAREA'].includes(event.target.tagName) || event.target.isContentEditable; if (modifier && event.key.toLowerCase() === 'k') { event.preventDefault(); Palette.open(); return; } if (modifier && event.shiftKey && event.key.toLowerCase() === 'o') { event.preventDefault(); newConversation(); return; } if (modifier && event.shiftKey && event.key.toLowerCase() === 'l') { event.preventDefault(); cycleTheme(true); return; } if (modifier && event.key.toLowerCase() === 'b') { event.preventDefault(); matchMedia('(max-width: 900px)').matches ? ($('#sidebar').classList.contains('open') ? closeSidebar() : openSidebar()) : $('#search')?.focus(); return; } if (event.key === 'Escape') { if (Menu.anchor) { Menu.close(); return; } if (Overlay.current) { Overlay.close(); return; } if ($('#sidebar').classList.contains('open')) closeSidebar(); else if (busy) Chat.stop(); return; } if (!typing && event.key === '/') { event.preventDefault(); Composer.focus(); } else if (!typing && event.key === '?') { event.preventDefault(); Overlay.open($('#shortcuts')); } else if (!typing && event.key === 'F2') { event.preventDefault(); renameActive(); } });
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

  Settings.load(); Projects.load(); State.load(); SettingsUI.init(); Palette.init(); Composer.init(); AgentUI.init(); Music.init(); wire(); wireSolatCursor(); Threads.render(); Projects.render(); LibraryFiles.render(); Chat.render(); updateStorageInfo(); refreshStatus(); Music.restoreHistory(); State.restoreDurable();
  setUiMode(localStorage.getItem('solat.ui.mode') || 'classic', false);
  $('#boot')?.classList.add('done'); $('#input')?.focus();
})();
