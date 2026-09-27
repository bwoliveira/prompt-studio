// ---------------------------------------------------------------------------
// UI
// ---------------------------------------------------------------------------
const typeStyle = { color: 'var(--ui-text-secondary)', fontFamily: 'var(--dt-font-sans, inherit)' }
const INPUT_LINE = 'var(--ui-stroke-secondary)'
const INPUT_LINE_FOCUS = 'var(--ui-accent)'
const visuallyHidden = { border: 0, clip: 'rect(0 0 0 0)', height: '1px', margin: '-1px', overflow: 'hidden', padding: 0, position: 'absolute', whiteSpace: 'nowrap', width: '1px' }
const QUESTION_TEXT_ID = 'prompt-studio-question-text'
const QUESTION_HELP_ID = 'prompt-studio-question-help'

// Keyboard: every studio control has a key, and the key is printed on the control itself.
// F4 opens the studio from the composer; everything else lives on the buttons: a button with a
// `keyHint` is the one that key presses, so what is shown is always what runs. SHORTCUT_MAP is the
// full list (F1 shows it). Tab, Enter and Esc are never taken: they stay the app's.
// Conflicts checked: Hermes Desktop binds none of these (it uses Ctrl/Ctrl+Shift/Ctrl+Alt chords,
// Alt+Space, Alt+Right, F12, Shift+F10); Cinnamon binds only Alt/Ctrl+Alt/Super+F-keys and
// Alt+Space/Tab/`/Print. F-keys with any modifier and Ctrl/Super chords are never taken. Capture
// phase, so the keys also work with the cursor in the answer field.
const OPEN_KEY = 'F4'
const HELP_KEY = 'F1'
const SETTINGS_KEY = 'F3'
const SHORTCUT_MAP = [
  [OPEN_KEY, 'open'],
  [HELP_KEY, 'help'],
  [SETTINGS_KEY, 'settings'],
  ['F5', 'accept'],
  ['F6', 'skip'],
  ['F7', 'useAi'],
  ['F8', 'back'],
  ['F9', 'generate'],
  ['F10', 'close'],
  ['Alt+1…9', 'pick'],
  ['Alt+Shift+1…9', 'edit'],
  ['Alt+S', 'ask'],
  ['Alt+N', 'another'],
  ['Alt+D', 'discard'],
  ['Alt+M', 'improve'],
  ['Alt+C', 'paste'],
  ['Alt+O / Alt+A', 'model'],
  ['Alt+I', 'mode'],
  ['Alt+V', 'version'],
  ['Alt+E', 'editPrompt']
]
// While open these are always swallowed, even when no control shows them right now: F5 would
// otherwise reach the window (reload in some Electron setups).
const STUDIO_FKEYS = /^F(5|6|7|8|9|10)$/

function keyCombo(event) {
  if (event.ctrlKey || event.metaKey) return ''
  if (/^F([1-9]|1[0-2])$/.test(event.key)) return event.altKey || event.shiftKey ? '' : event.key
  if (!event.altKey) return ''
  const letter = /^Key([A-Z])$/.exec(event.code || '')
  if (letter) return event.shiftKey ? '' : `Alt+${letter[1]}`
  const digit = /^Digit([1-9])$/.exec(event.code || '')
  if (digit) return `${event.shiftKey ? 'Alt+Shift+' : 'Alt+'}${digit[1]}`
  return ''
}

function shortcutTarget(root, combo) {
  for (const el of root.querySelectorAll('[data-studio-shortcut]')) {
    if (el.getAttribute('data-studio-shortcut') === combo && !el.disabled) return el
  }
  return null
}

// Installed once at register time through ctx.addEventListener, so the host removes it on
// dispose, on hot reload and when register() fails half way. While the studio is closed only F4
// is looked at (and only when the composer is on screen); while it is open, only combos printed
// on a visible control, plus F5-F10 swallowed.
function installStudioKeys(ctx) {
  if (typeof window === 'undefined' || !ctx?.addEventListener) return
  const onKey = event => {
    // IME composition (CJK, dead keys) owns the keyboard until it ends.
    if (event.isComposing || event.keyCode === 229) return
    const combo = keyCombo(event)
    if (!combo) return
    const open = $studio.get().status !== 'idle'
    let target = null
    if (open) {
      const root = document.querySelector('[data-studio-strip]')
      target = root && shortcutTarget(root, combo)
    } else if (combo === OPEN_KEY) {
      target = document.querySelector('[data-studio-open]')
    }
    if (!target && !(open && STUDIO_FKEYS.test(combo))) return
    event.preventDefault()
    event.stopPropagation()
    if (target && !event.repeat) target.click()
  }
  ctx.addEventListener(window, 'keydown', onKey, true)
}

// The key, drawn with the SDK's themed Kbd. On the primary (accent) button the `inverted`
// variant tints from currentColor, so the cap has its own background and full opacity.
// `reserved` renders an invisible cap that only holds the width (no layout jump when a key
// moves between buttons).
function KeyCap({ combo, primary, reserved }) {
  return jsx(Kbd, {
    'aria-hidden': true,
    ...(reserved ? { 'data-studio-key-reserved': combo } : { 'data-studio-key': combo }),
    'data-variant': primary ? 'inverted' : 'default',
    size: 'sm',
    variant: primary ? 'inverted' : 'default',
    style: { marginLeft: '6px', verticalAlign: '1px', visibility: reserved ? 'hidden' : undefined, whiteSpace: 'nowrap' },
    children: combo
  })
}

function keyProps(t, keyHint, title) {
  if (!keyHint) return { title }
  return { 'aria-keyshortcuts': keyHint, 'data-studio-shortcut': keyHint, title: [title, t('keys.shortcut', keyHint)].filter(Boolean).join(' · ') }
}

