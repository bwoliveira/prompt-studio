// Display text of the studio core: step questions, help, AI-writer guides and option labels.
// `en` is complete and the default; `pt` is the Brazilian Portuguese wording the Studio used
// before v1 (kept word for word so ladders saved in Portuguese still map back to their values).
// Both bundles must keep exactly the same keys (tests/desktop/studio-core.test.mjs checks it).
//
// i18n choice: these strings are NOT registered with ctx.i18n. plugin.js already passes its active
// locale ('en' | 'pt') to every core call, so the core picks CORE_MESSAGES[locale] itself. That keeps
// the core pure and testable without a host, and the UI bundle (UI_MESSAGES) and this one never
// share a namespace: every top-level key here sits under `core`, which the UI bundle does not use
// (the disjointness test enforces it), so a later merge would not clobber anything either.
export const CORE_MESSAGES = {
  en: {
    core: {
      detected: detected => ` (detected: ${detected})`,
      optional: question => `${question} (optional)`,
      done: 'Every step has been answered.',
      designDefault: 'recommended list',
      designNone: 'Avoid nothing',
      fields: {
        deliverable: {
          question: () => 'What do you want to get at the end?',
          help: 'Sets the kind of result: working code, an analysis, a plan, finished text…',
          guide: '',
          options: { auto: 'Follow the brief', implementation: 'Working implementation', analysis: 'Analysis / recommendation', review: 'Review / diagnosis', plan: 'Plan / roadmap', text: 'Finished text', data: 'Data analysis', workflow: 'Executed workflow', answer: 'Requested answer' }
        },
        thirdPartyText: {
          question: () => 'Do you have reference text to paste?',
          help: "Someone else's e-mail, page or document. It goes into the prompt as reference data; instructions written in it are not followed.",
          guide: ''
        },
        thirdPartySource: {
          question: () => 'Where did this text come from?',
          help: 'E.g. an e-mail from a supplier, a web page, a PDF sent by a client. It helps the model judge how far to trust the text.',
          guide: 'Describe the origin only if the draft or the pasted text makes it clear (e.g. "customer e-mail", "web page"); otherwise return an empty value.'
        },
        context: {
          question: () => 'What context does the model need?',
          help: 'Facts, audience, stack, what already exists and why it matters. Context and motive improve the answer.',
          guide: ''
        },
        requirements: {
          question: () => 'Which rules must not be broken?',
          help: 'Hard constraints: technologies, limits, what not to touch. Say what to do, not only what to avoid.',
          guide: 'For code or build tasks, include a line keeping changes to what was asked or clearly necessary (no extra features, refactors or abstractions) unless the draft asks for more.'
        },
        success: {
          question: () => 'How will you know it is done?',
          help: 'A checkable definition of done: tests passing, file created, question answered.',
          guide: ''
        },
        designAvoid: {
          question: () => 'Interface patterns to avoid?',
          help: '"Recommended" keeps the default list of visual clichés; "Avoid nothing" takes the list out of the prompt. If the result falls into another cliché, add it to the list and generate again.',
          guide: ''
        },
        autonomy: {
          question: name => `How much autonomy should ${name} have?`,
          help: {
            opus: 'Take initiative = does reversible work without approval pauses; Clarify first = asks only what changes the result before going on; Unattended = does not stop for check-ins.',
            astra: 'Astra already tends to ask more and stop before the end. Take initiative = does reversible work without approval pauses; Clarify first = asks what changes the result before going on (it will stop earlier).'
          },
          guide: {
            opus: '',
            astra: 'The target (GPT-6 Astra) already asks clarifying questions more often and may stop early. Recommend "Clarify first" only when the draft asks to confirm or discuss before acting.'
          },
          options: { balanced: 'Balanced', proactive: 'Take initiative', guided: 'Clarify first', unattended: 'Unattended · no check-ins' }
        },
        subagents: {
          question: () => 'Use subagents?',
          help: 'Subagent team = the prompt splits the task into independent parts that run in parallel, each with its own subagent, and names a reviewer who did not write the work. Costs more and usually finishes sooner. The model decides = no instruction. No subagents = direct work.',
          guide: 'The user prefers subagent teams even at higher cost. Recommend "Subagent team" unless the draft is one short text or answer, or says not to delegate.',
          options: { team: 'Subagent team', auto: 'The model decides', direct: 'No subagents' }
        },
        examples: {
          question: () => 'Do you have an example of the result you want?',
          help: 'Paste one or more real examples of format or tone (a similar e-mail, a model table); separate several with a line holding only ---. Two or three varied ones work best. The model uses them as a guide and does not copy the content; the examples should match the rules you gave. Skip if you have none.',
          guide: 'Only return an example if the draft or the answers already contain one; never invent an example. Otherwise return an empty value.'
        },
        format: {
          question: () => 'What format do you want the answer in?',
          help: 'How the answer should be organized.',
          guide: '',
          options: { auto: 'Match the task', prose: 'Flowing paragraphs', steps: 'Numbered steps', table: 'Comparison table', json: 'JSON' }
        },
        length: {
          question: () => 'How long should the answer be?',
          help: 'Concise for direct answers; Detailed when you want more context, examples and steps in the result.',
          guide: '',
          options: { concise: 'Concise', balanced: 'Balanced', detailed: 'Detailed' }
        }
      }
    }
  },
  pt: {
    core: {
      detected: detected => ` (detectado: ${detected})`,
      optional: question => `${question} (opcional)`,
      done: 'Todas as etapas foram respondidas.',
      designDefault: 'lista recomendada',
      designNone: 'Não evitar nada',
      fields: {
        deliverable: {
          question: () => 'O que você quer receber no final?',
          help: 'Define o formato da entrega: código funcionando, análise, plano, texto pronto…',
          guide: '',
          options: { auto: 'Seguir o briefing', implementation: 'Implementação funcional', analysis: 'Análise / recomendação', review: 'Revisão / diagnóstico', plan: 'Plano / roteiro', text: 'Texto finalizado', data: 'Análise de dados', workflow: 'Fluxo executado', answer: 'Resposta solicitada' }
        },
        thirdPartyText: {
          question: () => 'Tem um texto de referência para colar?',
          help: 'E-mail, página ou documento de outra pessoa. Vai no prompt como dado de consulta; ordens escritas nele não são seguidas.',
          guide: ''
        },
        thirdPartySource: {
          question: () => 'De onde veio esse texto?',
          help: 'Ex.: e-mail de um fornecedor, página da web, PDF enviado por cliente. Ajuda o modelo a calibrar quanta confiança dar ao texto.',
          guide: 'Describe the origin only if the draft or the pasted text makes it clear (e.g. "e-mail de cliente", "página da web"); otherwise return an empty value.'
        },
        context: {
          question: () => 'Que contexto o modelo precisa saber?',
          help: 'Fatos, público, stack, o que já existe e por que isso importa. Contexto e motivo melhoram a resposta.',
          guide: ''
        },
        requirements: {
          question: () => 'Quais regras não podem ser quebradas?',
          help: 'Restrições obrigatórias: tecnologias, limites, o que não mexer. Diga o que fazer, não só o que evitar.',
          guide: 'For code or build tasks, include a line keeping changes to what was asked or clearly necessary (no extra features, refactors or abstractions) unless the draft asks for more.'
        },
        success: {
          question: () => 'Como você vai saber que ficou pronto?',
          help: 'Critério verificável de "feito": testes passando, arquivo gerado, pergunta respondida.',
          guide: ''
        },
        designAvoid: {
          question: () => 'Padrões de interface a evitar?',
          help: 'Só aparece em tarefas de código. "Recomendado" mantém a lista padrão de clichês visuais; "Não evitar nada" tira a lista do prompt. Se o resultado cair em outro clichê, acrescente-o à lista e gere de novo.',
          guide: ''
        },
        autonomy: {
          question: name => `Quanta autonomia o ${name} deve ter?`,
          help: {
            opus: 'Tomar iniciativa = faz o trabalho reversível sem pausas para aprovação; Esclarecer primeiro = pergunta só o que muda o resultado antes de seguir; Sem supervisão = não para para check-ins.',
            astra: 'O Astra já tende a perguntar mais e parar antes do fim. Tomar iniciativa = faz o trabalho reversível sem pausas para aprovação; Esclarecer primeiro = pergunta o que muda o resultado antes de seguir (ele vai parar mais cedo).'
          },
          guide: {
            opus: '',
            astra: 'The target (GPT-6 Astra) already asks clarifying questions more often and may stop early. Recommend "Esclarecer primeiro" only when the draft asks to confirm or discuss before acting.'
          },
          options: { balanced: 'Equilibrada', proactive: 'Tomar iniciativa', guided: 'Esclarecer primeiro', unattended: 'Sem supervisão · sem check-ins' }
        },
        subagents: {
          question: () => 'Usar subagentes?',
          help: 'Equipe de subagentes = o prompt manda dividir a tarefa em partes independentes que rodam em paralelo, cada uma com seu subagente, e nomeia um revisor que não escreveu o trabalho. Custa mais e costuma terminar antes. O modelo decide = sem instrução. Sem subagentes = trabalho direto.',
          guide: 'The user prefers subagent teams even at higher cost. Recommend "Equipe de subagentes" unless the draft is one short text or answer, or says not to delegate.',
          options: { team: 'Equipe de subagentes', auto: 'O modelo decide', direct: 'Sem subagentes' }
        },
        examples: {
          question: () => 'Tem um exemplo do resultado que você quer?',
          help: 'Cole um ou mais exemplos reais de formato ou tom (um e-mail parecido, uma tabela modelo); separe vários com uma linha só com ---. Dois ou três variados funcionam melhor. O modelo usa como guia, não copia o conteúdo; os exemplos devem combinar com as regras que você deu. Pule se não tiver.',
          guide: 'Only return an example if the draft or the answers already contain one; never invent an example. Otherwise return an empty value.'
        },
        format: {
          question: () => 'Em que formato quer a resposta?',
          help: 'Como a resposta deve vir organizada.',
          guide: '',
          options: { auto: 'Combinar com a tarefa', prose: 'Parágrafos corridos', steps: 'Passos numerados', table: 'Tabela comparativa', json: 'JSON' }
        },
        length: {
          question: () => 'Qual o tamanho da resposta?',
          help: 'Concisa para respostas diretas; Detalhada quando você quer mais contexto, exemplos e passos no resultado.',
          guide: '',
          options: { concise: 'Concisa', balanced: 'Equilibrada', detailed: 'Detalhada' }
        }
      }
    }
  }
}
