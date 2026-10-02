// ---------------------------------------------------------------------------
// Keys: the shortcut map, how a combo is shown, the keydown listener, and the controls that wear a key (Button, KeyCap).
// F1 list. The F5-F10 / Alt twins, the overlay guard and the Mac dead keys live here.
// ---------------------------------------------------------------------------

const typeStyle = { color: 'var(--ui-text-secondary)', fontFamily: 'var(--dt-font-sans, inherit)' }

const visuallyHidden = { border: 0, clip: 'rect(0 0 0 0)', height: '1px', margin: '-1px', overflow: 'hidden', padding: 0, position: 'absolute', whiteSpace: 'nowrap', width: '1px' }

// Keyboard: every studio control has a key, and the key is printed on the control itself.
// F4 opens the studio from the composer (so does the Hermes Desktop keybind, see OPEN_BINDING); everything else lives on the buttons: a button with a
// `keyHint` is the one that key presses, so what is shown is always what runs. SHORTCUTS (below) is the
// one map of every key (F1 shows it). Tab, Enter and Esc are never taken: they stay the app's.
// Conflicts checked: Hermes Desktop binds none of these (it uses Ctrl/Ctrl+Shift/Ctrl+Alt chords,
// Alt+Space, Alt+Right, F12, Shift+F10); Cinnamon binds only Alt/Ctrl+Alt/Super+F-keys and
// Alt+Space/Tab/`/Print. F-keys with any modifier and Ctrl/Super chords are never taken. Capture
// phase, so the keys also work with the cursor in the answer field.
// The one shortcut map: every key printed on a control, listed under F1, switching a target or
// editing a step is read from here, never written as a string elsewhere. Entries are in F1 order;
// each key is also the name of its `shortcuts.<key>` label. `pick` / `edit` hold the digit range
// (see digitCombo) and `model` holds one combo per target id.
export const SHORTCUTS = {
  open: 'F4',
  help: 'F1',
  settings: 'F3',
  accept: 'F5',
  skip: 'F6',
  useAi: 'F7',
  back: 'F8',
  generate: 'F9',
  close: 'F10',
  pick: 'Alt+1…9',
  edit: 'Alt+Shift+1…9',
  ask: 'Alt+S',
  another: 'Alt+N',
  discard: 'Alt+D',
  improve: 'Alt+M',
  paste: 'Alt+C',
  model: Object.fromEntries(TARGETS.map(target => [target.id, target.key])),
  mode: 'Alt+I',
  version: 'Alt+V',
  editPrompt: 'Alt+E',
  // A second key, with no F-key, for each of F5-F10 (an Apple keyboard needs fn for those). Never E, I, N or U:
  // those Option chords are dead keys on a Mac. Free in the map above, in Hermes Desktop and in Cinnamon.
  // Not a row of its own in F1: each combo is listed next to the F-key it doubles.
  alt: { accept: 'Alt+Y', skip: 'Alt+K', useAi: 'Alt+L', back: 'Alt+B', generate: 'Alt+G', close: 'Alt+X' }
}
// The Hermes Desktop keybind that opens the studio (the `keybinds` area; the user can reassign it in Desktop
// settings). Desktop's own notation, `mod` = Cmd on a Mac and Ctrl elsewhere. Desktop's default actions use
// mod+shift with M N F B S L H T K G W C V 0 [ ] and \, so E is free; the Studio's own listener never sees it.
const OPEN_BINDING = 'mod+shift+e'
// The combo of digit `n` for a range entry of the map ('pick' → Alt+3, 'edit' → Alt+Shift+3).
const digitCombo = (action, n) => SHORTCUTS[action].replace('1…9', String(n))
// What the F1 list prints for an entry: the combo, or the three target combos joined.
const shortcutLabel = value => (typeof value === 'string' ? value : Object.values(value).join(' / '))

