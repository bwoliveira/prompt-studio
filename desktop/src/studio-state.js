// @core-start
// Studio state machine: idle → asking (engine picks the next step) → active (step on screen)
// → … → done (no more steps) → briefing (writing the prompt) → preview (user reviews it) → idle. `ladder` holds the answered
// steps in order; the UI never mutates it directly.
export function initialStudioState() {
  return {
    answer: '',
    current: null,
    intent: '',
    ladder: [],
    status: 'idle',
    preview: null,
    // Step being edited in place: { index, rung } with the original answer, so it can be restored.
    editing: null
  }
}

function asRung(current, answer) {
  return {
    answer: answer || current.recommended || '',
    category: current.category ?? null,
    question: current.question || '',
    recommended: current.recommended || ''
  }
}

function withCommittedCurrent(state, answer) {
  if (!state.current) return state
  const rung = asRung(state.current, answer ?? state.answer)
  // An edited step goes back to its own place, so later answers keep their order.
  const at = state.editing ? Math.min(state.editing.index, state.ladder.length) : state.ladder.length
  return { ...state, answer: '', current: null, editing: null, ladder: [...state.ladder.slice(0, at), rung, ...state.ladder.slice(at)] }
}

// Put the step being edited back with its original answer.
function withEditRestored(state) {
  if (!state.editing) return state
  const { index, rung } = state.editing
  const at = Math.min(index, state.ladder.length)
  return { ...state, editing: null, ladder: [...state.ladder.slice(0, at), rung, ...state.ladder.slice(at)] }
}

function canEditStep(state, index) {
  return ['active', 'done'].includes(state.status) && Number.isInteger(index) && index >= 0 && index < state.ladder.length
}

export function reduceStudio(state, action) {
  switch (action.type) {
    case 'START':
      return {
        ...initialStudioState(),
        intent: action.intent,
        status: 'asking'
      }
    case 'SET_ANSWER':
      return state.status === 'active' ? { ...state, answer: action.answer } : state
    case 'COMMIT_ANSWER':
      if (state.status !== 'active' || !state.current) return state
      return { ...withCommittedCurrent(state, action.answer), status: 'asking' }
    case 'INTERROGATION': {
      if (state.status !== 'asking') return state
      const response = action.response || {}
      if (response.done) return { ...state, current: null, status: 'done' }
      return {
        ...state,
        answer: '',
        current: {
          category: response.category ?? null,
          options: Array.isArray(response.options) ? response.options : [],
          question: response.question || '',
          recommended: response.recommended || '',
          kind: response.kind || 'text',
          hint: response.hint || '',
          help: response.help || '',
          guide: response.guide || '',
          // false = the AI is not asked by itself on this step (only the user knows the answer).
          autoSuggest: response.autoSuggest !== false,
          paste: Boolean(response.paste)
        },
        status: 'active'
      }
    }
    case 'WRITE_BRIEF': {
      if (state.status !== 'active' && state.status !== 'done') return state
      const explicit = action.answer && String(action.answer).trim()
      const next = action.includeCurrent && explicit
        ? withCommittedCurrent(state, String(action.answer).trim())
        : withEditRestored({ ...state, current: null, answer: '' })
      return { ...next, status: 'briefing' }
    }
    case 'EDIT_STEP': {
      // Reopen one answered step without dropping the ones after it.
      const base = withEditRestored(state)
      if (!canEditStep(base, action.index)) return state
      return {
        ...base,
        answer: '',
        current: null,
        editing: { index: action.index, rung: base.ladder[action.index] },
        ladder: base.ladder.filter((_, index) => index !== action.index),
        status: 'asking'
      }
    }
    case 'CANCEL_EDIT':
      if (!state.editing || !['active', 'asking', 'done'].includes(state.status)) return state
      return { ...withEditRestored(state), answer: '', current: null, status: 'asking' }
    case 'BRIEF_FAILED':
      return state.status === 'briefing' ? { ...state, status: 'done' } : state
    case 'BRIEF_READY':
      // Preview before anything reaches the composer. `ai` is empty when the AI was off or failed;
      // `engine` is the prompt built without AI from the same answers.
      return state.status === 'briefing'
        ? { ...state, preview: { ai: action.ai || '', engine: action.engine || '', showing: action.ai ? 'ai' : 'engine', note: action.note || '', noteDetail: action.noteDetail || '', warnings: action.warnings || [] }, status: 'preview' }
        : state
    case 'SHOW_VERSION':
      return state.status === 'preview' && state.preview?.[action.version]
        ? { ...state, preview: { ...state.preview, showing: action.version } }
        : state
    case 'BACK_TO_STEPS':
      return state.status === 'preview' ? { ...state, preview: null, status: 'done' } : state
    case 'RETARGET':
      if (!['active', 'done', 'asking'].includes(state.status)) return state
      return { ...state, answer: '', current: null, editing: null, ladder: action.ladder, status: 'asking' }
    case 'RESET':
      return initialStudioState()
    default:
      return state
  }
}
// @core-end

const $studio = atom(initialStudioState())
// True while the preview's prompt is being written into the composer (host.composer is async): the studio
// is frozen until the write settles, so the placed prompt and the studio state cannot diverge.
const $placing = atom(false)
let pluginContext = null

// Timers go through ctx.setTimeout so the host clears them on dispose (SDK pitfall: bare globals are
// not tracked). It returns a disposer. Plain global only when the host has no ctx.setTimeout.
function later(fn, ms) {
  if (typeof pluginContext?.setTimeout === 'function') return pluginContext.setTimeout(fn, ms)
  const id = setTimeout(fn, ms)
  return () => clearTimeout(id)
}

