# Risk register — Model Foundation

อัปเดต 2026-08-22

| ID | Risk | Impact | Mitigation/evidence | Status |
|---|---|---|---|---|
| MF-01 | Semantic answer quality is not proven by deterministic routing tests | อาจเข้าใจผิดว่า router ผ่านแล้ว model ตอบดี | แยก `NOT VERIFIED` ใน evaluator; ห้ามสร้าง GPT parity score | OPEN |
| MF-02 | Ambiguous names can map to multiple real entities | อ้างข้อมูลผิดตัว | bounded candidates, canonical spacing/hyphen dedupe, ask clarification when unresolved | MITIGATED; more adversarial cases pending |
| MF-03 | Model emits malformed or repeated tool calls | loop/corrupt evidence | schema validation, tool identity checks, timeout and round caps | MITIGATED; cancellation tests pending |
| MF-04 | Search result is approved but not relevant | hallucinated grounding | URL allowlist, query-token relevance, ranking/dedup and truthful empty/degraded states | MITIGATED; broader corpus pending |
| MF-05 | External GitHub code/license/dependency risk | legal/security/maintenance debt | matrix review; no unverified code copied or installed | MITIGATED |
| MF-06 | Thai romanization/typo normalization may over-correct | wrong entity or lost user wording | preserve original message; only bounded spacing/hyphen variants; no invented correction | OPEN |
| MF-07 | Local tests do not cover provider-specific semantics | false confidence | paid/live provider tests intentionally marked `NOT VERIFIED` | OPEN |
| MF-35 | A Chrome bridge could expose personal authentication or browsing data | Credential/account compromise | Explicit owner pairing and current-tab adoption; localhost token + exact extension origin; auth/payment/secret/callback full-page shield blocks DOM/actions/screenshots/assets; no cookie/history API; isolated Browser Workspace remains fallback | MITIGATED BY CONTRACT; live signed-in-site review remains MANUAL REVIEW REQUIRED |
| MF-36 | Chrome changes tab/page during a screenshot or asset transfer | Private pixels or wrong-page bytes could cross the bridge | Check tab, navigation revision and privacy before and after screenshot; discard on race; re-check privacy in both extension and main process before asset import; bounded 8 MB streams | MITIGATED BY TESTED CONTRACT |
| MF-37 | Broad Chrome host permission is powerful | Compromised extension could inspect sites | Extension code is local, fixed-ID and has no remote endpoint/dynamic code/cookie/history API; semantic access is owner-adopted and sensitive surfaces fail closed. Chrome installation still requires explicit owner action | OPEN FOR MANUAL INSTALL/REVIEW |
| MF-38 | Agents SDK or custom-model protocol changes could break message/tool conversion | Chat may fail, lose tool results, or misreport completion after a dependency upgrade | Pin through `package-lock.json`; versioned adapter; malformed item/tool failures; plain/tool/context/isolation tests; tracing disabled; exact packaged source parity | MITIGATED FOR `@openai/agents` 0.17.0; future upgrades require regression and packaged verification |

## Live-evaluation update (2026-08-14)

- MF-01 is mitigated for the four bounded semantic categories exercised by the authorized live DeepSeek run; broader semantic quality and GPT parity remain open.
- MF-07 is mitigated for those same four cases by six provider requests with zero retries and preserved provider/model/latency/usage/raw-response evidence; this does not generalize beyond the captured run.

## Quality iteration update (2026-08-15)

- MF-08 (gateway character-set corruption): MITIGATED at the provider boundary with a narrow Windows-874 mojibake detector/repair and regression tests; live post-change semantic improvement remains NOT VERIFIED.
- MF-09 (ordinary chat over-search and over-expansion): PROMPT MITIGATION ADDED; requires rerunning the fixed 100-case corpus to verify tool/scope and task-fulfillment gains.
- MF-10 (paired benchmark context leakage): OPEN. Ten fixed cases refer to earlier/previous entities while declaring empty history; captured ChatGPT answers sometimes contain earlier-chat context. `npm.cmd run validate:paired100` now fails visibly instead of allowing an unfair semantic score.

## Runtime and capability update (2026-08-15)

