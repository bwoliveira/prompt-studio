// Every string desktop/plugin.js shows outside the studio core (buttons, notes, errors, help,
// shortcut help). Registered with ctx.i18n.register(UI_MESSAGES) in register(); read with
// usePluginI18n(ID) in React and ctx.i18n.t outside it. `en` is complete and the default;
// `pt` is complete Brazilian Portuguese (unused until the app ships a pt locale).
// Both bundles must keep exactly the same keys (tests/desktop/studio-flow.test.mjs checks it).
export const UI_MESSAGES = {
  en: {
    // Lets code outside React learn the active locale: t('locale') resolves to 'en' or 'pt'.
    locale: 'en',
    studio: {
      region: 'Prompt Studio',
      request: 'Request:'
    },
    open: {
      label: '✨ Prompt Studio',
      aria: 'Open Prompt Studio with the text in the message field',
      title: 'Prompt Studio: build the prompt from the text in the message field'
    },
    palette: {
      label: 'Prompt Studio',
      detailDraft: 'Build the prompt from the draft',
      detailEmpty: 'The message field is empty'
    },
    notify: {
      empty: 'Write your request in the message field, then open Prompt Studio (F4).',
      short: 'Describe the request in at least 10 characters.',
      clearFailed: 'Could not clear the message field.',
      restoreFailed: 'Could not return the draft to the message field.',
      placeFailed: 'Could not place the prompt in the message field.',
      nextFailed: 'Prompt Studio could not prepare the next question.',
      unknownOption: list => `Option not recognized. Choose one of: ${list}`,
      conflict: detail => `Some answers contradict each other: ${detail} Edit an answer and try again.`
    },
    keys: {
      shortcut: combo => `Shortcut: ${combo}`
    },
    target: {
      label: 'Model:',
      group: 'Model the prompt is written for',
      title: model => `Write the prompt for ${model}`
    },
    ai: {
      group: 'AI help',
      label: '✨ AI:',
      cycle: 'Alt+I switches to the next mode',
      mode: { auto: 'Auto', manual: 'On request', off: 'Off' },
      modeTitle: {
        auto: 'The AI suggests an answer on every step and writes the final prompt.',
        manual: 'The AI suggests only when you ask; it writes the final prompt.',
        off: 'No AI: no model calls; the prompt is built locally.'
      },
      askEnum: '✨ Ask the AI',
      askText: '✨ Suggest text with AI',
      spinner: 'Asking the AI',
      analyzing: 'The AI is looking at this question…',
      improving: 'Improving your text…',
      stop: 'Stop',
      unavailable: 'AI unavailable.',
      missing: 'The Prompt Studio AI is not active. Restart Hermes Desktop.',
      failed: 'Could not reach the AI right now.',
      tooSlow: 'The AI took too long.',
      noAnswer: 'The model did not answer.',
      retry: 'Try again',
      agrees: value => `✨ The AI agrees with the recommended choice: ${value}`,
      theDefault: 'the recommended choice',
      nothing: 'The AI has nothing to add here.',
      suggests: value => `✨ The AI suggests: ${value}`,
      improved: '✨ Improved version:',
      suggestion: '✨ AI suggestion:',
      why: reason => `Why: ${reason}`,
      useDefault: 'Use the recommended',
      useSuggestion: 'Use the suggestion',
      useVersion: 'Use this version',
      putInField: 'Put in the field',
      discard: 'Discard',
      another: '↻ Another',
      anotherAria: 'Ask for another suggestion',
      improve: '✨ Improve my text',
      improveTitle: 'The AI rewrites your text more clearly, without adding facts',
      pickTitle: 'Choice suggested by the AI',
      status: {
        loading: 'Asking the AI…',
        ready: 'AI suggestion ready.',
        error: 'AI unavailable.'
      }
    },
    step: {
      label: n => `Step ${n}`,
      progress: (n, pct) => `Step ${n}, about ${pct}% done`,
      announce: (n, question) => `Step ${n}: ${question}`,
      editingBelow: 'editing below',
      editAria: (n, question) => `Edit answer ${n}: ${question}`,
      editTitle: 'Edit this answer (the ones after it stay)'
    },
    answer: {
      confirm: 'Confirm',
      recommended: value => `★ Recommended: ${value}`,
      recommendedByAi: value => `★ Recommended by AI: ${value}`,
      useAi: '★ Use AI suggestion',
      useDefault: value => `Use: ${value}`,
      recommendedTitle: 'Recommended option for this request',
      skip: 'Skip',
      none: "I don't have one",
      paste: '+ Paste text',
      pastePlaceholder: 'Paste the reference text here',
      emptyMeans: value => `empty = ${value}`,
      optional: 'optional'
    },
    actions: {
      generateAi: '✨ Generate prompt with AI',
      generate: 'Generate prompt',
      generateNow: 'Generate now',
      generateRest: 'The remaining steps use the recommended choice.',
      generateOff: 'Builds the prompt without AI.',
      generateOn: 'The AI writes the prompt from your answers; if it fails, the version without AI is used.',
      back: '← Back',
      undoEdit: '← Undo edit',
      undoEditTitle: 'Keeps the answer you had before',
      cancel: 'Cancel',
      cancelTitle: 'Closes and returns the original draft',
      done: label => `All steps answered. Choose “${label}” (F9).`
    },
    loading: {
      spinner: 'Loading',
      asking: 'Preparing the next question…',
      writing: 'Generating the prompt…',
      writingAi: 'The AI is writing the prompt from your answers…'
    },
    preview: {
      ai: '✨ Prompt written by the AI',
      engine: 'Prompt built without AI',
      use: 'Use this prompt',
      useTitle: 'Places it in the message field; you send it when you are ready',
      switchTitle: 'Same answers, built with or without AI',
      showEngine: 'See the version without AI',
      showAi: 'See the AI version',
      backToSteps: '← Back to steps',
      failed: 'Could not use the AI this time; showing the version without AI.',
      missing: 'The Prompt Studio AI is not active (restart Hermes Desktop); showing the version without AI.',
      empty: 'The AI did not write a prompt; showing the version without AI.'
    },
    shortcuts: {
      button: 'Shortcuts',
      title: 'Keyboard shortcuts',
      open: 'Open Prompt Studio (from the message field)',
      help: 'Show or hide this list',
      accept: 'Accept the recommended choice (in Auto mode, the AI pick) or confirm what you typed',
      skip: "Skip, I don't have one, or use the default",
      useAi: 'Use the AI text or the recommended one it offers',
      back: 'Back, undo the edit, or back to the steps',
      generate: 'Generate the prompt, then use it',
      close: 'Close and return the draft',
      pick: 'Pick an option',
      edit: 'Edit an answered step',
      ask: 'Ask the AI, or try again',
      another: 'Another suggestion',
      discard: 'Discard the suggestion, or stop the AI',
      improve: 'Improve my text',
      paste: 'Paste text',
      model: 'Model: Opus or Astra',
      mode: 'Next AI help mode',
      version: 'Other version in the preview',
      noteAlt: 'Use the left Alt key: on some layouts the right Alt works as AltGr.',
      noteDigits: 'Alt+digits follow the physical number row, whatever the keyboard layout.',
      noteKeys: 'Tab, Enter and Esc keep working as usual.'
    }
  },
  pt: {
    locale: 'pt',
    studio: {
      region: 'Prompt Studio',
      request: 'Pedido:'
    },
    open: {
      label: '✨ Prompt Studio',
      aria: 'Abrir o Prompt Studio com o texto do campo de mensagem',
      title: 'Prompt Studio: montar o prompt a partir do texto do campo de mensagem'
    },
    palette: {
      label: 'Prompt Studio',
      detailDraft: 'Montar o prompt a partir do rascunho',
      detailEmpty: 'O campo de mensagem está vazio'
    },
    notify: {
      empty: 'Escreva o pedido no campo de mensagem e abra o Prompt Studio (F4).',
      short: 'Descreva o pedido com pelo menos 10 caracteres.',
      clearFailed: 'Não foi possível limpar o campo de mensagem.',
      restoreFailed: 'Não foi possível devolver o rascunho ao campo de mensagem.',
      placeFailed: 'Não foi possível colocar o prompt no campo de mensagem.',
      nextFailed: 'O Prompt Studio não conseguiu preparar a próxima pergunta.',
      unknownOption: list => `Opção não reconhecida. Escolha uma de: ${list}`,
      conflict: detail => `Algumas respostas se contradizem: ${detail} Edite uma resposta e tente de novo.`
    },
    keys: {
      shortcut: combo => `Atalho: ${combo}`
    },
    target: {
      label: 'Modelo:',
      group: 'Modelo para o qual o prompt é escrito',
      title: model => `Escrever o prompt para ${model}`
    },
    ai: {
      group: 'Ajuda da IA',
      label: '✨ IA:',
      cycle: 'Alt+I muda para o próximo modo',
      mode: { auto: 'Auto', manual: 'Sob demanda', off: 'Desligada' },
      modeTitle: {
        auto: 'A IA sugere uma resposta em cada etapa e escreve o prompt final.',
        manual: 'A IA só sugere quando você pede; ela escreve o prompt final.',
        off: 'Sem IA: nenhuma chamada ao modelo; o prompt é montado localmente.'
      },
      askEnum: '✨ Perguntar à IA',
      askText: '✨ Sugerir texto com IA',
      spinner: 'Consultando a IA',
      analyzing: 'A IA está analisando esta pergunta…',
      improving: 'Melhorando o seu texto…',
      stop: 'Parar',
      unavailable: 'IA indisponível.',
      missing: 'A IA do Prompt Studio não está ativa. Reinicie o Hermes Desktop.',
      failed: 'Não foi possível usar a IA agora.',
      tooSlow: 'A IA demorou demais.',
      noAnswer: 'O modelo não respondeu.',
      retry: 'Tentar de novo',
      agrees: value => `✨ A IA concorda com o recomendado: ${value}`,
      theDefault: 'o recomendado',
      nothing: 'A IA não tem o que acrescentar neste campo.',
      suggests: value => `✨ A IA sugere: ${value}`,
      improved: '✨ Versão melhorada:',
      suggestion: '✨ Sugestão da IA:',
      why: reason => `Por quê: ${reason}`,
      useDefault: 'Usar o recomendado',
      useSuggestion: 'Usar a sugestão',
      useVersion: 'Usar esta versão',
      putInField: 'Colocar no campo',
      discard: 'Descartar',
      another: '↻ Outra',
      anotherAria: 'Pedir outra sugestão',
      improve: '✨ Melhorar meu texto',
      improveTitle: 'A IA reescreve o seu texto de forma mais clara, sem acrescentar fatos',
      pickTitle: 'Escolha sugerida pela IA',
      status: {
        loading: 'Consultando a IA…',
        ready: 'Sugestão da IA pronta.',
        error: 'IA indisponível.'
      }
    },
    step: {
      label: n => `Etapa ${n}`,
      progress: (n, pct) => `Etapa ${n}, cerca de ${pct}% concluído`,
      announce: (n, question) => `Etapa ${n}: ${question}`,
      editingBelow: 'editando abaixo',
      editAria: (n, question) => `Editar a resposta ${n}: ${question}`,
      editTitle: 'Editar esta resposta (as seguintes continuam)'
    },
    answer: {
      confirm: 'Confirmar',
      recommended: value => `★ Recomendado: ${value}`,
      recommendedByAi: value => `★ Recomendado pela IA: ${value}`,
      useAi: '★ Usar sugestão da IA',
      useDefault: value => `Usar: ${value}`,
      recommendedTitle: 'Opção recomendada para este pedido',
      skip: 'Pular',
      none: 'Não tenho',
      paste: '+ Colar texto',
      pastePlaceholder: 'Cole aqui o texto de referência',
      emptyMeans: value => `vazio = ${value}`,
      optional: 'opcional'
    },
    actions: {
      generateAi: '✨ Gerar prompt com IA',
      generate: 'Gerar prompt',
      generateNow: 'Gerar agora',
      generateRest: 'As etapas que faltam usam o recomendado.',
      generateOff: 'Gera o prompt sem IA.',
      generateOn: 'A IA escreve o prompt com as suas respostas; se falhar, entra a versão sem IA.',
      back: '← Voltar',
      undoEdit: '← Desfazer edição',
      undoEditTitle: 'Mantém a resposta que estava antes',
      cancel: 'Cancelar',
      cancelTitle: 'Fecha e devolve o rascunho original',
      done: label => `Todas as etapas respondidas. Escolha “${label}” (F9).`
    },
    loading: {
      spinner: 'Carregando',
      asking: 'Preparando a próxima pergunta…',
      writing: 'Gerando o prompt…',
      writingAi: 'A IA está escrevendo o prompt com as suas respostas…'
    },
    preview: {
      ai: '✨ Prompt escrito pela IA',
      engine: 'Prompt montado sem IA',
      use: 'Usar este prompt',
      useTitle: 'Coloca no campo de mensagem; você envia quando quiser',
      switchTitle: 'Mesmas respostas, montado com ou sem IA',
      showEngine: 'Ver versão sem IA',
      showAi: 'Ver versão da IA',
      backToSteps: '← Voltar às etapas',
      failed: 'Não foi possível usar a IA agora; mostramos a versão sem IA.',
      missing: 'A IA do Prompt Studio não está ativa (reinicie o Hermes Desktop); mostramos a versão sem IA.',
      empty: 'A IA não escreveu o prompt; mostramos a versão sem IA.'
    },
    shortcuts: {
      button: 'Atalhos',
      title: 'Atalhos de teclado',
      open: 'Abrir o Prompt Studio (a partir do campo de mensagem)',
      help: 'Mostrar ou esconder esta lista',
      accept: 'Aceitar o recomendado (no modo Auto, a escolha da IA) ou confirmar o que você digitou',
      skip: 'Pular, Não tenho, ou usar o padrão',
      useAi: 'Usar o texto da IA ou o recomendado que ela oferece',
      back: 'Voltar, desfazer a edição ou voltar às etapas',
      generate: 'Gerar o prompt e depois usá-lo',
      close: 'Fechar e devolver o rascunho',
      pick: 'Escolher uma opção',
      edit: 'Editar uma etapa respondida',
      ask: 'Perguntar à IA ou tentar de novo',
      another: 'Outra sugestão',
      discard: 'Descartar a sugestão ou parar a IA',
      improve: 'Melhorar meu texto',
      paste: 'Colar texto',
      model: 'Modelo: Opus ou Astra',
      mode: 'Próximo modo da ajuda da IA',
      version: 'Outra versão na prévia',
      noteAlt: 'Use o Alt da esquerda: em alguns layouts o Alt da direita funciona como AltGr.',
      noteDigits: 'Alt+dígito segue a fileira física de números, qualquer que seja o layout do teclado.',
      noteKeys: 'Tab, Enter e Esc continuam funcionando como sempre.'
    }
  }
}
