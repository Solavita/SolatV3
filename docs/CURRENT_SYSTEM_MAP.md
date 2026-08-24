# Current system map — SOLAT V3

## V1–V2 OpenAI Agents SDK foundation (2026-08-24)

- `src/core/openai-agents-runtime.js` is the versioned `solat.openai-agents-runtime.v1`
  adapter around the official `@openai/agents` TypeScript SDK. It exposes the
  existing Qwen Flash/Plus `ModelRouter` as a custom SDK model provider rather than
  replacing the configured model API.
- `src/core/conversation-core.js` sends ordinary typed and Voice-final turns through
  the same SDK Runner. Existing bounded history is supplied on every run, while the
  in-memory history key is owner + session so identical session IDs in different
  renderer owners cannot share context.
- Search, Commerce and explicitly selected filesystem/Computer capabilities become
  SDK function tools only for the current turn. Existing registries remain the
  code-authoritative executors, including ownership, approval, timeout, provenance
  and verified-postcondition boundaries. The persistent Computer Task loop remains
  the specialized safe desktop executor; it is not replaced by unrestricted model
  computer control.
- SDK tracing and sensitive trace capture are disabled. Malformed messages, tools,
  empty final responses and tool-limit overruns remain visible provider failures.
- `test/openai-agents-runtime.test.js` covers plain streaming, one bounded tool round,
  provider-message serialization, unified typed/voice routing, context continuity,
  cross-owner isolation and per-turn capability attachment.
- This checkpoint changes the V1–V2 foundation only. No new V3 feature was added.
  Local deterministic behavior is verified; paid/live packaged inference and
  subjective answer quality remain `NOT VERIFIED`.

## Owner-paired Chrome Control (2026-08-24)

- `chrome-extension/` is a clean-room Manifest V3 extension with the stable ID
  `eokiajfkblbchdnjobacdbddjdllkeca`. It exposes bounded semantic targets and
  verified actions only for public HTTP(S) pages selected by the owner.
- `src/chrome-control-manager.js` is a `127.0.0.1`-only authenticated WebSocket
  bridge. It validates the exact extension origin, keeps its persistent pairing
  secret outside renderer/status/log output, binds every surface to the live
  Electron owner and session, and fails closed on private or stale pages.
- `src/hybrid-browser-manager.js` routes new Browser Workspace tools to real Chrome
  when the extension is connected and preserves the existing isolated Browser
  Workspace as the automatic fallback.
- `src/ipc-router.js`, `src/preload.js` and the existing renderer expose an explicit
  `Chrome Control setup` command. Pairing and revealing the unpacked extension
  require separate owner clicks. Once paired, the UI and Agent can enumerate normal
  Chrome tabs through bounded pages and switch with owner/session-bound opaque
  `tab_ref` values; raw Chrome tab IDs never cross the Agent tool boundary.
- `chrome-extension/content.js` displays the SOLAT cursor and `SOLAT CONTROL`
  indicator on connected public tabs. Disconnect and live privacy transitions remove
  the overlay and restore the native cursor.
- Incognito/unsupported pages plus authentication, OAuth callbacks, password, OTP, card/payment, CAPTCHA and account
  challenge surfaces are full-page privacy shields. DOM observation, filling,
  clicking, screenshots and image extraction are blocked. The owner completes
  authentication in Chrome and explicitly adopts a normal page afterward.
- Alt-clicking a public-page image transfers bounded raster bytes through the
  existing `createChromeSpatialAssetBridge` and V4 immutable SpatialAsset path.
  Browser Workspace tools continue using the same versioned contracts and approval
  boundary, so the frontend does not recreate browser/asset authority.

## V4 mouse-lasso design memory (2026-08-24)

