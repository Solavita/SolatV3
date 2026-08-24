# SOLAT V2

Chrome Control setup and privacy boundaries are documented in
[`docs/CHROME_CONTROL.md`](docs/CHROME_CONTROL.md). Pairing requires an explicit
owner action; without it, the isolated Browser Workspace remains the automatic
fallback.

SOLAT V2 is a clean Electron rebuild. Its active text-model architecture is
`qwen_flash_plus.v1`: Qwen3.7 Flash is the sole Agent/Executor for final answers,
validated structured output and bounded tool loops; Qwen3.7 Plus supplies bounded
advice only for classified complexity or recovery, after which Flash still produces
the result. Active DeepSeek, RunPod and local/Ollama configuration, startup and
routing paths are decommissioned. Qwen3-VL-Flash remains a separately configured,
bounded vision route. V1 remains an immutable rollback archive/reference and is not
imported into this app.

The post-Milestone 1 foundation includes versioned creative contracts and a first
Music-to-Deck planning path. Through secure IPC, the UI can submit a goal, audience,
slide count, and music anchor; the provider must return validated structured JSON;
SOLAT then creates Emotion DNA, a narrative plan, a design system, an editable
document model, and a quality report with a manual-review gate. A failed provider or
malformed plan never becomes a fake deck.

## Development

1. Install Node.js 20+.
2. Copy `.env.example` to `.env` and set `SOLAT_QWEN_API_KEY`. The documented
   defaults use `qwen3.7-flash` and `qwen3.7-plus` through Alibaba Model Studio.
3. Run `npm install`.
4. Run `npm run dev`.

### Voice V1 configuration

Voice mode uses Cartesia Ink 2 for streaming microphone transcription and
Cartesia Sonic for speech output. Set `SOLAT_CARTESIA_API_KEY` and
`SOLAT_CARTESIA_VOICE_ID` in the local `.env`; do not put either value in the
renderer or commit them. `SOLAT_VOICE_LANGUAGE=auto` follows the current UI
locale, or it can be set to a language code such as `th` or `en`.

If voice credentials are missing, SOLAT reports that voice is not configured
and keeps typed chat, Agent, tools, and Computer Use available. The microphone
stream is disposed when voice mode closes. Speaking while SOLAT audio is
playing cancels that audio and starts a new listening turn.

`npm run build` copies the local untracked `.env` beside the local
`dist/win-unpacked/SOLAT.exe`, so that build can be opened immediately. The key
is read only at runtime and is never bundled into the renderer or committed to
Git. Remove that copied `.env` before sharing the folder, then let the recipient
set their own key beside `SOLAT.exe` or in Electron user-data.

The desktop window owns the UI and communicates with SOLAT Core through a
secure preload bridge. No local HTTP server or manually selected port is used.

## Tests and checks

- `npm test` runs deterministic core/provider/workflow tests plus the UI contract test.
- `npm run check` checks JavaScript syntax.
- `npm run build` creates a packaged build after dependencies are installed.

If the provider is not configured, the app stays usable but shows a truthful
configuration error instead of pretending that a model response succeeded.

## Verified locally

- `npm.cmd run check` passes JavaScript syntax checks.
- `npm.cmd test` passes the deterministic core/provider/router/search/workflow/export/UI contract suite (93 tests at the current revision).
- `npm.cmd run dev` starts the Electron development window without a manual port.
- `npm.cmd run build` creates `dist/win-unpacked/SOLAT.exe`.
- The only active text mode is automatic `qwen_flash_plus.v1`. Legacy `local` and
  `deepseek` selections normalize to this architecture and do not start or route to
  a retired provider.
- The current combined Goal 2 build is
  `dist-verified-20260823-qwen37-voice-combined-v1/win-unpacked/SOLAT.exe`. Its
  six-second isolated-profile startup, 44/44 non-asset runtime parity, 15/15 key-file
  parity, 2/2 Voice MP4 parity, privacy and active-legacy scan pass. Voice projects the
  exact nine states while reusing normal `Chat.send`: Qwen Flash executes final,
  structured and tool work, Plus supplies bounded advice, the visible assistant answer
  alone reaches TTS, and typed input is unchanged. Packaged live provider/model/tool
  execution remains `NOT VERIFIED`; network-zero evidence was not captured.