- MF-11 (live capture evidence pending): OPEN/CONFIGURED BUT NOT VERIFIED. D:\SOLAT_V3 now has local DeepSeek/Brave configuration with boolean readiness true; no live provider evidence is recorded yet and secret values remain excluded.
- MF-12 (file parser scope): MITIGATED for bounded TXT/JSON/CSV only. Derived records are persisted with provenance/content hash and owner/project isolation; PDF/DOCX/XLSX/images remain `NOT VERIFIED` without a parser.
- MF-13 (agent production tool scope): MITIGATED FOR BOUNDED TOOLS. The production registry now exposes scoped text-workspace and selected Windows UIA tools. Every mutation is fingerprinted, persisted and approval-gated; arbitrary shell/process/registry/clipboard tools are not exposed.
- MF-14 (300-case evaluation evidence): OPEN. Manifest preflight is verified (300/300 references; local tests 159/159), but live execution and semantic scoring have not started.
- MF-15 (computer target sensitivity): MITIGATED/OPEN. Lock/login/credential/password and named sensitive windows are denied; actions bind to a current HWND and semantic selector. Broader sensitive-data classification, secure desktop and vision-only apps remain NOT VERIFIED and must fail closed.
- MF-16 (external WinApp CLI availability): MITIGATED ON THIS DEVICE. Microsoft WinAppCli v0.6.0 was installed with Winget hash verification. Missing executable, timeout, non-zero exit, oversized or malformed JSON are visible failures; a different machine requires the dependency to be installed.
- MF-17 (false computer-action success): MITIGATED AT CONTRACT BOUNDARY. `computer_set_value` now verifies the exact resulting value, and `computer_invoke` requires an explicit post-action selector/state checked through `wait-for`; a zero exit or truthy JSON object alone cannot produce `verified=true`. Real mutation coverage remains open because concurrent user input stopped the disposable-window smoke.

- MF-36 (Qwen3-VL-Flash API credential): MITIGATED FOR CURRENT RUNTIME. A
  dedicated `SOLAT_VISION_MODEL_API_KEY` is configured outside source control;
  one real composition-root grounding request succeeded. The key remains
  local, the route is explicit, and the Token Plan/Qwen Code key is never
  reused implicitly. Broader vision coverage remains open.

## Runtime and capability update (2026-08-21)