V4 remains `NOT STARTED` as a new mouse-first lasso/object flow. The deferred
design records the SOLAT special-cursor context, lasso polygon, voice command
`เอาอันนี้มา`, deduplicated notification/TTS acknowledgement, and confirmation
before Workspace transfer in [docs/V4_MOUSE_LASSO_OBJECT_SPEC.md](V4_MOUSE_LASSO_OBJECT_SPEC.md).
This is a design/reference note only; it is not current implementation or
verification evidence, and hand tracking remains deferred.

ตรวจ 2026-08-22 จาก source บน `D:\SOLAT_V3`.

- `src/core/provider.js`: validated OpenAI-compatible provider boundary for active
  Qwen Cloud text/vision requests, including response/tool-call validation, bounded
  tool loops, Qwen request shaping and timeout/error mapping. Historical adapter code
  is not composed into active text routing.
- `src/core/conversation-core.js`: session-scoped conversation orchestration, full user message/history, search recovery and evidence merge
- `src/core/intent-router.js`: versioned advisory intent/context hints; model-first, no hard gate; query variants and reference resolution
- `src/core/web-search.js`: provider adapter boundary, allowlist, ranking/dedup, page-reader and degraded-state reporting
- `src/core/conversation-evaluator.js`: deterministic routing/evidence corpus evaluator
- `src/core/three-way-evaluator.js`: capture/structural comparison; semantic parity stays manual review
- `src/core/model-router.js`: versioned `qwen_flash_plus.v1` routing. Qwen3.7 Flash
  owns plain/final responses, structured output and bounded tool execution. Qwen3.7
  Plus can add bounded advisory context for classified complexity or recoverable Flash
  failure, but never returns the final result, executes a tool or decides authority.
  Routing records physical attempts and total request timing.
- `src/core/computer-task-loop.js` + `src/core/computer-use-adapter.js`: deterministic browser/search fast path, semantic unknown-app inspection, application-local hotkeys, and verified postconditions; text-only providers do not capture unused screenshots
- `src/core/computer-task-loop.js`: every terminal failure emits a visible terminal event; deterministic Notepad and cross-app workflows retain exact user terms and stop boundedly
- `src/core/computer-use-adapter.js`: existing Chrome/app HWNDs are activated and reused where safe; YouTube selection has bounded direct-URL and semantic fallbacks with title/playback verification
- `src/core/computer-agent-tools.js`: bounded Computer Use registry including `computer_press_hotkey`
- `renderer/` + `src/preload.js` + `src/main.js`: UI/IPC boundary; renderer does not call providers directly. Computer-task progress is keyed by task and request, with terminal tombstones preventing delayed events from reviving stale UI state
- `scripts/run-computer-use-ui-15.js`: real Electron/CDP verification for 15 natural Computer Use commands; it opens only case prerequisites, captures evidence, and cleans up only the Electron process/profile it created
- `test/`: Node regression suite and UI contracts
- `evaluations/`: deterministic conversation/search and Model Foundation corpora

The source now has an optional SmolVLM GUI-grounding route, validated exact-window PNG input, a task/revision/HWND/hash/freshness boundary, and a UIA-first gate. Production sampling is adaptive and bounded to at most three frames, 500 ms apart, within two seconds; duplicate hashes stop the sampler and only the latest frame is sent. Vision remains disabled by default. The exact `pierretokns/smolvlm-500m-ccmcp-v1` Q4_K_M model and projector were installed and tested through both Ollama and llama.cpp, but returned image descriptions instead of valid grounding JSON on real SOLAT screenshots. Raw-coordinate click is not exposed because WinApp has no exact-HWND mouse-coordinate primitive and a safe DPI/client-rect binding is not implemented. Vision is therefore `BLOCKED`, not production-ready.

The latest pre-migration development Computer Use evidence is
`reports/computer-use-ui-15-full-final-v2-20260822.json`: 15/15 PASS with no timeout
and 81.737 s summed terminal latency. Its DeepSeek escalation rows are historical and
do not establish Qwen3.7 packaged parity. Plain startup isolation remains relevant,
but the migrated package still requires its own runtime exercise.

