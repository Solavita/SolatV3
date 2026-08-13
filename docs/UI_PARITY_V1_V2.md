# SOLAT V1 → V2 UI parity

## Scope

The owner asked for the V1 UI functions to be available in the V2 shell. V2
keeps the V1 static control inventory and wires the interaction layer to local
state or the secure Electron IPC boundary. V1's HTTP client, port calls, and
provider-specific backend code were not copied.

## Covered in V2

- conversation list: search, select, new, rename, duplicate, export, delete,
  undo, keyboard navigation, and mobile drawer;
- chat controls: edit, copy, retry, helpful/not-helpful, print, jump-to-latest,
  model/status menu, visible provider/error state, thinking state, and the V1
  source disclosure with the same approved-domain policy;
- composer: Enter/Shift+Enter behavior, Ctrl/Cmd+Enter preference, resize,
  character limit, stop-request state, image/document attachment chips,
  drag-and-drop, and dictation when the desktop runtime exposes it;
- command palette: search, recent conversations, commands, arrow navigation,
  Enter activation, and Escape close;
- settings: General/Chat/API keys/Data tabs, theme, text scale, density,
  motion, opening replay, model preference, persistence, export, wipe, reset,
  and provider status cards without storing browser secrets;
- sidebar project/file rows and the V1 Music context lane, including its
  preview/action controls, creative-intensity control, and every V1
  `data-solat-*` surface marker.

## Honest boundary

Music analysis, search, image generation, slide generation, and file-byte
transport are not claimed as complete in this milestone. Their V1-visible
controls are present, open a truthful not-connected surface, and never
fabricate a result. Attachment names remain local context; the model provider
receives no file bytes through the current core contract. Source URLs are only
rendered as citations when they match the V1 approved allowlist.

## Evidence

- `test/ui.test.js` inventories every V1 static button ID and all V1 dynamic
  `data-music-*`, `data-solat-*`, and thinking markers, then asserts the V2
  renderer has a wired path for each one; it also checks `musicInput` and
  `musicPreview`. It also guards against rendering a completed turn before
  clearing its thinking state, which previously left an extra SOLAT bubble.
- `npm.cmd run check` — PASS.
- `npm.cmd test` — PASS (14 tests).
- `npm.cmd run build` — PASS; the packaged executable was relaunched after the
  build and the local `.env` was copied beside it without printing its key.

Status: `IMPLEMENTED BUT NOT FULLY VERIFIED` for subjective visual parity;
manual visual review is still required for pixel-level differences.
