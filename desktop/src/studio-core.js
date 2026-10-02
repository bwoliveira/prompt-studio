// Prompt Studio core: turns the brief into sequential questions and builds the prompt with the
// target's engine. Pure ESM; no DOM, no network. All display text comes from ./i18n-core.js.
import { ENGINE as OPUS_ENGINE } from './engine-opus.js'
import { ENGINE as ASTRA_ENGINE } from './engine-astra.js'
import { ENGINE as SONNET_ENGINE } from './engine-sonnet.js'
import { CORE_MESSAGES } from './i18n-core.js'

// The target registry: one entry per target model. The core, the UI target switch, the default-target rule, the
// design-avoid step and the build's engine list (the imports above) all read it. Adding a model is one engine
// file, one import above and one entry here, plus its help and guide in i18n-core.js (a test checks that).
//   key           the Alt chord that selects the target in the UI
//   pattern       default-target rule: a session model name matching it picks this target; the target without a
//                 pattern (null) is the fallback. `priority` orders the patterns (lowest first): a gateway name
//                 such as 'openai/claude-sonnet-5-5' must reach Sonnet before the broader GPT pattern sees it.
//   capabilities  designAvoid: the engine takes the design-avoid line (interface work)
export const TARGETS = [
  { id: 'opus', label: 'Opus', model: OPUS_ENGINE.model, key: 'Alt+O', pattern: null, priority: 0, engine: OPUS_ENGINE, capabilities: { designAvoid: true } },
  { id: 'astra', label: 'Astra', model: ASTRA_ENGINE.model, key: 'Alt+A', pattern: /gpt|openai|astra|codex|\bo[1-9]\b/i, priority: 2, engine: ASTRA_ENGINE, capabilities: { designAvoid: false } },
  { id: 'sonnet', label: 'Sonnet', model: SONNET_ENGINE.model, key: 'Alt+T', pattern: /sonnet/i, priority: 1, engine: SONNET_ENGINE, capabilities: { designAvoid: true } }
]
const FALLBACK_TARGET = TARGETS.find(target => target.pattern === null)
const targetOf = id => TARGETS.find(target => target.id === id)
const targetLabel = id => (targetOf(id) || FALLBACK_TARGET).label
export const MESSAGES = CORE_MESSAGES
// Skipped text answer. '(pulado)' is the marker saved before v1 and is still understood.
export const SKIPPED = '(skipped)'
const NONE_WORDS = ['(skipped)', '(pulado)', 'none', 'nenhum', 'nenhuma', 'nada', '-', 'vazio', 'skip', 'nao evitar nada', 'avoid nothing']
// Design-step button labels, both locales, plus the pre-0.3.1 label; all mean "the default list".
const DESIGN_DEFAULT_WORDS = ['recommended list', 'lista recomendada', 'padrao do site', 'recommended', 'recomendado']
// The engine reads 'none' as "no design line"; an empty value would bring its default list back.
const DESIGN_NONE_VALUE = 'none'

const foldText = value => String(value ?? '').trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
const isNoneAnswer = text => NONE_WORDS.includes(foldText(text))

// Locale bundle ('en' is the default and the fallback for unknown locales).
function coreMessages(locale) {
  return (CORE_MESSAGES[locale] || CORE_MESSAGES.en).core
}

// t(locale, key, ...args): 'core.fields.context.question' style lookup, en fallback, key if missing.
export function coreText(locale, key, ...args) {
  const find = bundle => key.split('.').reduce((node, part) => node?.[part], bundle)
  const value = find(CORE_MESSAGES[locale]) ?? find(CORE_MESSAGES.en)
  if (typeof value === 'function') return value(...args)
  return typeof value === 'string' ? value : key
}

function engineOf(target) {
  return (targetOf(target) || FALLBACK_TARGET).engine
}

// Steps in impact order. `when(analysis, brief)` gates optional steps; enum options come from the engine.
//   thirdPartyText before context: AI suggestions for later steps already see the pasted text.
//   Only the user knows whether they have something to paste, so it gets no AI suggestion (collapsed paste).
//   thirdPartySource only after a paste ("Tell Claude what the content is and where it came from").
//   designAvoid only for interface work and the targets with that capability (the engine drops it otherwise); examples not for code or agents; subagents is always asked.
const STEPS = [
  { id: 'deliverable', kind: 'enum' },
  { id: 'thirdPartyText', kind: 'text', paste: true, autoSuggest: false },
  { id: 'thirdPartySource', kind: 'text', when: (a, brief) => Boolean(brief.thirdPartyText) },
  { id: 'context', kind: 'text' },
  { id: 'requirements', kind: 'text' },
  { id: 'success', kind: 'text' },
  { id: 'designAvoid', kind: 'design', capability: 'designAvoid', when: a => Boolean(a.interface) },
  { id: 'autonomy', kind: 'enum' },
  { id: 'subagents', kind: 'enum' },
  { id: 'examples', kind: 'text', when: a => !['code', 'agent'].includes(a.category) },
  { id: 'format', kind: 'enum' },
  { id: 'length', kind: 'enum' }
]
const stepById = id => STEPS.find(step => step.id === id)