function Button({ children, onClick, variant = 'default', disabled = false, title, data, keyHint, reserveKey, ariaLabel }) {
  const t = useT()
  const primary = variant === 'primary'
  const accent = variant === 'accent'
  const live = keyHint && !disabled ? keyHint : undefined
  const reserved = !live ? reserveKey : undefined
  return jsx('button', {
    ...(data || {}),
    'aria-label': ariaLabel,
    disabled,
    onClick: event => {
      event.preventDefault()
      event.stopPropagation()
      if (!disabled) onClick?.()
    },
    onMouseDown: event => event.preventDefault(),
    style: {
      ...typeStyle,
      alignItems: 'center',
      background: primary ? 'var(--dt-primary)' : 'transparent',
      border: `1px solid ${primary ? 'var(--dt-primary)' : accent ? 'var(--ui-accent)' : 'var(--ui-stroke-secondary)'}`,
      borderRadius: '6px',
      color: primary ? 'var(--dt-primary-foreground)' : accent ? 'var(--ui-text-primary, inherit)' : 'var(--ui-text-secondary)',
      cursor: disabled ? 'default' : 'pointer',
      display: 'inline-flex',
      fontSize: '12px',
      fontWeight: primary ? 600 : 400,
      lineHeight: '16px',
      minHeight: '24px',
      opacity: disabled ? 0.45 : 1,
      padding: '3px 9px',
      whiteSpace: 'nowrap'
    },
    ...keyProps(t, live, title),
    type: 'button',
    children: live || reserved
      ? jsxs(Fragment, { children: [children, jsx(KeyCap, { combo: live || reserved, primary, reserved: Boolean(reserved) })] })
      : children
  })
}

function Ladder({ ladder, canEdit, editing }) {
  const t = useT()
  if (!ladder.length && !editing) return null
  // Rows in display order; the step being edited keeps its place as a marker.
  const rows = ladder.map((rung, index) => ({ rung, index }))
  if (editing) rows.splice(Math.min(editing.index, rows.length), 0, { rung: editing.rung, index: -1 })
  return jsx('div', {
    'data-studio-ladder': true,
    style: { display: 'grid', marginTop: '12px', rowGap: '2px' },
    children: rows.map(({ rung, index }, position) => {
      const isEditing = index < 0
      const combo = `Alt+Shift+${index + 1}`
      const cells = [
        jsx('span', { style: { ...typeStyle, fontSize: '12px', fontVariantNumeric: 'tabular-nums' }, children: String(position + 1) }),
        jsx('span', { style: { fontSize: '12px', minWidth: 0, overflow: 'hidden', textAlign: 'left', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }, title: rung.question, children: rung.question }),
        isEditing
          ? jsx('span', { style: { color: 'var(--ui-accent)', fontSize: '12px', textAlign: 'right' }, children: t('step.editingBelow') })
          : jsx(Tip, {
              label: rung.answer,
              children: jsx('span', { style: { color: 'var(--ui-text-primary, inherit)', fontSize: '12px', minWidth: 0, overflow: 'hidden', textAlign: 'right', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }, children: rung.answer })
            }),
        !isEditing && canEdit && index < 9
          ? jsx(KeyCap, { combo })
          : jsx('span', { 'aria-hidden': true, style: { fontSize: '12px', textAlign: 'center' }, children: isEditing ? '✎' : '' })
      ]
      const style = { ...typeStyle, alignItems: 'center', background: 'transparent', border: `1px solid ${isEditing ? 'var(--ui-accent)' : 'transparent'}`, borderRadius: '6px', columnGap: '8px', display: 'grid', gridTemplateColumns: '16px minmax(0, 1fr) minmax(0, 0.8fr) auto', lineHeight: '16px', minHeight: '24px', minWidth: 0, padding: '2px 4px', width: '100%' }
      if (isEditing || !canEdit) return jsx('div', { className: 'studio-rung-enter', 'data-studio-rung': true, 'data-studio-rung-editing': isEditing || undefined, style, children: cells }, `edit-${rung.question}`)
      return jsx('button', {
        'aria-label': t('step.editAria', position + 1, rung.question),
        className: 'studio-rung-enter studio-rung-button',
        'data-studio-rung': true,
        'data-studio-rung-edit': index,
        ...(index < 9 ? { 'aria-keyshortcuts': combo, 'data-studio-shortcut': combo } : {}),
        onClick: event => { event.preventDefault(); editStep(index) },
        onMouseDown: event => event.preventDefault(),
        style: { ...style, cursor: 'pointer', fontFamily: 'var(--dt-font-sans, inherit)' },
        title: [t('step.editTitle'), index < 9 ? t('keys.shortcut', combo) : ''].filter(Boolean).join(' · '),
        type: 'button',
        children: cells
      }, `${rung.question}-${index}`)
    })
  })
}

// The total can grow (a follow-up question appears after pasting), so it is shown as a bar,
// not as "of N": a number that changes mid-way reads as a mistake.
function Progress({ number, total }) {
  const t = useT()
  const done = Math.max(0, number - 1)
  const pct = Math.min(100, Math.round((done / Math.max(total, number, 1)) * 100))
  return jsxs('div', {
    style: { alignItems: 'center', display: 'flex', gap: '8px' },
    children: [
      jsx('span', { 'data-studio-step': true, style: { ...typeStyle, fontSize: '11px', fontVariantNumeric: 'tabular-nums', lineHeight: '16px' }, children: t('step.label', number) }),
      jsx('span', {
        'aria-label': t('step.progress', number, pct),
        'aria-valuemax': 100,
        'aria-valuemin': 0,
        'aria-valuenow': pct,
        role: 'progressbar',
        style: { background: 'var(--ui-stroke-secondary)', borderRadius: '2px', flex: '0 0 96px', height: '3px', overflow: 'hidden' },
        children: jsx('span', { style: { background: 'var(--ui-accent)', display: 'block', height: '100%', transition: 'width 200ms ease', width: `${pct}%` } })
      })
    ]
  })
}

