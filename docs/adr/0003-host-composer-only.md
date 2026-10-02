# 0003. The message field is read and written only through `host.composer`

Status: Accepted (2026-10-02)

## Context

Prompt Studio takes the user's draft from the message field, empties it while the Studio is open, puts the draft back on
Close, places the finished prompt and can send it. Earlier versions reached the field through the app's DOM, which
breaks whenever Hermes Desktop changes its markup and goes beyond what a plugin may touch. Hermes Desktop 0.21.5 added
`host.composer` to the plugin SDK for exactly this.

## Decision

The Desktop half reads and writes the composer only through the SDK's `host.composer` (`getDraft`, `setDraft`, `submit`),
addressed with `null` for the composer in use. It changes nothing in the app's DOM and reads no internal store. The one
thing it reads from the page is which dialogs, menus and listboxes are open (ARIA roles and visibility), so that its keys
stand back behind them.

## Consequences

- The plugin needs Hermes Desktop 0.21.5 or later; on an older Desktop the Studio does not open and asks the user to
  update Hermes.
- The SDK has no attachment API: attachments are not read. They stay in the composer, go with the prompt on
  "Put in composer to edit" and are not sent by "Send now"; the preview says so.
- The key guard behind foreign overlays depends on the host marking its overlays with ARIA roles.

Revisit when the SDK adds attachment access, or the host stops marking dialogs and menus with roles.