function stepApplies(step, target) {
  if (step.capability && !targetOf(target)?.capabilities[step.capability]) return false
  return step.kind !== 'enum' || (engineOf(target).options[step.id] || []).length > 0
}

export function defaultTarget(model) {
  const name = String(model || '')
  const match = TARGETS.filter(target => target.pattern).sort((a, b) => a.priority - b.priority).find(target => target.pattern.test(name))
  return (match || FALLBACK_TARGET).id
}

export function fieldForTarget(fieldId, target) {
  const step = stepById(fieldId)
  return Boolean(step && stepApplies(step, target))
}

function optionLabel(fieldId, value, locale) {
  return coreMessages(locale).fields[fieldId]?.options?.[value] ?? value
}

// Map a typed or chosen answer back to a field value. `undefined` = not understood.
// Enum answers match en or pt labels, value ids, a label's part before '·', or a unique prefix.
export function answerToValue(fieldId, answer, target) {
  const step = stepById(fieldId)
  if (!step) return undefined
  const text = String(answer ?? '').trim()
  if (step.kind === 'text') return isNoneAnswer(text) ? '' : text
  const engine = engineOf(target)
  if (step.kind === 'design') {
    if (!text || DESIGN_DEFAULT_WORDS.includes(foldText(text))) return engine.DEFAULT_DESIGN_AVOID || ''
    return isNoneAnswer(text) ? DESIGN_NONE_VALUE : text
  }
  const values = engine.options[fieldId] || []
  if (!text) return engine.defaults[fieldId] ?? undefined
  const wanted = foldText(text)
  const names = value => Object.keys(CORE_MESSAGES).map(locale => foldText(optionLabel(fieldId, value, locale)))
  const exact = values.find(value => foldText(value) === wanted || names(value).some(name => name === wanted || name.split('·')[0].trim() === wanted))
  if (exact) return exact
  const prefix = values.filter(value => names(value).some(name => name.startsWith(wanted)))
  return prefix.length === 1 ? prefix[0] : undefined
}

// Canonical display label for an enum answer ("Take" -> "Take initiative"); other kinds unchanged.
export function answerLabel(fieldId, answer, target, locale = 'en') {
  const step = stepById(fieldId)
  if (!step || step.kind !== 'enum' || !String(answer ?? '').trim()) return answer
  const value = answerToValue(fieldId, answer, target)
  return value === undefined ? answer : optionLabel(fieldId, value, locale)
}

export function briefFromLadder(target, intent, ladder) {
  const brief = { goal: String(intent || '') }
  for (const rung of ladder || []) {
    const step = stepById(rung.category)
    if (!step || !stepApplies(step, target)) continue
    const value = answerToValue(step.id, rung.answer, target)
    if (value !== undefined) brief[step.id] = value
  }
  return brief
}

// Options offered for an enum step. The deliverable step always lists every option: the engine's guess from
// the draft can be wrong, and a choice that contradicts it is kept and noted by the engine (never hidden here).
// The other enum steps do not offer an option the engine flags as a conflict for this draft + other answers.
function acceptedValues(step, target, intent, ladder) {
  const engine = engineOf(target)
  const options = engine.options[step.id] || []
  if (step.id === 'deliverable') return options
  const base = briefFromLadder(target, intent, (ladder || []).filter(rung => rung.category !== step.id))
  return options.filter(value => {
    const conflicts = engine.analyze({ ...base, [step.id]: value }).conflicts?.[step.id] || []
    return !conflicts.includes(value)
  })
}

// Subagent recommendation: every engine owns it (Opus, Sonnet and Astra: 'auto').
function recommendSubagents(target, brief) {
  return engineOf(target).recommend(brief)
}

function recommendedValue(step, target, brief, accepted) {
  const wanted = step.id === 'subagents' ? recommendSubagents(target, brief) : engineOf(target).defaults[step.id]
  return accepted.includes(wanted) ? wanted : accepted[0]
}

// An enum step is asked only when it offers a real choice: more than one accepted option besides
// the default (for subagents, which has no fixed default, more than one accepted option).
function hasRealChoice(step, target, intent, ladder) {
  if (step.kind !== 'enum') return true
  const accepted = acceptedValues(step, target, intent, ladder)
  const fallback = engineOf(target).defaults[step.id]
  return (fallback == null ? accepted : accepted.filter(value => value !== fallback)).length > 1
}

function shouldAsk(step, target, intent, ladder, analysis, brief) {
  if (step.when && !step.when(analysis, brief)) return false
  return hasRealChoice(step, target, intent, ladder)
}

function perTarget(value, target) {
  return value && typeof value === 'object' ? value[target] || '' : value || ''
}

