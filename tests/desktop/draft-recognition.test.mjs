// Ticket #24: the three engines classify the same drafts the same way. The table mixes positive drafts,
// negative ones (no verb, a question) and near misses (a word that looks like a signal but is not one).
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { ENGINE as OPUS } from '../../desktop/src/engine-opus.js'
import { ENGINE as SONNET } from '../../desktop/src/engine-sonnet.js'
import { ENGINE as ASTRA } from '../../desktop/src/engine-astra.js'
import { nextQuestion } from '../../desktop/studio-core.mjs'

const ENGINES = { opus: OPUS, sonnet: SONNET, astra: ASTRA }

// [draft, expected deliverable, why]
const TABLE = [
  // code artifacts are code, whatever else the draft mentions
  ['Write unit tests for the parser', 'implementation', 'tests are code'],
  ['Escreva testes unitários para o parser', 'implementation', 'pt: testes'],
  ['Write a SQL query that lists late orders', 'implementation', 'query is code, sql is not the deliverable'],
  ['Escreva uma query SQL que liste os pedidos atrasados', 'implementation', 'pt query'],
  ['Write a regex that matches ISO dates', 'implementation', 'regex'],
  ['Write a README for the project', 'implementation', 'readme'],
  ['Escreva um Dockerfile para a API', 'implementation', 'dockerfile'],
  ['Write a class that parses dates', 'implementation', 'class (singular)'],
  ['Escreva uma classe que leia datas', 'implementation', 'pt classe'],
  ['Write a Python script that parses the CSV and email me the result', 'implementation', 'email is a verb here'],
  ['Write a script and email me the result', 'implementation', 'email is a verb here'],
  ['Write a function that validates the product description', 'implementation', 'near miss: description after the code artifact'],
  ['Write a function to copy files', 'implementation', 'near miss: copy is a verb'],
  // text artifacts are text
  ['Write an email to the team about the new app', 'text', 'email noun'],
  ['Escreva um e-mail para o cliente explicando o atraso', 'text', 'pt e-mail noun'],
  ['Write the copy for the landing page', 'text', 'copy'],
  ['Redija a descrição do app', 'text', 'descricao'],
  ['Write the description of the app', 'text', 'description'],
  ['Escreva um post sobre o app novo', 'text', 'post'],
  // questions and no verb: answer; cron and rest are not signals
  ['Como funciona o cron do Linux?', 'answer', 'cron is not a workflow verb'],
  ['How does cron work?', 'answer', 'en cron'],
  ['Preciso entender o rest do projeto', 'answer', 'rest is not code'],
  ['Preciso entender a API REST do projeto', 'implementation', 'near miss: api is code'],
  ['Automatize o backup com um cron', 'workflow', 'verb automatize still decides'],
  // the first verb in the text decides, not the rule order
  ['Create a plan for the product launch', 'plan', 'plan as the object of create'],
  ['Crie um plano de lançamento do produto', 'plan', 'pt'],
  ['Build a review dashboard', 'implementation', 'build comes before review'],
  ['Construa um painel de revisão', 'implementation', 'pt'],
  ['Review the plan for the API', 'review', 'review comes before plan'],
  ['Revise o código e crie testes', 'review', 'review first'],
  ['Crie uma planilha de vendas', 'data', 'spreadsheet as the object of create'],
  ['Create a sales spreadsheet', 'data', 'en'],
  ['Crie um script que leia uma planilha', 'implementation', 'near miss: spreadsheet is not the artifact'],
  ['Crie um dashboard React que mostre as vendas a partir de um CSV', 'implementation', 'near miss: csv after create'],
  ['Limpe os dados da planilha de clientes', 'data', 'data verb'],
  ['Analise a planilha de vendas', 'data', 'analysis of a spreadsheet stays data'],
  // Portuguese verbs
  ['Gere um script que leia o log de erros', 'implementation', 'gerar'],
  ['Monte uma lista de tarefas para a semana', 'implementation', 'montar'],
  ['Resuma o relatório de vendas', 'analysis', 'resumir'],
  ['Configure o nginx no servidor', 'workflow', 'configurar'],
  ['Instale o node na máquina nova', 'workflow', 'instalar'],
  // questions and open drafts
  ['O que é um pull request?', 'answer', 'question'],
  ['Me ajuda com o projeto da empresa', 'answer', 'nothing to recognise'],
  // a text artifact named by a generate/assemble verb is text (review of #24, finding 1)
  ['Gere um e-mail de cobrança para o cliente', 'text', 'gerar + e-mail'],
  ['Monte um e-mail de boas-vindas', 'text', 'montar + e-mail'],
  ['Gere um post de blog sobre o lançamento', 'text', 'gerar + post'],
  ['Monte uma mensagem de boas-vindas', 'text', 'montar + mensagem'],
  ['Gere uma carta de apresentação', 'text', 'gerar + carta'],
  ['Gere um script que envie um e-mail', 'implementation', 'near miss: the script comes first'],
  ['Gere um app de blog', 'implementation', 'near miss: app comes before blog'],
  ['Monte uma API para o envio de e-mails', 'implementation', 'near miss: api comes before e-mails'],
  // a question stays an answer; the verbs inside it do not fire (finding 2)
  ['Como instalar o Docker?', 'answer', 'pt question with instalar'],
  ['Como instalar o Docker', 'answer', 'pt question without the mark'],
  ['Como resumir um livro?', 'answer', 'pt question with resumir'],
  ['Como configurar o nginx?', 'answer', 'pt question with configurar'],
  ['Como faço para instalar o Docker no servidor?', 'answer', 'pt long question'],
  ['Como instalar o Docker? Seja breve.', 'answer', 'question first, then a style note'],
  ['Como criar um app?', 'answer', 'question form wins over a create verb'],
  ['How do I install Docker?', 'answer', 'en question'],
  ['How do I summarize a book?', 'answer', 'en question'],
  ['How do I write a script?', 'answer', 'en question with a make verb'],
  ['Instale o Docker no servidor', 'workflow', 'near miss: an order, not a question'],
  ['Resuma o livro em dez linhas', 'analysis', 'near miss: an order'],
  ['Como especialista em redes, escreva um e-mail de cobrança', 'text', 'near miss: "como" means "as a" here'],
  ['Can you create a script that parses dates?', 'implementation', 'near miss: a polite order, not a wh-question'],
  // a report, summary or description is text; tests as a noun inside it is not code (finding 3)
  ['Write a summary of the test results for the team', 'text', 'summary of test results'],
  ['Escreva um relatório dos testes de usuário', 'text', 'pt relatório dos testes'],
  ['Write a report on the test results', 'text', 'report'],
  ['Write a test report for the team', 'text', 'test as a modifier of report'],
  ['Escreva um relatório de testes', 'text', 'pt'],
  ['Gere um resumo dos testes', 'text', 'gerar + resumo + testes'],
  ['Write a script that generates a report of the tests', 'implementation', 'near miss: script comes first'],
  ['Escreva um script para testes', 'implementation', 'near miss: script first'],
  ['Write tests for the report generator', 'implementation', 'near miss: tests are the artifact'],
]