Historical pre-migration Qwen 2B/DeepSeek evidence remains in
`reports/model-routing-qwen2-semantic-repair-final-20260822.json`. It is retained for
audit and rollback context only; its local/DeepSeek routes and 373-test baseline are
superseded by `qwen_flash_plus.v1` and are not active acceptance evidence.

The prior packaged build at
`D:\SOLAT_V3\dist-verified-20260822-full-prompt-final\win-unpacked\SOLAT.exe` remains
historical pre-migration evidence only. Its local/DeepSeek runtime behavior does not
verify the Qwen3.7 migration package. The archive secret-boundary evidence remains
valid for that artifact; a new packaged migration inventory is still required.

No Phase 0–4, Business Context, Commerce MVP or Google Classroom work is in scope
for the current Model Foundation iteration.

## Qwen3.7 model migration (2026-08-23)

- `src/core/config.js`, `src/core/model-router.js`, `src/core/provider.js` and the
  composition root now expose only the automatic `qwen_flash_plus.v1` text
  architecture. Active DeepSeek, RunPod and local/Ollama config, startup and routing
  are decommissioned; legacy `local`/`deepseek` mode values normalize to `auto`
  without starting or selecting the retired providers.
- Qwen3.7 Flash (`qwen3.7-flash`, thinking disabled) is the Agent/Executor for every
  final/plain response, versioned structured result and bounded tool loop. Qwen3.7
  Plus (`qwen3.7-plus`, thinking enabled) is advisory-only for classified complexity
  or bounded recovery. Advice is untrusted context and cannot override schemas,
  approval, ownership, verified evidence or tool limits; Flash always produces the
  final output.
- Qwen3-VL-Flash remains a distinct `qwencloud_vision` route with its own bounded
  image/structured-output contract. It is not part of the Flash/Plus text role split.
- The accepted live artifact is
  `reports/model-routing-qwen37-20260823-v4.json`: PASS, four cases, six physical
  provider calls and 46,367 ms total. Case durations are 2,462 ms plain Flash,
  2,874 ms structured Flash, 38,674 ms Plus-advice then Flash, and 2,357 ms for the
  bounded Flash tool loop. The tool fixture was an in-memory read with no side effect;
  final content was present. Response content, credentials and provider error messages
  are omitted from the artifact.
- `reports/model-routing-qwen37-20260823-v3.json` is a failed diagnostic artifact,
  not acceptance evidence (SHA-256
  `37590608A8E4C285CD8B1185BA86F98E933ECC6FBBC3AC2AEEA661BAFB26D120`). The accepted
  v4 report SHA-256 is
  `E15FECB41E8D44D7079F3C4DB8EFE1DEC0A8DEE51CB5838236F3E813699B67F2`.
- Non-live syntax/contract checks pass. Full regression passes 408/408 with zero
  fail, cancelled, skipped or todo; Node duration is 69,061.1332 ms. Deterministic
  conversation evaluation is 24 PASS, 0 FAIL, 1 intentionally NOT VERIFIED; Model
  Foundation evaluation is 21 PASS, 0 FAIL, 4 NOT VERIFIED. The paired 100-case
  preflight passes with 10 declared missing-context limitations; follow-up 100 and
  capability 100 preflights pass, and the 300-reference evaluation manifest passes.
