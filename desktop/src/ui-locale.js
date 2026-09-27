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
  const t = pluginContext?.i18n?.t
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

// This is the only module that selects or imperatively writes app-owned DOM.
// Selector provenance is documented in docs/DESKTOP-DEV.md.
const composerAdapter = {
  getRoot() {
    // index.tsx:1243-1277 creates the root; :1313-1326 distinguishes the live composer from its fallback root.
    return document.querySelector('[data-slot="composer-root"]:has([data-slot="composer-surface"])')
  },

  getInput() {
    const root = this.getRoot()
    if (!root) return null
    // rich-editor.ts:22 defines this slot; index.tsx:1053-1113 renders the visible contenteditable editor.
    return root.querySelector('[data-slot="composer-surface"] [data-slot="composer-rich-input"][role="textbox"]')
      // Legacy-compatible textarea path. index.tsx:1130-1140's aria-hidden textarea is deliberately excluded.
      || root.querySelector('[data-slot="composer-surface"] textarea:not([aria-hidden])')
  },

  readDraft() {
    const input = this.getInput()
    if (!input) return ''
    return input instanceof HTMLTextAreaElement ? input.value : input.textContent || ''
  },

  // `focus: false` clears the composer without moving the focus there (opening the studio).
  writeDraft(text, { focus = true } = {}) {
    const input = this.getInput()
    if (!input) return false
    if (input instanceof HTMLTextAreaElement) {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set
      if (!setter) return false
      setter.call(input, text)
    } else {
      input.textContent = text
    }
    input.dispatchEvent(new Event('input', { bubbles: true }))
    if (focus) this.focusComposer()
    return true
  },

  readAttachments() {
    const attachmentState = host.state?.composerAttachments?.get?.() ?? globalThis.__HERMES_PLUGIN_SDK__?.$composerAttachments?.get?.()
    if (Array.isArray(attachmentState)) return attachmentState
    const root = this.getRoot() || document
    return [...root.querySelectorAll('[data-slot="composer-attachments"] [data-attachment], [data-slot="composer-attachments"] > *')]
      .map((element, index) => {
        const image = element.querySelector?.('img')
        const name = element.getAttribute?.('data-name') || image?.getAttribute('alt') || element.textContent?.trim() || `Attachment ${index + 1}`
        return {
          id: element.getAttribute?.('data-id') || `${name}-${index}`,
          kind: image ? 'image' : 'file',
          name,
          data_url: image?.getAttribute('src') || undefined,
          path: element.getAttribute?.('data-path') || undefined,
          size: Number(element.getAttribute?.('data-size')) || undefined
        }
      })
  },

  forwardAttachments(attachments) {
    const payload = Array.isArray(attachments) ? attachments : []
    const attachmentState = host.state?.composerAttachments ?? globalThis.__HERMES_PLUGIN_SDK__?.$composerAttachments
    if (attachmentState?.set) attachmentState.set(payload)
    return payload
  },

  focusComposer() {
    const input = this.getInput()
    if (!(input instanceof HTMLElement)) return false
    input.focus()
    if (input.isContentEditable) {
      const range = document.createRange()
      range.selectNodeContents(input)
      range.collapse(false)
      const selection = window.getSelection()
      selection?.removeAllRanges()
      selection?.addRange(range)
    }
    return true
  }
}

function update(action) {
  $studio.set(reduceStudio($studio.get(), action))
}

