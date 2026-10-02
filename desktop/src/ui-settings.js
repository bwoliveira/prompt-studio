// ---------------------------------------------------------------------------
// Preferences (target, AI mode, Settings) in ctx.storage (keys live under hermes.plugin.prompt-studio.),
// and the Settings dialog with its model pickers.
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

// AI help mode: 'off' | 'manual' (button per question) | 'auto' (asks on every question).
const AI_MODES = ['auto', 'manual', 'off']
const $target = atom(null)
const $aiMode = atom('auto')

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

function SettingsButton() {
  const t = useT()
  return jsx(Button, {
    ariaLabel: t('settings.button'),
    data: { 'data-studio-settings': true, 'aria-haspopup': 'dialog' },
    onClick: () => $settingsOpen.set(!$settingsOpen.get()),
    keyHint: SHORTCUTS.settings,
    title: t('settings.button'),
    children: jsx(Codicon, { name: 'settings-gear' })
  })
}

function choiceLabel(value, inherit) {
  if (!value.model.trim()) return inherit
  const base = value.provider.trim() ? `${value.provider}: ${value.model}` : value.model
  return value.effort.trim() ? `${base} · ${reasoningEffortLabel(value.effort)}` : base
}

// Detached model picker, the same controller pattern as the kanban task override: the SDK menu edits a
// value held here, and Hermes' own presets are only read, never rewritten.
// A model catalog that fails to render must not take the Studio down: the picker keeps its value.
class CatalogBoundary extends Component {
  constructor(props) { super(props); this.state = { failed: false } }
  static getDerivedStateFromError() { return { failed: true } }
  componentDidCatch() { /* the picker stays on its current value (default when empty) */ }
  render() { return this.state.failed ? null : this.props.children }
}

function ModelPicker({ which, inherit }) {
  const t = useT()
  const value = useValue(which === 'helper' ? $helperModel : $contextModel)
  const [open, setOpen] = useState(false)
  const onChange = next => setChoice(which, next)
  const controller = {
    applyPreset: (preset, row) => onChange({ effort: preset.effort ?? '', model: row.model, provider: row.provider }),
    current: { effort: value.effort, fast: false, model: value.model, provider: value.provider },
    presetFor: () => ({}),
    select: (model, provider) => onChange({ ...value, model, provider }),
    setOptions: (patch, row) => {
      if (patch.effort === undefined) return
      onChange({ effort: patch.effort, model: row.model, provider: row.provider })
    }
  }
  const set = Boolean(value.model.trim())
  return jsxs('div', {
    'data-studio-model-picker': which,
    style: { alignItems: 'center', display: 'flex', gap: '6px', minWidth: 0 },
    children: [
      jsxs(DropdownMenu, {
        onOpenChange: setOpen,
        open,
        children: [
          jsx(DropdownMenuTrigger, {
            asChild: true,
            children: jsxs('button', {
              style: { ...typeStyle, alignItems: 'center', background: 'transparent', border: '1px solid var(--ui-stroke-secondary)', borderRadius: '6px', color: set ? 'var(--ui-text-primary, inherit)' : 'var(--ui-text-secondary)', cursor: 'pointer', display: 'flex', flex: 1, fontSize: '12px', gap: '6px', justifyContent: 'space-between', minHeight: '28px', minWidth: 0, padding: '2px 8px' },
              type: 'button',
              children: [
                jsx('span', { style: { minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }, children: choiceLabel(value, inherit) }),
                jsx(Codicon, { name: 'chevron-down' })
              ]
            })
          }),
          jsx(DropdownMenuContent, {
            align: 'start',
            className: 'w-72 p-0',
            children: jsx(CatalogBoundary, { children: jsx(ModelMenuCloseContext.Provider, { value: () => setOpen(false), children: jsx(ModelCatalogMenu, { controller }) }) })
          })
        ]
      }),
      set
        ? jsx('button', {
            'aria-label': t('settings.clear'),
            'data-studio-model-clear': true,
            onClick: () => onChange(EMPTY_CHOICE),
            style: { ...typeStyle, background: 'transparent', border: '1px solid var(--ui-stroke-secondary)', borderRadius: '6px', cursor: 'pointer', fontSize: '12px', minHeight: '28px', padding: '2px 8px' },
            title: t('settings.clear'),
            type: 'button',
            children: jsx(Codicon, { name: 'close' })
          })
        : null
    ]
  })
}


