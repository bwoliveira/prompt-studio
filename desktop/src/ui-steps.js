// ---------------------------------------------------------------------------
// Studio steps: the strip (ladder, current question, answers, actions, preview, target switch) and the step flow
// (ask, answer, edit, back). Every step is a button click; each button also has its key printed on it.
// ---------------------------------------------------------------------------

const INPUT_LINE = 'var(--ui-stroke-secondary)'
const INPUT_LINE_FOCUS = 'var(--ui-accent)'

const QUESTION_TEXT_ID = 'prompt-studio-question-text'
const QUESTION_HELP_ID = 'prompt-studio-question-help'

function askNext() {
  const state = $studio.get()
  if (state.status !== 'asking') return
  clearSuggestion()
  try {
    update({ type: 'INTERROGATION', response: nextQuestion(currentTarget(), state.intent, state.ladder, activeLocale()) })
  } catch (error) {
    host.notifyError(error, tr('notify.nextFailed'))
    update({ type: 'INTERROGATION', response: { done: true } })
    return
  }
  refreshSuggestion()
}

function unknownOption(current) {
  host.notify({ kind: 'warning', message: tr('notify.unknownOption', current.options.join(' · ')) })
}

function commitAnswer(answer) {
  const state = $studio.get()
  if (state.status !== 'active' || !state.current) return
  const text = String(answer ?? '').trim()
  if (text && answerToValue(state.current.category, text, currentTarget()) === undefined) {
    unknownOption(state.current)
    return
  }
  const label = answerLabel(state.current.category, text, currentTarget(), activeLocale())
  // Empty answer on a text field = skip; the rung records the skipped marker.
  update({ type: 'COMMIT_ANSWER', answer: label || (state.current.recommended ? '' : SKIP_MARK) })
  askNext()
}

// Reopen a question with its previous answer loaded; false when the core no longer asks it.
function reopen(state, rung) {
  const question = questionFor(currentTarget(), state.intent, state.ladder, rung.category, activeLocale())
  if (!question) return false
  update({ type: 'INTERROGATION', response: question })
  update({ type: 'SET_ANSWER', answer: isSkipped(rung.answer) ? '' : rung.answer })
  refreshSuggestion()
  return true
}

// Clicking an answered step: reopen it in place with its answer; later answers are kept.
function editStep(index) {
  const before = $studio.get()
  if (!['active', 'done'].includes(before.status)) return
  clearSuggestion()
  update({ type: 'EDIT_STEP', index })
  const state = $studio.get()
  if (!state.editing) return
  if (!reopen(state, state.editing.rung)) {
    update({ type: 'CANCEL_EDIT' })
    askNext()
  }
}

