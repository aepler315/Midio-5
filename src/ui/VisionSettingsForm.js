// Controller for the vision-provider settings <details> form in the loader.
// Binds the provider select + key/baseUrl/model inputs to VisionSettings,
// debounces saves, and refreshes baseUrl/model placeholders on provider
// change without clobbering anything the user already typed. Subscribes to
// external saves so two tabs stay consistent.
import { resolveSettings, saveVisionSettings, subscribe } from '../vision/VisionSettings.js';
import { getProvider, PROVIDER_IDS } from '../vision/providers/index.js';

export class VisionSettingsForm {
  constructor(root) {
    if (!root) return;
    this.root = root;
    this.providerEl = root.querySelector('#visionProvider');
    this.apiKeyEl = root.querySelector('#visionApiKey');
    this.baseUrlEl = root.querySelector('#visionBaseUrl');
    this.modelEl = root.querySelector('#visionModel');
    this.savedHintEl = root.querySelector('#visionSavedHint');

    this._populateProviderOptions();
    this._apply(resolveSettings());

    this._saveTimer = null;
    const save = () => this._scheduleSave();
    this.providerEl.addEventListener('change', () => {
      // Refresh placeholders for the new provider, but keep user-typed values.
      this._refreshPlaceholders();
      save();
    });
    [this.apiKeyEl, this.baseUrlEl, this.modelEl].forEach((el) => {
      el.addEventListener('input', save);
    });

    this._unsub = subscribe((resolved) => this._apply(resolved));
  }

  _populateProviderOptions() {
    for (const id of PROVIDER_IDS) {
      const a = getProvider(id);
      const opt = document.createElement('option');
      opt.value = id;
      opt.textContent = a.label;
      this.providerEl.appendChild(opt);
    }
  }

  // Reflect resolved settings into the form. Don't overwrite fields the user
  // is actively editing (comparing against the current value guards focus).
  _apply(resolved) {
    if (document.activeElement !== this.providerEl) this.providerEl.value = resolved.provider;
    if (document.activeElement !== this.apiKeyEl) this.apiKeyEl.value = resolved.apiKey;
    // baseUrl/model: only show the adapter default if the user left it blank.
    if (document.activeElement !== this.baseUrlEl) this.baseUrlEl.value = resolved.adapter && resolved.baseUrl === resolved.adapter.defaultBaseUrl ? '' : resolved.baseUrl;
    if (document.activeElement !== this.modelEl) this.modelEl.value = resolved.adapter && resolved.model === resolved.adapter.defaultModel ? '' : resolved.model;
    this._refreshPlaceholders();
    this._refreshKeyVisibility();
  }

  _refreshPlaceholders() {
    const a = getProvider(this.providerEl.value);
    this.baseUrlEl.placeholder = a.defaultBaseUrl;
    this.modelEl.placeholder = a.defaultModel;
    this.apiKeyEl.placeholder = a.needsKey ? 'required — paste API key' : 'not needed for local Ollama';
  }

  _refreshKeyVisibility() {
    const a = getProvider(this.providerEl.value);
    this.apiKeyEl.disabled = !a.needsKey;
    this.apiKeyEl.parentElement.classList.toggle('disabled', !a.needsKey);
  }

  _scheduleSave() {
    if (this._saveTimer) clearTimeout(this._saveTimer);
    this._saveTimer = setTimeout(() => {
      // Save only provider + apiKey + the raw field text; resolveSettings()
      // fills blank baseUrl/model from defaults, so persist blanks, not the
      // placeholder text.
      saveVisionSettings({
        provider: this.providerEl.value,
        apiKey: this.apiKeyEl.value.trim(),
        baseUrl: this.baseUrlEl.value.trim(),
        model: this.modelEl.value.trim(),
      });
      if (this.savedHintEl) {
        this.savedHintEl.textContent = 'saved';
        clearTimeout(this._hintTimer);
        this._hintTimer = setTimeout(() => { this.savedHintEl.textContent = ''; }, 1200);
      }
    }, 300);
  }

  destroy() {
    if (this._unsub) this._unsub();
  }
}