function CurrentQuestion({ field, number, text, total, help }) {
  return jsxs('div', {
    className: 'studio-question-enter',
    'data-studio-current-question': true,
    'data-studio-field': field || undefined,
    style: { display: 'grid', rowGap: '4px' },
    children: [
      total ? jsx(Progress, { number, total }) : null,
      jsx('span', { id: QUESTION_TEXT_ID, 'data-studio-current-text': true, style: { color: 'var(--ui-text-primary, inherit)', fontFamily: 'var(--dt-font-sans, inherit)', fontSize: '14px', fontWeight: 500, lineHeight: '20px' }, children: text }),
      help ? jsx('span', { id: QUESTION_HELP_ID, 'data-studio-help': true, style: { ...typeStyle, fontSize: '12px', lineHeight: '16px' }, children: help }) : null
    ]
  })
}

function mySuggestion(state, suggestion) {
  return suggestion && suggestion.key === questionKey(state) ? suggestion : null
}

function SuggestionRow({ state }) {
  const t = useT()
  const mode = useValue($aiMode)
  const suggestion = useValue($suggestion)
  // The paste step has nothing for the AI to guess: no AI row at all.
  if (mode === 'off' || !state.current || state.current.paste) return null
  const mine = mySuggestion(state, suggestion)
  const isEnum = state.current.kind === 'enum'
  const improving = mine?.mode === 'improve'
  const children = []
  let status = ''
  if (!mine || mine.status === 'dismissed') {
    children.push(jsx(Button, { data: { 'data-studio-ai-suggest': true }, onClick: () => requestSuggestion('suggest'), keyHint: 'Alt+S', children: isEnum ? t('ai.askEnum') : t('ai.askText') }))
  } else if (mine.status === 'loading') {
    status = t('ai.status.loading')
    children.push(jsxs('span', {
      'data-studio-ai-loading': true,
      style: { ...typeStyle, alignItems: 'center', display: 'inline-flex', fontSize: '12px', gap: '6px' },
      children: [jsx(GlyphSpinner, { ariaLabel: t('ai.spinner') }), improving ? t('ai.improving') : t('ai.analyzing')]
    }))
    children.push(jsx(Button, { data: { 'data-studio-ai-stop': true }, onClick: clearSuggestion, keyHint: 'Alt+D', children: t('ai.stop') }))
  } else if (mine.status === 'error') {
    status = t('ai.status.error')
    // Plain words on screen; the technical detail only in the tooltip.
    children.push(jsx('span', { 'data-studio-ai-error': true, style: { color: 'var(--dt-destructive)', fontSize: '12px' }, title: mine.detail || undefined, children: t(`ai.${mine.errorKey || 'failed'}`) }))
    children.push(jsx(Button, { data: { 'data-studio-ai-retry-error': true }, onClick: () => requestSuggestion(mine.mode), keyHint: 'Alt+S', children: t('ai.retry') }))
  } else {
    status = t('ai.status.ready')
    const empty = !mine.value
    const hasDefault = Boolean(state.current.recommended)
    let headline
    // An empty suggestion on a field with a default means "keep the default"; with no default the
    // step's own Skip button (F6) is the way forward, so no second skip button here.
    if (empty && (mine.agrees || hasDefault)) headline = t('ai.agrees', state.current.recommended || t('ai.theDefault'))
    else if (empty) headline = t('ai.nothing')
    else if (isEnum && mine.agrees === true) headline = t('ai.agrees', mine.value)
    else if (isEnum) headline = t('ai.suggests', mine.value)
    else headline = improving ? t('ai.improved') : t('ai.suggestion')
    children.push(jsxs('div', {
      'data-studio-ai-suggestion': true,
      'data-studio-ai-mode': mine.mode,
      style: { display: 'grid', flexBasis: '100%', rowGap: '4px' },
      children: [
        jsx('span', { style: { color: 'var(--ui-text-primary, inherit)', fontSize: '12px', fontWeight: 500 }, children: headline }),
        !isEnum && !empty
          ? jsx('span', { 'data-studio-ai-text': true, style: { borderLeft: '2px solid var(--ui-accent)', color: 'var(--ui-text-primary, inherit)', fontSize: '12px', paddingLeft: '8px', whiteSpace: 'pre-wrap' }, children: mine.value })
          : null,
        mine.reason ? jsx('span', { style: { ...typeStyle, fontSize: '11px' }, children: t('ai.why', mine.reason) }) : null
      ]
    }))
    // Choice steps: the AI's pick is the recommended button (F5) itself, so no F7 twin here.
    if (isEnum) {
      // nothing
    } else if (empty && hasDefault) {
      children.push(jsx(Button, { variant: 'accent', data: { 'data-studio-ai-use': true }, onClick: () => commitAnswer(''), keyHint: 'F7', children: t('ai.useDefault') }))
    } else if (!empty) {
      const label = improving ? t('ai.useVersion') : t('ai.putInField')
      children.push(jsx(Button, { variant: 'accent', data: { 'data-studio-ai-use': true }, onClick: useSuggestion, keyHint: 'F7', children: label }))
    }
    children.push(jsx(Button, { data: { 'data-studio-ai-discard': true }, onClick: discardSuggestion, keyHint: 'Alt+D', children: t('ai.discard') }))
    if (!improving) {
      children.push(jsx(Button, {
        ariaLabel: t('ai.anotherAria'),
        data: { 'data-studio-ai-retry': true },
        onClick: () => { suggestionCache.delete(mine.key); requestSuggestion('suggest') },
        title: t('ai.anotherAria'),
        keyHint: 'Alt+N',
        children: t('ai.another')
      }))
    }
  }
  // Only the short status line is live; the buttons are not re-read on every change.
  children.push(jsx('span', { 'aria-live': 'polite', 'data-studio-ai-status': true, role: 'status', style: visuallyHidden, children: status }))
  // Static list built with push: jsxs (not jsx) so React does not ask for keys.
  return jsxs('div', {
    'data-studio-ai-row': true,
    style: { alignItems: 'center', background: 'transparent', border: '1px solid var(--ui-stroke-tertiary, var(--ui-stroke-secondary))', borderRadius: '8px', display: 'flex', flexWrap: 'wrap', gap: '6px', marginTop: '12px', padding: '8px 10px' },
    children
  })
}

