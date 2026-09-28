// ---------------------------------------------------------------------------
// Preferences (target, AI mode) in ctx.storage (keys live under hermes.plugin.prompt-studio.).
// ---------------------------------------------------------------------------
const PREF_TARGET = 'target'
const PREF_AI_MODE = 'aiMode'
// Settings (CX-1): model choices are {provider, model, effort}; an empty model means "use the Hermes config".
const PREF_HELPER_MODEL = 'helperModel'
const PREF_CONTEXT_MODEL = 'contextModel'
const PREF_READ_CONTEXT = 'readContext'
const PREF_LANGUAGE = 'language'
const EMPTY_CHOICE = { provider: '', model: '', effort: '' }
const $helperModel = atom(EMPTY_CHOICE)
const $contextModel = atom(EMPTY_CHOICE)
const $readContext = atom(true)
const $settingsOpen = atom(false)
// Session context read on opening: null | { status: 'reading'|'ready'|'error', summary, model, ms, reason }
const $context = atom(null)
let contextPromise = null
let contextSerial = 0
// AI help mode: 'off' | 'manual' (button per question) | 'auto' (asks on every question).
const AI_MODES = ['auto', 'manual', 'off']
const $target = atom(null)
const $aiMode = atom('auto')
// Shortcut list open or closed (F1).
const $helpOpen = atom(false)
// Current suggestion: { key, mode: 'suggest'|'improve', status: 'loading'|'ready'|'error'|'dismissed',
//   value, reason, agrees, errorKey, detail, model, latency }
const $suggestion = atom(null)
// Finished suggestions by question key, so Back / reopening a question does not call the model again.
const suggestionCache = new Map()
let suggestSerial = 0

function readPref(key, fallback) {
  try { return pluginContext?.storage?.get(key, fallback) ?? fallback } catch { return fallback }
}

function writePref(key, value) {
  try { pluginContext?.storage?.set(key, value) } catch { /* in-memory only */ }
}

function readAiMode() {
  const raw = readPref(PREF_AI_MODE, 'auto')
  return AI_MODES.includes(raw) ? raw : 'auto'
}

function readChoice(key) {
  const raw = readPref(key, null)
  if (!raw || typeof raw !== 'object') return EMPTY_CHOICE
  return { provider: String(raw.provider || ''), model: String(raw.model || ''), effort: String(raw.effort || '') }
}

function loadSettings() {
  $helperModel.set(readChoice(PREF_HELPER_MODEL))
  $contextModel.set(readChoice(PREF_CONTEXT_MODEL))
  $readContext.set(readPref(PREF_READ_CONTEXT, true) !== false)
  const language = readPref(PREF_LANGUAGE, 'auto')
  $language.set(LANGUAGES.includes(language) ? language : 'auto')
}

function setChoice(which, value) {
  const choice = { provider: String(value?.provider || ''), model: String(value?.model || ''), effort: String(value?.effort || '') }
  ;(which === 'helper' ? $helperModel : $contextModel).set(choice)
  writePref(which === 'helper' ? PREF_HELPER_MODEL : PREF_CONTEXT_MODEL, choice)
}

function setReadContext(on) {
  $readContext.set(Boolean(on))
  writePref(PREF_READ_CONTEXT, Boolean(on))
}

function setLanguage(language) {
  if (!LANGUAGES.includes(language)) return
  $language.set(language)
  writePref(PREF_LANGUAGE, language)
}

// model_choice for the backend, or null when nothing is chosen (Hermes config).
function choiceOf(value) {
  return value?.model?.trim() ? { provider: value.provider, model: value.model, effort: value.effort } : null
}
const helperChoice = () => choiceOf($helperModel.get())
// Empty context model = the helper's choice (which may itself be empty = config).
const contextChoice = () => choiceOf($contextModel.get()) || helperChoice()

function currentTarget() {
  let target = $target.get()
  if (!target) {
    target = readPref(PREF_TARGET, null)
    if (!TARGETS.some(item => item.id === target)) target = defaultTarget(host.state.model?.get?.())
    $target.set(target)
  }
  return target
}

// Identity of "this question with these answers before it": a suggestion for it stays valid
// until the target, the field or any earlier answer changes.
function questionKey(state) {
  if (!state.current) return ''
  const before = state.ladder.map(rung => `${rung.category}=${rung.answer}`).join('\u241E')
  return `${currentTarget()}|${state.current.category}|${state.intent.length}|${before}`
}

function clearSuggestion() {
  cancelAutoSuggestion()
  suggestSerial += 1
  $suggestion.set(null)
}

// Auto mode waits a moment before asking (SP-2): the plugin REST door cannot abort a call, so
// clicking through steps quickly would otherwise queue one backend request per step. Leaving the
// step (clearSuggestion) or scheduling again cancels the pending ask; manual asks stay immediate.
const AUTO_SUGGEST_DELAY_MS = 400
let autoSuggestTimer = null

function cancelAutoSuggestion() {
  if (autoSuggestTimer !== null) autoSuggestTimer()
  autoSuggestTimer = null
}

function scheduleAutoSuggestion() {
  cancelAutoSuggestion()
  const key = questionKey($studio.get())
  const delay = globalThis.__promptStudioAutoSuggestDelayMs ?? AUTO_SUGGEST_DELAY_MS
  const serial = suggestSerial
  autoSuggestTimer = later(async () => {
    autoSuggestTimer = null
    // A pending session context read comes first (it has its own deadline); manual asks never wait.
    if (contextPromise) await contextPromise
    const state = $studio.get()
    if (serial !== suggestSerial || $aiMode.get() !== 'auto' || state.status !== 'active' || questionKey(state) !== key) return
    requestSuggestion()
  }, delay)
}

// Show the cached suggestion for the current question, or ask for one when the mode is automatic.
function refreshSuggestion() {
  const state = $studio.get()
  const mode = $aiMode.get()
  if (state.status !== 'active' || !state.current || mode === 'off') return
  const cached = suggestionCache.get(questionKey(state))
  if (cached) {
    $suggestion.set(cached)
    return
  }
  if (mode === 'auto' && state.current.autoSuggest !== false) scheduleAutoSuggestion()
}

function setTarget(target) {
  if (!TARGETS.some(item => item.id === target) || target === currentTarget()) return
  $target.set(target)
  writePref(PREF_TARGET, target)
  if ($studio.get().editing) update({ type: 'CANCEL_EDIT' })
  const state = $studio.get()
  if (!['active', 'done', 'asking'].includes(state.status)) return
  // Keep answers that still apply to the new target; ask the rest again.
  const seen = new Set()
  const ladder = state.ladder.filter(rung => {
    const ok = fieldForTarget(rung.category, target) && !seen.has(rung.category) && answerToValue(rung.category, rung.answer, target) !== undefined
    seen.add(rung.category)
    return ok
  })
  clearSuggestion()
  update({ type: 'RETARGET', ladder })
  askNext()
}

function setAiMode(mode) {
  if (!AI_MODES.includes(mode) || mode === $aiMode.get()) return
  $aiMode.set(mode)
  writePref(PREF_AI_MODE, mode)
  if (mode === 'off') clearSuggestion()
  else refreshSuggestion()
}