function questionObject(step, target, intent, ladder, locale) {
  const msg = coreMessages(locale)
  const text = msg.fields[step.id]
  const engine = engineOf(target)
  const brief = briefFromLadder(target, intent, ladder)
  const analysis = engine.analyze(brief)
  let question = text.question(targetLabel(target))
  const help = perTarget(text.help, target)
  const guide = perTarget(text.guide, target)
  if (step.kind === 'enum') {
    const accepted = acceptedValues(step, target, intent, ladder)
    const recommended = recommendedValue(step, target, brief, accepted)
    if (step.id === 'deliverable' && engine.defaults.deliverable === 'auto') question += msg.detected(optionLabel('deliverable', analysis.deliverable, locale))
    return { done: false, question, recommended: recommended ? optionLabel(step.id, recommended, locale) : '', options: accepted.map(value => optionLabel(step.id, value, locale)), category: step.id, kind: step.kind, help, guide }
  }
  if (step.kind === 'design') {
    return { done: false, question, recommended: msg.designDefault, options: [msg.designNone], category: step.id, kind: step.kind, hint: engine.DEFAULT_DESIGN_AVOID || '', help, guide }
  }
  return { done: false, question: step.paste ? question : msg.optional(question), recommended: '', options: [], category: step.id, kind: step.kind, help, guide, autoSuggest: step.autoSuggest !== false, paste: Boolean(step.paste) }
}

// Next step for the answered steps so far, or { done: true }.
export function nextQuestion(target, intent, ladder, locale = 'en') {
  const asked = new Set((ladder || []).map(rung => rung.category))
  const brief = briefFromLadder(target, intent, ladder)
  const analysis = engineOf(target).analyze(brief)
  for (const step of STEPS) {
    if (asked.has(step.id) || !stepApplies(step, target)) continue
    if (!shouldAsk(step, target, intent, ladder, analysis, brief)) continue
    return questionObject(step, target, intent, ladder, locale)
  }
  return { done: true, reason: coreMessages(locale).done }
}

// The question for one specific field ("Back" reopens exactly that field, even if its condition
// no longer holds).
export function questionFor(target, intent, ladder, fieldId, locale = 'en') {
  const step = stepById(fieldId)
  if (!step || !stepApplies(step, target)) return null
  return questionObject(step, target, intent, ladder, locale)
}

// Total steps for this brief (answered + still to ask), for "Step 3 of 8".
export function stepCount(target, intent, ladder) {
  const brief = briefFromLadder(target, intent, ladder)
  const analysis = engineOf(target).analyze(brief)
  const answered = new Set((ladder || []).map(rung => rung.category))
  return STEPS.filter(step => stepApplies(step, target) && (answered.has(step.id) || shouldAsk(step, target, intent, ladder, analysis, brief))).length
}

// Final prompt: exactly what the target's engine builds from the brief.
export function studioPrompt(target, intent, ladder) {
  const { prompt, notes } = engineOf(target).build(briefFromLadder(target, intent, ladder))
  return { prompt, notes: notes || [] }
}

// Warnings for the preview, in the Studio's language: one per answer the engine flags as a conflict with the
// draft (e.g. a deliverable picked against the draft's verb). The engine's own notes stay in English for the
// prompt; these are what the user reads, with the option and question labels of the active locale.
export function studioWarnings(target, intent, ladder, locale = 'en') {
  const msg = coreMessages(locale)
  const brief = briefFromLadder(target, intent, ladder)
  const conflicts = engineOf(target).analyze(brief).conflicts || {}
  const out = []
  for (const [fieldId, values] of Object.entries(conflicts)) {
    const step = stepById(fieldId)
    if (!step || brief[fieldId] === undefined || !(values || []).includes(brief[fieldId])) continue
    const question = msg.fields[fieldId]?.question(targetLabel(target)) || fieldId
    out.push(msg.conflict(optionLabel(fieldId, brief[fieldId], locale), question))
  }
  return out
}

// Question/answer pairs the AI writer gets: only steps really answered (skipped/empty/"none" left
// out; the engine baseline carries the defaults). The design default is sent as its real text.
// A step whose gate no longer holds for the final brief (e.g. the design answer after the deliverable was
// edited to a plan) is left out: the engine drops it from the baseline, and the AI writer must not get it.
export function studioAnswers(target, intent, ladder, locale = 'en') {
  const byId = new Map((ladder || []).map(rung => [rung.category, rung]))
  const engine = engineOf(target)
  const brief = briefFromLadder(target, intent, ladder)
  const analysis = engine.analyze(brief)
  const out = []
  for (const step of STEPS) {
    if (!stepApplies(step, target)) continue
    if (step.when && !step.when(analysis, brief)) continue
    const rung = byId.get(step.id)
    if (!rung) continue
    const answer = String(rung.answer || '').trim()
    if (!answer || isNoneAnswer(answer)) continue
    const question = coreMessages(locale).fields[step.id].question(targetLabel(target))
    if (step.kind === 'design') {
      const isDefault = DESIGN_DEFAULT_WORDS.includes(foldText(answer))
      out.push({ id: step.id, kind: 'design', question, answer: isDefault ? engine.DEFAULT_DESIGN_AVOID || '' : answer, isDefault })
      continue
    }
    if (step.kind === 'enum') {
      const value = answerToValue(step.id, answer, target)
      out.push({ id: step.id, kind: 'enum', question, answer, isDefault: engine.defaults[step.id] != null && value === engine.defaults[step.id] })
      continue
    }
    out.push({ id: step.id, kind: step.id === 'examples' ? 'example' : 'text', question, answer })
  }
  return out
}