// Which option is the one recommended button (F5). Auto mode: only the AI's pick, and none while the
// AI is still thinking; if the AI fails, is stopped or discarded, the local recommendation comes back.
// On request: the local one until the AI answers, then the AI's pick replaces it. Never two stars.
function enumRecommendation(current, mode, mine) {
  const same = (a, b) => String(a || '').trim().toLocaleLowerCase() === String(b || '').trim().toLocaleLowerCase()
  const all = [current.recommended, ...(current.options || [])].filter((v, i, a) => v && a.findIndex(o => same(o, v)) === i)
  if (mode !== 'off' && mine?.status === 'ready') {
    const value = mine.value || current.recommended
    if (value) return { value: all.find(o => same(o, value)) || value, byAi: true, all, same }
  }
  if (mode === 'auto' && mine?.status === 'loading') return { value: '', byAi: false, all, same }
  return { value: current.recommended || '', byAi: false, all, same }
}

function EnumAnswer({ state }) {
  const t = useT()
  const current = state.current
  const suggestion = useValue($suggestion)
  const mode = useValue($aiMode)
  const mine = mySuggestion(state, suggestion)
  const rec = enumRecommendation(current, mode, mine)
  // Auto: the AI's pick changes the cards, so they wait until it arrives, fails or is stopped.
  if (mode === 'auto' && mine?.status === 'loading') return null
  const options = rec.all.filter(option => !rec.value || !rec.same(option, rec.value))
  return jsxs('div', {
    'aria-labelledby': QUESTION_TEXT_ID,
    'data-studio-options': true,
    role: 'group',
    style: { display: 'flex', flexWrap: 'wrap', gap: '6px', marginTop: '10px' },
    children: [
      rec.value
        ? jsx(Button, { variant: 'primary', data: { 'data-studio-recommend': true, 'data-studio-ai-pick': rec.byAi ? 'true' : undefined }, onClick: () => commitAnswer(rec.value), title: rec.byAi ? t('ai.pickTitle') : t('answer.recommendedTitle'), keyHint: 'F5', reserveKey: 'F5', children: rec.byAi ? t('answer.recommendedByAi', rec.value) : t('answer.recommended', rec.value) })
        : null,
      ...options.map((option, index) => jsx(Button, {
        data: { 'data-studio-option': option },
        keyHint: index < 9 ? `Alt+${index + 1}` : undefined,
        onClick: () => commitAnswer(option),
        children: option
      }, option))
    ]
  })
}

// Paste step: collapsed to two buttons until the user says they have something to paste.
function PasteAnswer({ state }) {
  const t = useT()
  const [open, setOpen] = useState(Boolean(String(state.answer || '').trim()))
  if (open) return jsx(TextAnswer, { state, placeholder: t('answer.pastePlaceholder') })
  return jsxs('div', {
    style: { display: 'flex', flexWrap: 'wrap', gap: '6px', marginTop: '10px' },
    children: [
      jsx(Button, { variant: 'primary', data: { 'data-studio-skip': true }, onClick: () => commitAnswer(''), keyHint: 'F6', children: t('answer.none') }),
      jsx(Button, { data: { 'data-studio-paste-open': true }, onClick: () => setOpen(true), keyHint: 'Alt+C', children: t('answer.paste') })
    ]
  })
}

function TextAnswer({ state, placeholder }) {
  const t = useT()
  const current = state.current
  // Opening the paste field moves the cursor into it.
  useEffect(() => { document.querySelector('[data-studio-answer-input]')?.focus({ preventScroll: true }) }, [])
  const hasDefault = Boolean(current.recommended)
  const mode = useValue($aiMode)
  const mine = mySuggestion(state, useValue($suggestion))
  // Auto mode, step with a default, AI text ready: the AI text is the recommended action (F5) and the
  // default becomes a plain option (F6). Before it is ready or on failure: the default is recommended.
  const aiText = mode === 'auto' && hasDefault && mine?.status === 'ready' && mine.mode === 'suggest' && mine.value ? mine.value : ''
  // One primary action per step: Confirm once something is typed, otherwise Recommended / Skip.
  const typed = Boolean(String(state.answer || '').trim())
  // Auto: the recommended button may become the AI text, so it waits for the suggestion.
  const waiting = mode === 'auto' && hasDefault && mine?.status === 'loading' && mine.mode === 'suggest'
  return jsxs('div', {
    style: { marginTop: '8px' },
    children: [
      jsx('textarea', {
        'aria-describedby': current.help ? QUESTION_HELP_ID : undefined,
        'aria-labelledby': QUESTION_TEXT_ID,
        'data-studio-answer-input': true,
        onBlur: event => { event.currentTarget.style.borderColor = INPUT_LINE },
        onChange: event => update({ type: 'SET_ANSWER', answer: event.currentTarget.value }),
        onFocus: event => { event.currentTarget.style.borderColor = INPUT_LINE_FOCUS },
        // Keys stay local to this field: Enter makes a new line, nothing is intercepted.
        onKeyDown: event => event.stopPropagation(),
        placeholder: placeholder || (hasDefault ? t('answer.emptyMeans', current.recommended) : t('answer.optional')),
        rows: 2,
        style: { ...typeStyle, background: 'transparent', border: 0, borderBottom: `1px solid ${INPUT_LINE}`, borderRadius: 0, boxSizing: 'border-box', fontSize: '13px', lineHeight: '20px', outline: 'none', padding: '6px 0', resize: 'vertical', width: '100%' },
        value: state.answer
      }),
      jsxs('div', {
        style: { display: 'flex', flexWrap: 'wrap', gap: '6px', marginTop: '8px' },
        children: [
          jsx(Button, { variant: typed ? 'primary' : 'default', data: { 'data-studio-confirm': true }, disabled: !typed, onClick: () => commitAnswer(state.answer), keyHint: 'F5', reserveKey: 'F5', children: t('answer.confirm') }),
          aiText
            ? jsx(Button, { variant: typed ? 'default' : 'primary', data: { 'data-studio-recommend': true, 'data-studio-ai-pick': 'true' }, onClick: () => commitAnswer(aiText), title: t('ai.pickTitle'), keyHint: typed ? undefined : 'F5', reserveKey: 'F5', children: t('answer.useAi') })
            : null,
          aiText
            ? jsx(Button, { data: { 'data-studio-use-default': true }, onClick: () => commitAnswer(''), title: current.hint || '', keyHint: 'F6', children: t('answer.useDefault', current.recommended) })
            : waiting
            ? null
            : hasDefault
            ? jsx(Button, { variant: typed ? 'default' : 'primary', data: { 'data-studio-recommend': true }, onClick: () => commitAnswer(''), title: current.hint || '', keyHint: typed ? undefined : 'F5', reserveKey: 'F5', children: t('answer.recommended', current.recommended) })
            : jsx(Button, { variant: typed ? 'default' : 'primary', data: { 'data-studio-skip': true }, onClick: () => commitAnswer(''), keyHint: 'F6', children: t('answer.skip') }),
          ...(current.options || []).map((option, index) => jsx(Button, { data: { 'data-studio-option': option }, onClick: () => commitAnswer(option), keyHint: index < 9 ? `Alt+${index + 1}` : undefined, children: option }, option)),
          jsx(ImproveButton, { state })
        ]
      })
    ]
  })
}

