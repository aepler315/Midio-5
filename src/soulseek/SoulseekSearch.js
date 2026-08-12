/**
 * Soulseek-powered song search UI for Midio.
 *
 * Talks to the local bridge at /api/soulseek/* (see tools/soulseek-bridge.mjs).
 * Default connection is a direct Soulseek login; slskd is the alternate backend.
 * Results show Title / Artist / Album / Length and are version-deduped server-side.
 */

const STORAGE_KEY = 'midio.soulseek.config';

export class SoulseekSearch {
  /**
   * @param {object} opts
   * @param {HTMLElement} opts.root
   * @param {(files: File[]) => void} opts.onFiles
   * @param {(msg: string) => void} [opts.onStatus]
   */
  constructor({ root, onFiles, onStatus }) {
    this.root = root;
    this.onFiles = onFiles;
    this.onStatus = onStatus || (() => {});
    this.status = { mode: 'direct', connected: false, needsLogin: true };
    this.searchId = null;
    this.pollTimer = null;
    this.busy = false;

    this.els = {
      form: root.querySelector('#slskSearchForm'),
      input: root.querySelector('#slskQuery'),
      submit: root.querySelector('#slskSearchBtn'),
      results: root.querySelector('#slskResults'),
      empty: root.querySelector('#slskEmpty'),
      badge: root.querySelector('#slskModeBadge'),
      statusLine: root.querySelector('#slskStatus'),
      settingsBtn: root.querySelector('#slskSettingsBtn'),
      settings: root.querySelector('#slskSettings'),
      modeSelect: root.querySelector('#slskModeSelect'),
      slskdFields: root.querySelector('#slskdFields'),
      directFields: root.querySelector('#slskDirectFields'),
      slskdUrl: root.querySelector('#slskdUrl'),
      slskdKey: root.querySelector('#slskdKey'),
      slskUser: root.querySelector('#slskUser'),
      slskPass: root.querySelector('#slskPass'),
      saveCfg: root.querySelector('#slskSaveCfg'),
      clearCfg: root.querySelector('#slskClearCfg'),
      legal: root.querySelector('#slskLegal'),
    };

    // Default UI: Soulseek login
    if (this.els.modeSelect) this.els.modeSelect.value = 'direct';
    this._syncSettingsFields();

    this._bind();
    this._restoreLocalConfig();
    this.refreshStatus();
  }

  _bind() {
    const e = this.els;
    e.form?.addEventListener('submit', (ev) => {
      ev.preventDefault();
      this.search(e.input?.value || '');
    });
    e.settingsBtn?.addEventListener('click', () => this.toggleSettings());
    e.modeSelect?.addEventListener('change', () => this._syncSettingsFields());
    e.saveCfg?.addEventListener('click', () => this.saveConfig());
    e.clearCfg?.addEventListener('click', () => this.clearConfig());
    // Stop title-screen keyboard shortcuts from stealing typing
    for (const el of [e.input, e.slskdUrl, e.slskdKey, e.slskUser, e.slskPass]) {
      el?.addEventListener('keydown', (ev) => ev.stopPropagation());
    }
  }

  _syncSettingsFields() {
    const mode = this.els.modeSelect?.value || 'direct';
    if (this.els.slskdFields) {
      this.els.slskdFields.classList.toggle('hidden', mode !== 'slskd');
    }
    if (this.els.directFields) {
      this.els.directFields.classList.toggle('hidden', mode !== 'direct');
    }
  }

  toggleSettings(force) {
    if (!this.els.settings) return;
    const currentlyHidden = this.els.settings.classList.contains('hidden');
    const open = force ?? currentlyHidden;
    this.els.settings.classList.toggle('hidden', !open);
    if (open) this._syncSettingsFields();
  }