for (const [draft, expected, why] of TABLE) {
  test(`draft recognition: "${draft}" is ${expected} (${why})`, () => {
    const got = Object.fromEntries(Object.entries(ENGINES).map(([id, engine]) => [id, engine.analyze({ goal: draft }).deliverable]))
    assert.deepEqual(got, { opus: expected, sonnet: expected, astra: expected })
  })
}

test('draft recognition: Astra reads goal plus requirements, like Opus and Sonnet', () => {
  const brief = { goal: 'Preciso de ajuda com isto', requirements: 'Crie uma planilha de vendas' }
  for (const [id, engine] of Object.entries(ENGINES)) assert.equal(engine.analyze(brief).deliverable, 'data', id)
})

test('draft recognition: the deliverable value and line endings are normalised on every engine', () => {
  for (const [id, engine] of Object.entries(ENGINES)) {
    const out = engine.analyze({ goal: 'Crie um app', deliverable: '  Plan ' })
    assert.equal(out.deliverable, 'plan', id)
    const crlf = engine.analyze({ goal: 'Preciso de ajuda\r\ncom isto', requirements: 'Escreva testes\r\npara o parser' })
    assert.equal(crlf.deliverable, 'implementation', id)
  }
})

test('draft recognition: Astra build keeps the CRLF-free goal', () => {
  assert.ok(!ASTRA.build({ goal: 'Linha um\r\nlinha dois' }).prompt.includes('\r'))
})

