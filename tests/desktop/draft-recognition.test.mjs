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
  // a review named as the object of a writing verb is a review, not code about the thing reviewed (Codex P2)
  ['Write a review of the API', 'review', 'review object before the api promotion'],
  ['Escreva uma revisão da API', 'review', 'pt revisao'],
  ['Write a code review for the parser', 'review', 'code review'],
  ['Escreva uma auditoria do backend', 'review', 'pt auditoria'],
  ['Write an API client', 'implementation', 'near miss: no review object'],
  // the object word must head its noun phrase: a summary, memo or guide about it is text (Codex P2)
  ['Write a plan summary', 'text', 'summary heads the phrase'],
  ['Write a strategy memo', 'text', 'memo heads the phrase'],
  ['Write a workflow guide', 'text', 'guide heads the phrase'],
  ['Escreva um resumo do plano', 'text', 'pt resumo'],
  ['Write a review summary for the team', 'text', 'summary heads the phrase'],
  ['Create a plan for Q3', 'plan', 'near miss: plan followed by a preposition'],
  ['Create a launch plan.', 'plan', 'near miss: plan followed by punctuation'],
  // context before the writing verb does not name its object (Codex P2)
  ['For our app, write a blog post announcing the release', 'text', 'app before the verb is context'],
  ['Para o nosso app, escreva um post anunciando o lançamento', 'text', 'pt'],
  ['Our API is ready. Write an email to the customers about it', 'text', 'code noun in an earlier sentence'],
  ['Our app is slow. Write a script that profiles it', 'implementation', 'near miss: the script follows the verb'],
  ['Using the app API, write a function that lists users', 'implementation', 'near miss: function after the verb'],
  // a question closed by a period is still a question (Codex P2)
  ['How to create an app.', 'answer', 'trailing period'],
  ['Como criar um app.', 'answer', 'pt trailing period'],
  ['Como instalar o Docker no servidor.', 'answer', 'pt long, trailing period'],
  ['How do I write a script. ', 'answer', 'trailing period and space'],
  // a code word that only modifies the text asked for is not the artifact (Codex P2)
  ['Write an API announcement email to our customers', 'text', 'api modifies email'],
  ['Write an API reference article', 'text', 'api modifies article'],
  ['Escreva um e-mail de lançamento da API', 'text', 'pt: e-mail first, api after a preposition'],
  ['Write an email script', 'implementation', 'near miss: email modifies script'],
  ['Write a function that validates the product description', 'implementation', 'near miss: a clause, not a modifier'],
  // a noun before the verb is context, not the order (Codex P2)
  ['Our plan is ready. Build a React dashboard', 'implementation', 'plan noun before build'],
  ['Nosso plano está pronto. Construa um dashboard React', 'implementation', 'pt'],
  ['The spreadsheet is attached. Write an email to the client', 'text', 'data noun before write'],
  ['Plano de lançamento do produto', 'plan', 'near miss: a noun with no verb still decides'],
  ['Planilha de vendas do trimestre', 'data', 'near miss: noun only'],
  // an order after an opening question is the task; a style note is not (Codex P2)
  ['How does this app work? Fix the login bug.', 'implementation', 'fix after the question'],
  ['Como funciona este app? Corrija o bug de login.', 'implementation', 'pt'],
  ['What is cron? Write a script that runs it nightly', 'implementation', 'write + script after the question'],
  ['Como instalar o Docker? Responda em dez linhas.', 'answer', 'near miss: a style note, no task verb'],
  ['How does cron work? Be brief.', 'answer', 'near miss: style note'],
  // "plan" opening a sentence is an order, not a context noun (Codex P1)
  ['Plan the steps to configure nginx; do not run any commands.', 'plan', 'imperative plan before configure'],
  ['Plan the migration, then write a summary for the team', 'plan', 'imperative plan before write'],
  ['First, plan the rollout. Then automate the deploy.', 'plan', 'imperative plan after a one-word opener'],
  ['Our plan, the dashboard, is late. Build it now', 'implementation', 'near miss: a noun before a comma'],
  ['Review the plan for the API', 'review', 'review still first'],
  ['Our plan: build a React dashboard', 'implementation', 'near miss: plan is a noun before a colon'],
  // a context noun does not hide a later verb of the same rule (Codex P2)
  ['The CSV is attached. Extract the totals and write a report.', 'data', 'csv hides extract no more'],
  ['A planilha está anexa. Extraia os totais e escreva um relatório.', 'data', 'pt'],
  ['The roadmap is done. Plan the next quarter.', 'plan', 'roadmap noun, then imperative plan'],
  ['The spreadsheet is attached. Write an email to the client', 'text', 'near miss: no data verb follows'],
  // a polite prefix keeps the imperative (Codex P1)
  ['Please plan the steps to configure nginx; do not run any commands.', 'plan', 'please + plan'],
  ['Por favor, planeje os passos para configurar o nginx', 'plan', 'pt: por favor + planeje'],
  ['Por favor, plano de ação para configurar o nginx', 'plan', 'pt: a noun opening the request names it'],
  ['Plano de ação para configurar o nginx', 'plan', 'pt: noun first, infinitive after'],
  ['Planilha com os totais; extraia do CSV', 'data', 'pt: noun first'],
  ['Please review the API and then configure the proxy', 'review', 'please + review'],
  ['Please build a React dashboard for our plan', 'implementation', 'near miss: plan after the verb'],
  // a participle between the artifacts is a clause, not a modifier (Codex P2)
  ['Write an email announcing the app', 'text', 'announcing is a clause'],
  ['Write an article explaining our API', 'text', 'explaining is a clause'],
  ['Escreva um e-mail anunciando o app', 'text', 'pt anunciando'],
  ['Write a marketing email script', 'implementation', 'near miss: marketing is a field, script is the artifact'],
  ['Write a landing page copy script', 'implementation', 'near miss: landing is a field'],
  // a period inside a name or version does not close the question (Codex P2)
  ['Como instalar o Node.js?', 'answer', 'node.js'],
  ['Como instalar o Python 3.12?', 'answer', 'version'],
  ['How do I configure nginx 1.26?', 'answer', 'version'],
  ['How do I configure nginx 1.26', 'answer', 'version, no mark'],
  ['Como instalar o Node.js. Depois configure o nginx.', 'workflow', 'near miss: a real sentence end, then an order'],
  // a request prefix keeps the planning verb (Codex P1)
  ['Can you plan the steps to configure nginx; do not run any commands?', 'plan', 'can you + plan'],
  ['I need you to plan the rollout before we configure anything', 'plan', 'i need you to + plan'],
  ['Could you review the API and then configure the proxy?', 'review', 'could you + review'],
  ['Preciso que você planeje os passos para configurar o nginx', 'plan', 'pt: preciso que voce + planeje'],
  ['We are late, so plan the rollout and then configure nginx', 'plan', 'plan + determiner mid-sentence'],
  ['Can you build the dashboard from our plan?', 'implementation', 'near miss: plan is a noun after the verb'],
  // a negated verb is a prohibition, not the order (Codex P1)
  ['How do I install Docker? Do not execute any commands.', 'answer', 'negated execute after the question'],
  ['Como instalar o Docker? Não execute comandos.', 'answer', 'pt nao execute'],
  ['How do I install Docker? Never deploy from this machine.', 'answer', 'never deploy'],
  ['Never deploy on Fridays. Write a policy email to the team', 'text', 'negated deploy, then write'],
  ['How do I install Docker? Then configure nginx.', 'workflow', 'near miss: an affirmative order after the question'],
  // only the verb that fired promotes a request to code (Codex P2)
  ['Analyze this Python script, then write a blog post about it.', 'analysis', 'a later write does not promote'],
  ['Analise este script Python e depois escreva um post sobre ele.', 'analysis', 'pt'],
  ['Write a Python script that parses the CSV', 'implementation', 'near miss: the verb that fired makes the script'],
  // a second question is still a question (Codex P2)
  ['Como instalar o Docker? Como configurar o nginx?', 'answer', 'two pt questions'],
  ['How do I install Docker? How do I configure nginx?', 'answer', 'two en questions'],
  ['What is Docker? How does it work? Explain briefly.', 'answer', 'three questions and a style note'],
  ['What is Docker? How does it work? Fix the login bug.', 'implementation', 'near miss: an order after two questions'],
  // a negated reminder still asks for the action (Codex P2)
  ["Don't forget to review the API", 'review', 'reminder, not a prohibition'],
  ['Não esqueça de revisar a API', 'review', 'pt reminder'],
  ['Do not forget: review the API before Friday', 'review', 'reminder with a colon'],
  ['Never ever deploy from this machine. Write a policy email', 'text', 'near miss: adverb between negation and verb'],
  ['Do not run any commands; plan the steps instead', 'plan', 'near miss: the prohibited verb is skipped, the order stays'],
  // an explanation request stays an answer, whatever it is about (Codex P1)
  ['Explain how to configure nginx', 'answer', 'explain + configure'],
  ['Explique como instalar o Docker', 'answer', 'pt explique + instalar'],
  ['Explain the deploy pipeline to a new hire', 'answer', 'explain + workflow nouns'],
  ['Build the dashboard and explain your choices', 'implementation', 'near miss: the order comes first'],
  ['Write a post explaining the API', 'text', 'near miss: explaining is a clause, not the request'],
  // an infinitive or modal marker keeps the planning verb (Codex P1)
  ['We need to plan before we configure nginx', 'plan', 'need to plan'],
  ["Let's plan the migration, then configure the proxy", 'plan', "let's plan"],
  ['We should plan first and only then automate the deploy', 'plan', 'we should plan'],
  ['Precisamos planejar antes de configurar o nginx', 'plan', 'pt infinitive'],
  ['We need you to plan the rollout before we configure anything', 'plan', 'we need you to plan'],
  ['We need to configure nginx according to plan', 'workflow', 'near miss: plan is a noun after the order'],
  // a question may wrap onto the next line (Codex P2)
  ['How do I configure nginx\nwith TLS?', 'answer', 'question across two lines'],
  ['Como configurar o nginx\ncom TLS', 'answer', 'pt, two lines, no mark'],
  ['What is Docker?\nFix the login bug.', 'implementation', 'near miss: the mark closes the question, then an order'],
  ['How do I install Docker?\n\nThen configure nginx.', 'workflow', 'near miss: an order after a blank line'],
  // a comma inside a question does not end it (Codex P2)
  ['How do I configure nginx, with TLS.', 'answer', 'comma, trailing period'],
  ['Como configurar o nginx, sem reiniciar o servidor.', 'answer', 'pt comma'],
  ['How do I configure nginx, and then deploy it', 'answer', 'comma, no mark: still one question'],
  ['What is Docker? Then, configure nginx.', 'workflow', 'near miss: the mark closes the question, the comma after it is in the order'],
  // coordinated verbs stay under the prohibition (Codex P2)
  ['What is Docker? Do not build or deploy anything.', 'answer', 'build or deploy both negated'],
  ['O que é Docker? Não construa nem publique nada.', 'answer', 'pt nem'],
  ['How does cron work? Never install, configure or deploy anything here.', 'answer', 'three coordinated verbs'],
  ['What is Docker? Do not build anything. Configure nginx.', 'workflow', 'near miss: a new sentence is not coordinated'],
  ['Do not deploy; review the API instead', 'review', 'near miss: a semicolon is not a coordinator'],
  ['Como engenheiro de redes, configure o nginx', 'workflow', 'near miss: "como" means "as a", the comma is not inside a question'],
  // documentation about code is text (Codex P2)
  ['Write instructions for running the unit tests.', 'text', 'instructions about tests'],
  ['Write a guide to SQL queries.', 'text', 'guide about queries'],
  ['Escreva um tutorial sobre a API', 'text', 'pt tutorial'],
  ['Write the documentation for the CLI', 'text', 'documentation about the cli'],
  ['Write tests for the API', 'implementation', 'near miss: tests are the artifact'],
  ['Write the SQL queries for the monthly report', 'implementation', 'near miss: queries first, report after a preposition'],
  // a yes/no question is a question, before or after another one (Codex P2)
  ['What is Docker? Can I configure nginx?', 'answer', 'wh then yes/no'],
  ['Can I configure nginx without restarting?', 'answer', 'opening yes/no'],
  ['Do I need to install Docker first?', 'answer', 'do i'],
  ['Is it safe to configure nginx in production?', 'answer', 'is it'],
  ['Posso configurar o nginx sem reiniciar?', 'answer', 'pt posso'],
  ['O que é Docker? Devo instalar o Compose também?', 'answer', 'pt wh then devo'],
  ['Do you think I should configure nginx?', 'answer', 'do you think'],
  ['Can you configure nginx with TLS?', 'workflow', 'near miss: can you is a request'],
  ['Você pode configurar o nginx?', 'workflow', 'near miss: pt request'],
  ['What is Docker? Can you configure nginx?', 'workflow', 'near miss: a request after the question'],
  ['Can I install Docker here? Then configure nginx.', 'workflow', 'near miss: an order after the yes/no question'],
  // a period closes the question; what follows is read on its own (Codex P1)
  ['How do I configure nginx. Be brief.', 'answer', 'period-closed question, then a style note'],
  ['Como instalar o Docker. Seja breve.', 'answer', 'pt'],
  ['How do I configure nginx. Can I do it without downtime?', 'answer', 'period-closed question, then a yes/no one'],
  ['How do I install Docker. Then configure nginx.', 'workflow', 'near miss: an order after the period'],
  ['How do I configure nginx!', 'workflow', 'near miss: an exclamation is not a question close (unchanged)'],
  // a requested noun phrase names the request, whatever infinitive follows (Codex P1)
  ['A plan to configure nginx', 'plan', 'a plan to ...'],
  ['Preciso de um plano para configurar o nginx', 'plan', 'pt preciso de um plano'],
  ['I need a plan for installing Docker', 'plan', 'i need a plan'],
  ['Please, a plan to automate the deploy', 'plan', 'polite opener, then the noun phrase'],
  ['The plan is ready. Build a React dashboard', 'implementation', 'near miss: a copula follows the noun'],
  ['A planilha está anexa. Escreva um e-mail', 'text', 'near miss: pt copula'],
  ['Review the plan to configure nginx', 'review', 'near miss: the plan is the object of review'],
  // a prohibition is not a yes/no question, and a yes/no question ends with its sentence (Codex P1)
  ['Do not access production. Can you build the app?', 'implementation', 'do not ... then a request'],
  ["Don't touch production. Can you build the app?", 'implementation', "don't"],
  ['Can I configure nginx? Can you build the app?', 'implementation', 'near miss: a request after a yes/no question'],
  ['Do I need Docker? Be brief.', 'answer', 'near miss: yes/no then a style note'],
  ['Does it matter which port I use?', 'answer', 'near miss: does it, no negation'],
]