function goBack() {
  const state = $studio.get()
  // While editing, Back undoes the edit and keeps the original answer.
  if (state.editing) {
    clearSuggestion()
    update({ type: 'CANCEL_EDIT' })
    askNext()
    return
  }
  if (!['active', 'done'].includes(state.status) || !state.ladder.length) return
  // Reopen exactly the last answered field, with its own options and previous answer.
  const previous = state.ladder[state.ladder.length - 1]
  clearSuggestion()
  update({ type: 'RETARGET', ladder: state.ladder.slice(0, -1) })
  if (!reopen($studio.get(), previous)) askNext()
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
      const combo = digitCombo('edit', index + 1)
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
        title: [t('step.editTitle'), index < 9 ? t('keys.shortcut', displayCombo(combo)) : ''].filter(Boolean).join(' · '),
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
        ? jsx(Button, { variant: 'primary', data: { 'data-studio-recommend': true, 'data-studio-ai-pick': rec.byAi ? 'true' : undefined }, onClick: () => commitAnswer(rec.value), title: rec.byAi ? t('ai.pickTitle') : t('answer.recommendedTitle'), keyHint: SHORTCUTS.accept, reserveKey: SHORTCUTS.accept, children: rec.byAi ? t('answer.recommendedByAi', rec.value) : t('answer.recommended', rec.value) })
        : null,
      ...options.map((option, index) => jsx(Button, {
        data: { 'data-studio-option': option },
        keyHint: index < 9 ? digitCombo('pick', index + 1) : undefined,
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
      jsx(Button, { variant: 'primary', data: { 'data-studio-skip': true }, onClick: () => commitAnswer(''), keyHint: SHORTCUTS.skip, children: t('answer.none') }),
      jsx(Button, { data: { 'data-studio-paste-open': true }, onClick: () => setOpen(true), keyHint: SHORTCUTS.paste, children: t('answer.paste') })
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
  // One primary action per step (textStepPrimary): Confirm once something is typed, otherwise Recommended / Skip.
  const typed = Boolean(String(state.answer || '').trim())
  // Auto: the recommended button may become the AI text, so it waits for the suggestion.
  const waiting = mode === 'auto' && hasDefault && mine?.status === 'loading' && mine.mode === 'suggest'
  const primary = textStepPrimary({ typed, hasDefault, aiText: Boolean(aiText), waiting })
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
          jsx(Button, { variant: primary === 'confirm' ? 'primary' : 'default', data: { 'data-studio-confirm': true }, disabled: !typed, onClick: () => commitAnswer(state.answer), keyHint: SHORTCUTS.accept, reserveKey: SHORTCUTS.accept, children: t('answer.confirm') }),
          aiText
            ? jsx(Button, { variant: primary === 'ai' ? 'primary' : 'default', data: { 'data-studio-recommend': true, 'data-studio-ai-pick': 'true' }, onClick: () => commitAnswer(aiText), title: t('ai.pickTitle'), keyHint: typed ? undefined : SHORTCUTS.accept, reserveKey: SHORTCUTS.accept, children: t('answer.useAi') })
            : null,
          aiText
            ? jsx(Button, { data: { 'data-studio-use-default': true }, onClick: () => commitAnswer(''), title: current.hint || '', keyHint: SHORTCUTS.skip, children: t('answer.useDefault', current.recommended) })
            : waiting
            ? null
            : hasDefault
            ? jsx(Button, { variant: primary === 'recommended' ? 'primary' : 'default', data: { 'data-studio-recommend': true }, onClick: () => commitAnswer(''), title: current.hint || '', keyHint: typed ? undefined : SHORTCUTS.accept, reserveKey: SHORTCUTS.accept, children: t('answer.recommended', current.recommended) })
            : jsx(Button, { variant: primary === 'skip' ? 'primary' : 'default', data: { 'data-studio-skip': true }, onClick: () => commitAnswer(''), keyHint: SHORTCUTS.skip, children: t('answer.skip') }),
          ...(current.options || []).map((option, index) => jsx(Button, { data: { 'data-studio-option': option }, onClick: () => commitAnswer(option), keyHint: index < 9 ? digitCombo('pick', index + 1) : undefined, children: option }, option)),
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
        keyHint: SHORTCUTS.generate,
        reserveKey: SHORTCUTS.generate,
        title: [finished ? '' : t('actions.generateRest'), mode === 'off' ? t('actions.generateOff') : t('actions.generateOn')].filter(Boolean).join(' '),
        children: generateLabel(t, finished, mode)
      }),
      busy
        ? null
        : state.editing
        ? jsx(Button, { data: { 'data-studio-back': true }, onClick: goBack, title: t('actions.undoEditTitle'), keyHint: SHORTCUTS.back, reserveKey: SHORTCUTS.back, children: t('actions.undoEdit') })
        : jsx(Button, { data: { 'data-studio-back': true }, disabled: !state.ladder.length, onClick: goBack, keyHint: SHORTCUTS.back, reserveKey: SHORTCUTS.back, children: t('actions.back') }),
      // Cancel stays available while the AI writes the prompt.
      jsx(Button, { data: { 'data-studio-cancel': true }, onClick: cancelStudio, title: t('actions.cancelTitle'), keyHint: SHORTCUTS.close, children: t('actions.cancel') }),
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
    keyHint: SHORTCUTS.improve,
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
    'aria-keyshortcuts': SHORTCUTS.mode,
    'aria-label': t('ai.group'),
    'data-studio-ai-toggle': true,
    'data-studio-ai-state': mode,
    role: 'radiogroup',
    style: { ...typeStyle, alignItems: 'center', display: 'inline-flex', fontSize: '12px', gap: '4px' },
    children: [
      jsxs('span', { style: { alignItems: 'center', display: 'inline-flex', marginRight: '2px' }, title: t('ai.cycle', displayCombo(SHORTCUTS.mode)), children: [t('ai.label'), jsx(KeyCap, { combo: SHORTCUTS.mode })] }),
      ...AI_MODES.map(item => jsx('button', {
        ...(item === next ? { 'data-studio-shortcut': SHORTCUTS.mode } : {}),
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
    children: jsx(CurrentQuestion, { text: t('actions.done', generateLabel(t, true, mode), displayCombo(SHORTCUTS.generate)) })
  })
}

function PreviewPanel({ state }) {
  const t = useT()
  const placing = useValue($placing)
  const { ai, engine, showing, note, noteDetail } = state.preview
  const prompt = state.preview[showing]
  const failed = !ai && Boolean(note)
  // Resolved at render time from the active locale, so a language switch (F3) translates them too.
  const warnings = state.preview.warnings ? studioWarnings(state.preview.warnings.target, state.intent, state.preview.warnings.ladder, localeOf(t)) : []
  return jsxs('div', {
    'data-studio-preview': true,
    style: { display: 'grid', marginTop: '14px', rowGap: '8px' },
    children: [
      jsx('span', { 'data-studio-preview-title': true, style: { color: 'var(--ui-text-primary, inherit)', fontFamily: 'var(--dt-font-sans, inherit)', fontSize: '14px', fontWeight: 500 }, children: showing === 'ai' ? t('preview.ai') : t('preview.engine') }),
      // Answer/draft conflicts apply to both versions, so they stay whichever one is shown.
      ...warnings.map(text => jsx('span', { role: 'note', 'data-studio-preview-warning': true, style: { color: 'var(--ui-text-primary)', fontSize: '12px', lineHeight: '16px' }, children: text })),
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
          jsx(Button, { variant: 'primary', data: { 'data-studio-send-prompt': true }, onClick: sendPreview, disabled: placing, title: t('preview.sendTitle'), keyHint: SHORTCUTS.generate, children: t('preview.send') }),
          jsx(Button, { data: { 'data-studio-use-prompt': true }, onClick: usePreview, disabled: placing, title: t('preview.editTitle'), keyHint: SHORTCUTS.editPrompt, children: t('preview.edit') }),
          ai && engine
            ? jsx(Button, {
                data: { 'data-studio-switch-version': true },
                disabled: placing,
                onClick: () => update({ type: 'SHOW_VERSION', version: showing === 'ai' ? 'engine' : 'ai' }),
                title: t('preview.switchTitle'),
                keyHint: SHORTCUTS.version,
                children: showing === 'ai' ? t('preview.showEngine') : t('preview.showAi')
              })
            : null,
          jsx(Button, { data: { 'data-studio-back-to-steps': true }, disabled: placing, onClick: () => update({ type: 'BACK_TO_STEPS' }), keyHint: SHORTCUTS.back, children: t('preview.backToSteps') }),
          jsx(Button, { data: { 'data-studio-cancel': true }, onClick: cancelStudio, disabled: placing, title: t('actions.cancelTitle'), keyHint: SHORTCUTS.close, children: t('actions.cancel') })
        ]
      }),
      // host.composer.submit sends text only; attachments stay in the composer (see sendPreview).
      jsx('span', { 'data-studio-attachments-note': true, role: 'note', style: { color: 'var(--dt-destructive)', fontSize: '12px', lineHeight: '16px', marginTop: '4px' }, children: t('preview.attachmentsNote') })
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
        ...keyProps(t, SHORTCUTS.model[item.id], t('target.title', item.model)),
        'aria-checked': item.id === target,
        'data-studio-target-option': item.id,
        onClick: () => setTarget(item.id),
        onMouseDown: event => event.preventDefault(),
        role: 'radio',
        style: { ...segmentStyle(item.id === target), alignItems: 'center', display: 'inline-flex', padding: '2px 10px' },
        type: 'button',
        children: SHORTCUTS.model[item.id] ? jsxs(Fragment, { children: [item.label, jsx(KeyCap, { combo: SHORTCUTS.model[item.id] })] }) : item.label
      }, item.id))
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
        ? jsx('div', { style: { display: 'flex', marginTop: '12px' }, children: jsx(Button, { data: { 'data-studio-cancel': true }, onClick: cancelStudio, title: t('actions.cancelTitle'), keyHint: SHORTCUTS.close, children: t('actions.cancel') }) })
        : canEdit || state.status === 'briefing' ? jsx(ActionBar, { state }) : null
    ]
  })
}
