# 0004. F-keys plus Alt letters, and the Studio never takes Enter

Status: Accepted (2026-10-02)

## Context

The Studio is driven from the keyboard while the cursor is in a text field, so its keys must not collide with typing,
with the app's own bindings or with the desktop environment. Every control prints its key, so what is shown is what
runs. F-keys are short and free of printable characters, but on some keyboards, notably Apple's, they may need `fn`, and
whether they do is the user's own keyboard setting. Option (Alt) letters on a Mac can be dead keys that start an accent.

## Decision

- **F4** opens the Studio from the message field (so does the Hermes Desktop binding **Ctrl+Shift+E**, **⌘⇧E** on a Mac,
  which the user can reassign in Desktop's keybinds). **F1** is help and **F3** settings.
- **F5 to F10** are accept, skip, use the AI suggestion, back, generate and close. Each has an Alt+letter twin that
  needs no F-key: Alt+Y, Alt+K, Alt+L, Alt+B, Alt+G, Alt+X. The twin letters are never E, I, N or U, the Option dead
  keys on a Mac. The other actions have Alt+letter or Alt+digit keys.
- **The Studio never takes Enter, Alt+Enter, Tab, Esc or any Ctrl/Super chord.** Accepting without F5 is Enter on the
  focused recommended button, the button's native behaviour. In the Studio's own answer field Enter makes a new line.
- The key listener runs in the capture phase so the keys work in the answer field, swallows F5 to F10 while the Studio is
  open (F5 would reload the window), and does nothing behind a foreign dialog, menu or palette.
- Users are shown their platform's keys: ⌥ and ⇧ on a Mac, F-keys as plain F4. Documentation never tells users to press
  `fn`.
- One map, `SHORTCUTS`, feeds every printed key, the F1 list and the README keyboard table (generated, checked by the build).

## Consequences

- Typing an answer, using the app's own shortcuts and Enter in the composer never trigger a Studio action.
- Fewer free keys: new shortcuts must avoid E, I, N, U twins, Ctrl and Super, and be checked against Hermes Desktop and
  Cinnamon bindings.
- A Mac user can drive the whole flow without an F-key.

Revisit if Hermes Desktop offers a keybinding area for in-Studio actions, or tests on a real Mac show another dead key.
