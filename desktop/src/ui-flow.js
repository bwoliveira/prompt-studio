// ---------------------------------------------------------------------------
// Flow: every step is a button click; each button also has its key printed on it (installStudioKeys).
// ---------------------------------------------------------------------------
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

// The conversation the Studio was opened in, as a host.composer address (see focusedAddress): Close, dispose,
// placing and F9 all go there, never to whatever composer is active by then.
let openedAddress = 'new'

// Resolves after two animation frames and a short timer: later than the app's deferred composer-focus
// retries (the focus effect may run after a paint, then retries on the next frame and a 0 ms timer).
const FOCUS_SETTLE_MS = 50
function hostFocusSettled() {
  return new Promise(resolve => {
    const done = () => later(resolve, globalThis.__promptStudioFocusSettleMs ?? FOCUS_SETTLE_MS)
    if (typeof requestAnimationFrame !== 'function') return done()
    requestAnimationFrame(() => requestAnimationFrame(done))
  })
}

// One opening and one placement at a time: host.composer calls are async.
let starting = false
// The draft taken out of the composer while the Studio opens (not yet in $studio), and a counter bumped on
// dispose so an opening cut short by disable or hot reload never continues (see disposeComposerFlow).
let pendingDraft = null
let lifecycle = 0
// The preview placement in flight (a promise of its success), so a dispose waits for it (see disposeComposerFlow).
let placement = null

// On dispose the composer gets its draft back, whether the Studio was opening or open.
function disposeComposerFlow() {
  lifecycle += 1
  const state = $studio.get()
  const lost = pendingDraft ?? (state.status !== 'idle' && state.intent ? { text: state.intent, address: openedAddress } : null)
  const inFlight = placement
  pendingDraft = null
  starting = false
  $placing.set(false)
  if (!lost) return
  // pluginContext is cleared right after this, and restore may run later: take the clipboard API now.
  const os = pluginContext?.os
  const restore = () => returnDraftTo(lost.address, lost.text, { os, reason: 'closed' })
  // A prompt being placed wins: the request comes back only if that placement fails.
  if (inFlight) inFlight.then(ok => { if (!ok) restore() })
  else restore()
}

async function startFromComposer() {
  if ($studio.get().status !== 'idle' || starting) return
  if (!composerAdapter.available()) {
    host.notify({ kind: 'error', message: tr('notify.needsComposer') })
    return
  }
  starting = true
  const generation = lifecycle
  // A dispose clears pluginContext; a recovery that runs after one still needs the clipboard.
  const os = pluginContext?.os
  // F9 sends only into the session the Studio was opened in (see sendPreview): taken before any await.
  const originAddress = focusedAddress()
  try {
    // Read and cleared by the same address every later write uses: with two panes, the composer that was
    // typed in last (null) can belong to another conversation than the focused one.
    const draft = await composerAdapter.readDraft(originAddress)
    if (draft === null) {
      host.notify({ kind: 'error', message: tr('notify.readFailed') })
      return
    }
    const intent = draft.trim()
    if (!intent) {
      host.notify({ kind: 'info', message: tr('notify.empty', SHORTCUTS.open) })
      return
    }
    if (intent.length < 10) {
      host.notify({ kind: 'warning', message: tr('notify.short') })
      return
    }
    if (focusedAddress() !== originAddress || generation !== lifecycle) return
    if (!(await composerAdapter.writeDraft('', originAddress))) {
      host.notify({ kind: 'error', message: tr('notify.clearFailed') })
      return
    }
    if (generation !== lifecycle) {
      returnDraftTo(originAddress, draft, { os, reason: 'closed' })
      return
    }
    pendingDraft = { text: draft, address: originAddress }
    // setDraft makes the app focus the composer it painted, now and again on a later frame and timer
    // (focusComposerInput). The studio opens only after those retries, so its focus is not taken back.
    await hostFocusSettled()
    if (generation !== lifecycle) return
    pendingDraft = null
    if ($studio.get().status !== 'idle') {
      await returnDraftTo(originAddress, draft, { reason: 'closed' })
      return
    }
    // The user switched conversations while it opened: the draft goes back where it came from, never
    // into the conversation now on screen.
    if (focusedAddress() !== originAddress) {
      await returnDraftTo(originAddress, draft)
      return
    }
    suggestionCache.clear()
    $helpOpen.set(false)
    // Settings are read from storage on every opening (storage is the source of truth).
    loadSettings()
    openedAddress = originAddress
    update({ type: 'START', intent })
    startContextRead()
    askNext()
  } finally {
    starting = false
  }
}

