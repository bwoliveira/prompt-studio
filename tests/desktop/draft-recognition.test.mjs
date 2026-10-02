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
  ['How do I configure nginx!', 'answer', 'an exclamation closes the question'],
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
  // a requested plan keeps its modifiers and its request verb (Codex P1)
  ['I need a migration plan to configure nginx', 'plan', 'modifier before the noun'],
  ['Please outline a plan to configure nginx', 'plan', 'request verb before the determiner'],
  ['Preciso de um plano detalhado de migracao para configurar o nginx', 'plan', 'pt, two modifiers'],
  ['Elabore uma estrategia para automatizar o deploy', 'plan', 'pt request verb'],
  ['The migration plan is ready. Build a React dashboard', 'implementation', 'near miss: copula after the modified noun'],
  ['A script to configure nginx', 'workflow', 'near miss: a plain noun before "to" does not name the request'],
  // an indirect prohibition is still a prohibition (Codex P1)
  ['What is Docker? I do not want you to configure anything', 'answer', 'do not want you to'],
  ['What is Docker? Do not try to configure anything', 'answer', 'do not try to'],
  ['O que é Docker? Não quero que você configure nada', 'answer', 'pt nao quero que voce'],
  ["What is Docker? Don't forget to configure nginx", 'workflow', 'near miss: a reminder is an order'],
  ['I want you to configure nginx', 'workflow', 'near miss: no negation'],
  // "tell me how" asks for an explanation (Codex P1)
  ['Can you tell me how to configure nginx?', 'answer', 'can you tell me how'],
  ['Você pode me dizer como configurar o nginx?', 'answer', 'pt voce pode me dizer'],
  ['Could you walk me through installing Docker?', 'answer', 'walk me through'],
  ['Can you configure nginx and tell me how it went?', 'workflow', 'near miss: the order comes first'],
  // "code" named as a noun after a question is not an order (Codex P2)
  ['How do I configure nginx? Include a code example', 'answer', 'a code example'],
  ['Como configurar o nginx? Inclua um exemplo de código', 'answer', 'pt exemplo de codigo'],
  ['Build the login page. Include a code example', 'implementation', 'near miss: the order comes first, code is context'],
  ['Write a script that parses the CSV', 'implementation', 'near miss: the script is the artifact of the order'],
  // a blank line ends a mark-less question (Codex P2)
  ['How do I configure nginx\n\nBe brief.', 'answer', 'paragraph boundary, then a style note'],
  ['Como configurar o nginx\n\nSeja breve.', 'answer', 'pt'],
  ['How do I install Docker\n\nThen configure nginx.', 'workflow', 'near miss: an order after the blank line'],
  // a discarded modifier does not end the artifact search (Codex P2)
  ['Write an API documentation generator script', 'implementation', 'api modifies documentation, which modifies script'],
  ['Write a blog post scheduler script', 'implementation', 'blog post modifies script'],
  ['Escreva um script gerador de documentação da API', 'implementation', 'pt, script first'],
  ['Write an API documentation page', 'text', 'near miss: no later code artifact'],
  ['Write a script announcement email', 'text', 'near miss: script modifies email'],
  // a question word opening a statement is not a question (Codex P2)
  ['What I need: build a React dashboard', 'implementation', 'what i need:'],
  ['What I want is for you to build a React dashboard', 'implementation', 'what i want is for you to'],
  ['O que eu preciso: construa um dashboard', 'implementation', 'pt o que eu preciso:'],
  ['What we need is a plan to configure nginx', 'plan', 'declarative, then a requested noun'],
  ['What do I need to configure nginx?', 'answer', 'near miss: a real question'],
  ['What is needed to configure nginx', 'answer', 'near miss: what is, no pronoun'],
  // a negated adjective does not forbid the action after the comma (Codex P2)
  ['The API is not ready, review the code', 'review', 'not ready, review'],
  ['A API não está pronta, revise o código', 'review', 'pt nao esta pronta, revise'],
  ['Docker is not installed, configure nginx anyway', 'workflow', 'not installed, configure'],
  ['What is Docker? Do not build, test or deploy anything', 'answer', 'near miss: actions in a list stay forbidden'],
  // a polite word may sit between "can you" and the explanatory verb (Codex P2)
  ['Can you please tell me how to configure nginx?', 'answer', 'can you please tell me'],
  ['Could you kindly explain how cron works?', 'answer', 'could you kindly explain'],
  ['Você pode por favor me dizer como configurar o nginx?', 'answer', 'pt voce pode por favor me dizer'],
  ['Can you please configure nginx?', 'workflow', 'near miss: a polite request is still a request'],
  // a sentence-initial noun followed by a copula is context (Codex P2)
  ['Plan is ready. Build a React dashboard.', 'implementation', 'plan is ready'],
  ['CSV is attached. Write an email to the client.', 'text', 'csv is attached'],
  ['Plano está pronto. Construa um dashboard', 'implementation', 'pt plano esta pronto'],
  ['Plan the steps, then build it', 'plan', 'near miss: no copula, plan opens the order'],
  // help to act is a request, help to understand is a question (Codex P1)
  ['Can you help me fix the login bug in this repository?', 'implementation', 'help me fix'],
  ['Você pode me ajudar a corrigir o bug de login?', 'implementation', 'pt me ajudar a corrigir'],
  ['Could you help us configure nginx?', 'workflow', 'help us configure'],
  ['Can you help me understand how cron works?', 'answer', 'near miss: help me understand'],
  ['Você pode me ajudar a entender como o cron funciona?', 'answer', 'near miss: pt me ajudar a entender'],
  // a prose script is writing (Codex P2)
  ['Write a video script for my blog', 'text', 'video script'],
  ['Write a podcast script about the API', 'text', 'podcast script'],
  ['Write a script for my blog', 'text', 'script for my blog'],
  ['Escreva um roteiro de vídeo para o blog', 'text', 'pt roteiro'],
  ['Write a bash script for the deploy', 'implementation', 'near miss: a bash script is code'],
  ['Write a script that parses the CSV', 'implementation', 'near miss: a script that does something is code'],
  // a yes/no question addressed to "you" is a question; only can/could/would/will you is a request (Codex P2)
  ['Do you configure nginx with TLS by default?', 'answer', 'do you'],
  ['Did you deploy the app yesterday?', 'answer', 'did you'],
  ['Have you configured nginx before?', 'answer', 'have you'],
  ['Should you configure nginx before Docker?', 'answer', 'should you'],
  ['Can you configure nginx with TLS?', 'workflow', 'near miss: can you is a request'],
  ['Will you configure nginx for me?', 'workflow', 'near miss: will you is a request'],
  // a script named with a language is code, whatever it is for (Codex P2)
  ['Write a Python script for a YouTube video.', 'implementation', 'python script for a video'],
  ['Write a bash script for the podcast feed', 'implementation', 'bash script'],
  ['Escreva um script Python para o canal do YouTube', 'implementation', 'pt script python'],
  ['Write a deploy script for the blog', 'implementation', 'deploy script'],
  ['Write a script for a YouTube video', 'text', 'near miss: no language, a video script'],
  // the prohibition carries across a coordinated clause with an object (Codex P2)
  ['What is Docker? Do not build the app or configure nginx.', 'answer', 'do not build the app or configure'],
  ['O que é Docker? Não construa o app nem configure o nginx.', 'answer', 'pt nao construa o app nem configure'],
  ['What is Docker? Never deploy the API and configure nginx.', 'answer', 'never ... and configure'],
  ['What is Docker? I do not want you to build the app or configure nginx', 'answer', 'indirect, with an object'],
  ['What is Docker? Do not build the app. Configure nginx.', 'workflow', 'near miss: a new sentence is an order'],
  ['Docker is not installed, configure nginx anyway', 'workflow', 'near miss: a negated predicate forbids nothing'],
  // an adverb or a sequencing word may open the planning order (Codex P1)
  ['Please carefully plan before you configure nginx.', 'plan', 'please carefully plan'],
  ['First plan, then configure nginx.', 'plan', 'first plan, no comma'],
  ['Then plan the rollout and configure nginx', 'plan', 'then plan'],
  ['Primeiro, planeje a migracao e depois configure o nginx', 'plan', 'pt primeiro, planeje'],
  ['The weekly plan is attached. Configure nginx', 'workflow', 'near miss: a copula after the noun'],
  ['Carefully review the plan, then configure nginx', 'review', 'near miss: the adverb opens a review'],
  // an explanation request needs no question mark (Codex P2)
  ['Can you tell me how to configure nginx', 'answer', 'no mark'],
  ['Can you tell me how to configure nginx.', 'answer', 'period'],
  ['Você pode me dizer como configurar o nginx', 'answer', 'pt no mark'],
  ['Could you please explain how cron works.', 'answer', 'could you please explain'],
  ['Can you configure nginx', 'workflow', 'near miss: a plain request without a mark'],
  ['Can you tell me how it went. Then configure nginx.', 'workflow', 'near miss: an order after the explanation request'],
  // an educational test is writing, a software test is code (Codex P2)
  ['Write a test with ten multiple-choice questions for fifth-grade students about fractions', 'text', 'school test'],
  ['Escreva um teste de matemática para alunos do quinto ano', 'text', 'pt teste de matematica'],
  ['Write a spelling test for my students', 'text', 'spelling test'],
  ['Write tests for the API', 'implementation', 'near miss: software tests'],
  ['Write a test for the login function', 'implementation', 'near miss: a test for a function'],
  ['Escreva testes para a API', 'implementation', 'near miss: pt software tests'],
  // an imperative explanation request is a question (Codex P1)
  ['Tell me how to configure nginx', 'answer', 'tell me how to'],
  ['Me diga como instalar o Docker', 'answer', 'pt me diga como'],
  ['Show me how to configure nginx', 'answer', 'show me how to'],
  ['Please tell us how to configure nginx.', 'answer', 'please tell us'],
  ['Explique para mim como instalar o Docker', 'answer', 'pt explique para mim'],
  ['Tell me how it went. Then configure nginx.', 'workflow', 'near miss: an order after the explanation request'],
  ['Tell the team to configure nginx', 'workflow', 'near miss: tell someone else to act'],
  // a modifier may follow the requested review noun (Codex P1)
  ['Escreva uma revisão detalhada da API', 'review', 'pt revisao detalhada'],
  ['Write a review focused on security for the API', 'review', 'review focused on'],
  ['Escreva uma revisão crítica e detalhada do código', 'review', 'pt two modifiers'],
  ['Write a review summary for the API', 'text', 'near miss: a review summary is a summary'],
  ['Escreva um resumo da revisão da API', 'text', 'near miss: pt resumo da revisao'],
  // the object of a forbidden verb is not the request (Codex P2)
  ['Do not write a review. Build a React app.', 'implementation', 'forbidden review, then build'],
  ['Do not write reviews. Build a React app.', 'implementation', 'plural'],
  ['Não escreva uma revisão. Construa um app React.', 'implementation', 'pt'],
  ['Review the API', 'review', 'near miss: review as a verb'],
  ['Write a review of the API', 'review', 'near miss: the requested review'],
  // a single test is software only with a software cue (Codex P2)
  ['Write a biology test with ten questions about cell division', 'text', 'biology test'],
  ['Write a test with questions about chemistry', 'text', 'test with questions'],
  ['Write a test with ten questions', 'text', 'test with ten questions'],
  ['Escreva um teste com dez questões sobre biologia', 'text', 'pt teste com questoes'],
  ['Write a test about the French Revolution', 'text', 'test about a subject'],
  ['Write a load test for the API', 'implementation', 'near miss: load test'],
  ['Write a test suite for the parser', 'implementation', 'near miss: test suite'],
  ['Escreva um teste de integração para o parser', 'implementation', 'near miss: pt teste de integracao'],
  ['Write tests for the parser', 'implementation', 'near miss: plural tests are software'],
  ['Write tests with ten questions about chemistry', 'text', 'plural tests with questions'],
  // an introductory clause may precede the question (Codex P2)
  ['Before we begin, can I configure nginx without downtime?', 'answer', 'intro, yes/no question'],
  ['Before we begin, how do I configure nginx?', 'answer', 'intro, question word'],
  ['Antes de começar, posso configurar o nginx sem downtime?', 'answer', 'pt intro'],
  ['As a network expert, can you tell me how to configure nginx?', 'answer', 'intro, explanation request'],
  ['Before we begin, configure nginx.', 'workflow', 'near miss: intro, then an order'],
  ['After you configure nginx, can I deploy?', 'workflow', 'near miss: the intro holds the order'],
  // a verb naming a thing or telling the past is context (Codex P2)
  ['The configure script is broken. Review it.', 'review', 'the configure script'],
  ['I tried to configure nginx yesterday. Review the config.', 'review', 'i tried to configure'],
  ['Tentei configurar o nginx ontem. Revise a configuração.', 'review', 'pt tentei configurar'],
  ['The build job failed. Review the logs.', 'review', 'the build job'],
  ['The pipeline failed. Review the logs.', 'review', 'a predicate after the noun signal'],
  ['O pipeline falhou. Revise os logs.', 'review', 'pt predicate after the noun signal'],
  ['Try to configure nginx without downtime', 'workflow', 'near miss: try to, present'],
  ['Configure the nginx script', 'workflow', 'near miss: the verb opens the order'],
  // "help me" may open the planning order (Codex P1)
  ['Help me plan deployment before we configure nginx', 'plan', 'help me plan'],
  ['Help me plan to configure nginx without downtime', 'plan', 'help me plan to'],
  ['Please help us plan the rollout, then configure nginx', 'plan', 'please help us plan'],
  ['Ajude-me a planejar a migracao antes de configurar o nginx', 'plan', 'pt ajude-me a planejar'],
  ['Help me configure nginx', 'workflow', 'near miss: help me with a workflow verb'],
  ['Help me understand the plan before we configure nginx', 'answer', 'near miss: help me understand'],
  ['Me ajude a entender o plano antes de configurar o nginx', 'answer', 'near miss: pt me ajude a entender'],
  // a requested artifact before the verb that names its purpose stays the artifact (Codex P2)
  ['I need a script to write log files', 'implementation', 'a script to write'],
  ['Preciso de um script para escrever arquivos de log', 'implementation', 'pt um script para escrever'],
  ['I need a function that writes the report', 'implementation', 'a function that writes'],
  ['I need an email to write about the launch', 'text', 'near miss: an email to write'],
  ['The script is ready. Write the release notes', 'text', 'near miss: no purpose clause'],
  ['Write a script to parse the CSV', 'implementation', 'near miss: the verb opens the request'],
  // a bare comma after a prohibition opens an alternative order (Codex P2)
  ['Do not deploy, review the code instead.', 'review', 'do not deploy, review'],
  ['Não construa o app, revise o código.', 'review', 'pt nao construa, revise'],
  ['Do not build the app, configure nginx', 'workflow', 'do not build the app, configure'],
  ['What is Docker? Do not build, test or deploy anything', 'answer', 'near miss: a list closed by or'],
  ['What is Docker? Do not build the app, or configure nginx.', 'answer', 'near miss: a comma before or'],
  // the artifact asked for decides over the verb telling its purpose (Codex P2)
  ['I need a script to configure nginx', 'implementation', 'a script to configure'],
  ['Preciso de um script para configurar o nginx', 'implementation', 'pt um script para configurar'],
  ['I need a function to plan the sprint', 'implementation', 'a function to plan'],
  ['I need an email to schedule the meeting', 'text', 'an email to schedule'],
  ['Write a script to configure nginx', 'implementation', 'near miss: the verb opens the request'],
  ['I need a plan to configure nginx', 'plan', 'near miss: the plan is the noun request'],
  ['The script is ready, configure nginx', 'workflow', 'near miss: no purpose clause'],
  ['A script to configure nginx', 'workflow', 'near miss: no request opener, the earlier rule holds'],
  // "can you" and "help me" combine before the planning verb (Codex P2)
  ['Can you help me plan deployment before we configure nginx?', 'plan', 'can you help me plan'],
  ['Could you please help us plan the rollout before we configure nginx', 'plan', 'could you please help us plan'],
  ['Você pode me ajudar a planejar a migração antes de configurar o nginx?', 'plan', 'pt voce pode me ajudar a planejar'],
  ['Can you help me configure nginx?', 'workflow', 'near miss: a workflow verb after the prefixes'],
  ['Can you help me understand the plan before we configure nginx?', 'answer', 'near miss: help me understand'],
  // a predicate word after an opening review is its object (Codex P2)
  ['Review failed deployments before we configure monitoring', 'review', 'review failed deployments'],
  ['Review failed tests and write a report', 'review', 'review failed tests'],
  ['Review works in progress and write a summary', 'review', 'review works in progress'],
  ['Plan failed migrations before we configure nginx', 'plan', 'plan failed migrations'],
  ['The plan failed. Configure nginx', 'workflow', 'near miss: the predicate after a context noun'],
  ['The review failed. Build the app', 'implementation', 'near miss: the predicate after a context noun'],
  // an explanation request that carries an order after a coordinator (Codex P2)
  ['Can you walk through the repository and fix the login bug?', 'implementation', 'can you walk ... and fix'],
  ['Can you walk me through the repository and fix the login bug?', 'implementation', 'can you walk me ... and fix'],
  ['Você pode me explicar o código e corrigir o bug de login?', 'implementation', 'pt pode me explicar ... e corrigir'],
  ['Can you explain the code and then review the module?', 'review', 'can you explain ... and then review'],
  ['Can you walk me through how cron works and then write a guide?', 'text', 'can you walk me through ... and then write'],
  ['Can you walk me through the repository and the deploy process?', 'answer', 'near miss: and joins two topics'],
  ['Can you tell me how cron works and how systemd timers work?', 'answer', 'near miss: and joins two questions'],
  // a declarative request keeps its order even when a question mark closes it (Codex P2)
  ['What I need is for you to build a React dashboard, can you do that?', 'implementation', 'what i need is ... can you do that?'],
  ['O que eu preciso é que você construa um dashboard React, pode fazer?', 'implementation', 'pt o que eu preciso e ... pode fazer?'],
  ['What I need is a plan, can you help?', 'plan', 'what i need is a plan ... ?'],
  ['What I need is a review of the code, can you do that?', 'review', 'what i need is a review ... ?'],
  ['What do I need to build a React dashboard?', 'answer', 'near miss: a real question with the same words'],
  ['What I need is for you to explain the plan, can you do that?', 'answer', 'near miss: the declarative asks for an explanation'],
  // a coordinator inside an explanation topic does not open an order (Codex P1)
  ['Can you tell me how to configure nginx and deploy the app?', 'answer', 'how to configure nginx and deploy'],
  ['Can you explain the architecture and how to configure nginx?', 'answer', 'and how to configure'],
  ['Você pode me explicar como configurar o nginx e fazer o deploy?', 'answer', 'pt como configurar ... e fazer'],
  ['Can you tell me what the script does and why it fails?', 'answer', 'and why'],
  ['Can you tell me how to configure nginx and then configure it?', 'workflow', 'near miss: and then orders'],
  // a modal or an adverb may sit between the purpose mark and the verb (Codex P2)
  ['I need a script that will configure nginx', 'implementation', 'a script that will configure'],
  ['I need a script to safely configure nginx', 'implementation', 'a script to safely configure'],
  ['Preciso de um script que vai configurar o nginx', 'implementation', 'pt um script que vai configurar'],
  ['I need an email to kindly schedule the meeting', 'text', 'an email to kindly schedule'],
  ['I need a plan that will configure nginx', 'plan', 'near miss: the plan is the noun request'],
  // a verb deep inside a coordinated topic is not an order (Codex P2)
  ['Can you explain cron and the steps to configure nginx?', 'answer', 'and the steps to configure'],
  ['Can you tell me about Docker and the way we deploy the app?', 'answer', 'and the way we deploy'],
  ['Você pode me explicar o cron e os passos para configurar o nginx?', 'answer', 'pt e os passos para configurar'],
  ['Can you explain cron and configure nginx?', 'workflow', 'near miss: the order opens right after and'],
  ['Can you explain cron and then carefully configure nginx?', 'workflow', 'near miss: then plus an adverb'],
  // a bare comma continues a prohibition only through a bare item or an Oxford comma (Codex P2)
  ['Do not configure nginx, review the API and report findings.', 'review', 'do not configure, review ... and report'],
  ['Do not deploy, review the code and write a summary', 'review', 'do not deploy, review ... and write'],
  ['Não configure o nginx, revise a API e relate os achados.', 'review', 'pt nao configure, revise ... e relate'],
  ['What is Docker? Do not build, deploy, and configure anything', 'answer', 'near miss: an Oxford comma closes the list'],
  ['How does cron work? Never install, configure or deploy anything here.', 'answer', 'near miss: a bare item then or'],
  // the Portuguese preposition "a" before an infinitive is not an article (Codex P2)
  ['Ajude-me a revisar código Python', 'review', 'ajude-me a revisar'],
  ['Ajude-me a auditar código', 'review', 'ajude-me a auditar'],
  ['Comece a revisar o código', 'review', 'comece a revisar'],
  ['Revise a configure script', 'review', 'near miss: an article before a verb naming a thing'],
  // a post-nominal adjective after the data noun (Codex P2)
  ['Crie uma planilha detalhada com as vendas', 'data', 'planilha detalhada'],
  ['Crie uma planilha mensal de vendas', 'data', 'planilha mensal'],
  ['Build a spreadsheet, monthly, with the sales', 'data', 'spreadsheet, monthly'],
  ['Crie uma planilha gerador de relatórios', 'implementation', 'near miss: a compound noun after planilha'],
  // a role prefix before a marked question (Codex P2)
  ['Como especialista em segurança, você pode revisar esta API?', 'review', 'como especialista, voce pode revisar ...?'],
  ['Como arquiteta de software, você pode planejar a migração?', 'plan', 'como arquiteta, voce pode planejar ...?'],
  ['Como especialista em redes, como configuro o nginx?', 'answer', 'near miss: a role before a real question'],
  ['Como configuro o nginx, sem downtime?', 'answer', 'near miss: a question with a comma'],
  // a copula right after any verb word makes it a thing (Codex P1)
  ['The build is broken. Review the dashboard code.', 'review', 'the build is broken'],
  ['The build was slow. Review the pipeline.', 'review', 'the build was slow'],
  ['O build está quebrado. Revise o código.', 'review', 'pt o build esta quebrado'],
  ['The fix is ready. Review it.', 'review', 'the fix is ready'],
  ['Build is broken. Review the dashboard code.', 'review', 'build is broken, no article'],
  ['The build is broken. Fix the dashboard code.', 'implementation', 'near miss: the order after the context'],
  ['Build the app. It is broken.', 'implementation', 'near miss: the copula is not after the verb'],
  ['Revisar esta API', 'review', 'near miss: pt esta as a demonstrative'],
  ['Escreva uma revisão crítica e detalhada do código', 'review', 'near miss: pt e as a conjunction'],
  // any question word opens an explanation topic (Codex P1)
  ['Can you explain why we configure nginx and deploy the app?', 'answer', 'why we configure ... and deploy'],
  ['Can you explain when we build the app and deploy it?', 'answer', 'when we build ... and deploy'],
  ['Pode me explicar por que configuramos o nginx e fazemos o deploy?', 'answer', 'pt por que ... e fazemos'],
  ['Can you explain why it fails and then fix it?', 'implementation', 'near miss: then opens the order'],
  // a stated goal is context for the order in the next sentence (Codex P2)
  ['The goal is to write a Python script. Review the existing code.', 'review', 'the goal is to write ... review'],
  ['O objetivo é escrever um script Python. Revise o código existente.', 'review', 'pt o objetivo e escrever ... revise'],
  ['The plan is to build the app. Review the code.', 'review', 'the plan is to build ... review'],
  ['The goal is to write a Python script.', 'implementation', 'near miss: no order after the goal'],
  // a question after an opening statement (Codex P2)
  ['Do not install anything. How do I configure nginx?', 'answer', 'prohibition, then a question'],
  ['Context: the app is live. How do I configure nginx?', 'answer', 'context, then a question'],
  ['The API is slow.\n\nHow do I configure nginx?', 'answer', 'paragraph, then a question'],
  ['Do not install anything. How do I configure nginx? Then configure it.', 'workflow', 'near miss: an order after the question'],
  ['Do not install anything. Configure nginx.', 'workflow', 'near miss: no question'],
  // a yes/no question without a question mark (Codex P2)
  ['Do I need to configure nginx', 'answer', 'do I need to, no mark'],
  ['Can I configure nginx. Be brief.', 'answer', 'can I, closed by a period'],
  ['Posso configurar o nginx. Seja breve.', 'answer', 'pt posso, closed by a period'],
  ['Can I configure nginx. Then configure it.', 'workflow', 'near miss: an order after the unmarked question'],
  ['Can you configure nginx', 'workflow', 'near miss: can you is a request'],
  ['Existe um script para configurar o nginx. Revise-o.', 'review', 'near miss: pt existe without a mark is a statement'],
  // an existing thing with a purpose is context for the order in the next sentence (Codex P2)
  ['We have a plan to build the app. Review it.', 'review', 'we have a plan to build ... review'],
  ['We have a plan to configure nginx. Review it.', 'review', 'we have a plan to configure ... review'],
  ['There is a script to configure nginx. Review it.', 'review', 'there is a script to configure ... review'],
  ['Temos um plano para construir o app. Revise-o.', 'review', 'pt temos um plano para construir ... revise'],
  ['We have a plan to build the app.', 'implementation', 'near miss: no order after the thing'],
  // a role prefix before the order (Codex P2)
  ['As a security expert, review API authentication before we configure nginx', 'review', 'as a security expert, review'],
  ['Como especialista em segurança, revise autenticação da API antes de configurar o nginx', 'review', 'pt como especialista, revise'],
  ['As a security expert, plan deployment before we configure nginx', 'plan', 'as a security expert, plan'],
  ['As an aside, the plan failed. Configure nginx', 'workflow', 'near miss: the prefix is not the order'],
  // a participial clause after the review noun (Codex P2)
  ['Write a review highlighting security flaws in the API.', 'review', 'review highlighting'],
  ['Write a review comparing the two APIs', 'review', 'review comparing'],
  ['Escreva uma revisão destacando falhas de segurança na API', 'review', 'pt revisao destacando'],
  ['Write a review generator for the API', 'implementation', 'near miss: a compound noun after review'],
  // the folded Portuguese "e" is a conjunction, not a copula (Codex P2)
  ['Plano e cronograma para configurar nginx', 'plan', 'plano e cronograma'],
  ['Revisão e auditoria da API antes de configurar nginx', 'review', 'revisao e auditoria'],
  ['A revisão e o relatório estão prontos. Configure o nginx.', 'review', 'a revisao e o relatorio estao prontos'],
  ['O plano está pronto. Configure o nginx.', 'workflow', 'near miss: esta before a state is context'],
  // a yes/no request addressed to the assistant may carry a coordinated order (Codex P2)
  ['Can you recommend a design and build a React dashboard?', 'implementation', 'can you recommend ... and build'],
  ['Can you think through this and implement the fix?', 'implementation', 'can you think through ... and implement'],
  ['Can you recommend a design and a layout?', 'answer', 'near miss: no order after and'],
  ['Should I use Redis and configure nginx?', 'answer', 'near miss: a question about myself'],
  // the coordinated order keeps its verb offset (Codex P2)
  ['Can you explain cron and then review it?', 'review', 'and then review it'],
  ['Can you explain cron and then plan deployment?', 'plan', 'and then plan deployment'],
  ['Você pode explicar o cron e depois revisar o código?', 'review', 'pt e depois revisar'],
  // a sequence done by the explained agent stays the topic (Codex P2)
  ['Can you explain why we first configure nginx and then build the app?', 'answer', 'why we first ... and then build'],
  ['Can you explain how we configure nginx and then build the app?', 'answer', 'how we configure ... and then build'],
  ['Can you explain why it fails and then fix it?', 'implementation', 'near miss: it is not the agent, then orders'],
  ['Can you tell me how to configure nginx and then configure it?', 'workflow', 'near miss: how to has no agent'],
  // the thing asked in the sentence before is what the order writes (Codex P2)
  ['I need a React app. Write it in TypeScript', 'implementation', 'i need a react app. write it'],
  ['I need a script. Write it in Python', 'implementation', 'i need a script. write it'],
  ['Preciso de um script. Escreva em Python', 'implementation', 'pt preciso de um script. escreva'],
  ['I need an email. Write it in English', 'text', 'near miss: the thing asked is text'],
  ['I need a script. Write a blog post about it', 'text', 'near miss: the order names its own artifact'],
  // media-processing code is not a media script (Codex P2)
  ['Write a script for video processing in Python', 'implementation', 'script for video processing in python'],
  ['Write a script for video encoding', 'implementation', 'script for video encoding'],
  ['Escreva um script para processamento de vídeo em Python', 'implementation', 'pt script para processamento de video'],
  ['Write a script for a video about Python', 'text', 'near miss: a script for a video is writing'],
  ['Write a script for my blog', 'text', 'near miss: a script for a blog is writing'],
  // the order points back to the thing asked before (Codex P2)
  ['I need a React app. Write it in TypeScript with documentation.', 'implementation', 'write it ... with documentation'],
  ['I need a script. Write it in Python with a summary', 'implementation', 'write it ... with a summary'],
  ['Preciso de um script. Escreva-o em Python com documentação', 'implementation', 'pt escreva-o ... com documentacao'],
  ['I need an email. Write it in English with a summary', 'text', 'near miss: the thing asked is text'],
  // an exclamation mark closes a question form (Codex P2)
  ['Tell me how to configure nginx!', 'answer', 'tell me how to ...!'],
  ['Me diga como instalar o Docker!', 'answer', 'pt me diga como ...!'],
  ['Can I configure nginx!', 'answer', 'can I ...!'],
  ['Tell me how to configure nginx! Then configure it.', 'workflow', 'near miss: an order after the exclamation'],
  ['Configure nginx!', 'workflow', 'near miss: an exclaimed order'],
  // "do" and "have" open a question only before a subject (Codex P1)
  ['Have a look at the repository and fix the login bug.', 'implementation', 'have a look ... and fix'],
  ['Do a review of the authentication API.', 'review', 'do a review'],
  ['Do a security audit of the API', 'review', 'do a security audit'],
  ['Do we need to configure nginx', 'answer', 'near miss: do we, no mark'],
  ['Does the script configure nginx?', 'answer', 'near miss: does the script ...?'],
  ["Don't you think we should configure nginx?", 'answer', "near miss: don't you ...?"],
  // a participial clause after the data noun (Codex P2)
  ['Create a spreadsheet containing the sales data.', 'data', 'spreadsheet containing'],
  ['Create a spreadsheet summarizing the monthly sales.', 'data', 'spreadsheet summarizing'],
  ['Crie uma planilha contendo os dados de vendas', 'data', 'pt planilha contendo'],
  ['Create a spreadsheet generator in Python', 'implementation', 'near miss: a compound noun after spreadsheet'],
  // a polite prefix before the requested noun (Codex P1)
  ['Can you give me a plan to configure nginx?', 'plan', 'can you give me a plan'],
  ['Could you outline a plan to configure nginx?', 'plan', 'could you outline a plan'],
  ['Você pode me dar um plano para configurar o nginx?', 'plan', 'pt voce pode me dar um plano'],
  ['Can you give me a script to configure nginx?', 'implementation', 'can you give me a script'],
  ['Can you configure nginx?', 'workflow', 'near miss: no noun is requested'],
  // a modifier never crosses a line (Codex P1)
  ['Write a Python script\nInclude documentation', 'implementation', 'script, newline, instruction'],
  ['Escreva um script Python\nInclua documentação', 'implementation', 'pt script, newline, instruction'],
  ['Write a Python script generator', 'implementation', 'near miss: a compound noun on the same line'],
  ['Write a marketing email', 'text', 'near miss: a text modifier on the same line'],
  // guidance asked without a determiner (Codex P2)
  ['I need instructions to configure nginx', 'answer', 'i need instructions to'],
  ['Provide instructions to configure nginx', 'answer', 'provide instructions to'],
  ['Preciso de instruções para configurar o nginx', 'answer', 'pt preciso de instrucoes para'],
  ['I need steps to configure nginx', 'answer', 'i need steps to'],
  ['I need help to configure nginx', 'answer', 'i need help to'],
  ['I need a script to configure nginx', 'implementation', 'near miss: a script is code'],
  ['I need instructions. Configure nginx.', 'workflow', 'near miss: the order comes after'],
  ['Write documentation to configure nginx', 'text', 'near miss: documentation is written'],
  // a polite or sequencing opener between the prior request and the order (Codex P2)
  ['I need a script. Please write it in Python with documentation.', 'implementation', 'please write it'],
  ['I need a script. Could you write it in Python with documentation?', 'implementation', 'could you write it'],
  ['Preciso de um script. Por favor, escreva-o em Python com documentação.', 'implementation', 'pt por favor, escreva-o'],
  ['I need an email. Please write it in English with a summary', 'text', 'near miss: the thing asked is text'],
  ['I need a script. Please write a blog post about it', 'text', 'near miss: the order names its own artifact'],
  // an exclusion phrase ends the artifact (Codex P2)
  ['Write a Python script without documentation', 'implementation', 'script without documentation'],
  ['Escreva um script sem documentação', 'implementation', 'pt script sem documentacao'],
  ['Write an email without a script', 'text', 'near miss: the email is first'],
  // an instruction that shapes the answer after a question is not a task (Codex P2)
  ['How do I build a React app? Add examples.', 'answer', 'question, add examples'],
  ['Como configuro o nginx? Inclua exemplos.', 'answer', 'pt question, inclua exemplos'],
  ['How do I configure nginx? Include sources and keep it short.', 'answer', 'question, include sources'],
  ['How do I build a React app? Build it for me.', 'implementation', 'near miss: a real order after the question'],
  ['How do I configure nginx? Add a health check.', 'implementation', 'near miss: a real addition'],
  ['How do I configure nginx? Add examples. Then configure it.', 'workflow', 'near miss: an order after the note'],
  // a memo is text, whatever code nouns its topic names (Codex P2)
  ['Write a strategy memo about optimizing SQL queries', 'text', 'memo about sql queries'],
  ['Write a memo about the API', 'text', 'memo about the api'],
  ['Escreva um memorando sobre otimizar consultas SQL', 'text', 'pt memorando sobre consultas sql'],
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
  for (const goal of ['How do I configure nginx' + ' '.repeat(128000) + '!', 'Can I configure nginx' + ' '.repeat(128000) + '!', 'How do I configure nginx' + '\n '.repeat(64000) + '!', 'Write ' + 'test '.repeat(40000) + 'for students.']) {
    for (const [id, engine] of Object.entries(ENGINES)) {
      const started = performance.now()
      const out = engine.analyze({ goal })
      const took = performance.now() - started
      assert.ok(typeof out.deliverable === 'string', id)
      assert.ok(took < 1500, `${id}: analyze took ${Math.round(took)} ms on a ${goal.length}-character draft`)
    }
  }
})

