// ---------------------------------------------------------------------------
// Suggestion machine: the AI suggestion of the current question (ask, cache, auto-ask delay, use, discard)
// and the row that shows it.
// ---------------------------------------------------------------------------

// Current suggestion: { key, mode: 'suggest'|'improve', status: 'loading'|'ready'|'error'|'dismissed',
//   value, reason, agrees, errorKey, detail, model, latency }
const $suggestion = atom(null)

// Identity of "this question with these answers before it": a suggestion for it stays valid
// until the target, the field or any earlier answer changes.
function questionKey(state) {
  if (!state.current) return ''
  const before = state.ladder.map(rung => `${rung.category}=${rung.answer}`).join('\u241E')
  return `${currentTarget()}|${state.current.category}|${state.intent.length}|${before}`
}

function clearSuggestion() {
  cancelAutoSuggestion()
  lifecycle.suggestSerial += 1
  $suggestion.set(null)
}

// Auto mode waits a moment before asking (SP-2): the plugin REST door cannot abort a call, so
// clicking through steps quickly would otherwise queue one backend request per step. Leaving the
// step (clearSuggestion) or scheduling again cancels the pending ask; manual asks stay immediate.
const AUTO_SUGGEST_DELAY_MS = 400

function cancelAutoSuggestion() {
  if (lifecycle.autoSuggestTimer !== null) lifecycle.autoSuggestTimer()
  lifecycle.autoSuggestTimer = null
}

function scheduleAutoSuggestion() {
  cancelAutoSuggestion()
  const key = questionKey($studio.get())
  const delay = globalThis.__promptStudioTest?.autoSuggestDelayMs ?? AUTO_SUGGEST_DELAY_MS
  const serial = lifecycle.suggestSerial
  lifecycle.autoSuggestTimer = later(async () => {
    lifecycle.autoSuggestTimer = null
    // A pending session context read comes first (it has its own deadline); manual asks never wait.
    if (lifecycle.contextPromise) await lifecycle.contextPromise
    const state = $studio.get()
    if (serial !== lifecycle.suggestSerial || $aiMode.get() !== 'auto' || state.status !== 'active' || questionKey(state) !== key) return
    requestSuggestion()
  }, delay)
}