// Mac keyboards: Alt is the Option key (⌥) and Shift is ⇧; F-keys show as themselves (whether they need fn is the
// Mac's own keyboard setting). Read when drawn, with the
// same rule as the Desktop (userAgentData, then navigator.platform, then the user agent).
const isMacPlatform = () => typeof navigator !== 'undefined' && /mac/i.test(navigator.userAgentData?.platform || navigator.platform || navigator.userAgent || '')
const MAC_MODIFIERS = { alt: '⌥', shift: '⇧', ctrl: '⌃', mod: '⌘' }
// The Desktop SDK's formatModifierToken (0.21.4+) when it exports one and answers with the Mac glyph, else the
// local table. Read from the namespace: a named import of a missing export would stop the plugin from loading.
function modifierGlyph(name) {
  const key = name.toLowerCase()
  const sdk = typeof hermesSdk.formatModifierToken === 'function' ? hermesSdk.formatModifierToken(key) : ''
  return /^[⌘⌃⌥⇧]$/.test(sdk) ? sdk : MAC_MODIFIERS[key] ?? name
}
// How a combo of the map is shown to the user: as is, except on a Mac, where 'Alt+Shift+1…9' reads ⌥⇧1…9 and
// 'F4' stays F4 (the three target combos stay joined with ' / '). Attributes and tooltips' machine
// readers keep the canonical combo.
function displayCombo(combo) {
  if (!isMacPlatform()) return combo
  return combo.split(' / ').map(one => {
    const parts = one.split('+')
    const base = parts.pop()
    if (!parts.length && MAC_MODIFIERS[base.toLowerCase()]) return modifierGlyph(base)
    return /^F\d+$/.test(base) ? base : parts.map(modifierGlyph).join('') + base
  }).join(' / ')
}
// The Alt+letter that doubles a F-key combo, if there is one (F9 -> Alt+G).
const altOf = combo => {
  const action = Object.keys(SHORTCUTS.alt).find(key => SHORTCUTS[key] === combo)
  return action && SHORTCUTS.alt[action]
}
// While open these are always swallowed, even when no control shows them right now: F5 would
// otherwise reach the window (reload in some Electron setups), and a Mac would type the Option symbol.
const isFKeyAction = combo => Object.keys(SHORTCUTS.alt).some(key => SHORTCUTS[key] === combo || SHORTCUTS.alt[key] === combo)
// Behind an overlay only the F-keys themselves stay swallowed (F5 would reload the window); an Alt twin belongs to the
// overlay's own field there, where on a Mac it is a printable Option symbol.
const isBareFKeyAction = combo => Object.keys(SHORTCUTS.alt).some(key => SHORTCUTS[key] === combo)

function keyCombo(event) {
  if (event.ctrlKey || event.metaKey) return ''
  if (/^F([1-9]|1[0-2])$/.test(event.key)) return event.altKey || event.shiftKey ? '' : event.key
  if (!event.altKey) return ''
  const letter = /^Key([A-Z])$/.exec(event.code || '')
  if (letter) return event.shiftKey ? '' : `Alt+${letter[1]}`
  const digit = /^Digit([1-9])$/.exec(event.code || '')
  if (digit) return digitCombo(event.shiftKey ? 'edit' : 'pick', digit[1])
  return ''
}

// An Alt chord on a letter or digit key, by physical code. On macOS ⌥E, ⌥N, ⌥I, ⌥U and ⌥` are dead keys:
// the event has key 'Dead' and the browser may mark it keyCode 229 / isComposing as an accent starts, so
// the code is the only thing that says which shortcut it was.
const isAltCodeChord = event => event.altKey && !event.ctrlKey && !event.metaKey && /^(Key[A-Z]|Digit[1-9])$/.test(event.code || '')

// Behind an open overlay the studio's keys do nothing. Two kinds: the studio's own Settings dialog
// ($settingsOpen), where only F1 (help) and F3 (closes Settings) still work, and a FOREIGN overlay (a model
// menu, the command palette or any other dialog/menu/listbox in the document), behind which nothing the
// studio owns reacts, F1 and F3 included. Not counted: an overlay that is not rendered (hidden, aria-hidden,
// display:none or visibility:hidden on it or on an ancestor), one that holds the studio, and the Settings
// dialog element itself. A menu or listbox nested INSIDE Settings does count: Hermes's DialogContent is the
// portal container for the pickers opened in it.
const OVERLAY_KEYS = [SHORTCUTS.help, SHORTCUTS.settings]
const OVERLAY_SELECTOR = '[role="dialog"],[role="alertdialog"],[role="menu"],[role="listbox"]'
// jsdom has no layout, so rendering is read from computed style; visibility inherits, display does not.
function renderedHidden(el) {
  if (el.closest('[hidden],[aria-hidden="true"]')) return true
  const view = el.ownerDocument.defaultView
  if (!view?.getComputedStyle) return false
  const { visibility } = view.getComputedStyle(el)
  if (visibility === 'hidden' || visibility === 'collapse') return true
  for (let node = el; node; node = node.parentElement) {
    if (view.getComputedStyle(node).display === 'none') return true
  }
  return false
}
function foreignOverlayOpen() {
  const strip = document.querySelector('[data-studio-strip]')
  const settings = [...document.querySelectorAll('[data-studio-settings-dialog]')]
  return [...document.querySelectorAll(OVERLAY_SELECTOR)].some(el =>
    !settings.some(dialog => dialog === el || el.contains(dialog)) &&
    !(strip && el.contains(strip)) && !renderedHidden(el))
}