- One isolated packaged UI E2E request returned `SOLAT_UI_E2E_OK` through the
  renderer/IPC/provider path; the completed response had no thinking bubble or
  error node.
- The creative workflow tests cover structured planning, malformed provider output,
  idempotency, explicit state transitions, editable document validation, and the
  `MANUAL REVIEW REQUIRED` quality gate.
- Uploaded originals are stored through the owner/project-scoped `AssetStore`, with
  immutable metadata, SHA-256 integrity checks, and deletion intent tracking; export
  fidelity remains a separate verification item.
- Completed creative plans can be exported through the secure `solat:export-html`
  boundary as deterministic editable HTML plus a manifest. Opening and visual fidelity
  of that packaged export remain `MANUAL REVIEW REQUIRED`.
- The packaged creative workspace was exercised through the visible UI: a real
  `READY_FOR_EDIT` plan was generated, its editable slide list was previewed, a
  derived revision was created without changing the prior plan, and that revision
  exported to HTML plus a manifest in the same session. The UI showed no error node;
  visual quality is still `MANUAL REVIEW REQUIRED`.
- The workspace now keeps an in-session revision history, exposes a secure
  `Open exported HTML` action restricted to SOLAT's own export directory, and
  keeps artifacts isolated by session. Restart/recovery is intentionally
  truthful: the current in-memory workspace does not resurrect stale artifacts.
- Export inspection is available from the workspace after export. It reads only
  SOLAT's own HTML/manifest pair and reports slide count, element count,
  editable/locked counts, asset references, provenance, and structural issues;
  visual quality remains `MANUAL REVIEW REQUIRED`.
- Creative results, revision history, export metadata, and inspection metadata
  are persisted under the Electron owner user-data boundary and restored for the
  same conversation session after a packaged restart; chat-message durability
  remains a separate milestone.
- Conversation turns preserve the original message and prior turns while adding
  non-authoritative intent hints. The provider adapter can validate and execute bounded
  OpenAI-compatible tool-call rounds; general or ambiguous chat remains model-first.
- Comparison and ambiguous-name hints retain candidate entities, compact variants,
  and recent context so the Qwen Flash Agent can compare or ask for clarification without a
  router hard gate.
- The optional search tool uses SearXNG, Brave, DuckDuckGo, or Wikipedia,
  filters results to approved source hosts, deduplicates/ranks evidence, and reports
  disabled or degraded states truthfully. The model can request an approved source
  scope (`encyclopedic`, `social`, `video`, `ai_summary`, or `auto`), and the UI shows the selected
  scope beside the real source links. The default is the no-key DuckDuckGo adapter
  with Wikipedia fallback; the model still chooses whether to call it. When a
  search tool call actually returns evidence, the UI shows a compact `N source(s)`
  line below the answer and the settings surface reports provider readiness
  without exposing keys. An unconfigured provider is shown as not configured,
  never as ready.
- Before sources reach the active text model or the visible source drawer, SOLAT removes
  allowed-but-unrelated results, keeps canonical URL deduplication, and carries a
  bounded quality note. A comparison with separate evidence for each name is
  labelled as separate evidence rather than silently treating two entities as one.
- When a search snippet is insufficient, the model can request the bounded
  `web_read_page` tool for a URL already returned by the approved search path;
  URL allowlisting, timeout, text limits, and untrusted-page instructions remain
  enforced and page reads are reported separately from search results.
- Intent hints also include a bounded set of search-query variants for ambiguous
  hyphenated names and comparisons. They are advisory only: the full original
  user message and history stay intact, and Qwen Flash still chooses whether and
  how to use the search tool.