function generateLabel(t, finished, mode) {
  if (!finished) return t('actions.generateNow')
  return mode === 'off' ? t('actions.generate') : t('actions.generateAi')
}

function ActionBar({ state }) {
  const t = useT()
  const busy = state.status === 'briefing'
  const mode = useValue($aiMode)
  // Before the last step, generating is a shortcut, not the next move: keep it secondary.
  const finished = state.status === 'done'
  return jsxs('div', {
    'data-studio-actions': true,
    style: { alignItems: 'center', borderTop: '1px solid var(--ui-stroke-tertiary, var(--ui-stroke-secondary))', display: 'flex', flexWrap: 'wrap', gap: '6px', marginTop: '12px', paddingTop: '10px' },
    children: [
      // While the AI writes the prompt, the steps' actions are not shown (they depend on it).
      busy ? null : jsx(Button, {
        variant: finished ? 'primary' : 'default',
        data: { 'data-studio-generate': true },
        onClick: generatePrompt,
        keyHint: 'F9',
        reserveKey: 'F9',
        title: [finished ? '' : t('actions.generateRest'), mode === 'off' ? t('actions.generateOff') : t('actions.generateOn')].filter(Boolean).join(' '),
        children: generateLabel(t, finished, mode)
      }),
      busy
        ? null
        : state.editing
        ? jsx(Button, { data: { 'data-studio-back': true }, onClick: goBack, title: t('actions.undoEditTitle'), keyHint: 'F8', reserveKey: 'F8', children: t('actions.undoEdit') })
        : jsx(Button, { data: { 'data-studio-back': true }, disabled: !state.ladder.length, onClick: goBack, keyHint: 'F8', reserveKey: 'F8', children: t('actions.back') }),
      // Cancel stays available while the AI writes the prompt.
      jsx(Button, { data: { 'data-studio-cancel': true }, onClick: cancelStudio, title: t('actions.cancelTitle'), keyHint: 'F10', children: t('actions.cancel') }),
      jsx('span', { style: { flex: 1 } }),
      jsx(AiToggle, {})
    ]
  })
}

function ImproveButton({ state }) {
  const t = useT()
  const mode = useValue($aiMode)
  const suggestion = useValue($suggestion)
  // Pasted text must stay byte for byte: no rewriting offered on the paste step.
  if (mode === 'off' || state.current?.paste || !String(state.answer || '').trim()) return null
  const busy = mySuggestion(state, suggestion)?.status === 'loading'
  return jsx(Button, {
    data: { 'data-studio-ai-improve': true },
    disabled: busy,
    onClick: () => requestSuggestion('improve'),
    title: t('ai.improveTitle'),
    keyHint: 'Alt+M',
    children: t('ai.improve')
  })
}

const segmentStyle = selected => ({
  ...typeStyle,
  background: selected ? 'var(--ui-accent-subtle, transparent)' : 'transparent',
  border: `1px solid ${selected ? 'var(--ui-accent)' : 'var(--ui-stroke-secondary)'}`,
  borderRadius: '6px',
  color: selected ? 'var(--ui-text-primary, inherit)' : 'var(--ui-text-secondary)',
  cursor: selected ? 'default' : 'pointer',
  fontSize: '12px',
  minHeight: '24px',
  padding: '2px 8px'
})

// Visible three-way choice instead of a button that cycles through hidden states. Alt+I belongs
// to the group (aria-keyshortcuts); it moves to the next mode (Auto → On request → Off → Auto).
function AiToggle() {
  const t = useT()
  const mode = useValue($aiMode)
  const next = AI_MODES[(AI_MODES.indexOf(mode) + 1) % AI_MODES.length]
  return jsxs('div', {
    'aria-keyshortcuts': 'Alt+I',
    'aria-label': t('ai.group'),
    'data-studio-ai-toggle': true,
    'data-studio-ai-state': mode,
    role: 'radiogroup',
    style: { ...typeStyle, alignItems: 'center', display: 'inline-flex', fontSize: '12px', gap: '4px' },
    children: [
      jsxs('span', { style: { alignItems: 'center', display: 'inline-flex', marginRight: '2px' }, title: t('ai.cycle'), children: [t('ai.label'), jsx(KeyCap, { combo: 'Alt+I' })] }),
      ...AI_MODES.map(item => jsx('button', {
        ...(item === next ? { 'data-studio-shortcut': 'Alt+I' } : {}),
        'aria-checked': item === mode,
        'data-studio-ai-mode-option': item,
        onClick: event => { event.preventDefault(); setAiMode(item) },
        onMouseDown: event => event.preventDefault(),
        role: 'radio',
        style: segmentStyle(item === mode),
        title: t(`ai.modeTitle.${item}`),
        type: 'button',
        children: t(`ai.mode.${item}`)
      }, item))
    ]
  })
}