// Show the cached suggestion for the current question, or ask for one when the mode is automatic.
function refreshSuggestion() {
  const state = $studio.get()
  const mode = $aiMode.get()
  if (state.status !== 'active' || !state.current || mode === 'off') return
  const cached = lifecycle.suggestionCache.get(questionKey(state))
  if (cached) {
    $suggestion.set(cached)
    return
  }
  if (mode === 'auto' && state.current.autoSuggest !== false) scheduleAutoSuggestion()
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
    children.push(jsx(Button, { data: { 'data-studio-ai-suggest': true }, onClick: () => requestSuggestion('suggest'), keyHint: SHORTCUTS.ask, children: isEnum ? t('ai.askEnum') : t('ai.askText') }))
  } else if (mine.status === 'loading') {
    status = t('ai.status.loading')
    children.push(jsxs('span', {
      'data-studio-ai-loading': true,
      style: { ...typeStyle, alignItems: 'center', display: 'inline-flex', fontSize: '12px', gap: '6px' },
      children: [jsx(GlyphSpinner, { ariaLabel: t('ai.spinner') }), improving ? t('ai.improving') : t('ai.analyzing')]
    }))
    children.push(jsx(Button, { data: { 'data-studio-ai-stop': true }, onClick: clearSuggestion, keyHint: SHORTCUTS.discard, children: t('ai.stop') }))
  } else if (mine.status === 'error') {
    status = t('ai.status.error')
    // Plain words on screen; the technical detail only in the tooltip.
    children.push(jsx('span', { 'data-studio-ai-error': true, style: { color: 'var(--dt-destructive)', fontSize: '12px' }, title: mine.detail || undefined, children: t(`ai.${mine.errorKey || 'failed'}`) }))
    children.push(jsx(Button, { data: { 'data-studio-ai-retry-error': true }, onClick: () => requestSuggestion(mine.mode), keyHint: SHORTCUTS.ask, children: t('ai.retry') }))
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
      children.push(jsx(Button, { variant: 'accent', data: { 'data-studio-ai-use': true }, onClick: () => commitAnswer(''), keyHint: SHORTCUTS.useAi, children: t('ai.useDefault') }))
    } else if (!empty) {
      const label = improving ? t('ai.useVersion') : t('ai.putInField')
      children.push(jsx(Button, { variant: 'accent', data: { 'data-studio-ai-use': true }, onClick: applySuggestion, keyHint: SHORTCUTS.useAi, children: label }))
    }
    children.push(jsx(Button, { data: { 'data-studio-ai-discard': true }, onClick: discardSuggestion, keyHint: SHORTCUTS.discard, children: t('ai.discard') }))
    if (!improving) {
      children.push(jsx(Button, {
        ariaLabel: t('ai.anotherAria'),
        data: { 'data-studio-ai-retry': true },
        onClick: () => { lifecycle.suggestionCache.delete(mine.key); requestSuggestion('suggest') },
        title: t('ai.anotherAria'),
        keyHint: SHORTCUTS.another,
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

async function requestSuggestion(mode = 'suggest') {
  const state = $studio.get()
  if (state.status !== 'active' || !state.current || !lifecycle.pluginContext) return
  const improving = mode === 'improve'
  const typed = String(state.answer || '').trim()
  if (improving && (state.current.kind === 'enum' || !typed)) return
  cancelAutoSuggestion()
  const key = questionKey(state)
  const serial = ++lifecycle.suggestSerial
  $suggestion.set({ key, mode, status: 'loading' })
  let next
  try {
    const response = await withTimeout(lifecycle.pluginContext.rest('/suggest', {
      method: 'POST',
      body: {
        target: currentTarget(),
        intent: state.intent,
        mode,
        locale: activeLocale(),
        answer: improving ? typed : '',
        ladder: state.ladder.filter(rung => !isSkipped(rung.answer)).map(({ question, answer, category }) => ({ question, answer, category })),
        field: {
          id: state.current.category,
          kind: state.current.kind || 'text',
          question: state.current.question,
          options: state.current.kind === 'enum' ? [state.current.recommended, ...state.current.options].filter((v, i, a) => v && a.indexOf(v) === i) : [],
          recommended: state.current.recommended || null,
          hint: state.current.hint || null,
          guide: state.current.guide || null
        },
        ...(helperChoice() ? { model_choice: helperChoice() } : {}),
        ...($context.get()?.status === 'ready' ? { session_context: $context.get().summary.slice(0, 3000) } : {})
      }
    }), SUGGEST_CLIENT_TIMEOUT_MS)
    next = response?.ok
      ? { key, mode, status: 'ready', value: response.value || '', reason: response.reason || '', agrees: response.agrees, model: response.model || '', latency: response.latency_ms }
      : { key, mode, status: 'error', errorKey: response?.code === 'too_long' ? 'tooLong' : response?.error && !response?.empty ? 'failed' : 'noAnswer', detail: errorDetail(response) }
  } catch (error) {
    next = { key, mode, status: 'error', ...describeFailure(error) }
  }
  // Keep good suggestions even if the user already moved on: Back will show them instantly.
  if (next.status === 'ready' && !improving) lifecycle.suggestionCache.set(key, next)
  if (serial !== lifecycle.suggestSerial || questionKey($studio.get()) !== key) return
  $suggestion.set(next)
}

function applySuggestion() {
  const suggestion = $suggestion.get()
  const state = $studio.get()
  if (!suggestion || suggestion.status !== 'ready' || suggestion.key !== questionKey(state)) return
  if (state.current?.kind === 'enum') {
    commitAnswer(suggestion.value)
  } else {
    update({ type: 'SET_ANSWER', answer: suggestion.value })
    // The field now holds the AI text; drop the card so "Improve my text" works on the new text.
    lifecycle.suggestSerial += 1
    $suggestion.set(null)
  }
}

function discardSuggestion() {
  // Remembered as dismissed, so automatic mode does not ask again when the question comes back.
  const key = questionKey($studio.get())
  const dismissed = { key, mode: 'suggest', status: 'dismissed' }
  lifecycle.suggestionCache.set(key, dismissed)
  lifecycle.suggestSerial += 1
  $suggestion.set(dismissed)
}