- The immutable Voice V1 rollback package remains unchanged: EXE SHA-256
  `767BB75439291345F346CF9411AA94CD9406845985D1CD082EF494271C9832DA` and ASAR
  SHA-256 `5D680C99A6B58A82CAE87E5AC588CC3D6497B62B4F0F5BEA9A7A6E35C2A91879`.
  The immutable model-only migration checkpoint remains at
  `dist-verified-20260823-qwen37-model-v2/win-unpacked/SOLAT.exe`: isolated-profile
  startup stayed alive for 6,000 ms and process/profile cleanup passed. EXE SHA-256 is
  `F8EC2A81DDF7F72C258533D32B9F459019B81235E9D61C4782D447DF06485482`; ASAR SHA-256
  is `384D0A2551D52B184D2950EF37C24E0D02C195AF310C8308F6B15691BCDAC190`. The harness
  initiated no provider request and injected no SOLAT provider credential environment;
  cleanup stopped the main process and removed the isolated profile. Network-zero
  evidence was not captured; source parity shows startup itself does not initiate a
  model request. Evidence is `reports/model-packaged-startup-qwen37-20260823-v4.json`
  (`solat.model-packaged-startup.v2`, SHA-256
  `ADE72DFE23BC998EDB2436D1DDE85846529686ED09A7185E2888DEAF613ADD69`). The startup
  script SHA-256 is
  `E5EB9E29DB38A59534F9BC5EF78E8F4CDA113E85CCE142CCEDFF5C285E412E6C`.
- Final-package parity/privacy audit passes. `app.asar` contains 947 entries and exact
  source parity is 12/12 for `conversation-core`, `computer-task-loop`, `model-router`,
  `config`, `provider`, `services`, `main`, `preload`, `ipc-router`, renderer HTML/JS
  and `voice-controller`. Active legacy scan count is zero across main, services,
  config, conversation core, computer task and renderer; only intentional mode
  normalization/generic historical compatibility remains outside active startup.
  The package contains only public `.env.example` with empty credential fields and no
  real `.env`, certificate, private key or other secret file. Audit cleanup found zero
  remaining package processes and zero isolated-profile remnants.
- Goal 2 adds a lifecycle generation guard in `renderer/voice-controller.js`.
  `exit()` invalidates a pending enter; late microphone initialization cannot revive or
  leak resources, and a late STT start is cancelled without returning to `listening`.
  Renderer teardown still releases every session owned by that sender and best-effort
  cancels STT/TTS without affecting another sender.
- The Blue UI projects the exact nine-state Voice contract and sends one final transcript
  through the unchanged normal `Chat.send` path. Qwen Flash remains Agent/Executor,
  Plus advice stays bounded, tools remain code-authoritative, and only the visible
  assistant answer reaches TTS. Typed input behavior is unchanged.
- Final targeted UI/Voice regression passes 22/22. Full `npm.cmd test` passes 411/411,
  with 0 fail/cancelled/skipped/todo and Node duration 69,123.8142 ms; syntax, Voice
  syntax and whitespace checks pass.
- The current combined package is
  `D:\SOLAT_V3\dist-verified-20260823-qwen37-voice-combined-v1\win-unpacked\SOLAT.exe`
  (EXE SHA-256 `54ADA6740AE474967786611D43808CCF6A1B3E28B37889F11B4B3504E5BD6692`;
  ASAR SHA-256 `28F7568A1D0C228EF4F9C4AD67B33FE6323BDD23BB78023B914EABE1B03507B3`).
  Its 947-entry ASAR passes 44/44 non-asset runtime parity, 15/15 key parity, 2/2 Voice
  MP4 parity, privacy and active legacy scans. The Voice V1 and model-only V2 package
  hashes above remain unchanged.
- `reports/qwen37-voice-combined-startup-20260823-v1.json` passes after 6,000 ms with
  no harness-initiated provider request or injected SOLAT provider credential and with
  process/profile cleanup PASS. Report SHA-256 is
  `1C157952DF6A48551D75D7924C4871EEA837EDAB617747C94BD927E52B2B42FC`.
  This is startup evidence, not network-zero or packaged live inference evidence.
  Packaged live provider/model/tool execution and broad semantic quality remain
  NOT VERIFIED.

## Voice Core V1 (2026-08-23)

- `renderer/voice-controller.js` owns streaming microphone capture, the nine-state
  voice contract, final-transcript deduplication, audio playback, barge-in and
  deterministic resource disposal. Exit and re-entry are serialized, failed microphone
  initialization rolls back opened resources, and a suspended `AudioContext` is resumed.
  The versioned UI states are `idle`, `listening`,
  `user_speaking`, `transcribing`, `thinking`, `acting`, `speaking`, `interrupted`
  and `error`; partial transcripts update UI only.
