// ---------------------------------------------------------------------------
// i18n: bundles live in desktop/src/i18n-ui.js (inlined above between @ui-i18n markers).
// React components use usePluginI18n(ID); code outside React uses tr() -> ctx.i18n.t.
// ---------------------------------------------------------------------------
function resolveMessage(bundle, key, args) {
  let value = bundle
  for (const part of key.split('.')) value = value?.[part]
  if (typeof value === 'function') return value(...args)
  return typeof value === 'string' ? value : null
}

// Studio language (settings): 'auto' follows Hermes; 'pt' / 'en' use that bundle for every Studio string,
// the questions (through localeOf) and the `locale` sent to the backend.
const LANGUAGES = ['auto', 'pt', 'en']
const $language = atom('auto')

function fixedT(language) {
  return (key, ...args) => resolveMessage(UI_MESSAGES[language], key, args) ?? resolveMessage(UI_MESSAGES.en, key, args) ?? key
}

function tr(key, ...args) {
  const language = $language.get()
  if (language !== 'auto') return fixedT(language)(key, ...args)
  const t = lifecycle.pluginContext?.i18n?.t
  if (t) return t(key, ...args)
  return resolveMessage(UI_MESSAGES.en, key, args) ?? key
}

// usePluginI18n(ID), overridden by the Studio language when it is not 'auto'.
function useT() {
  const hermesT = usePluginI18n(ID)
  const language = useValue($language)
  return language === 'auto' ? hermesT : fixedT(language)
}

// The app decides the language; the bundle tells which one resolved ('en' is the fallback).
function localeOf(t) {
  return t('locale') === 'pt' ? 'pt' : 'en'
}

function activeLocale() {
  return localeOf(tr)
}

// Skipped-answer marker. The v1 core exports SKIPPED ('(skipped)') and still reads '(pulado)';
// an older core only knows '(pulado)'.
// eslint-disable-next-line no-undef
const SKIP_MARK = typeof SKIPPED === 'string' ? SKIPPED : '(pulado)'
function isSkipped(answer) {
  return answer === SKIP_MARK || answer === '(skipped)' || answer === '(pulado)'
}

// The composer is reached only through the SDK's host.composer (Hermes Desktop 0.21.5+): no app DOM.
// `null` addresses the composer the user is typing in. Attachments are not readable through the SDK;
// setDraft replaces only the text, so staged attachments stay in the composer.
const composerAdapter = {
  available() {
    return typeof host.composer?.getDraft === 'function' && typeof host.composer?.setDraft === 'function'
  },

  // null = no composer answered (none is active) or the call failed; '' = an empty composer.
  async readDraft(address = null) {
    if (!this.available()) return null
    try {
      const text = await host.composer.getDraft(address)
      return typeof text === 'string' ? text : null
    } catch {
      return null
    }
  },

  // sessionId null = the composer in use; a session id = that session's composer (false when not mounted).
  // Appends to the composer in use (a paragraph after what is there): never replaces someone's draft.
  appendDraft(text) {
    return this.serial(async () => {
      if (typeof host.composer?.insertText !== 'function') return false
      try {
        return (await host.composer.insertText(null, text, { mode: 'block' })) === true
      } catch {
        return false
      }
    })
  },

  async writeDraft(text, sessionId = null) {
    if (!this.available()) return false
    try {
      return (await host.composer.setDraft(sessionId, text)) === true
    } catch {
      return false
    }
  },

  // Puts text into a conversation's composer without ever losing what is there: an empty composer gets the
  // text, one that already holds other text gets it appended below. False when that composer is not on screen.
  // Serialized with appendDraft so a dispose restore cannot race another plugin placement.
  // The host can still receive typing during an await: only its append operation is safe for placement.
  placeDraft(text, address) {
    return this.serial(() => this.placeNow(text, address))
  },

  queue: Promise.resolve(),
  serial(task) {
    const run = this.queue.then(task, task)
    this.queue = run.then(() => undefined, () => undefined)
    return run
  },

  async placeNow(text, address) {
    if (!this.available() || !String(text || '').trim()) return false
    let current = null
    try {
      current = await host.composer.getDraft(address)
    } catch {
      current = null
    }
    // An equal draft needs no mutation. Even an empty read can be stale before the asynchronous write:
    // append against the host's live draft, never replace text typed while the request was pending.
    const existing = typeof current === 'string' ? current.trim() : null
    if (existing === text.trim()) return true
    if (typeof host.composer.insertText !== 'function') return false
    try {
      return (await host.composer.insertText(address, text, { mode: 'block' })) === true
    } catch {
      return false
    }
  }
}

function update(action) {
  if ($placing.get() && action.type !== 'RESET') return
  $studio.set(reduceStudio($studio.get(), action))
}