function shortcutTarget(root, combo) {
  for (const el of root.querySelectorAll('[data-studio-shortcut]')) {
    if ((el.getAttribute('data-studio-shortcut') === combo || el.getAttribute('data-studio-shortcut-alt') === combo) && !el.disabled) return el
  }
  return null
}

// Installed once at register time through ctx.addEventListener, so the host removes it on
// dispose, on hot reload and when register() fails half way. While the studio is closed only F4
// is looked at (and only when the composer is on screen); while it is open, only combos printed
// on a visible control, plus F5-F10 and their Alt letters swallowed.
function installStudioKeys(ctx) {
  if (typeof window === 'undefined' || !ctx?.addEventListener) return
  const onKey = event => {
    // IME composition (CJK) owns the keyboard until it ends; an Alt chord on a letter or digit key is a dead key.
    if ((event.isComposing || event.keyCode === 229) && !isAltCodeChord(event)) return
    const combo = keyCombo(event)
    if (!combo) return
    const open = $studio.get().status !== 'idle'
    const blocked = foreignOverlayOpen() || ($settingsOpen.get() && !OVERLAY_KEYS.includes(combo))
    let target = null
    if (blocked) {
      // Nothing behind the overlay: F5-F10 are still swallowed below while the studio is open; their Alt twins are not.
    } else if (open) {
      const root = document.querySelector('[data-studio-strip]')
      target = root && shortcutTarget(root, combo)
    } else if (combo === SHORTCUTS.open) {
      target = document.querySelector('[data-studio-open]')
    }
    if (!target && !(open && (blocked ? isBareFKeyAction(combo) : isFKeyAction(combo)))) return
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
    children: displayCombo(combo)
  })
}

function keyProps(t, keyHint, title) {
  if (!keyHint) return { title }
  const alt = altOf(keyHint)
  return {
    // aria-keyshortcuts takes a space-separated list; the visible and tooltip text read "F9 / Alt+G" (⌥G on a Mac).
    'aria-keyshortcuts': alt ? `${keyHint} ${alt}` : keyHint,
    'data-studio-shortcut': keyHint,
    ...(alt ? { 'data-studio-shortcut-alt': alt } : {}),
    title: [title, t('keys.shortcut', displayCombo(alt ? `${keyHint} / ${alt}` : keyHint))].filter(Boolean).join(' · ')
  }
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
      ? jsxs(Fragment, { children: [children, jsx(KeyCap, { combo: live || reserved, primary, reserved: Boolean(reserved) }), altOf(live || reserved) ? jsx(KeyCap, { combo: altOf(live || reserved), primary, reserved: Boolean(reserved) }) : null] })
      : children
  })
}

// Shortcut list open or closed (F1).
const $helpOpen = atom(false)

// "Shortcuts" (F1): the whole key map in one place, with the layout notes.
function ShortcutsButton() {
  const t = useT()
  const open = useValue($helpOpen)
  return jsx(Button, {
    data: { 'data-studio-shortcuts-help': true, 'aria-expanded': open, 'aria-controls': 'prompt-studio-shortcuts' },
    onClick: () => $helpOpen.set(!$helpOpen.get()),
    keyHint: SHORTCUTS.help,
    children: t('shortcuts.button')
  })
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
        children: Object.entries(SHORTCUTS).filter(([key]) => key !== 'alt').flatMap(([key, value]) => {
          const combo = [shortcutLabel(value), SHORTCUTS.alt[key]].filter(Boolean).join(' / ')
          return [
            jsx('dt', { 'data-studio-shortcut-row': combo, style: { margin: 0 }, children: jsx(Kbd, { size: 'sm', children: displayCombo(combo) }) }, `k-${combo}`),
            jsx('dd', { style: { ...typeStyle, fontSize: '12px', lineHeight: '18px', margin: 0 }, children: t(`shortcuts.${key}`) }, `d-${combo}`)
          ]
        })
      }),
      jsxs('ul', { style: { margin: '8px 0 0', paddingLeft: '16px' }, children: [note(t('shortcuts.noteAlt')), note(t('shortcuts.noteDigits', displayCombo(SHORTCUTS.pick.replace('+1…9', '')))), ...(isMacPlatform() ? [note(t('shortcuts.noteMac', displayCombo('Alt'), [SHORTCUTS.editPrompt, SHORTCUTS.another, SHORTCUTS.mode].map(displayCombo).join(', ')))] : []), note(t('shortcuts.noteKeys'))] })
    ]
  })
}