function ActiveQuestion({ state }) {
  const t = useT()
  const current = state.current
  if (!current) return null
  return jsxs('div', {
    style: { marginTop: '14px' },
    children: [
      jsx(CurrentQuestion, {
        field: current.category,
        number: state.editing ? state.editing.index + 1 : state.ladder.length + 1,
        text: current.question,
        help: current.help,
        total: stepCount(currentTarget(), state.intent, state.ladder)
      }, `${state.ladder.length}-${current.question}`),
      current.kind === 'enum' ? jsx(EnumAnswer, { state }) : current.paste ? jsx(PasteAnswer, { state }, `${questionKey(state)}|${localeOf(t)}`) : jsx(TextAnswer, { state }),
      jsx(SuggestionRow, { state })
    ]
  })
}

function DoneRow() {
  const t = useT()
  const mode = useValue($aiMode)
  return jsx('div', {
    'data-studio': 'done',
    style: { marginTop: '14px' },
    children: jsx(CurrentQuestion, { text: t('actions.done', generateLabel(t, true, mode)) })
  })
}

function PreviewPanel({ state }) {
  const t = useT()
  const { ai, engine, showing, note, noteDetail } = state.preview
  const prompt = state.preview[showing]
  const failed = !ai && Boolean(note)
  return jsxs('div', {
    'data-studio-preview': true,
    style: { display: 'grid', marginTop: '14px', rowGap: '8px' },
    children: [
      jsx('span', { 'data-studio-preview-title': true, style: { color: 'var(--ui-text-primary, inherit)', fontFamily: 'var(--dt-font-sans, inherit)', fontSize: '14px', fontWeight: 500 }, children: showing === 'ai' ? t('preview.ai') : t('preview.engine') }),
      note && (showing === 'ai' || failed)
        ? jsx('span', { 'aria-live': 'polite', 'data-studio-preview-note': true, style: { color: failed ? 'var(--ui-text-primary)' : 'var(--ui-text-secondary)', fontSize: '12px', lineHeight: '16px' }, title: noteDetail || undefined, children: note })
        : null,
      jsx('pre', {
        'data-studio-preview-text': true,
        style: { border: '1px solid var(--ui-stroke-secondary)', borderRadius: '8px', color: 'var(--ui-text-primary, inherit)', fontFamily: 'var(--dt-font-mono, monospace)', fontSize: '12px', lineHeight: '18px', margin: 0, maxHeight: '260px', overflow: 'auto', padding: '8px 10px', whiteSpace: 'pre-wrap', wordBreak: 'break-word' },
        tabIndex: 0,
        children: prompt
      }),
      jsxs('div', {
        style: { display: 'flex', flexWrap: 'wrap', gap: '6px' },
        children: [
          jsx(Button, { variant: 'primary', data: { 'data-studio-send-prompt': true }, onClick: sendPreview, title: t('preview.sendTitle'), keyHint: 'F9', children: t('preview.send') }),
          jsx(Button, { data: { 'data-studio-use-prompt': true }, onClick: usePreview, title: t('preview.editTitle'), keyHint: 'Alt+E', children: t('preview.edit') }),
          ai && engine
            ? jsx(Button, {
                data: { 'data-studio-switch-version': true },
                onClick: () => update({ type: 'SHOW_VERSION', version: showing === 'ai' ? 'engine' : 'ai' }),
                title: t('preview.switchTitle'),
                keyHint: 'Alt+V',
                children: showing === 'ai' ? t('preview.showEngine') : t('preview.showAi')
              })
            : null,
          jsx(Button, { data: { 'data-studio-back-to-steps': true }, onClick: () => update({ type: 'BACK_TO_STEPS' }), keyHint: 'F8', children: t('preview.backToSteps') }),
          jsx(Button, { data: { 'data-studio-cancel': true }, onClick: cancelStudio, title: t('actions.cancelTitle'), keyHint: 'F10', children: t('actions.cancel') })
        ]
      })
    ]
  })
}

function LoadingRow({ children }) {
  const t = useT()
  return jsxs('div', {
    style: { alignItems: 'center', display: 'grid', gridTemplateColumns: '20px minmax(0, 1fr)', marginTop: '14px' },
    children: [
      jsx('span', { style: { ...typeStyle, fontSize: '10px', lineHeight: '16px' }, children: jsx(GlyphSpinner, { ariaLabel: t('loading.spinner') }) }),
      jsx('span', { style: { ...typeStyle, fontSize: '14px', fontWeight: 500, lineHeight: '20px' }, children })
    ]
  })
}

function StudioMotionStyles() {
  return jsx('style', {
    children: `
      @keyframes studioFadeIn { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: translateY(0); } }
      @keyframes studioRungEnter { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: translateY(0); } }
      .studio-question-enter { animation: studioFadeIn 180ms cubic-bezier(.22,.8,.2,1) both; }
      .studio-rung-enter { animation: studioRungEnter 220ms cubic-bezier(.22,.8,.2,1) both; }
      .studio-rung-button:hover, .studio-rung-button:focus-visible { border-color: var(--ui-stroke-secondary) !important; }
      @media (prefers-reduced-motion: reduce) { .studio-question-enter, .studio-rung-enter { animation-duration: 1ms; } }
    `
  })
}