// Built-in stand-ins for the SDK settings rows, used when the Desktop SDK lacks them (Hermes < 0.21.5).
// Same props the Settings dialog passes to the SDK originals (apps/desktop/src/app/settings/primitives.tsx):
// label + description with the control beside it; the toggle is a real <button role="switch">, so it
// is focusable and Space/Enter toggle it natively, and aria-label names it like the SDK Switch.
function LocalListRow({ title, description, action }) {
  return jsxs('div', {
    'data-studio-list-row': true,
    style: { alignItems: 'center', columnGap: '12px', display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) auto', padding: '12px 0' },
    children: [
      jsxs('div', {
        style: { minWidth: 0 },
        children: [
          jsx('div', { style: { color: 'var(--ui-text-primary, inherit)', fontSize: 'var(--conversation-text-font-size, 13px)', fontWeight: 500 }, children: title }),
          description ? jsx('div', { style: { color: 'var(--ui-text-tertiary, inherit)', fontSize: 'var(--conversation-caption-font-size, 12px)', marginTop: '4px' }, children: description }) : null
        ]
      }),
      action ? jsx('div', { style: { alignItems: 'center', display: 'flex', flexWrap: 'wrap', gap: '8px', justifyContent: 'flex-end', minWidth: 0 }, children: action }) : null
    ]
  })
}
function LocalToggleRow({ checked, description, disabled, label, onChange }) {
  const on = Boolean(checked)
  return jsx(ListRow, {
    title: label,
    description,
    action: jsx('button', {
      'aria-checked': on,
      'aria-label': label,
      'data-state': on ? 'checked' : 'unchecked',
      disabled,
      onClick: () => onChange(!on),
      role: 'switch',
      type: 'button',
      style: { background: on ? 'var(--dt-primary)' : 'var(--ui-stroke-secondary)', border: '1px solid var(--ui-stroke-secondary)', borderRadius: '999px', cursor: disabled ? 'default' : 'pointer', flexShrink: 0, height: '18px', padding: '2px', position: 'relative', width: '32px' },
      children: jsx('span', { 'aria-hidden': true, style: { background: 'var(--dt-primary-foreground)', borderRadius: '999px', display: 'block', height: '14px', transform: on ? 'translateX(14px)' : 'none', transition: 'transform 120ms', width: '14px' } })
    })
  })
}
const ListRow = hermesSdk.ListRow ?? LocalListRow
const ToggleRow = hermesSdk.ToggleRow ?? LocalToggleRow

function SettingsDialog() {
  const t = useT()
  const open = useValue($settingsOpen)
  const readContext = useValue($readContext)
  const language = useValue($language)
  const helperSet = Boolean(useValue($helperModel).model.trim())
  return jsx(Dialog, {
    onOpenChange: next => $settingsOpen.set(Boolean(next)),
    open,
    children: jsxs(DialogContent, {
      'data-studio-settings-dialog': true,
      children: [
        jsx(DialogHeader, { children: jsx(DialogTitle, { children: t('settings.title') }) }),
        jsx(ListRow, { title: t('settings.helper'), description: t('settings.helperDescription'), action: jsx(ModelPicker, { which: 'helper', inherit: t('settings.helperInherit') }) }),
        jsx(ListRow, { title: t('settings.context'), description: t('settings.contextDescription'), action: jsx(ModelPicker, { which: 'context', inherit: helperSet ? t('settings.contextInherit') : t('settings.contextInheritDefault') }) }),
        jsx('div', { 'data-studio-read-context': true, children: jsx(ToggleRow, { checked: readContext, description: t('settings.readContextDescription'), label: t('settings.readContext'), onChange: setReadContext }) }),
        jsx(ListRow, {
          title: t('settings.language'),
          action: jsx('div', {
            'data-studio-language': true,
            children: jsxs(Select, {
              onValueChange: setLanguage,
              value: language,
              children: [
                jsx(SelectTrigger, { children: jsx(SelectValue, {}) }),
                jsxs(SelectContent, {
                  children: [
                    jsx(SelectItem, { value: 'auto', children: t('settings.languageAuto') }),
                    jsx(SelectItem, { value: 'pt', children: t('settings.languagePt') }),
                    jsx(SelectItem, { value: 'en', children: t('settings.languageEn') })
                  ]
                })
              ]
            })
          })
        }),
        jsx(DialogFooter, { children: jsx(Button, { data: { 'data-studio-settings-close': true }, onClick: () => $settingsOpen.set(false), children: t('settings.close') }) })
      ]
    })
  })
}