- `npm.cmd run smoke:live-search -- --output artifacts\\live-search-smoke\\<timestamp>.json`
  runs one explicit owner-approved text-model + search smoke case when both providers
  are configured. It records only readiness, bounded approved sources, visible
  answer text, and final-response usage metadata; it never writes API keys. If a
  provider is absent or the model does not return search-grounded evidence, the
  result is `NOT VERIFIED` rather than a false pass.
- `npm.cmd run evaluate:conversation` evaluates the checked-in conversation/search
  corpus without contacting a provider. Its report gives every case an explicit
  `PASS`, `FAIL`, or `NOT VERIFIED` result; live semantic parity is deliberately
  `NOT VERIFIED` until a real external baseline is captured.
- `npm.cmd run capture:three-way -- --execute --case-ids <case-id> --chatgpt-baselines <file> --output <file>`
- `npm.cmd run report:three-way` produces a read-only coverage view of the current 25-case corpus; it never calls a model.
  makes one raw DeepSeek request and one SOLAT request for each selected case, then
  combines them with an owner-captured ChatGPT baseline. It records visible answers,
  source/tool trace, timestamp-derived DeepSeek/SOLAT latency (and explicit unknown
  browser-baseline latency), and bounded usage metadata but deliberately
  leaves semantic parity as `NOT VERIFIED` until a person reviews the three answers.
  The checked-in `evaluations/chatgpt-baselines.template.json` is a blank safe input
  format; it must never contain a key, cookie, or private share URL.

The UI is copied from the owner-supplied
`C:\Users\pengc\Downloads\SolatUI.html` (source SHA-256:
`590691B503AD67EE49517C0215737E1943C217D93EFB7453637E77B91E25D8CA`).
All visual HTML/CSS/SVG content is retained, including the butterfly opening
shell, icon sprite, overlays, settings surface, message styles, composer, and
responsive rules. A normalized comparison (remove only the original inline
application script and the V2 external-script tag; restore the boot class)
matches exactly: `04C6F636615221BFF7FCB2FC5E8D0470599C5E2B7A5397F030D1A22A515B87F1`.
The original inline V1 application/connection script is the only removed part;
the V2 renderer supplies the new secure path:
Renderer -> secure preload -> Electron IPC -> SOLAT Core.

The desktop process was observed running with a `SOLAT` window. The packaged
UI reports provider failures truthfully and reads the local `.env` beside the
executable without exposing the secret to the renderer. Pixel-level visual
parity and a full conversation benchmark remain `MANUAL REVIEW REQUIRED`;
the smoke request is not a quality benchmark.

## V2 spatial interaction foundation (2026-08-23)

The first V2 spatial foundation is implemented without replacing the V1 voice,
model, Computer Use, or Blue UI paths. `src/core/spatial-memory.js` owns the
versioned `solat.spatial-event.v1` and `solat.spatial-context.v1` contracts,
authoritative bounds, bounded points/display geometry, owner/session isolation,
deeply isolated context, and bounded `InteractionMemory`. It recognizes Thai
grounding phrases such as “อันนี้” and “ตรงนี้”, including deterministic
self-correction to the previous annotation.

`src/spatial-overlay-manager.js`, the two narrow preloads, and
`renderer/spatial-overlay.*` provide a transparent, frameless, always-on-top
overlay on the display nearest the cursor. Circle, X, arrow, highlight,
freehand, lasso, click, and drag are available. The overlay uses a sandboxed
isolated renderer, sender-bound capture token, display-local CSS-pixel
coordinates, pointer source metadata, a capture timeout, and cancellation on
owner close, overlay close, display metrics change, display removal, or load
failure. Spatial evidence returns through the normal Chat/Agent path; it is
pointing evidence only, and Computer Use must obtain current screen evidence
before an action that depends on the marked content.

Voice alignment records the main-process receive timestamp for a final STT
event and grounds a same-owner, same-session spatial annotation only when it
existed at that timestamp. No provider was called for this foundation audit.

Verification recorded for this checkpoint:

- `npm.cmd run check` — PASS.
- `npm.cmd run check:spatial` — PASS.
- Focused Spatial/IPC/Voice/UI regression — 60/60 PASS.
- Full `npm.cmd test` — 437/437 PASS, 0 fail, 0 skipped, 0 cancelled; Node
  duration `71108.6052 ms`.
- A real development Electron window opened the transparent overlay and showed
  the toolbar. Computer Use could not complete a physical drag because its
  helper could not obtain a process id for the transparent foreground window;
  physical pointer drawing, mixed-DPI drawing, and monitor-removal behavior
  therefore remain `MANUAL REVIEW REQUIRED` / `NOT VERIFIED`.

### V2 spatial final package checkpoint (2026-08-23)

The final spatial package was built directly with `electron-builder` into the
unique output directory
`D:\SOLAT_V3\dist-verified-20260823-v2-spatial-v1`; the direct build did not
copy `.env`. The package identity is EXE SHA-256
`30F8C64508C6D016E24C07F47285205BDA395794C870457943069C3BC213DF43` and ASAR
SHA-256 `419EBA2872D8E4224AA72FA5E7A75CBD628AB6239E82605BA2B0962B7A9229F5`.
Parity passed 17/17 across spatial/model/voice/security contracts, overlay
HTML/JS/preload, and MP4/assets. The package inventory found zero real `.env`,
private-key, certificate, or credential files; only the public `.env.example`
is present.

`reports/v2-spatial-packaged-startup-20260823-v1.json` reports PASS after
6,000 ms with the process alive, no provider request initiated by the harness,
 no credential environment injected, and process/profile cleanup PASS. This
report SHA-256 is
`E8721B9822BB9C5237275FF46773294753692781B3552C90ADF324D24F99A9B2`.
This
startup result does not establish network-zero, packaged live provider/model
behavior, or physical transparent-overlay pointer behavior; those remain
`NOT VERIFIED` / `MANUAL REVIEW REQUIRED`.

## V3–V6 autonomous checkpoint (2026-08-24)

Owner tutorial: `docs/USER_TUTORIAL_V3_V6.md`. The same quick tutorial is
available inside SOLAT through `Ctrl+G` -> `V3–V6 tutorial`.

- V3 adds an on-demand Browser Workspace in a separate sandboxed window. Remote
  pages receive no SOLAT preload, Node.js, popup, download, permission, or
  private/local-network access. Targets are opaque and navigation-revision bound.
- V4 adds a provider-neutral `SpatialAsset` protocol. Mouse, touch and hand use
  the same derived ghost, surface switch, drop, provenance and interaction memory.
- V5 adds opt-in renderer-local hand inference with
  `@mediapipe/tasks-vision` 1.0.1. Only two sets of 21 normalized landmarks at
  most cross IPC; camera images/video are not sent to main or persisted.
- V6 fuses bounded semantic voice, pointer, hand, screen and asset events into
  owner/session-scoped interaction memory. A profile-stable main-process owner
  restores semantic references after Electron restart even when the live
  renderer id changes; Chat/Agent/Computer Use authority remains bound to the
  current authenticated renderer.

All checks, offline evaluation/preflight gates and the full regression suite
pass (`512/512`, no failures/skips/cancellations; `70063.5678 ms`). No paid
provider call or camera capture was made. The final package output is
`D:\SOLAT_V3\dist-verified-20260824-v6-final-v6\win-unpacked`; exact hashes and
startup evidence are recorded outside the self-referential package in
`docs/VERIFICATION_REPORT.md`.
An isolated packaged runtime probe also initialized and closed the local
MediaPipe detector successfully without requesting camera access or calling a
provider. WASM and the model are unpacked explicitly; CSP permits local
`'wasm-unsafe-eval'` only and keeps general JavaScript `unsafe-eval` disabled.
`THIRD_PARTY_NOTICES.md` and the full Apache-2.0 license are packaged.

Physical camera gestures, cross-window/app drops, authenticated sites/CAPTCHA,
acoustic Voice and subjective UI quality remain `NOT VERIFIED` /
`MANUAL REVIEW REQUIRED`.