- A final STT turn reuses the existing `Chat.send` path exactly once. If Chat is busy,
  the final callback waits for the current turn rather than dropping the transcript.
  It therefore
  retains the same conversation history, ModelRouter, Agent, tools and Computer Use
  behavior as typed input; there is no second conversation core.
- `src/core/voice-service.js` contains swappable STT/TTS ports and Cartesia adapters.
  Ink 2 receives bounded PCM chunks over an auto-finalizing websocket. Sonic TTS
  receives only the validated visible `result.assistant` text, never progress or
  internal tool trace content. The selected Cartesia voice is Elias
  (`6a176356-ada1-4b48-b2ae-3a3fdd485680`). Thai-script output selects `th` at the
  renderer boundary; an explicit main-process voice language overrides inferred or
  request language. Full-buffer TTS responses are rejected above 16 MiB.
- `src/preload.js` and `src/ipc-router.js` expose narrow, owner-bound voice channels.
  API key and voice id stay in the main process through `src/core/config.js`. Destroyed
  or closed renderer senders release their claimed sessions and trigger best-effort
  STT/TTS cancellation.
- Voice mode fails visibly and leaves normal text chat available when configuration,
  microphone access, provider transport or audio playback is unavailable.
- The bounded live provider loop in `reports/voice-live-v1-20260823-v5.json` passes:
  Sonic returned 268,128 bytes of 44.1 kHz PCM in 812 ms, and Ink 2 returned the exact
  final transcript `Hello, this is the Solat voice verification.` in 4,817 ms.
  This loop fed the generated TTS audio into STT; it did not use a physical
  microphone or prove speaker playback, packaged permissions, multi-turn latency,
  quota behavior or subjective Elias voice quality. TTS generation remains
  non-streaming, but the controller enters an interruptible `speaking` state while
  generation is pending; a re-entrancy lock prevents overlapping interrupt flows.
  Speaker playback and acoustic echo behavior remain NOT VERIFIED.
- Final non-live verification passes: `npm.cmd run check` in 5.117 s,
  `npm.cmd run check:voice` in 1.144 s, full `npm.cmd test` at 402/402 with
  zero fail/cancelled/skipped/todo, Node duration 70,643.8994 ms (71.840 s wall),
  and `git diff --check` in 0.112 s. The final package is
  `dist-verified-20260823-voice-v1-final/win-unpacked/SOLAT.exe`; its source-parity
  checks pass 15/15 Voice contracts and 10/10 integration contracts with Cartesia
  4.0.1. The package contains no real `.env`; the public `.env.example` is allowed.
  A five-second isolated-profile startup with configuration injected only into process
  memory opened `SOLAT — AI Operating System` (main PID 5796, window handle 7473540;
  child PIDs 9872, 14488, 18972 and 21588 resolve to the same package). This is startup
  evidence, not speaker, permission-UX, multi-turn or echo evidence.
- `reports/voice-packaged-silent-v1-20260823.json` adds a packaged silent runtime PASS
  against that exact final EXE. Chromium captured the OS-selected live/running 48 kHz
  microphone track: 18/18 processor frames were non-zero (maximum RMS 0.0508064), and
  the secure bridge sent 15 bounded pushes / 288,000 PCM bytes to live Cartesia STT
  with no provider error. While live packaged Cartesia TTS was pending, two injected
  RMS 0.2 frames crossed the 0.08 production threshold and produced
  `speaking(pendingAudio)` at 0.0 ms, `interrupted` at 0.5 ms, `listening` at 158.2 ms
  and `user_speaking` at 170.1 ms. Exactly one TTS cancel and one STT cancel occurred;
  STT started twice, the voice session rotated, the conversation remained unchanged,
  and `Audio` constructor/play counts stayed zero. The test used only test-launch flags
  `--remote-debugging-address=127.0.0.1 --remote-debugging-port=9223`; neither production
  source nor packaged ASAR contains a CDP flag. Cleanup removed the test process, port
  and isolated profile. Audible speaker output, acoustic echo/barge-in, permission
  dialog UX, device switching, physical multi-turn use and subjective quality remain
  NOT VERIFIED.