  _restoreLocalConfig() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const cfg = JSON.parse(raw);
      // Migrate old default "demo" → prefer direct if no explicit choice with creds
      if (this.els.modeSelect) {
        this.els.modeSelect.value = cfg.mode || 'direct';
      }
      if (this.els.slskdUrl && cfg.slskdUrl) this.els.slskdUrl.value = cfg.slskdUrl;
      if (this.els.slskdKey && cfg.slskdKey) this.els.slskdKey.value = cfg.slskdKey;
      if (this.els.slskUser && cfg.slskUser) this.els.slskUser.value = cfg.slskUser;
      if (this.els.slskPass && cfg.slskPass) this.els.slskPass.value = cfg.slskPass;
      this._syncSettingsFields();
      if ((cfg.mode && cfg.mode !== 'direct') || (cfg.slskUser && cfg.slskPass) || (cfg.slskdUrl && cfg.slskdKey)) {
        this._pushConfig(cfg).catch(() => {});
      }
    } catch {
      /* ignore corrupt storage */
    }
  }

  async _pushConfig(cfg) {
    const res = await fetch('/api/soulseek/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(cfg),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `Config failed (${res.status})`);
    return data;
  }

  async saveConfig() {
    const mode = this.els.modeSelect?.value || 'direct';
    const cfg = { mode };
    if (mode === 'slskd') {
      cfg.slskdUrl = this.els.slskdUrl?.value?.trim() || '';
      cfg.slskdKey = this.els.slskdKey?.value?.trim() || '';
    } else if (mode === 'direct') {
      cfg.slskUser = this.els.slskUser?.value?.trim() || '';
      cfg.slskPass = this.els.slskPass?.value?.trim() || '';
    }
    try {
      this._setStatusLine(mode === 'direct' ? 'Signing in…' : 'Saving connection…');
      const data = await this._pushConfig(cfg);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(cfg));
      this.status = data;
      this._renderBadge();
      this._setStatusLine(data.note || 'Connected.');
      if (data.connected) this.toggleSettings(false);
    } catch (err) {
      this._setStatusLine(err.message || 'Could not save config');
    }
  }

  async clearConfig() {
    try {
      await fetch('/api/soulseek/config', { method: 'DELETE' });
    } catch {
      /* ignore */
    }
    localStorage.removeItem(STORAGE_KEY);
    if (this.els.modeSelect) this.els.modeSelect.value = 'direct';
    if (this.els.slskdUrl) this.els.slskdUrl.value = '';
    if (this.els.slskdKey) this.els.slskdKey.value = '';
    if (this.els.slskUser) this.els.slskUser.value = '';
    if (this.els.slskPass) this.els.slskPass.value = '';
    this._syncSettingsFields();
    await this.refreshStatus();
    this.toggleSettings(true);
    this._setStatusLine('Signed out. Enter your Soulseek login to search.');
  }

  async refreshStatus() {
    try {
      const res = await fetch('/api/soulseek/status');
      if (!res.ok) throw new Error('status ' + res.status);
      this.status = await res.json();
    } catch {
      this.status = {
        mode: 'offline',
        connected: false,
        needsLogin: true,
        note: 'Soulseek bridge unreachable — is the Midio server running?',
      };
    }
    // Keep the Connect panel in sync with the active backend
    if (this.els.modeSelect && this.status.mode && this.status.mode !== 'offline') {
      this.els.modeSelect.value = this.status.mode;
      this._syncSettingsFields();
    }
    this._renderBadge();
    // Open sign-in when not connected (Soulseek default)
    if (this.status.needsLogin || !this.status.connected) {
      this.toggleSettings(true);
    } else {
      this.toggleSettings(false);
    }
    if (this.els.settingsBtn) {
      this.els.settingsBtn.textContent = this.status.connected ? 'Account' : 'Sign in';
    }
    if (this.els.legal) {
      this.els.legal.textContent =
        this.status.mode === 'demo'
          ? 'Demo catalog (free music). Title · Artist · Album · Length. Switch to Soulseek login for the live network.'
          : 'Only download files you have the right to use. Duplicates collapsed — remixes & instrumentals kept once each.';
    }
    if (this.status.needsLogin) {
      this._setStatusLine(this.status.note || 'Sign in with your Soulseek account to search.');
    }
  }

  _renderBadge() {
    const b = this.els.badge;
    if (!b) return;
    const mode = this.status.mode || 'direct';
    const needs = this.status.needsLogin && mode === 'direct';
    b.dataset.mode = needs ? 'needs-login' : mode;
    b.textContent = needs
      ? 'sign in'
      : mode === 'slskd'
        ? 'slskd'
        : mode === 'direct'
          ? 'Soulseek'
          : mode === 'offline'
            ? 'offline'
            : mode === 'demo'
              ? 'demo'
              : mode;
    b.title = this.status.note || '';
  }

  _setStatusLine(msg) {
    if (this.els.statusLine) this.els.statusLine.textContent = msg || '';
    this.onStatus(msg || '');
  }

  _stopPoll() {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  async search(query) {
    const q = String(query || '').trim();
    if (!q) {
      this._setStatusLine('Type a song, artist, or album.');
      return;
    }
    if (this.status.needsLogin || (!this.status.connected && this.status.mode === 'direct')) {
      this.toggleSettings(true);
      this._setStatusLine('Sign in with your Soulseek account first.');
      this.els.slskUser?.focus();
      return;
    }
    if (this.busy) return;
    this.busy = true;
    this._stopPoll();
    this._renderResults([]);
    this._setStatusLine(
      this.status.mode === 'demo'
        ? `Searching free catalog for “${q}”…`
        : `Searching Soulseek for “${q}”…`,
    );
    if (this.els.submit) this.els.submit.disabled = true;

    try {
      const res = await fetch('/api/soulseek/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: q }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `Search failed (${res.status})`);
      this.searchId = data.id;
      await this._pollOnce();
      this.pollTimer = setInterval(() => this._pollOnce(), 1000);
    } catch (err) {
      this._setStatusLine(err.message || 'Search failed');
      this.busy = false;
      if (this.els.submit) this.els.submit.disabled = false;
      if (/sign in|login/i.test(err.message || '')) this.toggleSettings(true);
    }
  }

  async _pollOnce() {
    if (!this.searchId) return;
    try {
      const res = await fetch(`/api/soulseek/search/${encodeURIComponent(this.searchId)}`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Poll failed');
      this._renderResults(data.results || []);
      if (data.status === 'completed') {
        this._stopPoll();
        this.busy = false;
        if (this.els.submit) this.els.submit.disabled = false;
        const n = data.resultCount ?? (data.results || []).length;
        this._setStatusLine(
          n
            ? `${n} unique version${n === 1 ? '' : 's'} · ${data.mode === 'demo' ? 'free catalog' : 'Soulseek'}`
            : 'No audio matches — try a shorter query.',
        );
      } else if (data.status === 'error') {
        this._stopPoll();
        this.busy = false;
        if (this.els.submit) this.els.submit.disabled = false;
        this._setStatusLine(data.error || 'Search error');
        if (/sign in|login/i.test(data.error || '')) this.toggleSettings(true);
      } else {
        const n = (data.results || []).length;
        this._setStatusLine(
          n ? `Listening… ${n} unique so far` : 'Listening on the network…',
        );
      }
    } catch (err) {
      this._stopPoll();
      this.busy = false;
      if (this.els.submit) this.els.submit.disabled = false;
      this._setStatusLine(err.message || 'Search failed');
    }
  }

  _renderResults(results) {
    const list = this.els.results;
    if (!list) return;
    list.innerHTML = '';
    if (this.els.empty) {
      this.els.empty.classList.toggle('hidden', results.length > 0);
    }
    for (const item of results) {
      list.appendChild(this._resultRow(item));
    }
  }

  _resultRow(item) {
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'slskResult';
    row.title = item.filename || '';

    const title = item.title || basename(item.filename) || 'Untitled';
    const artist = item.artist || 'Unknown artist';
    const album = item.album || '—';
    const length =
      item.lengthLabel ||
      (item.lengthSec ? formatLength(item.lengthSec) : '—');

    row.innerHTML = `
      <span class="slskResultIcon" aria-hidden="true">${item.ext === 'mid' || item.ext === 'midi' ? '🎹' : '♪'}</span>
      <span class="slskResultBody">
        <span class="slskResultTitle"></span>
        <span class="slskResultFields">
          <span class="slskFieldLine"><span class="slskFieldLabel">Artist</span><span class="slskFieldValue slskArtist"></span></span>
          <span class="slskFieldLine"><span class="slskFieldLabel">Album</span><span class="slskFieldValue slskAlbum"></span></span>
          <span class="slskFieldLine"><span class="slskFieldLabel">Length</span><span class="slskFieldValue slskLength"></span></span>
        </span>
        <span class="slskResultMeta"></span>
      </span>
      <span class="slskResultAction">Play</span>
    `;
    row.querySelector('.slskResultTitle').textContent = title;
    row.querySelector('.slskArtist').textContent = artist;
    row.querySelector('.slskAlbum').textContent = album;
    row.querySelector('.slskLength').textContent = length;

    const meta = [];
    if (item.versionLabel) meta.push(item.versionLabel);
    if (item.ext) meta.push(String(item.ext).toUpperCase());
    if (item.bitrate) meta.push(`${item.bitrate} kbps`);
    if (item.sizeLabel) meta.push(item.sizeLabel);
    if (item.user && item.source !== 'demo') meta.push(item.user);
    if (item.slots === false) meta.push('queued');
    row.querySelector('.slskResultMeta').textContent = meta.join(' · ');

    row.addEventListener('click', () => this.play(item, row));
    return row;
  }

  async play(item, row) {
    if (this.busy) return;
    this.busy = true;
    if (row) {
      row.classList.add('loading');
      const act = row.querySelector('.slskResultAction');
      if (act) act.textContent = '…';
    }
    this._setStatusLine(`Fetching “${item.title || item.filename}”…`);

    try {
      const res = await fetch('/api/soulseek/download', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ item }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `Download failed (${res.status})`);
      }
      const buf = await res.arrayBuffer();
      const name =
        decodeURIComponent(res.headers.get('X-Filename') || '') ||
        item.filename ||
        'track.mp3';
      const type = res.headers.get('Content-Type') || guessMime(name);
      const file = new File([buf], basename(name), { type });
      this._setStatusLine(`Loading “${file.name}” into Midio…`);
      this.onFiles([file]);
    } catch (err) {
      this._setStatusLine(err.message || 'Download failed');
      this.busy = false;
      if (row) {
        row.classList.remove('loading');
        const act = row.querySelector('.slskResultAction');
        if (act) act.textContent = 'Play';
      }
    }
  }

  resetBusy() {
    this.busy = false;
    if (this.els.submit) this.els.submit.disabled = false;
  }

  destroy() {
    this._stopPoll();
  }
}

function basename(p) {
  if (!p) return 'track';
  const parts = String(p).replace(/\\/g, '/').split('/');
  return parts[parts.length - 1] || p;
}

function formatLength(sec) {
  const s = Math.round(Number(sec) || 0);
  if (s <= 0) return '—';
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${String(r).padStart(2, '0')}`;
}

function guessMime(name) {
  const ext = (name.match(/\.([^.]+)$/) || [, ''])[1].toLowerCase();
  return (
    {
      mp3: 'audio/mpeg',
      flac: 'audio/flac',
      wav: 'audio/wav',
      ogg: 'audio/ogg',
      m4a: 'audio/mp4',
      mid: 'audio/midi',
      midi: 'audio/midi',
    }[ext] || 'application/octet-stream'
  );
}
