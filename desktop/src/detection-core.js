// Draft detection for Prompt Studio, shared by the three engines. Pure ESM: no imports, no DOM, no clock, no randomness.
// What the draft asks for (implementation, analysis, review, plan, text, data, workflow or answer) is decided here, once:
// the first verb in the text decides, a question stays an answer (so does a "show me" request for code: only a build
// verb makes it a task), and the artifact named after the verb says whether it is code or text. A recognition fix lands in this file and reaches every target.
//
// The rules are data. `createDetector(profile)` reads a profile of rule lines and returns a detector:
//   verbs       [id, pattern] pairs that follow the shared object rules; on a tie in the text the earlier pair wins
//   categories  [id, pattern] pairs for the broad category of the draft ([] for an engine that has none)
//   dataNoun    a data file named in a draft whose verb is an analysis makes the deliverable data ...
//   dataUnless  ... unless this pattern also matches (null: never)
//   foldLimit   how many characters of the draft are read (Infinity: all of it)
// A field an engine leaves out is the default profile, which Opus and Sonnet read as it is; an engine passes only the
// rule lines in which it differs (Astra: its own verbs and data rule, no categories, no cap).
//
// Patterns run on fold()ed text (lower-cased, NFD diacritics stripped), so Portuguese words are written without accents.
// Each pattern carries a `Languages:` comment; other languages fall back to defaults.

// Lowercase, accents stripped, capped so keyword matching stays fast on huge drafts.
const DEFAULT_FOLD_LIMIT = 4000
function fold(text, limit = DEFAULT_FOLD_LIMIT) {
  return text.slice(0, limit).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
}


// Languages: Portuguese (unaccented) + English; tested on normalize()/fold() output (lower-cased, NFD diacritics stripped).
const CATEGORY_RULES = [
  ['agent', /\b(automati[sz]\w*|automate\w*|agentes?|agents?|workflows?|pipelines?|bots?)\b/],
  ['code', /\b(react|vue|angular|svelte|api|codigo|code|bugs?|func(ao|oes)|functions?|scripts?|dashboards?|apps?|aplicativos?|frontend|front-end|backend|css|html|typescript|javascript|python|node|repos?|repositorio|pull request|pr|sites?|website|landing|pagina|page|componentes?|components?|login|deploy|endpoints?|refator\w*|refactor\w*)\b/],
  ['data', /\b(planilhas?|csv|datasets?|sql|excel|spreadsheets?|dados|data)\b/],
  ['research', /\b(pesquis\w*|research\w*|compar\w*|benchmark\w*|estudo|survey|investig\w*)\b/],
  ['writing', /(\be-?mails?\b|\b(artigos?|articles?|posts?|blog|texto|carta|letter|copy|redacao|newsletter|essay|ensaio|roteiro|script de video)\b)/],
  ['business', /\b(plano de|lancamento|launch|vendas|sales|marketing|proposta|proposal|pricing|precos?|estrategia|strategy|negocios?|business|trimestre|quarter|clientes?|customers?)\b/]
]

// A make verb whose object is a review, a plan, a data file or an automation names that deliverable, whatever verb
// rule it also matches ("Write a review of the API", "Create a plan", "Crie uma planilha"). The object must be the
// head of its noun phrase (end, punctuation or a preposition follows): "Write a plan summary" asks for a summary.
// Languages: Portuguese (unaccented) + English.
const REVIEW_OBJECT = /\b(?:crie|criar|construa|desenvolva|escreva|escrever|redija|redigir|monte|montar|gere|gerar|elabore|elaborar|write|create|build|make|draft|develop)\s+(?:(?:a|an|the|um|uma|o|os|as|our|nosso|nossa|new|novo|nova|detailed|detalhado|detalhada|simple|simples)\s+){0,2}(?:\w+\s+)?(?:reviews?|revisao|revisoes|audits?|auditoria|auditorias|diagnostico|diagnosticos|diagnosis|critique)\b(?:\s+(?:\w+ly|\w+mente|\w+(?:ed|ada|ado|ida|ido)|detailed|detalhada|detalhado|brief|short|breve|curta|curto|thorough|completa|completo|rigorosa|rigoroso|critica|critico|critical|tecnica|tecnico|technical|final|initial|inicial|rapida|rapido|quick|honest|honesta|honesto|independent|independente|formal|informal)){0,2}(?=\s*$|\s*[.,;:!?\n]|\s+(?:for|para|of|de|do|da|dos|das|desta|deste|desse|dessa|destes|destas|desses|dessas|daquele|daquela|daqueles|daquelas|neste|nesta|nesse|nessa|naquele|naquela|on|sobre|about|to|that|which|que|with|com|in|em|no|na|nos|nas|by|por|and|e|from|at|before|after|ate|until|covering|explaining|so|without|except|excluding|sem|exceto|excluindo|using|usando|\w{3,}ing|\w{3,}ndo)\b)/
const PLAN_OBJECT = /\b(?:crie|criar|construa|desenvolva|escreva|escrever|redija|redigir|monte|montar|gere|gerar|elabore|elaborar|write|create|build|make|draft|develop)\s+(?:(?:a|an|the|um|uma|o|os|as|our|nosso|nossa|new|novo|nova|detailed|detalhado|detalhada|simple|simples)\s+){0,2}(?:\w+\s+)?(?:plan|plano|planos|roadmap|cronograma|strategy|estrategia)\b(?=\s*$|\s*[.,;:!?\n]|\s+(?:for|para|of|de|do|da|dos|das|on|sobre|about|to|that|which|que|with|com|in|em|no|na|nos|nas|by|por|and|e|from|at|before|after|ate|until|covering|explaining|so)\b)/
const DATA_OBJECT = /\b(?:crie|criar|construa|desenvolva|escreva|escrever|redija|redigir|monte|montar|gere|gerar|elabore|elaborar|write|create|build|make|draft|develop)\s+(?:(?:a|an|the|um|uma|o|os|as|our|nosso|nossa|new|novo|nova|detailed|detalhado|detalhada|simple|simples)\s+){0,2}(?:\w+\s+)?(?:planilhas?|spreadsheets?|csv|datasets?)\b(?:\s+(?:\w+(?:ad[ao]s?|id[ao]s?|iv[ao]s?|os[ao]s?|ais|al|eis|el|ente|ante)|simples|nov[ao]s?|complet[ao]s?|detailed|simple|monthly|weekly|annual|complete|new|clean|tidy))?(?=\s*$|\s*[.,;:!?\n]|\s+(?:for|para|of|de|do|da|dos|das|desta|deste|desse|dessa|destes|destas|desses|dessas|daquele|daquela|daqueles|daquelas|neste|nesta|nesse|nessa|naquele|naquela|on|sobre|about|to|that|which|que|with|com|in|em|no|na|nos|nas|by|por|and|e|from|at|before|after|ate|until|covering|explaining|so|\w{3,}ing|\w{3,}ndo)\b)/
const WORKFLOW_OBJECT = /\b(?:crie|criar|construa|desenvolva|escreva|escrever|redija|redigir|monte|montar|gere|gerar|elabore|elaborar|write|create|build|make|draft|develop)\s+(?:(?:a|an|the|um|uma|o|os|as|our|nosso|nossa|new|novo|nova|detailed|detalhado|detalhada|simple|simples)\s+){0,2}(?:\w+\s+)?(?:workflows?|pipelines?)\b(?=\s*$|\s*[.,;:!?\n]|\s+(?:for|para|of|de|do|da|dos|das|desta|deste|desse|dessa|destes|destas|desses|dessas|daquele|daquela|daqueles|daquelas|neste|nesta|nesse|nessa|naquele|naquela|on|sobre|about|to|that|which|que|with|com|in|em|no|na|nos|nas|by|por|and|e|from|at|before|after|ate|until|covering|explaining|so|without|except|excluding|sem|exceto|excluindo|using|usando|\w{3,}ing|\w{3,}ndo)\b)/