- `reports/voice-packaged-e2e-v1-20260823.json` passes one integrated silent turn in
  the same final package using test-only localhost CDP port 9224. Cartesia-generated
  PCM was injected into the production audio callback while an OS microphone track was
  live; Ink 2 finalized `Please reply with` at 7,465.6 ms from trace start. That was
  only a partial match for the longer generated seed, so exact STT semantic accuracy
  remains NOT VERIFIED. Chat storage and the rendered user DOM both contained that
  exact final in the preserved conversation. DeepSeek completed without an assistant
  error; privacy evidence records only the source answer length (352 characters),
  rendered DOM length (347 characters), and source SHA-256
  `B079A293B04E70D5F9CA443F40EC99C0EF59436A7DE83CD5617C89A4C4FD7FB8`, not its text.
  The TTS request exactly matched the 352-character assistant source/hash—not the DOM—
  with language `en-US`; live Cartesia TTS was called once and returned a valid 1,869,918-byte
  RIFF/WAV. The
  controller moved `speaking(pendingAudio)` → `speaking(audio ready)` → `listening`;
  the silent in-memory test sink recorded one `Audio` construction and one `play` call
  without physical speaker output. The voice session rotated, the conversation id was
  preserved, no runtime error occurred, and controller/stream/context/track/bridge,
  process and isolated-profile cleanup all passed. Physical human input, physical
  multi-turn use, audible speaker output, acoustic echo, permission-dialog UX, device
  switching and subjective quality remain NOT VERIFIED.
  The final report SHA-256 is
  `8A7853999BF330267D2052E8DA7193F852DACA17206C3104D05F3C0520E973AC`.

## Qwen3-VL-Flash API wiring (2026-08-22)

`src/core/config.js` and `src/core/provider.js` now support an explicit
`qwencloud_vision` adapter for Alibaba Cloud `qwen3-vl-flash` through the
OpenAI-compatible endpoint. The route is disabled by default, sends bounded
validated PNG captures only, and keeps the vision API key separate from the
Qwen Code/Token Plan key. Contract tests verify the endpoint, image payload,
structured JSON response mode, and provider options. A live composition-root
call now succeeds with the dedicated local key and returns structured
grounding JSON in about 1.85 seconds. The route remains used only when trusted
UIA evidence is insufficient; the real 15-case UI suite still passes without
forcing vision for UIA-sufficient tasks.

## Roblox and Computer Use capability catalog (2026-08-22)

`computer_open_website` now allowlists Roblox at `https://www.roblox.com/` and
verifies the visible Chrome title before reporting success. The command planner,
tool schema, adapter, and model routing target list share the same Roblox label.
The Computer Task Loop receives trusted tool definitions from the composition
root, including descriptions, argument schemas, and side-effect levels. Registry
validation, approval, target inspection, and sensitive-field guards remain
authoritative. Roblox login, account selection, gameplay clicks, and credential
entry are not enabled.

## Voice credit audit (2026-08-23)

The previous excess usage cause was twofold: every microphone frame was forwarded
to STT even when its RMS was silence, and TTS had no request-context/text
fingerprint guard, so repeated delivery of the same visible assistant text could
generate it again. The controller now gates silent frames (speech plus a bounded
five-frame tail only), logs `solat.voice-usage-debug.v1` start/stop/request/cancel
events without raw audio or text, and suppresses duplicate TTS per request context.
TTS cancellation is propagated through the existing abort path. Deterministic
voice tests are 14/14 and the full suite is 413/413; no paid/live provider was
called during this audit. Live Cartesia credit reduction remains NOT VERIFIED.

## V2 spatial interaction foundation (2026-08-23)