for (const [draft, expected, why] of TABLE) {
  test(`draft recognition: "${draft}" is ${expected} (${why})`, () => {
    const got = Object.fromEntries(Object.entries(ENGINES).map(([id, engine]) => [id, engine.analyze({ goal: draft }).deliverable]))
    assert.deepEqual(got, { opus: expected, sonnet: expected, astra: expected })
  })
}

test('draft recognition: a long draft full of context nouns is analysed in linear time on every engine (Codex P2)', () => {
  const goal = 'The CSV is attached. '.repeat(10000) + 'Write an email to the team.'
  for (const [id, engine] of Object.entries(ENGINES)) {
    const started = performance.now()
    const out = engine.analyze({ goal })
    const took = performance.now() - started
    // Opus and Sonnet fold() only the first 4 000 characters, so the closing order is out of their window; what
    // this test guards is the time, not the deliverable.
    assert.ok(typeof out.deliverable === 'string', id)
    assert.ok(took < 1500, `${id}: analyze took ${Math.round(took)} ms on a 210k-character draft`)
  }
})

test('draft recognition: a question form that fails on a long run of spaces is still linear on every engine (Codex P2)', () => {
  for (const goal of ['How do I configure nginx' + ' '.repeat(128000) + '!', 'Can I configure nginx' + ' '.repeat(128000) + '!', 'How do I configure nginx' + '\n '.repeat(64000) + '!']) {
    for (const [id, engine] of Object.entries(ENGINES)) {
      const started = performance.now()
      const out = engine.analyze({ goal })
      const took = performance.now() - started
      assert.ok(typeof out.deliverable === 'string', id)
      assert.ok(took < 1500, `${id}: analyze took ${Math.round(took)} ms on a ${goal.length}-character draft`)
    }
  }
})

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
  for (const needle of ['CATEGORY_RULES', 'DELIVERABLE_RULES', 'MAKE_VERB', 'CODE_ARTIFACT', 'TEXT_ARTIFACT', 'GENERATE_VERB', 'QUESTION_FORM', 'YESNO_FORM', 'QUESTION_START', 'NOUN_SIGNAL', 'SENTENCE_START', 'VERB_OBJECT', 'REQUESTED_NOUN', 'COPULA', 'INFINITIVE_MARK', 'NEGATED', 'COORDINATED', 'QUESTION_HEAD', 'CONTEXT_WINDOW', 'MODIFIER_GAP', 'INTERFACE', 'function contextBefore', 'function prohibited', 'function isQuestion', 'function firstSignal', 'function detect', 'function analyzeNormalized']) {
    assert.ok(a.includes(needle), `opus block has ${needle}`)
  }
  assert.equal(a, b, 'Opus and Sonnet detection blocks drifted apart: change both engines identically')
})

test('parity: the artifact constants are the same text on all three engines', async () => {
  const sources = await Promise.all(['engine-opus.js', 'engine-sonnet.js', 'engine-astra.js'].map(src))
  for (const name of ['MAKE_VERB', 'CODE_ARTIFACT', 'TEXT_ARTIFACT', 'GENERATE_VERB', 'QUESTION_FORM', 'YESNO_FORM', 'NOUN_SIGNAL', 'SENTENCE_START', 'VERB_OBJECT', 'REQUESTED_NOUN', 'COPULA', 'INFINITIVE_MARK', 'NEGATED', 'COORDINATED', 'QUESTION_HEAD', 'CONTEXT_WINDOW', 'MODIFIER_GAP', 'REVIEW_OBJECT', 'PLAN_OBJECT', 'DATA_OBJECT', 'WORKFLOW_OBJECT']) {
    const lines = sources.map(source => source.split('\n').find(line => line.startsWith(`const ${name} =`)))
    assert.ok(lines.every(Boolean), `${name} exists in every engine`)
    assert.equal(new Set(lines).size, 1, `${name} differs between engines:\n${lines.join('\n')}`)
  }
})