- MF-18 (Ollama compatibility route ignores `think:false`): MITIGATED. SOLAT now uses Ollama native `/api/chat` for `ollama_local`; the OpenAI-compatible route spent its response budget on hidden reasoning and left visible content empty. Direct routing and desktop UI inference pass after the repair.
- MF-19 (local planner latency): MITIGATED FOR BOUNDED ROUTES. Deterministic unknown-app Calculator reading now uses UIA only, zero provider calls, and completed in 2.136 s in the direct runtime smoke and 4.564 s through the real SOLAT UI. Qwen remains limited to compact simple-controller steps; deterministic Fast Path remains preferred.
- MF-20 (unknown-app read privacy): OPEN. Semantic UI inspection can expose visible text from a wrongly selected non-sensitive window. Geometry is removed before model calls and sensitive windows are denied, but tighter target selection/data minimization remains required.
- MF-21 (vision capability gap): BLOCKED WITH VERIFIED ALTERNATIVE. The exact SmolVLM Q4_K_M and F16 variants load, but four real screenshot requests (`raw` and `json_format`) returned descriptions/self-repetition rather than valid grounding JSON. UIA-first exact-window state is the production alternative and passed the 15-case real UI suite; tasks without adequate trusted UIA evidence escalate to DeepSeek where sufficient or fail visibly. Raw-coordinate execution and SmolVLM routing remain disabled.
- MF-22 (model mode isolation): OPEN. The selected model mode is process-global rather than session-scoped.
- MF-23 (secret-bearing package output): MITIGATED FOR CURRENT BUILD. The verified package contains `.env.example` only and no `.env`; machine-local runtime configuration remains external. Future packaging must continue using the direct unique-output builder command rather than the legacy script that copies local environment files.
- MF-24 (packaged parity): MITIGATED FOR CURRENT BUILD. The final unique-output executable completed Auto-to-Qwen chat, verified Chrome Fast Path, and normal Notepad launch/text entry through its packaged UI. Broader device/app parity remains open.
- MF-25 (stale Computer Use progress/state bleed): MITIGATED FOR COVERED LIFECYCLE. Renderer progress and terminal reconciliation now bind both `task_id` and `request_id`; terminal tombstones reject delayed events. The real 15-case sequential UI suite passes 15/15, including cancellation and multi-app return.
- MF-26 (duplicate external apps during startup/tests): MITIGATED. Plain SOLAT startup has no Chrome/Notepad/Calculator launch side effect. The live runner launches Calculator only for cases that declare that prerequisite, while the adapter reuses an existing Chrome/app window where safe. OS startup programs and unrelated user automation remain outside SOLAT control.
- MF-27 (real UI coverage boundary): OPEN. The current 15-case suite covers ordinary Chrome, YouTube, Notepad, Calculator, cancellation, unknown-app inspection and DeepSeek escalation, but not UAC, credential UI, secure desktop, games or vision-only canvas.
- MF-28 (latest packaged parity): MITIGATED FOR BUILD `dist-verified-20260821-204912`. The packaged executable passed local Qwen chat, Chrome Fast Path, Notepad Computer Use, and plain-startup isolation. Device-specific UIA behavior and apps outside the verified matrix remain open.
- MF-29 (YouTube false playback and duplicate tab): MITIGATED FOR BUILD `dist-verified-20260821-214041`. YouTube can expose stale Pause and Play controls together while `unstarted-mode` remains active. SOLAT now rejects that state, clicks the fresh Play control with bounded stale-element recovery, and clicks the selected result in the existing search tab instead of launching its URL again. Real packaged playback passes; adapter tests pass 39/39 and full regression passes 346/346.
- MF-30 (short Thai chat misclassified as named lookup): MITIGATED. Common Thai conversation/transform verbs are excluded from the conservative named-lookup heuristic. Real development UI latency dropped from 17.641 s with an unnecessary tool round to 3.472-5.679 s on fixed local-Qwen smokes; targeted tests pass 124/124 and full regression passes 368/368.
- MF-31 (Qwen 2B controller quality): MITIGATED FOR BOUNDED SIMPLE ACTIONS. A real Auto request returned a schema-valid `computer_open_website/google` step through the exact local model in 6.064 s. Strict schema validation, observed-target checks, approval gates, and DeepSeek fallback contain malformed or insufficient output. Complex, ambiguous, screen-reading, and cross-app decisions remain outside the local route.
- MF-32 (natural-language query suffix leakage): MITIGATED FOR VERIFIED THAI POLITENESS FORMS. The packaged approval now contains exact `Diana King`, not `Diana King ให้หน่อย`; the verifier extracts the actual tool JSON and requires exact equality. Broader paraphrase normalization remains deliberately conservative.
- MF-33 (final Qwen 2B package parity): MITIGATED FOR BUILD `dist-verified-20260822-full-prompt-final`. Packaged Qwen chat, exact Chrome search, Notepad entry, and startup isolation pass. The executable SHA-256 is `D7807C916DF37C64F2E8205A8AE68BBE9244B23A14BA681527BDB67A6A63443D`; the app archive contains no `.env`.
- MF-34 (Windows duplicate app HWNDs): MITIGATED. Windows 11 can expose Calculator as foreground `ApplicationFrameHost` plus one or more inner app HWNDs. Read-only matching now inspects every exact identity match and accepts only semantic value evidence; shell-only trees are ignored and differing values require clarification. Real UI Calculator passes in 4.564 s with zero provider calls.
- MF-35 (CDP smoke probe stall): MITIGATED IN TEST HARNESS. A stale Windows listener could accept `/json/list` without responding and make packaged verification hang before a case started. Both packaged smoke runners now apply a one-second per-request abort while retaining the bounded overall retry deadline.

- MF-37 (Roblox navigation scope): MITIGATED FOR ALLOWLISTED LANDING PAGE. The
  planner, tool schema, adapter, and title verification now agree on Roblox.
  Authentication, account selection, gameplay, purchases, and credential entry
  remain outside the trusted capability boundary and are not claimed as working.

## Qwen3.7 model migration risks (2026-08-23)

- MF-48 (Plus gains execution or final-answer authority): MITIGATED AT THE ROUTER
  BOUNDARY. `qwen_flash_plus.v1` permits Qwen3.7 Plus to return bounded advice only;
  Qwen3.7 Flash remains the Agent/Executor for all final, structured and tool-loop
  output. Advice cannot override tool schemas, approval, ownership or verified evidence.