- `src/core/spatial-memory.js` defines the versioned `solat.spatial-event.v1`
  and `solat.spatial-context.v1` contracts. It accepts circle, X, arrow,
  highlight, freehand, lasso, click, and drag; derives bounds in code; bounds
  points, timestamps, display geometry, and retained sessions; and deep-freezes
  the event/context boundary. `InteractionMemory` is keyed by the main-process
  renderer principal plus conversation session, supports latest/previous Thai
  references, and rejects stale or pre-event references.
- `src/spatial-overlay-manager.js` creates a transparent frameless
  always-on-top BrowserWindow on the cursor's display. The overlay is sandboxed
  with `contextIsolation` and `nodeIntegration: false`, uses a capture token and
  isolated sender identity, and has bounded timeout, load-failure, owner-close,
  overlay-close, display-metrics-change, and display-removal cleanup.
- `renderer/spatial-overlay.html` and `renderer/spatial-overlay.js` use a local
  canvas with DPR-aware sizing, pointer source preservation for mouse/touch/
  stylus, active-pointer tracking, and pointer cancellation/lost-capture
  cleanup. The overlay never calls a provider and sends only bounded raw points;
  main remains authoritative for timestamps and geometry.
- `src/ipc-router.js` derives the spatial owner from `event.sender.id`, binds
  open/complete/cancel to the owner renderer and token, and passes only the
  validated context into the existing `ConversationCore` request. Final STT
  receives a main-process timestamp and voice/session metadata so a spatial
  mark made after the utterance cannot be used for that utterance.
- `src/core/conversation-core.js` labels spatial data as owner-authored
  pointing evidence rather than permission or proof of screen content. The
  existing Computer Use evidence path remains required for screen-dependent
  actions. No new provider or dependency was added.

The implementation is `IMPLEMENTED BUT NOT FULLY VERIFIED`: source contracts,
ownership, timestamp alignment, lifecycle, security settings, and regression
evidence pass, while physical transparent-window pointer drawing, mixed-DPI
behavior, and monitor-removal behavior need `MANUAL REVIEW REQUIRED` evidence.
The development Electron runtime opened the transparent overlay and displayed
the toolbar. The Computer Use drag probe was blocked by its transparent
foreground-window process-id limitation, so that limitation is not treated as
an application draw success.

### V2 spatial final package checkpoint (2026-08-23)

- The final package is `D:\SOLAT_V3\dist-verified-20260823-v2-spatial-v1`,
  produced with a direct `electron-builder` invocation into a unique output
  directory. The build did not copy `.env`.
- Package identity: EXE SHA-256
  `30F8C64508C6D016E24C07F47285205BDA395794C870457943069C3BC213DF43`; ASAR
  SHA-256 `419EBA2872D8E4224AA72FA5E7A75CBD628AB6239E82605BA2B0962B7A9229F5`.
  Parity is 17/17 for spatial/model/voice/security contracts, overlay HTML/JS/
  preload, and MP4/assets.
- Package privacy inventory found zero real `.env`, private-key, certificate,
  or credential files. The public `.env.example` is the only allowed env file.
- `reports/v2-spatial-packaged-startup-20260823-v1.json` is PASS after 6,000 ms:
  the process stayed alive, the harness initiated no provider request and
  injected no credential environment, and process/profile cleanup is PASS.
  Report SHA-256 is
  `E8721B9822BB9C5237275FF46773294753692781B3552C90ADF324D24F99A9B2`.
  Network-zero, packaged live provider/model execution, and physical pointer
  drawing remain `NOT VERIFIED` / `MANUAL REVIEW REQUIRED`.

## V3–V6 current checkpoint (2026-08-23)