const TARGET_KEYS = { opus: 'Alt+O', astra: 'Alt+A' }

// Exclusive choice: radiogroup + radio, like the AI mode selector.
function TargetSwitch() {
  const t = useT()
  const target = useValue($target) || currentTarget()
  return jsxs('div', {
    'aria-label': t('target.group'),
    'data-studio-target': true,
    role: 'radiogroup',
    style: { ...typeStyle, alignItems: 'center', display: 'flex', fontSize: '12px', gap: '6px', lineHeight: '16px', marginTop: '8px' },
    children: [
      jsx('span', { children: t('target.label') }),
      ...TARGETS.map(item => jsx('button', {
        ...keyProps(t, TARGET_KEYS[item.id], t('target.title', item.model)),
        'aria-checked': item.id === target,
        'data-studio-target-option': item.id,
        onClick: () => setTarget(item.id),
        onMouseDown: event => event.preventDefault(),
        role: 'radio',
        style: { ...segmentStyle(item.id === target), alignItems: 'center', display: 'inline-flex', padding: '2px 10px' },
        type: 'button',
        children: TARGET_KEYS[item.id] ? jsxs(Fragment, { children: [item.label, jsx(KeyCap, { combo: TARGET_KEYS[item.id] })] }) : item.label
      }, item.id))
    ]
  })
}

// "Shortcuts" (F1): the whole key map in one place, with the layout notes.
function ShortcutsButton() {
  const t = useT()
  const open = useValue($helpOpen)
  return jsx(Button, {
    data: { 'data-studio-shortcuts-help': true, 'aria-expanded': open, 'aria-controls': 'prompt-studio-shortcuts' },
    onClick: () => $helpOpen.set(!$helpOpen.get()),
    keyHint: HELP_KEY,
    children: t('shortcuts.button')
  })
}