- MF-49 (retired model path remains reachable): MITIGATED AT CONFIG/STARTUP/ROUTING
  BOUNDARIES. Active DeepSeek, RunPod and local/Ollama settings are no longer composed
  or selected. Legacy `local` and `deepseek` mode values normalize to the single `auto`
  architecture without launching a retired runtime. Source/contract checks pass;
  packaged migration behavior remains NOT VERIFIED.
- MF-50 (provider-specific structured/tool regression): MITIGATED FOR ONE BOUNDED LIVE
  RUN. `reports/model-routing-qwen37-20260823-v4.json` passes four cases and six calls
  in 46,367 ms: plain 2,462 ms, structured 2,874 ms, Plus-advice then Flash 38,674 ms,
  and Flash tool loop 2,357 ms. The tool was a no-side-effect in-memory read fixture
  and final content was present. Response content, credentials and error messages were
  omitted. The v3 failed artifact is diagnostic only (SHA-256
  `37590608A8E4C285CD8B1185BA86F98E933ECC6FBBC3AC2AEEA661BAFB26D120`); accepted v4
  SHA-256 is `E15FECB41E8D44D7079F3C4DB8EFE1DEC0A8DEE51CB5838236F3E813699B67F2`.
- MF-51 (text/vision role confusion): MITIGATED AT CONFIG AND ROUTER CONTRACT.
  Qwen3-VL-Flash remains a separate bounded `qwencloud_vision` path; it is not used as
  the Qwen3.7 Flash Agent/Executor or Plus adviser.
- MF-52 (migration rollback loss): MITIGATED FOR IMMUTABLE V1 ARTIFACTS. The Voice V1
  rollback EXE hash remains
  `767BB75439291345F346CF9411AA94CD9406845985D1CD082EF494271C9832DA`; ASAR remains
  `5D680C99A6B58A82CAE87E5AC588CC3D6497B62B4F0F5BEA9A7A6E35C2A91879`.
- MF-53 (development evidence mistaken for packaged acceptance): OPEN. Non-live checks,
  final 411/411 regression and the bounded source-live provider report pass. The
  immutable model-only V2 checkpoint started with an isolated profile, remained alive
  for 6,000 ms and cleaned up
  its process/profile; the harness initiated no provider request and injected no SOLAT
  provider credential environment. Network-zero evidence was not captured; exact source
  parity shows startup itself does not initiate a model request.
  `dist-verified-20260823-qwen37-model-v2` passes its own
  parity/privacy audit: 947 ASAR entries, exact 12/12 scoped source parity, zero active
  legacy startup/config scan matches, only an empty-credential public `.env.example`,
  no real `.env`/certificate/private-key/secret file, and zero remaining process/profile
  artifacts after cleanup. Startup report SHA-256 is
  `ADE72DFE23BC998EDB2436D1DDE85846529686ED09A7185E2888DEAF613ADD69`; harness script
  SHA-256 is `E5EB9E29DB38A59534F9BC5EF78E8F4CDA113E85CCE142CCEDFF5C285E412E6C`.
  The combined `dist-verified-20260823-qwen37-voice-combined-v1` package separately
  passes startup, 44/44 non-asset runtime parity, 15/15 key parity, 2/2 Voice MP4
  parity, privacy and active legacy scans. Its EXE/ASAR hashes are
  `54ADA6740AE474967786611D43808CCF6A1B3E28B37889F11B4B3504E5BD6692` and
  `28F7568A1D0C228EF4F9C4AD67B33FE6323BDD23BB78023B914EABE1B03507B3`.
  A live packaged provider/model/tool call remains NOT VERIFIED; network-zero evidence
  was not captured. Full packaged inference and broad semantic quality still await
  evidence and human review.

## Voice Core V1 risks (2026-08-23)

- MF-38 (live voice provider parity): MITIGATED FOR ONE BOUNDED PROVIDER LOOP.
  The owner-authorized Cartesia smoke passed with Ink 2 and Sonic using Elias
  (`6a176356-ada1-4b48-b2ae-3a3fdd485680`): TTS returned 268,128 bytes of 44.1 kHz
  PCM in 812 ms and streaming STT returned the exact final transcript
  `Hello, this is the Solat voice verification.` in 4,817 ms. Evidence is
  `reports/voice-live-v1-20260823-v5.json`. This does not establish broad transcript
  accuracy, quota behavior, production latency or subjective voice quality.