- V3: a separate sandboxed Browser Workspace is created on demand. Main owns
  state and renderer identity; remote pages have no preload/Node privileges.
  Public HTTP/HTTPS, opaque target ids, navigation revisions, bounded semantic
  observations, safe takeover and canvas-only vision fallback are enforced.
  A stable owner profile preserves ordinary site sessions. Login/OAuth/challenge
  routes and password/OTP/payment inputs close every SOLAT observation, capture
  and action path. Google OAuth is never disguised or embedded: the current
  first-party page is opened in installed Chrome and the Chrome session remains
  outside SOLAT instead of copying OAuth URLs, cookies or tokens.
  Chrome remains a human-auth lane. After authentication, copied image bytes or
  a native image-file drag can enter the existing V4 SpatialAsset bridge; main
  decodes and bounds PNG/JPEG/WebP/GIF, rejects SVG/private URLs/over-8-MB data,
  and retains public source provenance when Chrome supplies it. No Chrome DOM,
  cookie, token or password-manager access is added.
- V4: immutable `SpatialAsset` originals feed a derived ghost and one protocol
  for mouse/touch/hand selection, hold, transform, surface switch, drop, cancel,
  provenance and latest-insertion memory.
- V5: renderer-local MediaPipe inference emits normalized landmarks only. Main
  validates at most two hands/21 landmarks, supplies display bounds, recognizes
  point/pinch/grab/drag/release and forwards semantic events to V4. Thread and
  renderer lifecycle cleanup are bounded.
- V6: bounded semantic voice/pointer/hand/screen/asset events are persisted
  atomically by owner/session, deduplicated, resolved for recent Thai/English
  references and attached to the existing Chat/Flash/Plus/tool path only as
  non-authoritative context. Production persistence uses the main-process
  profile principal `local-desktop-profile:v1`, while live Chat/Agent/tool
  authority remains bound to the current Electron sender. An integration test
  records a hand reference with sender 301, recreates the coordinator, resolves
  it with sender 777, and proves restart recovery without trusting renderer
  owner input.
- Owner help is available inside SOLAT through `Ctrl+G` -> `V3–V6 tutorial`;
  the full Thai guide is `docs/USER_TUTORIAL_V3_V6.md` and is packaged.

All check scripts PASS. Full regression: `512/512`, zero fail/skip/cancel/todo,
`70063.5678 ms`. Offline conversation/model evaluations, both benchmarks and
100/100/100/300 corpus preflights PASS. No live provider or camera was invoked.

Final package:
`D:\SOLAT_V3\dist-verified-20260824-v6-final-v6\win-unpacked`; EXE
`DF814DBF3E20C54DDCA19E938CD79ECDAD7F07469795677FE5DE0086F777B03C`; ASAR
`A812813205B230FBD39B6593D1E8B9F82BE58B3177815C4DCD1C1064793CD249`.
ASAR inventory: 993 entries, 64/64 non-asset JS/MJS/HTML source parity;
README, Thai V3–V6 tutorial, third-party notice and full Apache-2.0 license all
match source byte-for-byte.
MediaPipe model SHA-256:
`FBC2A30080C3C557093B5DDFC334698132EB341044CCEE322CCF8BCF3607CDE1`.
No real `.env`, key, certificate or credential filename was found; public
`.env.example` is allowed. The isolated 6,000 ms startup report is PASS with
process/profile cleanup PASS and no provider request initiated by the harness.
The packaged local detector initialization probe is PASS without camera or
provider access. `reports/v6-final-hand-detector-20260824-v4.json` records zero
baseline and detector-phase external HTTP requests in this bounded run; this is
not a broad all-runtime network-zero claim. MediaPipe WASM/model are explicit
ASAR-unpacked entries; main CSP allows local `wasm-unsafe-eval` but not general
JavaScript `unsafe-eval`. Isolated startup evidence is
`reports/v6-final-startup-20260824-v5.json` and cleanup is PASS.

Overall status: `IMPLEMENTED BUT NOT FULLY VERIFIED`. Physical camera gestures,
cross-window/application target acceptance, signed-in sites/CAPTCHA, acoustic
Voice and subjective interaction quality remain `NOT VERIFIED` /
`MANUAL REVIEW REQUIRED`.