// The default verb rules (Opus and Sonnet), after the object rules. Verb signals: an explicit request in the draft. The first
// match in the text decides; on a tie the earlier rule wins.
// Languages: Portuguese (unaccented) + English; tested on fold() output (lower-cased, NFD diacritics stripped).
const DEFAULT_VERBS = [
  ['review', /\b(revise|revisar|revisao|review|reviews|audite|auditar|audit)\b/],
  ['workflow', /\b(automati[sz]\w*|automate\w*|agende|schedule|workflows?|pipelines?|configure|configurar|instale|instalar)\b/],
  ['data', /\b(planilhas?|csv|datasets?|spreadsheets?|limpe os dados|clean the data|extraia|extract)\b/],
  ['implementation', /\b(crie|criar|implemente|implementar|implement|build|construa|desenvolva|develop|corrija|corrigir|fix|refatore|refactor|programe|create|make|adicione|adicionar|add|gere|gerar|monte|montar)\b/],
  ['text', /\b(escreva|escrever|redija|write|draft|reescreva|rewrite|traduza|translate)\b/],
  ['analysis', /\b(pesquise|pesquisar|research|compare|comparar|analise|analisar|analyze|analyse|investigue|investigate|avalie|evaluate|resuma|resumir)\b/],
  ['plan', /\b(plano|planeje|planejar|plan|roadmap|cronograma|estrategia|strategy)\b/],
  // "Explain how to configure nginx": an explanation is asked for, whatever the verbs it is about.
  ['answer', /\b(explique|explicar|explain|esclareca|esclarecer|clarify)\b/]
]