- MF-39 (device audio behavior): PARTIALLY MITIGATED. Packaged OS-selected microphone
  capture is PASS: its live/running 48 kHz track produced 18/18 non-zero processor
  frames and 15 secure IPC pushes / 288,000 PCM bytes reached live Cartesia STT without
  provider error. Audible speaker playback, acoustic echo/noise behavior, permission
  dialog UX, device switching and a physical multi-turn conversation remain NOT VERIFIED.
- MF-40 (voice audio memory/IPC pressure): MITIGATED FOR V1 BOUNDS. Capture sends
  100 ms PCM chunks, caps the pending queue at eight and rejects chunks above 256 KiB;
  full-buffer TTS is rejected above 16 MiB using both declared and actual byte length.
  Long-session CPU/memory behavior on real hardware remains NOT VERIFIED.
- MF-41 (voice/session crossover): MITIGATED AT CONTRACT BOUNDARY. Each voice session
  is claimed by one Electron sender, events are filtered to the versioned provider
  contract, and final utterance ids are deduplicated. Destroyed/closed senders release
  ownership and trigger best-effort STT/TTS cancellation. Deterministic tests cover
  both sender `destroyed` and `closed`: all sessions belonging to that sender are
  cancelled/released, another sender is untouched, and released ownership can be
  reclaimed. Multi-window live stress remains NOT VERIFIED.
- MF-42 (cancellation and barge-in timing): MITIGATED FOR PACKAGED SILENT PROCESSOR
  PATH. During live packaged Cartesia TTS generation, two injected RMS 0.2 frames at
  the production 0.08 threshold moved from pending `speaking` to `interrupted` in
  0.5 ms, `listening` in 158.2 ms and `user_speaking` in 170.1 ms. Calls were exactly
  TTS cancel 1, STT cancel 1 and STT start 2; the session rotated, conversation was
  preserved, and no `Audio` object was constructed or played. The existing model
  request can still finish after a UI stop. Acoustic echo/barge-in over audible speaker
  output remains NOT VERIFIED.
- MF-43 (voice lifecycle race or lost busy final): MITIGATED AT REGRESSION BOUNDARY.
  A busy final waits for Chat to become idle, while exit/re-entry is serialized;
  failed microphone initialization rolls back tracks/nodes/context/subscription and a
  suspended `AudioContext` is resumed. A lifecycle generation now invalidates pending
  enter work: late microphone initialization cannot revive/leak resources and a late
  STT start is cancelled without returning to listening. Targeted UI/Voice regression
  passes 22/22 and the final suite passes 411/411. Physical device and reload stress
  remain NOT VERIFIED.
- MF-44 (spoken-language selection): MITIGATED AT ROUTING CONTRACT. Thai-script
  assistant text selects `th`; an explicit configured voice language overrides the
  renderer/request selection. Subjective Elias Thai pronunciation remains NOT VERIFIED.
- MF-45 (final Voice package parity and secret leakage): MITIGATED FOR BUILD
  `dist-verified-20260823-voice-v1-final`. Final syntax, Voice syntax, 402/402 full
  regression and diff checks pass; ASAR parity passes 15/15 Voice plus 10/10 integration
  checks and contains Cartesia 4.0.1. The unpacked tree contains zero real `.env` files;
  only the public `.env.example` is allowed in the archive. The isolated-profile startup
  reached a responsive titled main window with environment configuration injected in
  process memory without printing secrets. The packaged silent run also passed resource
  cleanup and removed its process, localhost CDP port and isolated profile. Remaining
  physical audio limitations are tracked in MF-39.
- MF-46 (test instrumentation exposure): MITIGATED FOR THE VERIFIED PACKAGE. The silent
  probe bound CDP only to `127.0.0.1:9223` with test-launch flags
  `--remote-debugging-address` and `--remote-debugging-port`; production source and the
  packaged ASAR contain no CDP flag. The process, port and isolated user profile were
  removed after the run. Future runtime probes must retain these bounds.
- MF-47 (integrated packaged Voice turn): MITIGATED FOR ONE SYNTHETIC SILENT TURN.
  `reports/voice-packaged-e2e-v1-20260823.json` exercised the exact final package over
  test-only localhost CDP port 9224: injected Cartesia PCM produced final transcript
  `Please reply with` at 7,465.6 ms from trace start; Chat storage and DOM contained
  that exact final, DeepSeek completed with no assistant error, and the exact
  352-character assistant source/hash—not the 347-character rendered DOM—was sent to
  TTS as `en-US`. Live Cartesia TTS returned one valid 1,869,918-byte WAV.
  State returned from pending/audio-ready `speaking` to `listening`; conversation id was
  preserved, voice session rotated, and cleanup passed. Playback used a silent in-memory
  test sink, and input was not spoken by a person. Physical human input, audible output,
  acoustic echo, permission UX, device switching, subjective quality and physical
  multi-turn behavior remain NOT VERIFIED. The longer seed was only partially
  transcribed, so exact STT semantic accuracy also remains NOT VERIFIED. Report SHA-256:
`8A7853999BF330267D2052E8DA7193F852DACA17206C3104D05F3C0520E973AC`.

- MF-48 (Voice credit amplification): MITIGATED AT DETERMINISTIC CONTROLLER
  BOUNDARY. Root causes were silence frames being sent continuously to STT and
  missing per-request TTS deduplication. VAD now sends speech plus a bounded
  five-frame tail, TTS keys requests by context/text fingerprint, and all STT/TTS
  lifecycle events emit redacted `solat.voice-usage-debug.v1` telemetry. Voice
  tests and full regression pass; real Cartesia billing reduction remains NOT
  VERIFIED until a separately authorized live credit comparison.

## V2 spatial interaction risks (2026-08-23)

| ID | Risk | Impact | Mitigation/evidence | Status |
|---|---|---|---|---|
| SP-01 | Renderer/session spoofing or cross-window spatial capture | One window could attach another window's mark to a chat turn | Main derives `renderer:<sender.id>` ownership; capture token, overlay webContents identity, owner/session checks, and cross-sender tests protect open/complete/cancel and context lookup | MITIGATED AT IPC CONTRACT |
| SP-02 | Voice mark and spoken utterance use different times | A later mark could ground an earlier voice request | Main timestamps final STT receipt; same-owner/session transcript metadata is validated and consumed; focused timestamp alignment tests pass | MITIGATED AT TIMESTAMP BOUNDARY |
| SP-03 | Malformed/extreme geometry or retained-memory growth | Model receives false geometry or the process accumulates unbounded events | Versioned schema, finite/size/timing/display bounds, 2,048-point and 32-event caps, 128-session cap, deep clone/freeze, and rejection tests | MITIGATED FOR CONTRACT BOUNDS |
| SP-04 | Overlay lifecycle leaks or stale transparent windows | Input remains captured after close, display change, sender loss, or failed load | Timeout, owner/overlay cleanup, display metrics/removal listeners, load-failure cleanup, token binding, and lifecycle tests | MITIGATED FOR TESTED LIFECYCLE |
| SP-05 | Physical transparent-window drawing across real DPI/display changes | A pointer could be offset, blocked, or rendered incorrectly on a user's desktop | DPR-aware renderer and display-local coordinates are implemented; runtime opened the transparent overlay and showed its toolbar, but Computer Use drag was blocked by its transparent-window process-id limitation | OPEN — MANUAL REVIEW REQUIRED / NOT VERIFIED |
| SP-06 | Model treats a mark as authority or current screen truth | An agent could act on stale/ambiguous content | Conversation instruction explicitly labels spatial data as pointing evidence and requires current Computer Use evidence for screen-dependent actions | MITIGATED AT PROMPT/TOOL BOUNDARY |
| SP-07 | External reference code or license is copied into the runtime | Legal, security, and maintenance debt | Relay, PromptShot, ai_screen_assistant, and Konva were audited as reference material only; no code or dependency was added | MITIGATED FOR THIS CHECKPOINT |

### Final spatial package evidence (2026-08-23)

- SP-08 (package drift or secret-bearing output): **MITIGATED FOR THE FINAL
  CHECKPOINT**. Direct `electron-builder` output
  `D:\SOLAT_V3\dist-verified-20260823-v2-spatial-v1` has EXE SHA-256
  `30F8C64508C6D016E24C07F47285205BDA395794C870457943069C3BC213DF43` and ASAR
  SHA-256 `419EBA2872D8E4224AA72FA5E7A75CBD628AB6239E82605BA2B0962B7A9229F5`.
  Parity is 17/17 across spatial/model/voice/security, overlay HTML/JS/preload,
  and MP4/assets. The direct build did not copy `.env`; the inventory found zero
  real `.env`, private-key, certificate, or credential files and only the public
  `.env.example`.