function SettingsButton() {
  const t = useT()
  return jsx(Button, {
    ariaLabel: t('settings.button'),
    data: { 'data-studio-settings': true, 'aria-haspopup': 'dialog' },
    onClick: () => $settingsOpen.set(true),
    keyHint: SETTINGS_KEY,
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

// Session context indicator: reading / used (model, seconds) / not available (short reason).
function ContextStatus() {
  const t = useT()
  const context = useValue($context)
  if (!context || context.status === 'reading') return null
  const text = context.status === 'reading'
    ? t('context.reading')
    : context.status === 'ready'
      ? t('context.used', context.model || '-', (context.ms / 1000).toFixed(1))
      : t('context.failed', context.reason)
  return jsx('span', { 'aria-live': 'polite', 'data-studio-context-status': context.status, role: 'status', style: { ...typeStyle, display: 'block', fontSize: '11px', lineHeight: '16px', marginTop: '4px' }, children: text })
}

function ShortcutsList() {
  const t = useT()
  const open = useValue($helpOpen)
  if (!open) return null
  const note = text => jsx('li', { style: { ...typeStyle, fontSize: '12px', lineHeight: '16px' }, children: text })
  return jsxs('div', {
    'aria-label': t('shortcuts.title'),
    'data-studio-shortcuts-list': true,
    id: 'prompt-studio-shortcuts',
    role: 'region',
    style: { border: '1px solid var(--ui-stroke-secondary)', borderRadius: '8px', marginTop: '8px', padding: '8px 10px' },
    children: [
      jsx('span', { style: { color: 'var(--ui-text-primary, inherit)', display: 'block', fontSize: '13px', fontWeight: 500, marginBottom: '6px' }, children: t('shortcuts.title') }),
      jsx('dl', {
        style: { columnGap: '10px', display: 'grid', gridTemplateColumns: 'max-content minmax(0, 1fr)', margin: 0, rowGap: '4px' },
        children: SHORTCUT_MAP.flatMap(([combo, key]) => [
          jsx('dt', { 'data-studio-shortcut-row': combo, style: { margin: 0 }, children: jsx(Kbd, { size: 'sm', children: combo }) }, `k-${combo}`),
          jsx('dd', { style: { ...typeStyle, fontSize: '12px', lineHeight: '18px', margin: 0 }, children: t(`shortcuts.${key}`) }, `d-${combo}`)
        ])
      }),
      jsxs('ul', { style: { margin: '8px 0 0', paddingLeft: '16px' }, children: [note(t('shortcuts.noteAlt')), note(t('shortcuts.noteDigits')), note(t('shortcuts.noteKeys'))] })
    ]
  })
}

// The first thing to act on for each screen (U1). Never the composer while the studio is open.
function focusTarget(root, state) {
  const pick = (...selectors) => selectors.map(sel => root.querySelector(sel)).find(el => el && !el.disabled) || null
  if (state.status === 'preview') return pick('[data-studio-send-prompt]', '[data-studio-use-prompt]')
  if (state.status === 'done') return pick('[data-studio-generate]')
  if (state.status === 'active' && state.current) {
    if (state.current.kind === 'enum') return pick('[data-studio-recommend]', '[data-studio-option]')
    return pick('[data-studio-answer-input]', '[data-studio-paste-open]')
  }
  return root
}

function useStudioFocus(state) {
  const suggestion = useValue($suggestion)
  const stepKey = `${state.status}|${questionKey(state)}|${state.editing?.index ?? ''}|${state.preview?.showing ?? ''}`
  // Every step or status change: move to the first logical target.
  useEffect(() => {
    const root = document.querySelector('[data-studio-strip]')
    if (root) focusTarget(root, state)?.focus({ preventScroll: true })
  }, [stepKey])
  // A clicked AI button can unmount (Stop, Discard, Use): if the focus fell out of the studio,
  // bring it back to the same first target instead of leaving it on <body>.
  useEffect(() => {
    const root = document.querySelector('[data-studio-strip]')
    if (root && !root.contains(document.activeElement)) focusTarget(root, state)?.focus({ preventScroll: true })
  }, [suggestion?.status, suggestion?.key])
}

function StudioLadder() {
  const t = useT()
  const state = useValue($studio)
  const context = useValue($context)
  useStudioFocus(state)
  if (state.status === 'idle') return null
  const canEdit = ['active', 'done'].includes(state.status)
  const number = state.editing ? state.editing.index + 1 : state.ladder.length + 1
  // While this session is read, the steps (which use it) are not shown: only the loading state and Cancel.
  const reading = context?.status === 'reading' && canEdit
  const body =
    reading
      ? jsx('div', { 'data-studio-context-loading': true, children: jsx(LoadingRow, { children: t('context.reading') }) })
      : state.status === 'asking'
      ? jsx(LoadingRow, { children: t('loading.asking') })
      : state.status === 'briefing'
        ? jsx(LoadingRow, { children: $aiMode.get() === 'off' ? t('loading.writing') : t('loading.writingAi') })
        : state.status === 'active'
          ? jsx(ActiveQuestion, { state })
          : state.status === 'done'
            ? jsx(DoneRow, {})
            : state.status === 'preview'
              ? jsx(PreviewPanel, { state })
              : null

  return jsxs('div', {
    'aria-label': t('studio.region'),
    'data-studio-strip': true,
    role: 'region',
    style: { padding: '0 0 8px' },
    tabIndex: -1,
    children: [
      jsx(StudioMotionStyles, {}),
      jsx('span', { 'aria-live': 'polite', 'data-studio-announce': true, style: visuallyHidden, children: !reading && state.status === 'active' && state.current ? t('step.announce', number, state.current.question) : '' }),
      jsxs('div', {
        'data-studio-intent-row': true,
        style: { alignItems: 'center', display: 'flex', gap: '6px', lineHeight: '18px', minWidth: 0 },
        children: [
          jsx('span', { style: { ...typeStyle, flex: 'none', fontSize: '12px' }, children: t('studio.request') }),
          jsx('span', { style: { color: 'var(--ui-text-primary, inherit)', flex: 1, fontFamily: 'var(--dt-font-sans, inherit)', fontSize: '13px', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }, title: state.intent, children: state.intent }),
          jsx(ShortcutsButton, {}),
          jsx(SettingsButton, {})
        ]
      }),
      jsx(ContextStatus, {}),
      jsx(SettingsDialog, {}),
      jsx(ShortcutsList, {}),
      jsx(TargetSwitch, {}),
      jsx(Ladder, { canEdit, editing: state.editing, ladder: state.ladder }),
      body,
      reading
        ? jsx('div', { style: { display: 'flex', marginTop: '12px' }, children: jsx(Button, { data: { 'data-studio-cancel': true }, onClick: cancelStudio, title: t('actions.cancelTitle'), keyHint: 'F10', children: t('actions.cancel') }) })
        : canEdit || state.status === 'briefing' ? jsx(ActionBar, { state }) : null
    ]
  })
}

// Entry point inside the composer, before the model pill (composer.actions). Hidden while the
// studio is open: closing lives in the studio's own Cancel; one close control, not two.
function StudioButton() {
  const t = useT()
  const state = useValue($studio)
  if (state.status !== 'idle') return null
  return jsx('button', {
    'aria-keyshortcuts': OPEN_KEY,
    'aria-label': t('open.aria'),
    'data-studio-open': true,
    onClick: event => {
      event.preventDefault()
      event.stopPropagation()
      startFromComposer()
    },
    onMouseDown: event => event.preventDefault(),
    style: {
      ...typeStyle,
      alignItems: 'center',
      background: 'transparent',
      border: '1px solid var(--ui-stroke-secondary)',
      borderRadius: '6px',
      cursor: 'pointer',
      display: 'inline-flex',
      fontSize: '12px',
      gap: '4px',
      height: '26px',
      lineHeight: '16px',
      padding: '0 8px',
      whiteSpace: 'nowrap'
    },
    title: `${t('open.title')} · ${t('keys.shortcut', OPEN_KEY)}`,
    type: 'button',
    children: [t('open.label'), jsx(KeyCap, { combo: OPEN_KEY }, 'key')]
  })
}

export default {
  id: ID,
  name: 'Prompt Studio',
  register(ctx) {
    pluginContext = ctx
    ctx.onDispose(() => {
      cancelAutoSuggestion()
      suggestSerial += 1
      composeSerial += 1
      suggestionCache.clear()
      pluginContext = null
      $studio.set(initialStudioState())
      $suggestion.set(null)
      $helpOpen.set(false)
      $target.set(null)
      stopContextRead()
      $settingsOpen.set(false)
    })
    ctx.i18n?.register(UI_MESSAGES)
    $aiMode.set(readAiMode())
    loadSettings()
    // Tracked by the host: removed on dispose, hot reload or a failed register.
    installStudioKeys(ctx)
    ctx.registerMany([
      {
        id: 'ladder',
        area: COMPOSER_AREAS.top,
        render: () => jsx(StudioLadder, {})
      },
      {
        id: 'open-button',
        area: COMPOSER_AREAS.actions,
        render: () => jsx(StudioButton, {})
      },
      {
        id: 'middleware',
        area: COMPOSER_AREAS.middleware,
        // While the studio is open the composer is intentionally empty; a send that reaches
        // the app's submit path anyway must not fire a blank turn.
        data: { handler: draft => ($studio.get().status !== 'idle' ? null : draft) }
      },
      {
        id: 'palette-start',
        area: PALETTE_AREA,
        data: {
          action: `${ID}.start`,
          detail: () => (composerAdapter.readDraft().trim() ? tr('palette.detailDraft') : tr('palette.detailEmpty')),
          id: `${ID}.start`,
          keywords: ['prompt', 'studio', 'opus', 'astra'],
          label: tr('palette.label'),
          run: startFromComposer
        }
      }
    ])
  }
}