// Languages: Portuguese (unaccented) + English.
const MAKE_VERB = /\b(crie|criar|escreva|escrever|write|create|build|construa|desenvolva|develop|implemente|implement|programe|gere|gerar|monte|montar)\b/
// Languages: Portuguese (unaccented) + English.
const CODE_ARTIFACT = /\b((?:python|bash|shell|zsh|node|nodejs|javascript|typescript|ruby|perl|php|powershell|lua|sql|automation|build|deploy|deployment|migration|backup|cron|install|setup)\s+scripts?|scripts?\s+(?:em\s+|in\s+)?(?:python|bash|shell|zsh|node|nodejs|javascript|typescript|ruby|perl|php|powershell|lua|sql|automation|build|deploy|deployment|migration|backup|cron|install|setup)\b|(?<!\b(?:video|videos|podcast|youtube|film|movie|audio|tiktok|reels?|filme)\s)scripts?(?!\s+(?:for|para|de|do|da)\s+(?:(?:my|the|our|o|a|meu|minha|nosso|nossa)\s+)?(?:blog|videos?|podcasts?|canal|channel|youtube|filme|film|movie)\b(?!\s+(?:processing|processamento|encoding|codificacao|transcoding|conversion|conversao|compression|compressao|editing|edicao|analysis|analise|download|downloads|upload|uploads|streaming|rendering|renderizacao|pipelines?|files?|arquivos?|frames?|metadata|thumbnails?)\b)(?![^.!?\n]{0,80}\b(?:in|em)\s+(?:python|bash|shell|zsh|node|nodejs|javascript|typescript|ruby|perl|php|powershell|lua|sql|go|rust|java|c|c\+\+|c#)\b))|func(ao|oes)|functions?|apis?|endpoints?|cli|clis|apps?|aplicativos?|modul[oe]s?|class(e|es)?|programas?|programs?|bots?|(?:unit|integration|e2e|end-to-end|load|stress|smoke|regression|automated|acceptance|performance|functional|contract|snapshot|unitarios?|automatizados?)\s+(?:tests?|testes?)|(?:tests?|testes?)\s+(?:de\s+)?(?:unidade|integracao|carga|regressao|fumaca|aceitacao|contrato)\b|(?:tests?|testes?)\s+(?:suites?|cases?|files?|coverage|harness|runners?|fixtures?)\b|(?<!\b(?:students?|alunos?|alunas?|pupils?|graders?|grade|serie|multiple-?choice|multipla escolha|quiz|quizzes|exams?|provas?|school|escola|classroom|turma|lesson|aula|homework|matematica|math|maths|mathematics|history|historia|geography|geografia|science|ciencias|english|ingles|portuguese|portugues|spelling|vocabulary|vocabulario|fractions|fracoes)\s)(?:tests|testes)(?!\s+(?:report|relatorio|results?|resultados?|summary|resumo)\b)(?![^.!?\n]{0,80}\b(?:students?|alunos?|alunas?|pupils?|graders?|grade|serie|multiple-?choice|multipla escolha|quiz|quizzes|exams?|provas?|school|escola|classroom|turma|lesson|aula|homework|matematica|math|maths|mathematics|history|historia|geography|geografia|science|ciencias|english|ingles|portuguese|portugues|spelling|vocabulary|vocabulario|fractions|fracoes|quest(?:ao|oes)|questions?|perguntas?)\b)|quer(y|ies)|regex(es)?|readme|dockerfile)\b/
// Languages: Portuguese (unaccented) + English.
const TEXT_ARTIFACT = /((?<!\b(?:and|then|also|e|depois|por|via|by)\s)\be-?mails?\b(?!\s+(?:me|us|him|her|them|you)\b)|\bmemos?\b|\bmemorandos?\b|\b((?:video|videos|podcast|youtube|film|movie|audio|tiktok|reels?|filme)\s+scripts?|(?<!\b(?:python|bash|shell|zsh|node|nodejs|javascript|typescript|ruby|perl|php|powershell|lua|sql|automation|build|deploy|deployment|migration|backup|cron|install|setup)\s)scripts?(?!\s+(?:em\s+|in\s+)?(?:python|bash|shell|zsh|node|nodejs|javascript|typescript|ruby|perl|php|powershell|lua|sql|automation|build|deploy|deployment|migration|backup|cron|install|setup)\b)(?=\s+(?:for|para|de|do|da)\s+(?:(?:my|the|our|o|a|meu|minha|nosso|nossa)\s+)?(?:blog|videos?|podcasts?|canal|channel|youtube|filme|film|movie)\b(?!\s+(?:processing|processamento|encoding|codificacao|transcoding|conversion|conversao|compression|compressao|editing|edicao|analysis|analise|download|downloads|upload|uploads|streaming|rendering|renderizacao|pipelines?|files?|arquivos?|frames?|metadata|thumbnails?)\b)(?![^.!?\n]{0,80}\b(?:in|em)\s+(?:python|bash|shell|zsh|node|nodejs|javascript|typescript|ruby|perl|php|powershell|lua|sql|go|rust|java|c|c\+\+|c#)\b))|posts?|artigos?|articles?|blog|carta|letter|newsletter|texto|essay|ensaio|roteiro|mensagem|message|copy(?!\s+(?:of|function|script|command|files?|folders?)\b)|description|descricao|reports?|relatorios?|summar(?:y|ies)|resumos?|instructions?|instrucoes|instrucao|guides?|guias?|tutorials?|tutoriais|manua(?:l|is)|documentation|documentacao|docs|how-?tos?|faqs?|checklists?|release notes|notas de versao)\b)/
// Languages: Portuguese (unaccented).
// A generate/assemble verb at the start of the match: it does not say which artifact is made, so the first artifact named decides ("Gere um e-mail").
const GENERATE_VERB = /^(gere|gerar|monte|montar)\b/
// Languages: Portuguese (unaccented) + English.
// A question: the draft opens with a question word and its first sentence is a question (or one phrase without
// punctuation, a plain period included; a period inside a name or version, "Node.js", "3.12", is not an end). The verbs
// inside it ("Como instalar o Docker?") are what is asked about, not an order. A question may wrap onto the next
// line ("How do I configure nginx\nwith TLS?") or carry a comma ("How do I configure nginx, with TLS."); a blank line
// ends it ("How do I configure nginx\n\nBe brief." is still a question), and so does a sentence mark or a period
// followed by a space ("How do I configure nginx. Be brief."), after
// which an order is a task ("What is Docker? Fix the login bug."). The scan is linear: no part of the form may
// re-consume whitespace another part accepted, or a long run of spaces before a stray mark backtracks quadratically.
const QUESTION_FORM = /^(?:como|o que|qual|quais|por que|porque|quando|onde|quem|quanto|how|what|why|which|who|when|where)\b(?:(?:[^.!?\n]|\.(?=\S)|\n(?![ \t]*\n))*\?|(?:[^.!?\n]|\.(?=\S)|\n(?![ \t]*\n))*(?:!|\.(?!\S)|$|(?=\n[ \t]*\n)))/
// "What I need: build a dashboard", "O que eu quero e que voce construa ...": a question word opening a statement.
// "Como especialista em seguranca, voce pode revisar esta API?": a role, not the question word "como".
const ROLE_HEAD = /^(?:como|enquanto)\s+(?:um |uma )?(?:especialista|expert|engenheir[ao]|arquitet[ao]|desenvolvedor[a]?|analista|consultor[a]?|revisor[a]?|lider|gerente|professor[a]?|designer|cientista|advogad[ao]|medic[ao]|redator[a]?|editor[a]?|auditor[a]?|tester|dba|sre|devops|senior|junior|pleno|profissional|programador[a]?|pesquisador[a]?)\b/
const DECLARATIVE = /^(?:what|o que)\s+(?:i|we|you|eu|nos|a gente|voce|voces)\s+(?:need|want|would like|'d like|expect|mean|ask|prefer|really (?:need|want)|preciso|precisamos|quero|queremos|gostaria|gostariamos|espero|esperamos)\b/
// Languages: Portuguese (unaccented) + English.
// "Analise a planilha" stays a data task: the analysis verb with a data file as its subject.
const DATA_NOUN = /\b(planilhas?|csv|datasets?|spreadsheets?)\b/
const QUESTION_START = /^(qual|quais|como|o que|por que|porque|quando|onde|quem|quanto|what|how|why|which|who|when|where|is|are|does|do|can)\b/

// Languages: Portuguese (unaccented) + English.
// A signal that is a noun, not an order ("Our plan is ready. Build ..."): it decides only when no verb does.
const NOUN_SIGNAL = /^(plano|planos|plan|roadmap|cronograma|estrategia|strategy|workflows?|pipelines?|planilhas?|csv|datasets?|spreadsheets?|revisao|review|reviews|pesquisa|code|codigo)$/
// The match opens the draft or a sentence (only punctuation or a line break and spaces before it), or follows a
// one-word opener and its comma ("First, plan ..."), a polite prefix ("Please plan ...", "Por favor, planeje") or a
// request prefix ("Can you plan ...", "I need you to plan ...", "Preciso que voce planeje ...").
// A noun-signal word there names the request ("Plan the steps ...", "Plano de acao para ..."), not context.
const SENTENCE_START = /(?:^|[.!?;:\n])\s*(?:(?:\w+|(?:as|como|enquanto)\s+(?:an?\s+|um\s+|uma\s+)?[^,.!?;:\n]{1,40}),\s*)?(?:(?:please|pls|por favor|favor)\s*,?\s+)?(?:(?:(?:can|could|would|will) you|(?:i|we) (?:need|want) you to|voce pode|preciso que voce|precisamos que voce|quero que voce|queremos que voce)\s+(?:please\s+)?)?(?:(?:help (?:me|us)(?: to)?|(?:me|nos) (?:ajude|ajudem|ajuda) a|(?:ajude|ajudem)(?:-| )(?:me|nos) a)\s+(?:please\s+)?)?(?:(?:\w+ly|\w+mente|first|then|now|next|also|just|again|primeiro|depois|agora|entao|tambem|so|ja)\s+)?$/
// A noun-signal word after an infinitive or modal marker is the verb ("we need to plan before ...", "let's plan").
const INFINITIVE_MARK = /\b(?:(?:need|needs|needed|want|wants|wanted|have|has|had|going|ought|able|like|try|trying|time|ready|how)\s+to|let'?s|let us|(?:we|you|i|they)\s+(?:should|must|will|can|could|shall|may|might)(?:\s+(?:also|first|then|now|just))?|precisamos|devemos|vamos|queremos|preciso|quero|devo|vou)\s*$/
// A noun-signal word that heads a requested noun phrase ("A plan to configure nginx", "Preciso de um plano para ...")
// names the request: a determiner (after an optional request opener or verb) opens its sentence, up to two plain
// modifiers may sit between them ("a migration plan"), and no copula follows ("The plan is ready. Build ..." is context).
const REQUESTED_NOUN = /(?:^|[.!?;:\n])\s*(?:\w+,\s*)?(?:(?:please|pls|por favor|favor)\s*,?\s+)?(?:(?:can|could|would|will|may)\s+you\s+(?:please\s+)?|(?:(?:voce|voces)\s+)?(?:pode|poderia|podem|poderiam)\s+(?:por favor\s+)?)?(?:(?:(?:i|we) (?:need|want|would like)|i'd like|we'd like|give me|send me|show me|tell me|preciso de|precisamos de|quero|queremos|gostaria de|gostariamos de|me de|me dar|dar|me mostre|me mostrar|mostrar|mostre|me diga|diga-me|diga me|me dizer|dizer|diga|me passe|me envie|me mande|outline|draft|prepare|propose|sketch|produce|provide|esboce|elabore|prepare|proponha|produza|forneca|apresente|what (?:i|we) (?:need|want|would like) is|o que (?:eu|nos) (?:preciso|precisamos|quero|queremos) e)\s+(?:me\s+)?)?(?:a|an|the|um|uma|o|os|as|some|algum|alguma|alguns|algumas)\s+(?:(?!(?:to|for|of|and|or|that|which|para|de|do|da|que|e|ou)\s)[\w-]+\s+){0,2}$/
// "Plano e cronograma para configurar nginx": the folded "e" (and/is) is a conjunction until proven otherwise, and
// "esta" (this/is) counts only before a participle or state ("esta quebrado", "esta pronto", "esta anexa").
const COPULA = /^\s+(?:(?:is|are|was|were|will|would|has|have|had|estao|era|eram|foi|foram|sera|serao|ja|fica|ficou|seems|looks|parece)\b|esta\s+\w*(?:ad[ao]s?|id[ao]s?|ndo|nte|pront[ao]s?|lent[ao]s?|anex[ao]s?|ok)\b)/
// "The pipeline failed. Review the logs.": a predicate after a noun-signal word makes it context, unless the word opens
// its sentence as an order ("Review failed deployments", "Review works in progress").
// For a plain verb word, "e" (and/is) and "esta" (this/is) are ambiguous: only an unambiguous copula, or "esta" before
// a participle or state ("esta quebrado", "esta pronto"), makes "The build is broken" a thing.
const VERB_COPULA = /^\s+(?:(?:is|are|was|were|will|would|has|have|had|estao|era|eram|foi|foram|sera|serao|fica|ficou|seems|looks|parece)\b|esta\s+\w*(?:ad[ao]s?|id[ao]s?|ndo|nte|pront[ao]s?|lent[ao]s?|anex[ao]s?|ok)\b)/
const PREDICATE = /^\s+(?:failed|fails|broke|breaks|crashed|crashes|works|worked|ran|runs|stopped|stops|falhou|falha|quebrou|quebra|funciona|funcionou|rodou|roda|parou)\b/
// A noun-signal word followed by a determiner is the verb wherever it sits ("... so plan the steps", "review our API").
// Portuguese este/esta are left out: folded, "esta" is also "esta" ("Nosso plano esta pronto").
const VERB_OBJECT = /^\s+(?:the|a|an|our|my|your|this|these|those|all|each|every|o|os|as|um|uma|uns|umas|nosso|nossa|nossos|nossas|meu|minha|seu|sua|esse|essa|esses|essas|todos|todas|cada)\b/
// A verb right after a negation (an adverb at most in between) is a prohibition, not the order ("do not run any
// commands", "never ever deploy", "nao execute"). A reminder ("don't forget to review") still asks for the review.
const NEGATED = /(?:^|[\s,;:(])(?:(?:do not|don't|dont|does not|doesn't|never|not|nao|nunca|jamais)(?:\s+(?:ever|even|just|simply|actually|really|ainda|mesmo|sequer|simplesmente))?(?:\s+(?:want|wants|try|tries|need|needs|attempt|expect|intend|wish|dare|like|allow|let|ask|tell)(?:\s+(?:you|me|us|them|him|her|anyone))?\s+to|\s+(?:quero|queremos|tente|tentem|tentar|precisa|precisamos|espero|esperamos|permito|deixe|peca|peço)(?:\s+que\s+(?:voce|voces|ele|ela|eles|elas|ninguem|alguem))?)?|without|sem)\s*$/
// A prohibition may be indirect ("I do not want you to configure", "do not try to configure", "nao quero que voce
// configure"); a reminder ("don't forget to review") is not one.
// The prohibition covers the verbs coordinated with the negated one ("do not build or deploy anything", "never
// install, configure or deploy"): a coordinator or a list comma leads back to the previous word.
const COORDINATED = /\b(\w+)\s*(?:,|,?\s+(?:or|nor|and|ou|nem|e))\s*$/
// "Do not build the app or configure nginx": the clause before the coordinator opens with the prohibition.
// "Do not build, test or deploy anything": a bare comma is a list only when the next item is bare ("test or") or a
// comma precedes the coordinator ("deploy, and"); "Do not configure nginx, review the API and report findings" opens
// an alternative order whose own coordinator does not reach back.
const LIST_TAIL = /^[\w-]+(?:\s+[\w-]+)?\s+(?:or|nor|and|ou|nem|e)\b|^[^.!?;:\n]{0,120}?,\s*(?:or|nor|and|ou|nem|e)\b/
const CLAUSE_NEGATION = /(?:^|[.!?;:\n])\s*(?:\w+,\s*)?(?:(?:please|por favor)\s*,?\s+)?(?:(?:i|we|eu|nos)\s+)?(?:do not|don't|dont|does not|doesn't|never|not|nao|nunca|jamais)\b[^.!?;:\n]*$/
const PREDICATE_NEGATION = /\b(?:is|are|was|were|am|be|been|being|'s|'re|seems|looks|esta|estao|estava|estavam|e|era|eram|foi|foram|fica|ficou|parece)\s+(?:not|nao|never|nunca)(?:\s+\w+)?\s*$/
// A mark-less question may carry a comma only when what precedes the comma already reads as a question ("How do
// I configure nginx, with TLS."): a role opener ("Como especialista em redes, escreva ...") is not one.
const QUESTION_HEAD = /\b(?:do|does|did|can|could|should|would|will|may|might|is|are|was|were|am|have|has|posso|devo|consigo|faco|funciona|funcionam|deveria|poderia|sao|esta|estao|ha)\b/
// Only this many characters around a match are inspected, so the scan stays linear on long drafts; the prefixes
// NEGATED and SENTENCE_START look for are far shorter than this.
const CONTEXT_WINDOW = 120
// "Can you show me a script that extracts data?", "Give me a function that parses dates", "Me mostre um script que leia
// datas": a request to be shown, given, sent or told a code artifact asks for information. The request is read as a
// question: the verbs inside it are what the artifact does, not an order, and only a build order after it ("... and then
// write unit tests", "Can you make it faster?", "Help me add unit tests") makes the draft a task. This replaces any
// reading of what the artifact is (existing, owned, found in a source, a recommendation): all of them are answers.
// Languages: Portuguese (unaccented) + English.
const SHOW_OPEN = /^(?:(?:please|pls|por favor),?\s+)?(?:(?:(?:can|could|would|will)\s+you|(?:(?:voce|voces)\s+)?(?:pode|poderia|podem|poderiam)(?:\s+por favor)?)\s+(?:(?:please|kindly)\s+)?)?(?:(?:show|give|send|tell|pass)\s+(?:me|us)|(?:me|nos)\s+(?:mostrar|mostre|dar|de|dizer|diga|passar|passe|enviar|envie|mandar|mande)|(?:mostre|de|diga|passe|envie|mande)-(?:me|nos))\b/
const PT_SHOW = /\b(?:mostr\w+|dar|de|dizer|diga|passar|passe|enviar|envie|mandar|mande|pode\w*|voces?)\b/
const SHOW_FORM = new RegExp(`${SHOW_OPEN.source}(?:[^.?!;:\\n]|\\.(?=\\S))*(?:[?!;:\\n]|\\.(?!\\S)|$)`)
// The head of the phrase asked for ends at a preposition, a clause word, a courtesy word or a mark ("the name of the function", "a review of
// the code" and "the API key" ask for something else than code).
const SHOW_HEAD = /[.!?,\n]|\s+(?:please|pls|thanks|thank|obrigado|obrigada|of|to|for|from|in|on|at|about|between|with|without|by|through|via|inside|using|that|which|who|whose|where|when|and|or|but|de|do|da|dos|das|para|em|no|na|nos|nas|sobre|entre|com|sem|por|que|e|ou|mas)\b/
// The phrase asked for ends with code: a code artifact, or anything the code category knows ("a dashboard", "the login
// page"). The last word is the head noun, not a modifier, as in "the API key" or "a code review".
const CODE_HEAD = new RegExp(`(?:${CODE_ARTIFACT.source}|${CATEGORY_RULES.find(([id]) => id === 'code')[1].source})\\s*$`)
// "I need a script to write log files": the artifact asked for sits before the verb that tells its purpose; with the
// request opener ("I need", "preciso de") it also decides the deliverable ("I need a script to configure nginx").
// "I need a React app. Write it in TypeScript": the thing asked in the sentence before is what the order writes.
const PRIOR_REQUEST = /(?:(?:i|we) (?:need|want|would like)|i'd like|we'd like|give me|preciso de|precisamos de|quero|queremos|gostaria de|gostariamos de)\s+(?:(?:a|an|the|um|uma|o|os|as|some)\s+)?([^.!?\n]{1,60})[.!?\n]\s*(?:(?:please|pls|por favor|favor|now|agora|then|depois|entao|also|tambem)\s*,?\s+|(?:can|could|would|will)\s+you\s+(?:please\s+)?|(?:voce\s+)?(?:pode|poderia)\s+(?:por favor\s+)?){0,3}$/
// "Write it in TypeScript with documentation": the order points back ("it", "-o", "em") instead of naming a new thing.
const PRONOUN_OBJECT = /^\s*[\w-]+?(?:-(?:o|a|os|as|lo|la|los|las))?\s+(?:it|them|this|that|these|those|one|isso|isto|aquilo|in|em|with|com|using|usando|for|para)\b|^\s*\w+-(?:o|a|os|as|lo|la|los|las)\b/
const REQUESTED_ARTIFACT = /((?:(?:i|we) (?:need|want|would like)|i'd like|we'd like|give me|send me|preciso de|precisamos de|quero|queremos|gostaria de|gostariamos de|me de|me passe|me envie|me mande|what (?:i|we) (?:need|want|would like) is|o que (?:eu|nos) (?:preciso|precisamos|quero|queremos) e)\s+(?:me\s+)?)?(?:(?:a|an|the|um|uma|o|os|as|some|algum|alguma|alguns|algumas)\s+(?:(?!(?:to|for|and|or|that|which|para|que|e|ou)\s)[\w-]+\s+){1,3}|(?:(?:clear|detailed|short|simple|quick|step-by-step|claras|detalhadas|simples|rapidas)\s+)?(instructions|instrucoes|steps|passos|guidance|orientacoes|orientacao|guidelines|diretrizes|documentation|documentacao|docs|help|ajuda|advice|conselhos|tips|dicas|directions|pointers|recommendations|recomendacoes)\s+)(?:(?:to|that|which|para|que)\s+(?:(?:will|would|can|could|should|must|might|may|shall|vai|va|pode|possa|deve|deva|ira|iria|consiga|safely|quickly|carefully|properly|automatically|reliably|correctly|fully|gently|kindly|please|\w+ly|\w+mente)\s+){0,2}|(?:(?:that|which|que)\s+)?(?:explaining|describing|showing|covering|teaching|detailing|explicando|descrevendo|mostrando|ensinando|detalhando|explains|describes|shows|covers|teaches|details|explica|descreve|mostra|ensina|detalha|explique|descreva|mostre|ensine|detalhe)\s+(?:how|why|what|when|where|which|como|por que|o que|quando|onde|qual)\s+(?:to\s+|(?:i|we|you|they|one)\s+(?:can|could|should|must)?\s*|(?:eu|nos|voce|voces)\s+(?:posso|podemos|pode|podem|devo|devemos|deve|devem)?\s*)?)$/
// "and fix the login bug", "e corrigir o bug": a coordinator followed by an order inside an explanation request.
// "how to configure nginx and deploy the app", "the architecture and how to configure nginx": a topic, not an order.
const TOPIC_TAIL = /\b(?:how to|how|why|when|where|what|which|whether|como|por que|porque|quando|onde|o que|qual|quais|se)\s+\w+[^.!?,;]*$/
const TOPIC_AGENT = /\b(?:we|you|i|they|nos|voce|voces|eles|elas|a gente|first|primeiro)\b/
// "a script to read and write files": a coordinator inside an infinitive purpose of the artifact (no comma, no "then")
// extends what the artifact does, it does not order anything. After a finite verb ("that extracts data and fix ...") a bare
// verb is an order.
// How an order is wrapped when it is addressed to the assistant ("can you", "help me", "I need you to", "voce pode", "me ajude a").
const ADDRESS_WRAP = '(?:(?:can|could|would|will)\\s+you|(?:voce|voces)\\s+(?:pode|poderia)|(?:i|we)\\s+(?:need|want)\\s+you\\s+to|(?:preciso|quero)\\s+que\\s+voce|help\\s+(?:me|us)(?:\\s+to)?|(?:me|nos)\\s+ajude\\s+a|ajude(?:-|\\s)(?:me|nos)\\s+a)'
// ... unless the coordinated clause opens by addressing the assistant ("and please add", "and can you add").
// An adverb in front ("and also can you add", "e tambem por favor adicione") does not hide it.
const ORDER_ADDRESS = new RegExp(`^(?:(?:also|then|now|just|tambem|depois|agora|so|\\w+ly|\\w+mente)\\s*,?\\s+){0,2}(?:(?:please|por favor)\\b|${ADDRESS_WRAP}\\b)`)
// "a script that can install and then configure nginx": after a modal the coordinated verb is part of what the script can do.
const PURPOSE_MODAL = /\b(?:that|which|who|whose|que)\s+(?:(?:also|always|never|just|still|ja|tambem|nunca|sempre)\s+)?(?:can|could|should|will|would|must|may|might|possa|possam|deva|devam|pode|podem)\b[^.!?;:]*$/
// "a script that helps users read and write files", "que ajuda a ler e escrever": what the script helps or lets someone do
// (a help verb, a pronoun or people-noun object, a bare verb) is part of the script, so the coordinated verb is not a second order. A coordinator
// or a comma after the complement ends it ("helps users read and write files and fix the bug").
const NOT_BARE_OBJECT = 'the|an?|our|your|their|my|his|her|its|all|some|new|and|or|with|for|on|in|of|to|from|at|by|about|through|via|into|as|than|between'
const PURPOSE_COMPLEMENT = new RegExp(`\\b(?:help|helps|let|lets|allow|allows|enable|enables|permit|permits)\\s+(?:(?:me|us|you|them|him|her|users|people|everyone|someone|anyone|developers|customers)\\s+(?!(?:${NOT_BARE_OBJECT})\\b)(?:\\w+ly\\s+)?(?!\\w*[^\\Wsui]s\\b)[\\w-]+|(?:the|an?|our|your|their|my|his|her|its|all|some|new)\\s+(?:[\\w-]+\\s+){1,2}(?:\\w+ly\\s+)?${MAKE_VERB.source})(?:\\s+(?!(?:and|or)\\b)[\\w-]+){0,3}\\s*$|\\b(?:ajuda|ajudam)\\s+(?:(?!(?:e|ou)\\b)[\\w-]+\\s+){0,2}a\\s+\\w+(?:ar|er|ir)\\b(?:\\s+(?!(?:e|ou)\\b)[\\w-]+){0,3}\\s*$`)
// "to" opens a purpose only before a verb: "to users", "to the team", "to them" and "para os usuarios" name a recipient.
// A plural noun ends in s (not ss, us, is); a Portuguese infinitive ends in ar, er or ir ("para ler", "para instala-lo").
const PURPOSE_TAIL = /\bto\s+(?!(?:the|an?|my|our|your|their|his|her|its|this|that|these|those|all|each|every|some|any|no|me|us|you|them|him|it)\b)(?!\d)(?!\w*[^\Wsui]s\b)\w/g
const PURPOSE_PARA = /\bpara\s+(?:\w+(?:ar|er|ir)|\w+-(?:lo|la|los|las))\b/
// After a relative pronoun (a finite verb and its object come first: "that sends data to Redis"), "to" is an infinitive only
// behind a word that takes one ("used to", "needs to", "helps users to", "in order to").
const RELATIVE_PRONOUN = /\b(?:that|which|who|whose)\b/
const PURPOSE_CUE = /\b(?:use|uses|used|using|designed|built|made|meant|intended|supposed|able|ready|going|need|needs|needed|want|wants|wanted|try|tries|trying|help|helps|let|lets|allow|allows|enable|enables|order|written|wrote)\s+(?:[\w-]+\s+){0,2}$/
// "which" and "where" after a noun ("a function which parses dates", "a script where the bug occurs") open a relative clause;
// after a verb of asking or knowing, a conjunction or "me" ("show me which", "and where") they ask a question: a topic.
const QUESTION_CONTEXT = /(?:^|\s)(?:show|tell|explain|ask|know|see|learn|understand|decide|choose|about|whether|if|and|or|me|us)\s+$/
const TOPIC_HEAD = /^\s*(?:how|what|why|when|where|which|whether|como|o que|por que|quando|onde|qual|quais)\b/
// "and fix the login bug": the order verb opens right after the coordinator, at most behind please/then/an adverb.
// "Can you recommend a design and build a React dashboard?": a yes/no question addressed to the assistant may carry an order.
const ADDRESSED = /^(?:(?:can|could|would|will|should|may|might|do|does|did)\s+you\b|(?:voce|voces)\b|(?:pode|podem|poderia|poderiam|consegue|conseguem|da|daria)\s+(?:para\s+)?(?:voce|voces|me|nos)?\b)/
// "How do I build a React app? Add examples.": after a question, an instruction about the answer is not a task.
const RESPONSE_NOTE = /^(?:add|include|give|provide|use|keep|make|show|cite|list|format|mention|cover|avoid|skip|omit|limit|be|adicione|inclua|de|forneca|mantenha|faca|mostre|cite|liste|formate|mencione|cubra|evite|pule|omita|limite|seja)\s+(?:(?:the|a|an|some|more|any|your|o|os|as|um|uma|mais|alguns|algumas|sua|seu)\s+)?(?:\w+\s+){0,2}?(?:examples?|exemplos?|sources?|fontes?|references?|referencias?|links?|citations?|citacoes|bullet\s*points?|bullets|topicos|tables?|tabelas?|code\s+samples?|snippets?|trechos|answer|resposta|response|explanation|explicacao|details?|detalhes|context|contexto|summary|resumo|steps?|passos|numbers?|numeros|comparison|comparacao|short|brief|concise|breve|curto|conciso|simple|simples|jargon|jargao|markdown|headings?|titulos?|emojis?|words?|palavras|sentences?|frases|paragraphs?|paragrafos|portuguese|english|ingles|portugues)\b/
const ORDER_LEAD = new RegExp(`^\\s*(?:(?:please|por favor|then|depois|also|tambem|now|agora|\\w+ly|\\w+mente|${ADDRESS_WRAP})\\s*,?\\s+){0,2}$`)
// A comma joins an order only when the clause after it addresses the assistant ("..., please write tests", "..., can you add").
const ORDER_JOIN = new RegExp(`\\b(?:and|then|e|depois|entao)\\s+(?:then\\s+|depois\\s+)?|,\\s*(?=${ORDER_ADDRESS.source.slice(1)})`, 'g')
const INTRO_CLAUSE = /^([^.!?,:;\n]{1,60}),\s+/
// "The configure script is broken", "I tried to configure nginx yesterday": the verb names a thing or tells the past.
// "Ajude-me a revisar codigo": before a Portuguese infinitive, "a" is the preposition, not an article.
const PT_INFINITIVE = /(?:ar|er|ir)$/
const AFTER_A = /\ba\s+$/
// "The goal is to write a Python script. Review the existing code.": the stated goal is context for the order after it.
const STATED_GOAL = /\b(?:(?:goal|aim|objective|purpose|idea|plan|objetivo|meta|ideia|proposito|intencao)\s+(?:is|was|e|era|foi)\s+(?:to\s+|de\s+)?|(?:have|has|had|there is|there are|wrote|drafted|made|got|temos|tem|tenho|tinha|ha|existe|escrevi|escrevemos|fiz|fizemos)\s+(?:(?:a|an|the|some|um|uma|o|os|as)\s+)?(?:[\w-]+\s+){1,3}(?:to|that|which|para|que)\s+)$/
const MODIFIER_USE = /\b(?:the|a|an|this|that|these|those|my|our|your|o|os|a|as|um|uma|este|esta|esse|essa|meu|minha|nosso|nossa|seu|sua)\s+$/
const COMPOUND_AFTER = /^\s+(?!(?:the|a|an|this|that|these|those|my|our|your|all|each|every|o|os|as|um|uma|uns|umas|este|esta|esse|essa|meu|minha|nosso|nossa|seu|sua|todos|todas|cada|and|or|e|ou|to|for|para|de|do|da|with|com|in|em|on|at|by|por|it|them|me|us|is|are|was|were|e|esta|estao)\b)\w+/
const NARRATIVE = /(?:^|[.!?;:\n])\s*(?:\w+,\s*)?(?:(?:i|we|they|he|she|eu|nos|a gente|eles|elas|ele|ela)\s+)?(?:tried|attempted|managed|failed|forgot|happened|used|started|began|finished|stopped|tentei|tentamos|tentou|tentaram|consegui|conseguimos|conseguiu|esqueci|esquecemos|comecei|comecamos|comecou|parei|paramos|parou|terminei|terminamos|terminou)\s+(?:to\s+|de\s+|a\s+)?$/
// Languages: Portuguese (unaccented) + English.
// Between two artifact words, only bare modifiers ("API announcement email"): a preposition, clause word or
// participle ("email announcing the app", "script that sends an e-mail", "app de blog") means the first word is the
// artifact asked for. Nouns in -ing that name a field (marketing, landing, onboarding, billing) stay modifiers.
// The gap never crosses a line: "Write a Python script\nInclude documentation" is a script plus an instruction.
const MODIFIER_GAP = /^[ \t]+(?:(?!(?:that|which|who|to|for|of|on|about|with|without|except|excluding|minus|versus|vs|but|not|rather|instead|and|or|in|by|que|para|de|do|da|dos|das|sobre|com|sem|exceto|excluindo|mas|nao|vez|invés|and|or|e|ou|em|no|na|por)\b)(?!(?!(?:marketing|landing|onboarding|billing)\b)\w+(?:ing|ndo)\b)\w+[ \t]+){0,2}$/

// The first artifact named after the verb decides, unless it only modifies the next one; a discarded modifier does not
// end the search ("API documentation generator script" is code: API modifies documentation, which modifies script).
function pickArtifact(request) {
  const scan = (re, from) => { const g = new RegExp(re.source, re.flags.replace('g', '') + 'g'); g.lastIndex = from; return g.exec(request) }
  let code = scan(CODE_ARTIFACT, 0)
  let txt = scan(TEXT_ARTIFACT, 0)
  while (code && txt) {
    const [first, next] = code.index < txt.index ? [code, txt] : [txt, code]
    if (!MODIFIER_GAP.test(request.slice(first.index + first[0].length, next.index))) break
    if (first === code) code = scan(CODE_ARTIFACT, next.index + next[0].length)
    else txt = scan(TEXT_ARTIFACT, next.index + next[0].length)
  }
  if (code && txt) return code.index < txt.index ? 'code' : 'text'
  return code ? 'code' : txt ? 'text' : null
}
// The clause before a coordinator ends in an infinitive purpose ("a script to read and write files", "para ler e escrever").
function purposeTail(before) {
  const clause = before.slice(before.search(/[^.!?;:,]*$/))
  for (const m of clause.matchAll(PURPOSE_TAIL)) {
    const lead = clause.slice(0, m.index)
    if (!RELATIVE_PRONOUN.test(lead) || PURPOSE_CUE.test(lead)) return true
  }
  return PURPOSE_PARA.test(clause)
}
function contextBefore(text, at) {
  // The sentinel keeps ^ from matching where the window was cut.
  return at > CONTEXT_WINDOW ? '\u0000' + text.slice(at - CONTEXT_WINDOW, at) : text.slice(0, at)
}
// A verb is prohibited when a negation precedes it, or precedes a word it is coordinated with ("do not build or
// deploy", "never install, configure or deploy"); the walk back is bounded.
function prohibited(text, at, hops = 0) {
  const before = contextBefore(text, at)
  // A negated predicate ("The API is not ready, review the code") forbids nothing coordinated after it.
  if (NEGATED.test(before)) return hops === 0 || !PREDICATE_NEGATION.test(before)
  const chain = hops < 5 && COORDINATED.exec(before)
  if (!chain) return false
  if (/,\s*$/.test(chain[0]) && !LIST_TAIL.test(text.slice(at))) return false
  if (CLAUSE_NEGATION.test(before.slice(0, chain.index))) return true
  return prohibited(text, at - before.length + chain.index, hops + 1)
}
// Languages: Portuguese (unaccented) + English.
// A yes/no question, closed by its mark ("Can I configure nginx?", "Posso reiniciar o servidor?"). "Can you ..." and
// "Voce pode ..." are requests, not questions, unless they ask what the reader thinks, knows or can tell; "help me
// understand" asks, "help me fix" orders; "Do you / did you / have you ..." only ask; "Do not ..." is a
// prohibition, and the question ends at its own sentence, so a later request is read on its own.
// "Do I need to configure nginx", "Posso configurar o nginx.": only a modal or auxiliary opener reads as a question
// without its mark; "Preciso de um plano" or "Existe um script" is a statement until a "?" closes it.
// "Do I need to configure nginx": do/have open a question only before a subject; "Do a code review" and "Have a look" order.
const UNMARKED_YESNO = /^(?:(?:should|must|is|are|was|were|am|can|could|would|will|may|might|shall|posso|podemos|devo|devemos|consigo|conseguimos|sera que)\b|(?:do|does|did|have|has|had)(?:n't)?\s+(?:not\s+)?(?:i|we|you|they|he|she|it|this|that|these|those|there|anyone|someone|people)\b)/
const YESNO_FORM = /^(?:(?:voce|voces)\s+(?:pode|podem|poderia|poderiam|consegue|conseguem|sabe|sabem)\s+(?:por favor\s+)?(?:me\s+)?(?:explicar|contar|descrever|esclarecer|orientar|indicar|(?:mostrar|dizer)(?!\s+(?:um|uma|o|a|os|as|alguns|algumas|outro|outra|meu|minha|nosso|nossa|seu|sua)\s+(?!(?:passo|passos|jeito|forma|formas|maneira|maneiras|motivo|motivos|razao|razoes|diferenca|diferencas|opcoes|alternativas|riscos|requisitos|melhor|melhores|principal|principais|mesmo|mesma|outros|outras)\b))|ajudar a (?:entender|compreender|saber|decidir|escolher))|(?:(?:should|must|is|are|was|were|am|posso|podemos|devo|devemos|consigo|conseguimos|preciso|precisamos|existe|existem|ha|tem como|da para|e possivel|e preciso|e necessario|e seguro|e melhor|sera que|vale)\b|(?:do|does|did|have|has|had)(?:n't)?\s+(?:not\s+)?(?:i|we|you|they|he|she|it|this|that|these|those|there|anyone|someone|people|the|a|an|my|our|your|their|his|her|its)\b|(?:can|could|would|will|may|might|shall)(?!\s+(?:you|voce|voces)\b(?!(?:\s+(?:please|kindly|por favor|gentilmente))?\s+(?:think|know|believe|recommend|suggest|mean|see|say|explain|describe|clarify|walk|(?:show|tell)(?!\s+(?:me|us)\s+(?:a|an|the|some|another|my|our|your)\s+(?!(?:step|steps|way|ways|reason|reasons|difference|differences|basics|pros|cons|options|alternatives|trade-?offs|risks|requirements|best|right|correct|proper|main|key|most|first|next|last|only|same|other)\b))|help (?:me |us )?(?:to )?(?:understand|figure out|learn|know|see|grasp|decide|choose)|acha|sabe|recomenda|sugere|conhece|me explicar|me contar|me descrever|me esclarecer|me orientar|explicar|contar|descrever|esclarecer|(?:me )?(?:mostrar|dizer)(?!\s+(?:um|uma|o|a|os|as|alguns|algumas|outro|outra|meu|minha|nosso|nossa|seu|sua)\s+(?!(?:passo|passos|jeito|forma|formas|maneira|maneiras|motivo|motivos|razao|razoes|diferenca|diferencas|opcoes|alternativas|riscos|requisitos|melhor|melhores|principal|principais|mesmo|mesma|outros|outras)\b))|me ajudar a (?:entender|compreender|saber|decidir|escolher))\b)))(?!\s+not\b|n't\b))\b(?:[^.?!\n]|\.(?=\S)|\n(?![ \t]*\n))*(?:\?|!|\.(?!\S)|$|(?=\n[ \t]*\n))/
// "Can you tell me how to configure nginx", "Tell me how to ...", "Me diga como ...": an explanation is asked for,
// whether or not a question mark closes it; the request ends with its sentence.
const EXPLAIN_FORM = /^(?:(?:(?:please|por favor),?\s+)?(?:(?:explain to|describe to|walk) (?:me|us)|(?:show|tell) (?:me|us)(?!\s+(?:(?:please\s+)?(?:a|an|the|some|another|my|our|your)\s+)(?!(?:step|steps|way|ways|reason|reasons|difference|differences|basics|pros|cons|options|alternatives|trade-?offs|risks|requirements|best|right|correct|proper|main|key|most|first|next|last|only|same|other)\b))|help (?:me|us) (?:to )?(?:understand|figure out|learn|know|see|grasp|decide|choose)|(?:me|nos) (?:ajude|ajudem) a (?:entender|compreender|saber|decidir|escolher)|(?:ajude|ajudem)(?:-| )(?:me|nos) a (?:entender|compreender|saber|decidir|escolher)|(?:me|nos) (?:explique|expliquem|conte|contem|descreva|descrevam|esclareca|esclarecam)|(?:me|nos) (?:mostre|mostrem|diga|digam)(?!\s+(?:um|uma|o|a|os|as|alguns|algumas|outro|outra|meu|minha|nosso|nossa|seu|sua)\s+(?!(?:passo|passos|jeito|forma|formas|maneira|maneiras|motivo|motivos|razao|razoes|diferenca|diferencas|opcoes|alternativas|riscos|requisitos|melhor|melhores|principal|principais|mesmo|mesma|outros|outras)\b))|(?:diga|digam|explique|expliquem|mostre|mostrem|conte|contem|descreva|descrevam|esclareca|esclarecam) (?:me|nos|pra mim|para mim|para nos))|(?:can|could|would|will) you (?:(?:please|kindly) )?(?:say|explain|describe|clarify|walk|(?:show|tell)(?!\s+(?:me|us)\s+(?:a|an|the|some|another|my|our|your)\s+(?!(?:step|steps|way|ways|reason|reasons|difference|differences|basics|pros|cons|options|alternatives|trade-?offs|risks|requirements|best|right|correct|proper|main|key|most|first|next|last|only|same|other)\b))|help (?:me |us )?(?:to )?(?:understand|figure out|learn|know|see|grasp|decide|choose))|(?:voce|voces) (?:pode|podem|poderia|poderiam|consegue|conseguem|sabe|sabem) (?:por favor )?(?:me )?(?:explicar|contar|descrever|esclarecer|orientar|indicar|(?:mostrar|dizer)(?!\s+(?:um|uma|o|a|os|as|alguns|algumas|outro|outra|meu|minha|nosso|nossa|seu|sua)\s+(?!(?:passo|passos|jeito|forma|formas|maneira|maneiras|motivo|motivos|razao|razoes|diferenca|diferencas|opcoes|alternativas|riscos|requisitos|melhor|melhores|principal|principais|mesmo|mesma|outros|outras)\b))|ajudar a (?:entender|compreender|saber|decidir|escolher)))\b(?:[^.?!\n]|\.(?=\S)|\n(?![ \t]*\n))*(?:\?|!|\.(?!\S)|$|(?=\n[ \t]*\n))/

// The profile an engine may leave out in whole or in part: what Opus and Sonnet read.
const DEFAULT_PROFILE = { verbs: DEFAULT_VERBS, categories: CATEGORY_RULES, dataNoun: DATA_NOUN, dataUnless: null, foldLimit: DEFAULT_FOLD_LIMIT }

// A make verb with a review, a plan, a data file or an automation as its object: tried before every profile's verbs.
const OBJECT_RULES = [
  ['review', REVIEW_OBJECT],
  ['plan', PLAN_OBJECT],
  ['data', DATA_OBJECT],
  ['workflow', WORKFLOW_OBJECT]
]

function createDetector(profile = {}) {
  const verbs = profile.verbs ?? DEFAULT_PROFILE.verbs
  const categories = profile.categories ?? DEFAULT_PROFILE.categories
  const dataNoun = profile.dataNoun ?? DEFAULT_PROFILE.dataNoun
  const dataUnless = profile.dataUnless ?? DEFAULT_PROFILE.dataUnless
  const foldLimit = profile.foldLimit ?? DEFAULT_PROFILE.foldLimit
  const verbRules = [...OBJECT_RULES, ...verbs]
  const foldDraft = text => fold(text, foldLimit)

  // The phrase after "show me" asks for code: code heads the phrase asked for.
  // In Portuguese an adjective follows the noun ("uma funcao simples", "um script novo"): up to two words after the code noun.
  function asksCode(phrase, pt) {
    const head = phrase.slice(0, 300).split(SHOW_HEAD, 1)[0]
    if (CODE_HEAD.test(head)) return true
    // Not behind the English modifier "code" ("um code review") nor a determiner or a review/plan/data noun.
    const cut = text => text.replace(/\s+[\w-]+\s*$/, '')
    return pt && [cut(head), cut(cut(head))].some(stem => CODE_HEAD.test(stem) && !/\bcode\s*$/.test(stem)
      && !/^\s*(?:an?|the|um|uma|uns|umas|o|os|as)\s/.test(head.slice(stem.length)) && !head.slice(stem.length).split(/\s+/).some(word => NOUN_SIGNAL.test(word)))
  }
  function coordinatedOrder(text, purpose = false) {
    ORDER_JOIN.lastIndex = 0
    for (let n = 0, m; n < 8 && (m = ORDER_JOIN.exec(text)); n++) {
      // A comma is a join in a show request only; elsewhere it continues the sentence.
      if (!purpose && m[0][0] === ',') continue
      const before = text.slice(Math.max(0, m.index - CONTEXT_WINDOW), m.index)
      const rest = text.slice(m.index + m[0].length, m.index + m[0].length + CONTEXT_WINDOW)
      // "how to configure nginx and deploy the app": the coordinator extends the topic, not the request; "and then" orders.
      let topic = TOPIC_TAIL.exec(before)
      if (purpose && topic && /^(?:which|where)\s/.test(topic[0]) && !QUESTION_CONTEXT.test(before.slice(0, topic.index))) topic = TOPIC_TAIL.exec(before.slice(topic.index + topic[0].search(/\s/)))
      // "why we first configure nginx and then build the app": a sequence done by the explained agent stays the topic.
      const sequence = /\b(?:then|depois|entao)\b/.test(m[0]) && !(topic && TOPIC_AGENT.test(topic[0]))
      const addressed = purpose && ORDER_ADDRESS.test(rest)
      const inPurpose = purpose && !addressed && (PURPOSE_MODAL.test(before) || PURPOSE_COMPLEMENT.test(before) || (!sequence && purposeTail(before)))
      if (TOPIC_HEAD.test(rest) || inPurpose || (!sequence && !addressed && topic)) continue
      const next = firstSignal(rest)
      // The offset of the order verb itself, so the rest starts a sentence ("review it?") and is read as an order.
      if (next.verb && ORDER_LEAD.test(rest.slice(0, next.at))) return m.index + m[0].length + next.at
    }
    return -1
  }
  function orderAfterSentence(text, from) {
    const m = /[.!?;:\n]/.exec(text.slice(from, from + CONTEXT_WINDOW))
    return !!m && firstSignal(text.slice(from + m.index + 1, from + m.index + 1 + CONTEXT_WINDOW), true).verb
  }
  // "Do not install anything. How do I configure nginx?": the verb found sits inside a later question.
  function questionStart(text, at) {
    let start = 0
    for (let i = at - 1; i >= 0; i--) if (/[.!?;\n]/.test(text[i])) { start = i + 1; break }
    start += text.slice(start).length - text.slice(start).trimStart().length
    return isQuestion(text.slice(start)) ? start : null
  }
  // The question form, unless its comma follows something that is not a question ("Como especialista, escreva").
  function isQuestion(goal) {
    const direct = questionAt(goal)
    if (direct) return direct
    // "Before we begin, can I configure nginx without downtime?": a short clause without an order may introduce it.
    const intro = INTRO_CLAUSE.exec(goal)
    if (!intro || DECLARATIVE.test(intro[1]) || firstSignal(intro[1]).verb) return null
    const rest = questionAt(goal.slice(intro[0].length))
    return rest ? [intro[0] + rest[0]] : null
  }
  function questionAt(goal) {
    const explain = EXPLAIN_FORM.exec(goal)
    // "Can you walk through the repository and fix the login bug?": the explanation carries an order after it.
    if (explain) {
      const order = coordinatedOrder(explain[0])
      return order < 0 ? explain : [explain[0].slice(0, order)]
    }
    // "Can you show me a script that extracts data and then write unit tests?": the request carries an order after it.
    const show = SHOW_FORM.exec(goal)
    const open = show && SHOW_OPEN.exec(show[0])[0]
    if (show && asksCode(show[0].slice(open.length), PT_SHOW.test(open))) {
      const order = coordinatedOrder(show[0], true)
      return order < 0 ? show : [show[0].slice(0, order)]
    }
    const yesNo = YESNO_FORM.exec(goal)
    if (yesNo && (yesNo[0].includes('?') || UNMARKED_YESNO.test(yesNo[0]))) {
      const order = ADDRESSED.test(yesNo[0]) ? coordinatedOrder(yesNo[0]) : -1
      return order < 0 ? yesNo : [yesNo[0].slice(0, order)]
    }
    const m = QUESTION_FORM.exec(goal)
    if (!m) return null
    // "What I need is for you to build a React dashboard, can you do that?": a declarative request, with or without the mark.
    if (DECLARATIVE.test(m[0])) return null
    if (!m[0].includes(',')) return m
    if (m[0].includes('?') && !ROLE_HEAD.test(m[0])) return m
    const head = m[0].slice(0, m[0].indexOf(','))
    return QUESTION_HEAD.test(head) || firstSignal(head).verb ? m : null
  }
  // The earliest explicit verb decides; a noun signal counts only when no verb fired. Every match of a rule is
  // read, so a context noun ("The CSV is attached. Extract ...") does not hide a later verb of the same rule.
  function firstSignal(text, shallow = false) {
    let signal = null
    let at = Infinity
    let noun = null
    let nounAt = Infinity
    for (const [id, re] of verbRules) {
      const all = new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g')
      let m
      while ((m = all.exec(text))) {
        if (m[0] === '') { all.lastIndex++; continue }
        const word = m[0].trim()
        if (prohibited(text, m.index)) continue
        const before = contextBefore(text, m.index)
        const end = m.index + m[0].length
        const after = text.slice(end, end + CONTEXT_WINDOW)
        // A copula after the word makes it context wherever it sits ("Plan is ready. Build ...", "CSV is attached.").
        const copula = COPULA.test(after) || (PREDICATE.test(after) && !SENTENCE_START.test(before))
        const requested = REQUESTED_NOUN.test(before) && !copula
        const isNoun = NOUN_SIGNAL.test(word) && (copula || (!SENTENCE_START.test(before) && !INFINITIVE_MARK.test(before) && !VERB_OBJECT.test(after) && !requested))
        if (isNoun) { if (m.index < nounAt) { noun = id; nounAt = m.index }; continue }
        // "The build is broken", "The fix is ready": a copula right after any verb word makes it a thing, not an order.
        if (!NOUN_SIGNAL.test(word) && (VERB_COPULA.test(after) || (PREDICATE.test(after) && !SENTENCE_START.test(before) && !INFINITIVE_MARK.test(before)))) continue
        // A verb that names a thing ("the configure script") or tells the past ("I tried to configure") is context.
        if (!shallow && !NOUN_SIGNAL.test(word) && STATED_GOAL.test(before) && orderAfterSentence(text, end)) continue
        const article = MODIFIER_USE.test(before) && !(AFTER_A.test(before) && PT_INFINITIVE.test(word))
        if (!NOUN_SIGNAL.test(word) && (NARRATIVE.test(before) || (article && COMPOUND_AFTER.test(after)))) continue
        if (m.index < at) { signal = id; at = m.index }
        break
      }
    }
    if (signal) return { signal, at, verb: true }
    return noun ? { signal: noun, at: nounAt, verb: false } : { signal: null, at: Infinity, verb: false }
  }

  function detect(draft, requirements) {
    const text = foldDraft(`${draft}\n${requirements}`)
    let category = 'general'
    for (const [id, re] of categories) if (re.test(text)) { category = id; break }
    let { signal, at } = firstSignal(text)
    const goal = foldDraft(draft).trim()
    // A question stays an answer, whatever verbs it contains; only an order after it ("How does it work? Fix the bug.")
    // is a task, and a style note ("Seja breve.") is not.
    let question = isQuestion(goal)
    let questionAt = text.length - text.trimStart().length
    if (!question && Number.isFinite(at)) {
      const open = questionStart(text, at)
      if (open !== null) { question = isQuestion(text.slice(open)); questionAt = open }
    }
    if (question) {
      let restAt = questionAt + question[0].length
      // Further questions ("Como instalar o Docker? Como configurar o nginx?") are still questions, not orders.
      for (;;) {
        const rest = text.slice(restAt)
        const pad = rest.length - rest.trimStart().length
        const next = isQuestion(rest.slice(pad))
        if (!next) break
        restAt += pad + next[0].length
      }
      let after = firstSignal(text.slice(restAt))
      // An instruction that shapes the answer ("Add examples.", "Make the answer concise") is skipped, up to eight times.
      for (let notes = 0; notes < 8 && after.verb && RESPONSE_NOTE.test(text.slice(restAt + after.at, restAt + after.at + 120)); notes++) {
        const end = text.slice(restAt + after.at).search(/[.!?\n;]|,?\s+(?:and\s+|e\s+)?(?:then|depois|entao)\b|$/)
        restAt += after.at + end + 1
        after = firstSignal(text.slice(restAt))
      }
      if (after.verb) { signal = after.signal; at = restAt + after.at } else { signal = 'answer'; at = Infinity }
    }
    if (signal === 'analysis' && dataNoun.test(text) && !(dataUnless && dataUnless.test(text))) signal = 'data'
    // "Create/write a script that ... CSV": the artifact is code, whatever data words it mentions.
    // "Write an e-mail about the new app": the artifact is text, whatever product words it mentions.
    // When both kinds are named, the first one decides ("Write a function that validates the description" is code),
    // unless it only modifies the other ("Write an API announcement email" is text).
    // Only what follows the verb names its object: context before it ("For our app, write a blog post") does not.
    if (signal === 'text' && TEXT_ARTIFACT.test(text)) category = 'writing'
    const request = Number.isFinite(at) ? text.slice(at) : text
    // Only the verb that fired can make a code artifact: a later "write" does not turn an analysis into code.
    const verbWord = (request.match(/^\s*(\w+)/) || [])[1] || ''
    const requestedArtifact = Number.isFinite(at) && REQUESTED_ARTIFACT.exec(text.slice(Math.max(0, at - CONTEXT_WINDOW), at))
    let artifact = pickArtifact(requestedArtifact ? text.slice(at - requestedArtifact[0].length) : request)
    const prior = (!artifact || PRONOUN_OBJECT.test(request)) && Number.isFinite(at) && MAKE_VERB.test(verbWord) && PRIOR_REQUEST.exec(text.slice(Math.max(0, at - CONTEXT_WINDOW), at))
    const priorArtifact = prior && pickArtifact(prior[1])
    if (priorArtifact) artifact = priorArtifact
    const codeWins = artifact === 'code'
    const textWins = artifact === 'text'
    const asked = (requestedArtifact && requestedArtifact[1]) || !!priorArtifact
    // "I need instructions to configure nginx", "Provide instructions to ...": guidance is asked, not the action.
    if (requestedArtifact && requestedArtifact[2]) { signal = 'answer' }
    else if (asked && codeWins) { signal = 'implementation'; category = 'code' }
    else if (asked && textWins) { signal = 'text'; category = 'writing' }
    else if ((signal === 'data' || signal === 'text') && MAKE_VERB.test(verbWord) && codeWins) { signal = 'implementation'; category = 'code' }
    // "Gere um e-mail", "Monte uma mensagem": the verb does not say what is made, the first artifact named does.
    if (signal === 'implementation' && GENERATE_VERB.test(request) && textWins) { signal = 'text'; category = 'writing' }
    return { category, signal, text, goal, asksQuestion: goal.endsWith('?') || QUESTION_START.test(goal) }
  }

  return { detect }
}

export const DETECTION = { createDetector, fold, MAKE_VERB }