- SP-09 (packaged startup mistaken for live acceptance): **OPEN**. The isolated
  startup report `reports/v2-spatial-packaged-startup-20260823-v1.json` is PASS
  after 6,000 ms with the process alive, no harness provider request or
  credential environment, and process/profile cleanup PASS. Network-zero,
  packaged live provider/model behavior, and physical pointer behavior remain
  `NOT VERIFIED` / `MANUAL REVIEW REQUIRED`.

## V3–V6 residual risks (2026-08-23)

| ID | Risk | Mitigation/evidence | Status |
|---|---|---|---|
| MM-01 | Remote page reaches SOLAT privileges/local network | Separate sandboxed view, no remote preload/Node, public-HTTPS validation, popup/download/permission/navigation denial | MITIGATED AT TESTED BOUNDARY |
| MM-02 | Stale/forged browser target causes a mutation | Opaque targets, current observation, navigation revision, takeover interruption and existing approval/postcondition authority | MITIGATED AT TESTED BOUNDARY |
| MM-03 | Spatial original/provenance is lost | Immutable id/hash, derived ghost, transfer/insertion chain and stale-target fail-closed | MITIGATED AT CONTRACT BOUNDARY |
| MM-04 | Camera leaks images or stays active | Opt-in renderer inference, landmark-only IPC, no image persistence, thread/sender/resource cleanup tests | IMPLEMENTED; PHYSICAL CAMERA NOT VERIFIED |
| MM-05 | Multi-display hand coordinates drift | Main supplies true display origin/size and renderer converts to window-local CSS coordinates | MIXED-DPI PHYSICAL TEST NOT VERIFIED |
| MM-06 | Multimodal memory leaks, becomes unreachable after Electron restart, or expands authority | Profile-stable main-process persistence owner plus session key; live renderer is still authenticated separately; schema/allowlist/bounds/checksum/atomic persistence/dedupe; context explicitly non-authoritative; restart integration changes sender 301→777 and restores the same semantic reference | MITIGATED AT TESTED BOUNDARY |
| MM-07 | Protocol drop is mistaken for external-app acceptance | Evidence records only SOLAT protocol insertion; external acceptance is not claimed | OPEN — MANUAL REVIEW REQUIRED |
| MM-08 | Auth/CAPTCHA/site changes break Browser Workspace | Login/OAuth/challenge routes and credential inputs fail closed; ordinary user-entered site login may persist locally; Google OAuth is handed to real Chrome without UA spoofing or cookie/token transfer | OPEN / LIVE SIGNED-IN COMPATIBILITY NOT VERIFIED |
| MM-09 | MediaPipe/model supply chain drifts | Exact dependency 1.0.1; official immutable model URL/size/SHA; no runtime model download; packaged third-party notice and full Apache-2.0 license | MITIGATED FOR FINAL PACKAGE |
| MM-10 | A crash is mistaken for restoration of transient visual state | V6 restores bounded semantic interaction memory; an active ghost, open Browser window and renderer-only Blue insertion preview are intentionally transient and are not claimed as recovered UI | OPEN — MANUAL WORKFLOW REVIEW REQUIRED |
| MM-11 | Chrome image handoff leaks credentials or imports an untrusted network target | Handoff accepts only owner-pasted/dropped image bytes; main decodes bounded raster formats, rejects SVG, local/private provenance and data over 8 MB; it never fetches the URL or reads Chrome DOM/cookies/tokens | MITIGATED AT TESTED IPC/DECODE BOUNDARY; PHYSICAL CROSS-WINDOW DRAG NOT VERIFIED |
| MM-12 | Full-tab discovery leaks a private tab or lets the Agent invent a raw Chrome tab id | Extension classifies before activation; shielded/unsupported entries omit title and URL; main replaces raw ids with owner/session opaque refs; switching requires current listed evidence and approval | MITIGATED AT DETERMINISTIC CONTRACT; LIVE MULTI-TAB REVIEW REQUIRED |
| MM-13 | A huge tab set causes unbounded work or silently disappears | Extension pages at 100; main caps one list at 1,000 and returns total_count/truncated truthfully | MITIGATED AT RESOURCE BOUNDARY |
| MM-14 | Cursor claims SOLAT control on a protected or disconnected page | Indicator installs only after authenticated local pairing on a public page; disconnect and privacy mutation remove it and restore native cursor | MITIGATED AT TESTED LIFECYCLE; PHYSICAL CHROME REVIEW REQUIRED |