function focusedSession() {
  return host.state?.focusedSessionId?.get?.() ?? null
}

// The focused conversation as a host.composer address: its stored id (a saved conversation whose runtime is not
// bound yet has only that one), else its runtime id, else 'new' for a fresh chat. Never null, which would reach
// whatever composer is active later.
function focusedAddress() {
  return host.state?.focusedStoredSessionId?.get?.() ?? focusedSession() ?? 'new'
}

// The draft was taken out of its composer, so it must land somewhere, never over another draft: its own
// conversation's composer (address: session id or 'new'); else the clipboard; else appended below the text of
// the composer in use (nothing sent); else the error notice carries the text itself.
// reason 'switch': the user changed conversations while the Studio opened; 'closed': Close, or the plugin
// was disabled or reloaded. os: the clipboard API, kept by the caller when the context is being disposed.
async function returnDraftTo(address, draft, { reason = 'switch', os = pluginContext?.os } = {}) {
  const key = reason === 'switch' ? 'sessionChanged' : 'draftBack'
  if (await composerAdapter.placeDraft(draft, address)) {
    if (reason === 'switch') host.notify({ kind: 'info', message: tr('notify.sessionChanged') })
    return true
  }
  let copied = false
  try {
    copied = (await os?.writeClipboard?.(draft)) === true
  } catch {
    copied = false
  }
  if (copied) {
    host.notify({ kind: 'warning', message: tr(`notify.${key}Copied`) })
    return false
  }
  if (await composerAdapter.appendDraft(draft)) {
    host.notify({ kind: 'warning', message: tr(`notify.${key}Here`) })
    return false
  }
  host.notify({ kind: 'error', message: tr(`notify.${key}Lost`, draft) })
  return false
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

function cancelStudio() {
  const state = $studio.get()
  // While the prompt is being placed, Close would race it and put the old draft over the prompt.
  if (state.status === 'idle' || $placing.get()) return
  clearSuggestion()
  composeSerial += 1
  stopContextRead()
  $helpOpen.set(false)
  const intent = state.intent
  update({ type: 'RESET' })
  if (intent) returnDraftTo(openedAddress, intent, { reason: 'closed' })
}

// Final prompt. With AI on, the model writes it from the answers (the local engine prompt goes
// along as a baseline). If the model fails or times out, the engine prompt is used and the user
// is told so in plain words (the technical detail stays in the note's tooltip).
let composeSerial = 0
const COMPOSE_CLIENT_TIMEOUT_MS = 50_000
// A bit above the backend's 15 s hard deadline for /context.
const CONTEXT_CLIENT_TIMEOUT_MS = 17_000
const SUGGEST_CLIENT_TIMEOUT_MS = 25_000
const TIMEOUT_MESSAGE = 'client timeout'
const MISSING_ROUTE = /404|405|not found|method not allowed/i

function withTimeout(promise, ms) {
  let cancel
  return Promise.race([
    promise,
    new Promise((_, reject) => { cancel = later(() => reject(new Error(TIMEOUT_MESSAGE)), ms) })
  ]).finally(() => cancel())
}

// Technical failure -> one of the plain-language message keys, plus the raw detail for the tooltip.
function describeFailure(error) {
  const detail = String(error?.message || error || '')
  if (MISSING_ROUTE.test(detail)) return { errorKey: 'missing', detail }
  if (detail === TIMEOUT_MESSAGE) return { errorKey: 'tooSlow', detail }
  return { errorKey: 'failed', detail }
}

// ok:false reply -> tooltip text: the localized text for the backend's `code`, or the raw `error`
// when the code is unknown or absent (older backend).
function errorDetail(response) {
  const code = typeof response?.code === 'string' ? response.code : ''
  const key = `errors.${code}`
  const text = code ? tr(key, SHORTCUTS.settings) : null
  return text && text !== key ? text : String(response?.error || '')
}

function stopContextRead() {
  contextSerial += 1
  contextPromise = null
  $context.set(null)
}

// Once per opening, in the background: only with AI on, the switch on and a stored session id (a fresh
// draft has none). Never blocks the form; a failure leaves a short note and the Studio goes on without it.
function startContextRead() {
  stopContextRead()
  const sessionId = host.state?.focusedStoredSessionId?.get?.()
  if (!pluginContext || $aiMode.get() === 'off' || !$readContext.get() || !sessionId) return
  const serial = contextSerial
  const profile = host.state?.focusedSessionProfile?.get?.()
  const choice = contextChoice()
  const body = { session_id: sessionId, ...(profile ? { profile } : {}), locale: activeLocale(), ...(choice ? { model_choice: choice } : {}) }
  $context.set({ status: 'reading' })
  const fail = code => {
    const key = `errors.${code}`
    const text = tr(key, SHORTCUTS.settings)
    return { status: 'error', reason: text && text !== key ? text : tr('errors.unavailable') }
  }
  contextPromise = withTimeout(pluginContext.rest('/context', { method: 'POST', body }), globalThis.__promptStudioContextTimeoutMs ?? CONTEXT_CLIENT_TIMEOUT_MS)
    .then(
      response => (response?.ok && typeof response.summary === 'string' && response.summary.trim()
        ? { status: 'ready', summary: response.summary, model: response.model || '', ms: Number(response.ms) || 0 }
        : fail(response?.ok ? 'invalid_summary' : typeof response?.code === 'string' ? response.code : 'unavailable')),
      error => fail(String(error?.message || error) === TIMEOUT_MESSAGE ? 'timeout' : 'unavailable')
    )
    .then(next => {
      if (serial !== contextSerial) return
      contextPromise = null
      $context.set(next)
    })
}

async function generatePrompt() {
  const state = $studio.get()
  if (!['active', 'done'].includes(state.status)) return
  const locale = activeLocale()
  // A typed but not yet confirmed answer counts, the same as confirming it first.
  const typed = String(state.answer || '').trim()
  if (state.status === 'active' && typed && state.current && answerToValue(state.current.category, typed, currentTarget()) === undefined) {
    unknownOption(state.current)
    return
  }
  const answer = state.current ? answerLabel(state.current.category, typed, currentTarget(), locale) : ''
  update({ type: 'WRITE_BRIEF', answer, includeCurrent: state.status === 'active' })
  const requestState = $studio.get()
  const target = currentTarget()
  const ladder = requestState.ladder.filter(rung => !isSkipped(rung.answer))
  let engineResult
  try {
    engineResult = studioPrompt(target, requestState.intent, ladder)
  } catch (error) {
    // Contradictory choices (e.g. implementation on an analysis-only request).
    host.notify({ kind: 'error', message: tr('notify.conflict', String(error?.message || error)) })
    update({ type: 'BRIEF_FAILED' })
    return
  }
  clearSuggestion()
  let prompt = engineResult.prompt
  // The engine's notes (e.g. a deliverable that contradicts the draft) reach the preview whatever the AI mode:
  // the AI prompt is written from the same baseline and choices, so they apply to both versions.
  const engineNote = (engineResult.notes || []).join(' ')
  let note = ''
  let noteDetail = ''
  if ($aiMode.get() !== 'off' && pluginContext) {
    const serial = ++composeSerial
    try {
      // Client-side ceiling a bit above the backend's 45 s deadline: a hung transport falls back
      // to the local engine instead of leaving the studio stuck on "writing".
      const response = await withTimeout(pluginContext.rest('/compose', {
        method: 'POST',
        body: { target, intent: requestState.intent, answers: studioAnswers(target, requestState.intent, ladder, locale), baseline: engineResult.prompt, locale, ...(helperChoice() ? { model_choice: helperChoice() } : {}) }
      }), COMPOSE_CLIENT_TIMEOUT_MS)
      if (serial !== composeSerial || $studio.get().status !== 'briefing') return // cancelled meanwhile
      if ($aiMode.get() === 'off') {
        // AI switched off while it was writing: keep the engine prompt.
      } else if (response?.ok && response.prompt) {
        prompt = response.prompt
        note = response.notes || ''
      } else {
        note = tr('preview.empty')
        noteDetail = errorDetail(response)
      }
    } catch (error) {
      if (serial !== composeSerial || $studio.get().status !== 'briefing') return
      if ($aiMode.get() !== 'off') {
        const { errorKey, detail } = describeFailure(error)
        note = tr(errorKey === 'missing' ? 'preview.missing' : 'preview.failed')
        noteDetail = detail
      }
    }
  }
  update({ type: 'BRIEF_READY', ai: prompt !== engineResult.prompt ? prompt : '', engine: engineResult.prompt, note: [engineNote, note].filter(Boolean).join(' '), noteDetail })
}

// Preview accepted: the prompt goes to the composer (not sent). setDraft replaces only the text,
// so attachments staged in the composer stay there and go with it.

// The prompt goes into the conversation the Studio was opened in. Tracked in `placement` so a dispose during
// the write waits for its outcome instead of racing it.
function placePrompt(text) {
  const run = composerAdapter.placeDraft(text, openedAddress)
  placement = run
  run.finally(() => { if (placement === run) placement = null })
  return run
}

async function usePreview() {
  const state = $studio.get()
  if (state.status !== 'preview' || !state.preview || $placing.get()) return
  $placing.set(true)
  try {
    // Into the conversation the Studio was opened in; false (not on screen) keeps the preview open.
    if (!(await placePrompt(state.preview[state.preview.showing]))) {
      host.notify({ kind: 'error', message: tr('notify.placeFailed') })
      return
    }
  } finally {
    $placing.set(false)
  }
  if ($studio.get() !== state) return
  stopContextRead()
  $helpOpen.set(false)
  update({ type: 'RESET' })
}

// F9 on the preview: send as if the user pressed Enter, in the session the Studio was opened in.
// host.composer.submit sends text only: attachments staged in the composer stay there, unsent (the
// preview says so). submit is fail-closed (false = not sent, e.g. a turn is running): then the
// prompt is placed in the composer with a short note, so it is never lost. If the focused session
// changed since opening, it is not sent either (it would land in another conversation).
async function sendPreview() {
  const state = $studio.get()
  if (state.status !== 'preview' || !state.preview || $placing.get()) return
  const text = state.preview[state.preview.showing]
  let sent = false
  try {
    sent = focusedAddress() === openedAddress && typeof host.composer?.submit === 'function' && host.composer.submit(openedAddress, text) === true
  } catch {
    sent = false
  }
  if (!sent) {
    $placing.set(true)
    try {
      if (!(await placePrompt(text))) {
        host.notify({ kind: 'error', message: tr('notify.placeFailed') })
        return
      }
    } finally {
      $placing.set(false)
    }
    host.notify({ kind: 'info', message: tr('notify.placedNotSent') })
  }
  if ($studio.get() !== state) return
  stopContextRead()
  $helpOpen.set(false)
  update({ type: 'RESET' })
}

async function requestSuggestion(mode = 'suggest') {
  const state = $studio.get()
  if (state.status !== 'active' || !state.current || !pluginContext) return
  const improving = mode === 'improve'
  const typed = String(state.answer || '').trim()
  if (improving && (state.current.kind === 'enum' || !typed)) return
  cancelAutoSuggestion()
  const key = questionKey(state)
  const serial = ++suggestSerial
  $suggestion.set({ key, mode, status: 'loading' })
  let next
  try {
    const response = await withTimeout(pluginContext.rest('/suggest', {
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
  if (next.status === 'ready' && !improving) suggestionCache.set(key, next)
  if (serial !== suggestSerial || questionKey($studio.get()) !== key) return
  $suggestion.set(next)
}

function useSuggestion() {
  const suggestion = $suggestion.get()
  const state = $studio.get()
  if (!suggestion || suggestion.status !== 'ready' || suggestion.key !== questionKey(state)) return
  if (state.current?.kind === 'enum') {
    commitAnswer(suggestion.value)
  } else {
    update({ type: 'SET_ANSWER', answer: suggestion.value })
    // The field now holds the AI text; drop the card so "Improve my text" works on the new text.
    suggestSerial += 1
    $suggestion.set(null)
  }
}

function discardSuggestion() {
  // Remembered as dismissed, so automatic mode does not ask again when the question comes back.
  const key = questionKey($studio.get())
  const dismissed = { key, mode: 'suggest', status: 'dismissed' }
  suggestionCache.set(key, dismissed)
  suggestSerial += 1
  $suggestion.set(dismissed)
}