test('marketing copy is text: the Studio asks for examples, not design patterns, on every target', () => {
  for (const draft of ['Write the copy for the landing page', 'Redija a descrição do app']) {
    for (const target of ['opus', 'sonnet', 'astra']) {
      const asked = []
      const ladder = []
      for (let i = 0; i < 30; i++) {
        const q = nextQuestion(target, draft, ladder, 'en')
        if (q.done) break
        asked.push(q.category)
        ladder.push({ category: q.category, question: q.question, answer: '(skipped)' })
      }
      assert.ok(asked.includes('examples'), `${target}: ${draft} asks for examples`)
      assert.ok(!asked.includes('designAvoid'), `${target}: ${draft} asks no design patterns`)
    }
  }
  for (const [id, engine] of Object.entries({ opus: OPUS, sonnet: SONNET })) {
    assert.equal(engine.analyze({ goal: 'Write the copy for the landing page' }).interface, false, id)
    assert.equal(engine.analyze({ goal: 'Build a landing page for my bakery' }).interface, true, id)
  }
})

// ------------------------------------------------------------ parity

const src = name => readFile(new URL(`../../desktop/src/${name}`, import.meta.url), 'utf8')
const withoutComments = text => text.split('\n').filter(line => !/^\s*\/\//.test(line)).join('\n')

// The detection block of an engine: its constants and the functions that use them, comments dropped
// (the comments name each engine's own doc key).
function detection(source) {
  const start = source.indexOf('function pick(')
  const endMarker = 'function analyzeNormalized'
  const end = source.indexOf('\n}\n', source.indexOf(endMarker)) + 3
  assert.ok(start >= 0 && end > start, 'detection block found')
  return withoutComments(source.slice(start, end))
}

test('parity: Opus and Sonnet carry the identical detection block', async () => {
  const [opus, sonnet] = await Promise.all([src('engine-opus.js'), src('engine-sonnet.js')])
  const a = detection(opus)
  const b = detection(sonnet)
  for (const needle of ['CATEGORY_RULES', 'DELIVERABLE_RULES', 'MAKE_VERB', 'CODE_ARTIFACT', 'TEXT_ARTIFACT', 'GENERATE_VERB', 'QUESTION_FORM', 'QUESTION_START', 'INTERFACE', 'function detect', 'function analyzeNormalized']) {
    assert.ok(a.includes(needle), `opus block has ${needle}`)
  }
  assert.equal(a, b, 'Opus and Sonnet detection blocks drifted apart: change both engines identically')
})

test('parity: the artifact constants are the same text on all three engines', async () => {
  const sources = await Promise.all(['engine-opus.js', 'engine-sonnet.js', 'engine-astra.js'].map(src))
  for (const name of ['MAKE_VERB', 'CODE_ARTIFACT', 'TEXT_ARTIFACT', 'GENERATE_VERB', 'QUESTION_FORM', 'PLAN_OBJECT', 'DATA_OBJECT']) {
    const lines = sources.map(source => source.split('\n').find(line => line.startsWith(`const ${name} =`)))
    assert.ok(lines.every(Boolean), `${name} exists in every engine`)
    assert.equal(new Set(lines).size, 1, `${name} differs between engines:\n${lines.join('\n')}`)
  }
})