test('draft recognition: an instruction in the requirements field is not a modifier of the goal artifact on any engine (Codex P1)', () => {
  const cases = [
    [{ goal: 'Write a Python script', requirements: 'Include documentation' }, 'implementation'],
    [{ goal: 'Escreva um script Python', requirements: 'Inclua documentação' }, 'implementation'],
    [{ goal: 'Write a Python script', requirements: 'Write a blog post about it' }, 'implementation'],
    [{ goal: 'Write a blog post', requirements: 'Include a script' }, 'text'],
    [{ goal: 'What is Docker?', requirements: 'Make the answer concise' }, 'answer'],
    [{ goal: 'What is Docker?', requirements: 'Build a demo app' }, 'implementation'],
  ]
  for (const [brief, expected] of cases) {
    for (const [id, engine] of Object.entries(ENGINES)) assert.equal(engine.analyze(brief).deliverable, expected, `${id}: ${JSON.stringify(brief)}`)
  }
})

test('draft recognition: a requested text with an explanatory clause stays text on Opus and Sonnet (Codex P2)', () => {
  // Astra reads "explaining how to" as a question on the base and still does; this guards the two engines that regressed.
  const cases = [
    ['I need a blog post explaining how to configure nginx.', 'text'],
    ['I want an email that explains how to configure nginx.', 'text'],
    ['Preciso de um post de blog explicando como configurar o nginx.', 'text'],
    ['I need a script explaining how to configure nginx.', 'implementation'],
    ['I need a blog post. Then configure nginx.', 'workflow'],
  ]
  for (const [goal, expected] of cases) {
    for (const id of ['opus', 'sonnet']) assert.equal(ENGINES[id].analyze({ goal }).deliverable, expected, `${id}: ${goal}`)
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
  for (const needle of ['CATEGORY_RULES', 'DELIVERABLE_RULES', 'MAKE_VERB', 'CODE_ARTIFACT', 'TEXT_ARTIFACT', 'GENERATE_VERB', 'QUESTION_FORM', 'UNMARKED_YESNO', 'YESNO_FORM', 'EXPLAIN_FORM', 'QUESTION_START', 'NOUN_SIGNAL', 'SENTENCE_START', 'VERB_OBJECT', 'REQUESTED_NOUN', 'COPULA', 'VERB_COPULA', 'PREDICATE', 'INFINITIVE_MARK', 'NEGATED', 'COORDINATED', 'PREDICATE_NEGATION', 'CLAUSE_NEGATION', 'LIST_TAIL', 'QUESTION_HEAD', 'ROLE_HEAD', 'DECLARATIVE', 'TOPIC_TAIL', 'TOPIC_AGENT', 'TOPIC_HEAD', 'ADDRESSED', 'RESPONSE_NOTE', 'ORDER_LEAD', 'ORDER_JOIN', 'INTRO_CLAUSE', 'PT_INFINITIVE', 'AFTER_A', 'STATED_GOAL', 'MODIFIER_USE', 'COMPOUND_AFTER', 'NARRATIVE', 'CONTEXT_WINDOW', 'PRONOUN_OBJECT', 'PRIOR_REQUEST', 'REQUESTED_ARTIFACT', 'MODIFIER_GAP', 'INTERFACE', 'function contextBefore', 'function prohibited', 'function isQuestion', 'function questionAt', 'function coordinatedOrder', 'function orderAfterSentence', 'function questionStart', 'function pickArtifact', 'function firstSignal', 'function detect', 'function analyzeNormalized']) {
    assert.ok(a.includes(needle), `opus block has ${needle}`)
  }
  assert.equal(a, b, 'Opus and Sonnet detection blocks drifted apart: change both engines identically')
})

test('parity: the artifact constants are the same text on all three engines', async () => {
  const sources = await Promise.all(['engine-opus.js', 'engine-sonnet.js', 'engine-astra.js'].map(src))
  for (const name of ['MAKE_VERB', 'CODE_ARTIFACT', 'TEXT_ARTIFACT', 'GENERATE_VERB', 'QUESTION_FORM', 'UNMARKED_YESNO', 'YESNO_FORM', 'EXPLAIN_FORM', 'NOUN_SIGNAL', 'SENTENCE_START', 'VERB_OBJECT', 'REQUESTED_NOUN', 'COPULA', 'VERB_COPULA', 'PREDICATE', 'INFINITIVE_MARK', 'NEGATED', 'COORDINATED', 'PREDICATE_NEGATION', 'CLAUSE_NEGATION', 'LIST_TAIL', 'QUESTION_HEAD', 'ROLE_HEAD', 'DECLARATIVE', 'TOPIC_TAIL', 'TOPIC_AGENT', 'TOPIC_HEAD', 'ADDRESSED', 'RESPONSE_NOTE', 'ORDER_LEAD', 'ORDER_JOIN', 'INTRO_CLAUSE', 'PT_INFINITIVE', 'AFTER_A', 'STATED_GOAL', 'MODIFIER_USE', 'COMPOUND_AFTER', 'NARRATIVE', 'CONTEXT_WINDOW', 'PRONOUN_OBJECT', 'PRIOR_REQUEST', 'REQUESTED_ARTIFACT', 'MODIFIER_GAP', 'REVIEW_OBJECT', 'PLAN_OBJECT', 'DATA_OBJECT', 'WORKFLOW_OBJECT']) {
    const lines = sources.map(source => source.split('\n').find(line => line.startsWith(`const ${name} =`)))
    assert.ok(lines.every(Boolean), `${name} exists in every engine`)
    assert.equal(new Set(lines).size, 1, `${name} differs between engines:\n${lines.join('\n')}`)
  }
})
