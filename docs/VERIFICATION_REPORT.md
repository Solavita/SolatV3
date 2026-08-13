# SOLAT V2 verification report

Last checked: 2026-08-12 12:05:00 +07:00

## Current checkpoint (2026-08-12)

| Check | Status | Evidence | Boundary |
|---|---|---|---|
| Current deterministic regression | PASS | `npm.cmd test`: 95/95 tests pass | This does not establish subjective answer quality |
| Current conversation/search corpus | PASS | `npm.cmd run evaluate:conversation`: 24 PASS, 0 FAIL, 1 NOT VERIFIED | The remaining row is live semantic parity and intentionally requires external evidence |
| Current syntax/build | PASS | `npm.cmd run check` and `npm.cmd run build` pass; packaged `dist/win-unpacked/SOLAT.exe` starts successfully | Visual/source-quality review remains separate |
| Current tool-loop safety | PASS | Milestone 133: semantically repeated tool calls are bounded before `tool_loop_limit` | A provider that keeps requesting genuinely new tools can still hit the configured cap |
| Current overall Milestone 19 status | IMPLEMENTED BUT NOT FULLY VERIFIED | Context routing, ambiguity hints, source priority, evidence metadata, bounded corroboration, and three-way capture infrastructure are implemented | Live semantic parity with ChatGPT and broad current-revision quality remain `NOT VERIFIED` |

## UI parity and boundary

| Criterion | Status | Exact action | Evidence | Limitation |
|---|---|---|---|---|
| V1 static controls exist in V2 | PASS | `npm.cmd test` | `test/ui.test.js` inventories every V1 button id | Pixel-level visual parity still needs manual review |
| V1 dynamic Music controls exist and are wired | PASS | `npm.cmd test` | `data-music-*`, `data-solat-*`, `data-thinking` inventory plus renderer action paths | Service calls remain intentionally outside Milestone 1 |
| V1 answer rendering controls | PASS | `npm.cmd test` + `npm.cmd run check` | markdown code blocks have Copy, tables render as tables, and approved source blocks use a disclosure panel | Token-by-token streaming is not in this milestone |
| Source disclosure policy is preserved | PASS | static check + renderer path | `SOURCE_ALLOWLIST_HOSTS`, `splitSourceBlock`, `sourceDisclosure` in `renderer/renderer.js` | Only source blocks returned by a provider can be displayed |
| Thinking/stop state is visible and cleared | PASS | `npm.cmd test` + renderer check | `data-thinking` node is added only while the IPC request is active; cleanup clears the controller before the final render so no orphan bubble remains | No token streaming in this milestone |
| Packaged UI spot check after response | PASS | Activated packaged `SOLAT.exe`, captured the visible window, and inspected the rendered conversation | One assistant answer was visible and the composer followed it directly; no second SOLAT thinking bubble was present | This is a targeted regression check, not a full pixel-by-pixel review of every V1 screen |
| Packaged UI → IPC → real provider → UI E2E | PASS | Opened the current packaged app in an isolated profile; entered the exact prompt through `#input`, invoked `#sendBtn`, and inspected the visible renderer result | `SOLAT_UI_E2E_OK` appeared in the UI from `deepseek-v4-flash`; error count was 0 and the visible thinking node was absent after completion | A test-only Chrome debugging port was used only for inspection; normal SOLAT starts without a port |
| Renderer does not open a manual port | PASS | `npm.cmd test` | no `fetch`, localhost, or loopback port in renderer | IPC requires the packaged Electron runtime |

## Runtime and provider

| Criterion | Status | Exact action | Evidence | Limitation |
|---|---|---|---|---|
| JavaScript/static checks | PASS | `npm.cmd run check` | all main/preload/core/renderer files parse | none observed |
| Regression suite | PASS | `npm.cmd test` | 95/95 deterministic tests passed, including completed-turn thinking cleanup, V4 non-thinking request shaping, tool-call handling, context/source disclosure, creative schema/layout, search boundary, asset storage, export, persistence, conversation recovery, and UI contracts | deterministic tests do not prove subjective answer quality |
| One-command development startup | PASS | `npm.cmd run dev -- --user-data-dir=<isolated-test-profile>` | Electron development window started successfully; the isolated process tree and profile were removed after the check | Test profile was isolated so the user's running app was not changed |
| Packaged build | PASS | `npm.cmd run build` | electron-builder 26.15.3 produced `dist/win-unpacked`; its local untracked `.env` was copied beside `SOLAT.exe` for immediate local use | Remove the copied `.env` before sharing the folder; default Electron icon remains |
| Real DeepSeek smoke request | PASS | one request, no retry: `Reply with exactly SOLAT_PROVIDER_SMOKE_OK.` | provider `deepseek_api`, model `deepseek-v4-flash`, exact response, 18 prompt + 10 completion tokens; V4 uses explicit non-thinking mode | one smoke request is not a benchmark |
| Packaged env safety | PASS | post-build presence check | `PACKAGED_ENV_KEY_PRESENT=True`; key value was never printed | secret is local-only and ignored by git |
| Dependency audit | PASS | `npm.cmd audit --audit-level=high` | 0 vulnerabilities reported | audit reflects the current lockfile only |

## GitHub environment

| Criterion | Status | Evidence | Limitation |
|---|---|---|---|
| V2 CI workflow prepared | PASS | `.github/workflows/ci.yml` runs `npm ci`, `npm run check`, and `npm test` on Windows | none |
| V2 GitHub environment prepared safely | PASS | V2 has its own Git repository, Windows CI workflow, `.gitignore`, focused commits, and secret scan passed | Remote push is deliberately deferred until an exact repository target is supplied; the initial rebuild prompt says a clean V2 repository/branch is sufficient |

Overall Milestone 1 status: `VERIFIED COMPLETE`.

The optional remote connection remains an owner-controlled follow-up and is not
needed to claim this milestone complete. No V1 origin was reused silently.

## Post-Milestone 1 shared foundation (2026-08-11)

| Criterion | Status | Exact action | Evidence | Limitation |
|---|---|---|---|---|
| Versioned domain contracts exist | PASS | Added `src/core/contracts.js` and `docs/DOMAIN_CONTRACTS.md` | Project, Creative Brief, Emotion Profile, Narrative Plan, Design System, Creative Document, Asset, Job and Quality Report constructors validate required fields and expose schema versions; the contracts are used by the planning and export paths | Persistent database recovery remains unverified |
| Project/job state transitions are explicit | PASS | Added transition tables and `transitionProject`/`transitionJob` | Invalid transitions and successful jobs without outputs fail deterministically in `test/core.test.js` | No persistent database adapter yet |
| Ownership and immutable original asset rules | PASS | Added owner/session fields, immutable project snapshots, asset class/hash/parent/transform metadata | Contract tests verify owner/session fields, frozen objects, original asset flag and derived parent relationship | Cross-process storage/access-control verification remains pending |
| Conversation path uses job/idempotency state | PASS | Wired `SessionWorkspace` into `ConversationCore` and passed a renderer request ID | `npm.cmd test` verifies project/job/trace IDs, replay of completed request IDs and truthful retryable failure state | Long-running creative jobs and recovery UI are not wired yet |
| Deterministic checks after foundation change | PASS | `npm.cmd run check`; `npm.cmd test`; `git diff --check` | JavaScript syntax passes; 39/39 tests pass; no whitespace errors | These tests do not prove provider quality, visual quality, or full flagship completion |
| Original asset storage adapter | PASS | `npm.cmd test` asset-store case | `AssetStore` writes immutable original bytes and manifest under owner/project/asset isolation, records SHA-256 and relative storage reference, verifies bytes on read, rejects ownership mismatch, and records deletion intent without deleting bytes | Export fidelity and cross-process production storage recovery remain NOT VERIFIED |

Current broader V2 status: `IMPLEMENTED BUT NOT FULLY VERIFIED`.
The planning slice is now connected; the next required path is deterministic preview/export plus original-asset and targeted-revision verification before any completion claim.

## Music-to-Deck planning vertical slice (2026-08-11)

| Criterion | Status | Exact action | Evidence | Limitation |
|---|---|---|---|---|
| Structured planning provider boundary | PASS | Added `OpenAICompatibleProvider.completeStructured` with JSON response mode and strict object parsing | `test/core.test.js` verifies `response_format: {type: "json_object"}` and malformed JSON failure | One real provider response has not yet been used for the creative schema |
| Brief -> Emotion DNA -> narrative -> design -> editable document | PASS | Added `CreativeWorkflow` and `solat:create-deck` secure IPC path | Deterministic workflow test returns all five validated artifacts and `READY_FOR_EDIT`; the renderer action and HTML export IPC are wired | A packaged click-through of this newer workflow remains unverified |
| Quality gate and honest failure | PASS | Added deterministic document checks and `QualityReport.human_review_required` | Valid path emits a quality report; provider failure leaves `FAILED_RECOVERABLE` project and terminal job with no outputs | Visual quality and export validity remain `MANUAL REVIEW REQUIRED` |
| Music UI action is connected | PASS | `Generate deck` action opens a structured input surface and calls `window.solat.createDeck` | Renderer source contains goal/audience/slide count/music payload and visible result/error state | Full computer-use UI run after this change is pending |

Current broader V2 status remains `IMPLEMENTED BUT NOT FULLY VERIFIED`: the first planning slice and original-asset storage adapter are implemented, but deterministic renderer/export, targeted revision, search grounding, and the full benchmark evidence package are still required by the larger prompt.

## Editable export checkpoint (2026-08-11)

| Criterion | Status | Exact action | Evidence | Limitation |
|---|---|---|---|---|
| Deterministic editable HTML export | PASS | `npm.cmd test` exporter cases | `src/core/exporter.js` validates canvas/geometry, escapes content, preserves asset refs, locks and provenance, writes `index.html` plus `manifest.json`, and rejects overwrite of the same revision | PPTX/PDF export is not implemented |
| Export IPC boundary | PASS | `npm.cmd test` UI contract + source inspection | `solat:export-html` is exposed only through preload and resolves a session-owned creative result; output is written under Electron user data | Packaged UI click-through is pending |
| Export failure truthfulness | PASS | `npm.cmd test` exporter cases | Missing assets, unsafe URLs, overflow and duplicate revision fail with structured error codes; no success output is fabricated | Cross-process recovery after app restart is NOT VERIFIED |

Current broader V2 status remains `IMPLEMENTED BUT NOT FULLY VERIFIED`: the first
editable export path is implemented, but packaged visual opening, targeted revision,
search grounding, audio analysis, and full benchmark evidence are still pending.

## Conversation routing and tool-call boundary (2026-08-11)

| Criterion | Status | Exact action | Evidence | Limitation |
|---|---|---|---|---|
| Context-preserving intent hints | PASS | `npm.cmd test` router/conversation cases | `src/core/intent-router.js` emits versioned candidates, confidence, recency, allowed tools and safety constraints; `ConversationCore` sends the full original message and prior turns plus advisory hints | Heuristics are advisory and not a semantic quality benchmark |
| Model-first general/ambiguous path | PASS | `npm.cmd test` intent-router case | `routing.hard_gate=false`; general and ambiguous inputs remain `model_first` | No live provider quality comparison in this checkpoint |
| OpenAI-compatible tool-call validation and loop bound | PASS | `npm.cmd test` provider tool-call case | `extractToolCalls` validates names/JSON arguments; `completeWithTools` uses `tool_choice=auto`, appends tool results, and stops at a bounded round count | Tool availability is still constrained by the approved source allowlist |

## Search adapter checkpoint (2026-08-11)

| Criterion | Status | Exact action | Evidence | Limitation |
|---|---|---|---|---|
| Search provider boundary | PASS | `npm.cmd test` local HTTP search case | `WebSearchService` supports SearXNG, Brave, DuckDuckGo and Wikipedia adapters without putting provider calls in the renderer | Default is no-key DuckDuckGo with Wikipedia fallback; an owner may still disable it |
| Source safety and evidence ranking | PASS | `npm.cmd test` web-search case | HTTP(S) allowlist, canonical URL deduplication, authority/query ranking, and source metadata are applied before results reach a tool call | Allowlist is intentionally narrower than the open web |
| Search degraded-state reporting | PASS | `npm.cmd test` web-search case | Disabled, empty, ready, degraded and unavailable states are represented explicitly; unsafe and malformed responses fail truthfully | No paid/live search request was made in this checkpoint |
| Search + model route and source disclosure | PASS | `npm.cmd test`; live DeepSeek action 2026-08-11 | Intent hints expose `web_search`; the model receives `tool_choice=auto`, search metadata returns through IPC, and the renderer displays approved sources; a real `deepseek-v4-flash` call selected the tool and returned 5 Wikipedia sources | This proves the boundary and visible evidence path, not parity with any other model or search quality across all queries |
| Packaged source disclosure E2E | PASS | Rebuilt `dist/win-unpacked`, opened an isolated packaged window, submitted a tool-backed prompt, and inspected the renderer | The completed UI had five approved Wikipedia links in its Sources disclosure, no visible thinking node, and no error node | The isolated inspection window was closed after the check; normal SOLAT does not require a debugging port |

## Creative workflow packaged checkpoint (2026-08-11)

| Criterion | Status | Exact action | Evidence | Limitation |
|---|---|---|---|---|
| Original asset immutability and owner/session boundary | PASS | `npm.cmd test`; packaged renderer IPC action | `AssetStore` persists bytes plus SHA-256 under owner/project/asset isolation; the packaged renderer stored a 5-byte original and returned its hash without exposing a filesystem path or secret | Cross-process recovery after a full app restart remains NOT VERIFIED |
| Real structured creative plan | PASS | One `deepseek-v4-flash` action | A one-slide photosynthesis brief produced Emotion DNA, narrative, design and editable document with `READY_FOR_EDIT`; schema and deterministic layout checks completed | The model is not used to determine geometry; visual quality is not proven by this run |
| Real editable HTML export with provenance | PASS | One real structured-plan-to-export action | `index.html` and `manifest.json` were created; manifest recorded creative result id, `deepseek_api`, and `deepseek-v4-flash` provenance | The exported HTML was structure-validated; subjective visual quality remains `MANUAL REVIEW REQUIRED` |
| Packaged secure IPC creative E2E | PASS | Rebuilt `dist/win-unpacked`; used the packaged renderer bridge to call `createDeck` then `exportHtml` in one session | Returned `READY_FOR_EDIT`, one editable slide, and revision-1 HTML/manifest paths from the actual packaged Electron process | This verifies the secure renderer/preload/main/core route; a human UI click-through and visual review remain `MANUAL REVIEW REQUIRED` |

## Milestone 4 — creative workspace UI checkpoint (2026-08-11)

| Criterion | Status | Exact action | Evidence | Limitation |
|---|---|---|---|---|
| Generate action shows a real plan in the owner UI | PASS | Built the latest package, opened an isolated packaged window, entered `calm piano`, filled the visible deck form, and submitted it | The dialog showed `Plan ready: 1 editable slides · status READY_FOR_EDIT`; the conversation showed the real `deepseek-v4-flash · deepseek_api` metadata and no error node | One live brief is not a quality benchmark |
| Preview action shows the stored plan | PASS | Clicked the visible `Preview slides` action after generation | The preview dialog showed `Status: READY_FOR_EDIT`, `Emotion confidence: 0.8`, `s01: opening · 14 editable elements`, and the explicit manual-review notice | The dialog is a structural plan preview, not a rendered visual-quality approval |
| Revision action uses the current session and preserves the prior plan | PASS | Set the visible revision prompt to `Make the explanation shorter and more visual.` and clicked `Revise slides` | The conversation showed `Derived revision ready: 1 editable slides. The prior plan remains unchanged.` with `deepseek-v4-flash · deepseek_api`; no error node appeared | Revision quality still needs human review |
| Export action uses the derived revision through secure IPC | PASS | Closed the preview, clicked visible `Export deck`, then inspected the UI and generated files | The UI showed `Editable HTML exported for review` and `Editable HTML export created.`; `index.html` (17,372 bytes) and `manifest.json` (11,830 bytes) were created, and manifest provenance recorded `revision_of`, provider `deepseek_api`, and model `deepseek-v4-flash` | Export was HTML only; opening/rendering the exported artifact and subjective visual quality remain `MANUAL REVIEW REQUIRED` |
| Packaged UI error honesty | PASS | Inspected the completed UI after Generate, Preview, Revision, and Export | `errors=0`; no fabricated success was shown; status/quality limitation remained visible | Full restart recovery and multi-window isolation remain unverified |

Milestone 4 status: `IMPLEMENTED BUT NOT FULLY VERIFIED` for the broader creative
quality objective. The requested UI control path is verified, while visual quality,
export rendering fidelity, and multi-session/restart recovery still require manual or
broader evidence.

## Milestone 5 — revision history and safe export opening (2026-08-11)

| Criterion | Status | Exact action | Evidence | Limitation |
|---|---|---|---|---|
| Revision history is visible and immutable | PASS | Built the latest package, generated a plan, revised it, then opened the visible `Revision history` action | UI listed Revision 1 as the original plan and Revision 2 as `derived from <revision-1-id>`; the earlier plan remained unchanged | History is currently session-scoped in memory |
| Export output can be opened from the workspace | PASS | Exported the derived revision, then clicked visible `Open exported HTML` | The UI showed `Opened the editable HTML export.`; `shell.openPath` was reached through `window.solat.openExport` and no error node appeared | OS/browser handoff is verified as a successful launch request, not a pixel review of the external browser window |
| Open-export path is constrained | PASS | `npm.cmd test` UI/static checks and packaged action | Main process accepts only an existing `index.html` below the app's user-data `exports` root; outside paths and non-files fail with explicit codes | This is local desktop protection, not a remote authorization system |
| Export structure remains inspectable | PASS | `npm.cmd test`; inspect generated revision manifest and HTML | 39/39 tests pass; generated manifest recorded `revision_of`, `deepseek_api`, `deepseek-v4-flash`, one slide and nine elements; HTML contains slide/element IDs and editable nodes | Subjective visual quality remains `MANUAL REVIEW REQUIRED` |
| Restart and session isolation | PASS | Deterministic `SessionWorkspace` test | Artifact from session A was not readable from session B and was absent from a new workspace instance, preventing stale cross-session leakage | Durable restart recovery is not implemented; recovery remains `NOT VERIFIED` |

Milestone 5 status: `IMPLEMENTED BUT NOT FULLY VERIFIED`. The revision and safe
opening path is verified; durable persistence, external-window pixel review, and
subjective creative quality remain open.

## Milestone 6 — export inspection and asset/provenance evidence (2026-08-11)

| Criterion | Status | Exact action | Evidence | Limitation |
|---|---|---|---|---|
| Export inspection reads the real HTML/manifest pair | PASS | Built the latest package, generated a real plan, exported HTML, and clicked visible `Inspect export` | UI dialog showed `Status: PASS. Slides: 1. Elements: 5. Editable: 5. Locked: 1.` and `Issues: No structural issues found.`; UI showed `Export inspection PASS.` with no error node | The run used a one-slide brief |
| Inspection exposes assets and provenance | PASS | Inspected the generated manifest through the secure export-inspection IPC path | Manifest had `format=editable_html`, `deepseek_api`, `deepseek-v4-flash`, a creative result id, one slide, and five elements; the UI explicitly reported `Assets: none` for this brief | Asset-bearing revision still needs a separate live upload case |
| Geometry/locking/editability evidence is structural | PASS | `npm.cmd test` plus `inspectEditableHtml` regression | 39/39 tests passed; inspection counts slides/elements/editable/locked nodes and detects manifest/HTML count mismatch, missing assets, and incomplete provenance | It cannot judge artistic composition or human readability |
| Truthful failure boundary | PASS | Static/runtime inspection path and unit coverage | Missing/unsafe paths, malformed manifest, count mismatch, missing asset metadata, or incomplete provenance produce `FAIL`/explicit error instead of success | Adversarial filesystem race testing remains open |
| Packaged inspection E2E | PASS | Isolated packaged window on port 9342, visible Generate → Export → Inspect flow | Real DeepSeek plan reached `READY_FOR_EDIT`; export created `index.html` (7,671 bytes) and `manifest.json` (4,703 bytes); inspection returned `PASS`, zero UI errors | Visual quality remains `MANUAL REVIEW REQUIRED`; external browser pixel review is not claimed |

Milestone 6 status: `IMPLEMENTED BUT NOT FULLY VERIFIED`. Structural export
inspection and honest UI reporting are verified; asset-bearing live capture,
durable persistence, and subjective visual quality remain open.

## Milestone 7 — durable creative workspace recovery (2026-08-11)

| Criterion | Status | Exact action | Evidence | Limitation |
|---|---|---|---|---|
| Creative results persist under the owner user-data boundary | PASS | Added `CreativePersistence` and wired `solat:create-deck` to save validated results under the Electron user-data directory | Results are written as versioned JSON with hashed session filenames and atomic replacement; no secret or absolute path is returned to the renderer | This stores creative workspace metadata, not a full database migration |
| Revision/export/inspection metadata survives restart | PASS | Added persistence IPC for history, export metadata, and inspection metadata; ran a packaged restart with the same isolated profile | First run generated a real DeepSeek plan, exported HTML, and inspection returned PASS; after stopping and reopening the packaged app, `calm piano` and one revision returned in visible `Revision history` with `exported HTML available`, and Inspect export returned PASS again | Chat message durability is outside this milestone |
| Session isolation is preserved | PASS | Deterministic persistence test saved session A and attempted to load it from another session | `test/persistence.test.js` rejects traversal-like IDs and returns no history for another session; persisted lookups require the exact session ID | Cross-user authorization still depends on the Electron user-data boundary |
| Restart recovery is exercised through the packaged UI | PASS | Built `SOLAT.exe`, opened isolated profiles on debug ports 9343/9344, used visible Generate → Export → Inspect → close → reopen → History → Inspect actions | Real UI showed `Plan ready: 1 editable slides · status READY_FOR_EDIT`, export path under user-data, and after restart `Revision 1 ... exported HTML available`; inspection showed `Status: PASS`, zero error nodes | A one-slide creative brief is not a visual-quality benchmark |
| Deterministic regression and syntax checks | PASS | `npm.cmd run check`; `npm.cmd test`; `git diff --check` | JavaScript checks pass, 40/40 tests pass, and diff whitespace check passes | No paid/provider quality claim beyond the recorded single live E2E |

Milestone 7 status: `IMPLEMENTED BUT NOT FULLY VERIFIED`. Creative result,
revision, export, and inspection metadata recover correctly after a packaged
restart within the same owner/session profile. Full chat persistence, multi-user
authorization, external-browser pixel review, and subjective visual quality are
still outside this milestone; visual quality remains `MANUAL REVIEW REQUIRED`.

## Milestone 8 — durable conversation recovery (2026-08-11)

| Criterion | Status | Exact action | Evidence | Limitation |
|---|---|---|---|---|
| Conversation turns persist under the owner user-data boundary | PASS | Added `ConversationPersistence` and wired secure save/load IPC; renderer saves sanitized thread snapshots by session | Stored snapshots retain thread title, user/assistant content, timestamps, response mode/provider and approved source URLs; common API key/Bearer/secret patterns are redacted | This is a local desktop persistence adapter, not a shared remote account store |
| Context returns after a clean packaged restart | PASS | Sent one real DeepSeek message, waited for persistence, removed the renderer's local thread snapshot, stopped the packaged app, then reopened the same isolated profile | The new packaged UI restored the title `Remember this exact phrase: blue lantern 314`, both turns, the visible answer, and selected the restored thread; there were zero error nodes | One short conversation was used for the live restart check |
| Session isolation and malformed input are enforced | PASS | Ran `conversation-persistence.test.js` with separate sessions and traversal-like IDs | Session B loaded no Session A data; `../session-a` was rejected; unknown roles normalize safely and secret-like content is redacted | Multi-account authorization beyond the local owner profile is outside this desktop milestone |
| Durable restore does not block normal UI startup | PASS | Restore is invoked after the normal local render and failures are caught without fabricating a successful chat turn | A missing/malformed durable snapshot leaves the normal conversation UI usable; no provider success is generated by the recovery layer | Recovery errors are not a provider-quality signal |
| Deterministic and packaged checks | PASS | `npm.cmd run check`; `npm.cmd test`; packaged restart on ports 9347/9348 | Syntax checks pass, 41/41 tests pass, and packaged restart restored the real conversation after local snapshot removal | Visual quality and search parity remain `MANUAL REVIEW REQUIRED` |

Milestone 8 status: `IMPLEMENTED BUT NOT FULLY VERIFIED`. Conversation context
and visible history now recover across a packaged restart for the same owner/session
profile, with basic secret redaction and isolation checks. Multi-device sync,
remote account auth, and long-running multi-turn recovery remain future work.

## Milestone 9 — search source policy and visible evidence (2026-08-11)

| Criterion | Status | Exact action | Evidence | Limitation |
|---|---|---|---|---|
| Search source scopes are explicit and allowlisted | PASS | Added `SOURCE_SCOPES` and `source_scope` to the `web_search` tool contract | `encyclopedic` limits to Wikipedia, `social` limits to Pinterest/TikTok/Instagram/Facebook, `video` limits to YouTube, and `auto`/`approved` preserve the approved host list; unapproved scopes fail with `invalid_source_scope` | Pinterest/TikTok/Instagram/YouTube live adapters still depend on the configured SearXNG/Brave/DDG provider; no scraper was added |
| Results remain ranked, deduplicated, and degraded-aware | PASS | Extended `WebSearchService.search` to carry `source_scope`, allowed hosts, provider errors, and result counts | Existing local HTTP boundary test still passes; unsafe Asura Scan result is filtered; duplicate Wikipedia URLs collapse to one; `ready/degraded/unavailable/empty` statuses remain truthful | No paid/live search request was made in this checkpoint |
| DeepSeek receives evidence and can choose the source scope | PASS | Tool schema now exposes source scope as an optional model-selected argument; conversation response includes `searchEvidence` | Regression test confirms the model-selected tool path returns `source_scope`, `allowed_hosts`, `result_count`, and `error_count` alongside visible sources | Tool choice remains model-dependent; the router only supplies advisory source-scope hints |
| Source provenance is visible below the answer | PASS | Renderer records `searchEvidence` and adds the selected `source scope` to the response-origin line while keeping source links in the disclosure panel | Static UI contract and source disclosure tests pass; persisted conversations retain bounded search evidence metadata | A live packaged UI search display with an external search provider is not verified because the current local package has no search provider configured |
| Deterministic verification | PASS | `npm.cmd run check`; `npm.cmd test`; `git diff --check` | Syntax checks pass and 41/41 tests pass, including source scopes, intent hints, search evidence, session recovery, and existing search safety cases | Search quality/parity with ChatGPT remains `MANUAL REVIEW REQUIRED` |

Milestone 9 status: `IMPLEMENTED BUT NOT FULLY VERIFIED`. Search now has an
explicit source-policy contract, evidence metadata, and visible scope reporting;
external provider coverage and semantic quality across real queries still need a
configured live search run and a paired benchmark.

## Milestone 10 — ambiguity and comparison hints (2026-08-11)

| Criterion | Status | Exact action | Evidence | Limitation |
|---|---|---|---|---|
| Comparison candidates are extracted without replacing the user message | PASS | Added advisory `disambiguation` hints to `analyzeIntent` | `compare Park Dayoung and Han Nari` yields two raw entities plus normalized/compact variants; the original message remains in `original_message` and is sent unchanged to the model | Entity extraction is deterministic hinting, not a knowledge claim |
| Ambiguous single names can be clarified | PASS | Added `likely_ambiguous`, context candidates, policy, and a clarification-question hint | `Park-Dayoung` is marked `ask_if_search_evidence_cannot_resolve`; router remains `model_first` and does not block the model | The model still decides whether to ask, search, or answer |
| Follow-up context remains available | PASS | Disambiguation records the last bounded prior user/assistant contents | Hints preserve the prior-turn count and include up to two recent context candidates while the full history still goes to DeepSeek | Context window and provider behavior remain bounded by existing limits |
| Regression and failure safety | PASS | `npm.cmd run check`; `npm.cmd test`; `git diff --check` | 41/41 tests pass, including English comparison, hyphenated ambiguity, Thai/English source hints, malformed provider handling, and existing search safety checks | Semantic parity with ChatGPT remains `MANUAL REVIEW REQUIRED` |

Milestone 10 status: `IMPLEMENTED BUT NOT FULLY VERIFIED`. The router now
provides useful comparison and ambiguity context without becoming a hard gate;
real multilingual quality and live search grounding still need configured
provider evidence and paired review.

## Milestone 11 — truthful search readiness and source-count disclosure (2026-08-11)

| Criterion | Status | Exact action | Evidence | Limitation |
|---|---|---|---|---|
| Provider readiness is truthful and secret-free | PASS | Extended `WebSearchService.status()` and the renderer settings surface | DuckDuckGo/Wikipedia report ready by default; Brave and SearXNG report `Not configured` until their required environment values exist; status contains no key or secret | This is configuration readiness, not proof that an external provider is reachable |
| Search evidence count is visible below the answer | PASS | Rendered bounded `searchEvidence` metadata in a one-line source-count box | Assistant responses with search evidence show `Search · N source(s) · status` below the answer; the existing approved source links remain available in the disclosure panel | No box appears for turns that did not use search, which avoids implying a source that was not used |
| Search scope remains visible | PASS | Kept the scope in the response-origin line and persisted bounded evidence metadata | The UI identifies `encyclopedic`, `social`, `video`, `auto`, or `approved` beside the response origin | Scope is an advisory tool argument; DeepSeek still decides whether to call the tool |
| Search-only success is not fabricated | PASS | Reused the model-first `completeWithTools` route and truthful degraded/error handling | Conversation responses remain model responses; search metadata is attached only when a tool call actually returns evidence or an explicit degraded state | Semantic answer quality and ChatGPT parity remain `MANUAL REVIEW REQUIRED` |
| Deterministic verification | PASS | `npm.cmd run check`; `npm.cmd test`; `git diff --check` | Syntax checks pass and 41/41 tests pass, including provider readiness, source-count UI contract, source scopes, tool calls, persistence, and existing safety cases | No live external search request was made because this checkpoint had no configured live search provider |

Milestone 11 status: `IMPLEMENTED BUT NOT FULLY VERIFIED`. The app now tells
the user which search configuration is ready and shows a compact source count
under search-grounded answers without exposing secrets or claiming search was
used when it was not. A configured live-provider smoke run and semantic paired
benchmark remain future evidence.

## Milestone 12 — live search + DeepSeek smoke evidence (2026-08-11)

| Criterion | Status | Exact action | Evidence | Limitation |
|---|---|---|---|---|
| Secret-free readiness harness | PASS | Added `src/core/live-search-smoke.js` and `npm.cmd run smoke:live-search` | Report retains provider/model names, configured flags, source scopes, bounded approved URLs, timestamps and response metadata only; API keys are never read into output | Readiness does not establish factual quality |
| Honest not-configured/model-no-tool outcome | PASS | Regression coverage for an unconfigured model and a search-grounded report | Harness returns `NOT VERIFIED` without calling the model when configuration is missing, and returns `NOT VERIFIED` when no search-grounded visible evidence comes back | The harness is one bounded case, not a semantic benchmark suite |
| One owner-approved live search + DeepSeek case | PASS | `npm.cmd run smoke:live-search -- --output artifacts\\live-search-smoke\\20260811-142937.json` | Ran from `2026-08-11T07:29:38.098Z` to `07:29:46.084Z`; `deepseek-v4-flash` used two tool rounds, final response mode `search_and_model`, final search status `ready`, and five visible approved Wikipedia sources for Ada Lovelace | The first model-selected scope returned empty and the second selected `encyclopedic`; this proves truthful tool progression, not broad answer quality |
| Source-count path is present in the packaged application | PASS | Rebuilt `dist/win-unpacked/SOLAT.exe` and inspected the generated `resources/app.asar` | Packaged `renderer/renderer.js` contains `data-source-count` and `data-search-provider-status`; packaged core contains `src/core/live-search-smoke.js` and `src/core/web-search.js` | The desktop window was launched after the rebuild; pixel-level automated UI assertion remains `MANUAL REVIEW REQUIRED` |
| Regression and package verification | PASS | `npm.cmd run check`; `npm.cmd test`; `npm.cmd run build`; `git diff --check` | Syntax check passed, 43/43 deterministic tests passed, and the package copied local configuration beside the executable without logging it | Usage returned is explicitly marked as final-provider-response usage only, not total multi-round cost |

Milestone 12 status: `IMPLEMENTED BUT NOT FULLY VERIFIED`. The full configured
search + DeepSeek route now has one real evidence capture and an executable
harness that preserves truthful `NOT VERIFIED` outcomes. This does not prove
quality parity with ChatGPT, nor does it validate every provider/source scope.

## Milestone 13 — source-quality and comparison-evidence gate (2026-08-11)

| Criterion | Status | Exact action | Evidence | Limitation |
|---|---|---|---|---|
| Approved but unrelated results are excluded | PASS | Added query-token relevance assessment after URL allowlisting and canonical deduplication | An allowed Wikipedia result about a different subject is removed before sources reach the model; quality reports `filtered` and `dropped_unrelated_count` | Lexical relevance cannot prove every retained source is factually correct |
| Comparison sources do not silently conflate entities | PASS | Added candidate-entity matching for explicit `compare A and B` / `A vs B` search queries | Results record `comparison_split_evidence` when evidence covers the compared names separately rather than in one source; renderer explains this below the source count | The model must still synthesize cautiously; it is not forced to answer a comparison |
| Scope behavior remains constrained | PASS | Regression uses a local SearXNG-shaped response across `auto`, `encyclopedic`, and `social` scopes | Encyclopedic scope keeps only Wikipedia hosts; social scope refuses Wikipedia evidence and returns `insufficient_relevance` rather than leaking it | Live Pinterest/TikTok/YouTube discovery still depends on the configured provider returning approved URLs |
| Quality/degraded metadata reaches the UI and persistence boundary | PASS | Added bounded `quality` metadata to conversation evidence and durable conversation snapshots | UI retains `filtered`, `insufficient_relevance`, and comparison-split notes below the source-count line; persisted metadata is bounded and redacted | Pixel-level visual review remains `MANUAL REVIEW REQUIRED` |
| Regression verification | PASS | `npm.cmd run check`; `npm.cmd test`; `git diff --check` | Syntax checks pass and 44/44 tests pass, including irrelevant-source rejection, comparison separation, social scope isolation, conversation evidence, and existing failures | This is deterministic quality-gate evidence, not a complete live semantic benchmark |

Milestone 13 status: `IMPLEMENTED BUT NOT FULLY VERIFIED`. SOLAT now has a
truthful source-quality boundary before model synthesis: approved URLs alone
are not enough, and separate entities are not presented as a single source.
Broad multilingual/entity-resolution quality and ChatGPT parity remain
`MANUAL REVIEW REQUIRED`.

## Milestone 14 — context-aware query hints and multi-scope evidence (2026-08-11)

| Criterion | Status | Exact action | Evidence | Limitation |
|---|---|---|---|---|
| Original wording and history remain authoritative | PASS | Added query-variant hints only inside the existing advisory intent object | The original user message and full conversation history still go to DeepSeek unchanged; router stays `model_first`/`hard_gate=false` | DeepSeek may still choose an unhelpful query in a real provider run |
| Bounded variants support hyphenated names and comparisons | PASS | Added at most five `search_query_variants` with a reason field | `Park-Dayoung` yields the original plus `Park Dayoung`; `compare Park Dayoung and Han Nari` retains the complete request plus one candidate query per name | Variants are not a universal entity-resolution system and never claim identity by themselves |
| Multi-scope evidence is summarized safely | PASS | Added `searchSummary` from tool runs and retained canonical URL deduplication | Summary carries bounded source count, source scopes, hosts, and statuses; renderer notes when more than one scope contributed | Separate sources remain evidence, not a guarantee that sources agree |
| Comparison and follow-up regression | PASS | Provider stub executes encyclopedic then social tool calls for a hyphenated comparison | Result remains `search_and_model`, contains two sources and two source scopes, and provider sees the original comparison plus advisory variants | This proves orchestration rather than live social-platform availability |
| Regression and package verification | PASS | `npm.cmd run check`; `npm.cmd test`; `git diff --check`; `npm.cmd run build` | Syntax checks pass, 45/45 tests pass, and the latest packaged SOLAT window launches with the updated renderer/core | Fresh paid provider testing was intentionally not repeated for this deterministic change |

Milestone 14 status: `IMPLEMENTED BUT NOT FULLY VERIFIED`. SOLAT now gives
DeepSeek bounded search alternatives and a truthful multi-scope evidence summary
without replacing the user's actual message. Live multilingual disambiguation,
social-source availability, and ChatGPT parity still require broader evidence.

## Milestone 15 — grounded-synthesis contract (2026-08-11)

| Criterion | Status | Exact action | Evidence | Limitation |
|---|---|---|---|---|
| Search-grounded synthesis is explicitly instructed | PASS | Extended the advisory system prompt supplied to the OpenAI-compatible tool path | Prompt says factual claims must come from tool evidence and forbids inventing URLs, sources, names, or facts | A model instruction cannot guarantee semantic compliance without live evaluation |
| Empty/degraded/split evidence is handled truthfully | PASS | Prompt contract names empty, unavailable, insufficient, and split candidate evidence | The model is told to state the limitation; existing tool failure/status metadata and UI disclosure remain unchanged | Wording quality remains provider-dependent |
| General chat remains model-first | PASS | Contract is conditional on `web_search` evidence and router behavior is unchanged | General messages still follow the normal `complete` path without tool use; no hard gate was added | This is deterministic routing evidence only |
| Regression verification | PASS | `npm.cmd run check`; `npm.cmd test`; `git diff --check` | Syntax checks pass and 45/45 tests pass; conversation tool test asserts the anti-fabrication contract reaches the model | No fresh paid provider run was made for this prompt-only change |

Milestone 15 status: `IMPLEMENTED BUT NOT FULLY VERIFIED`. The provider now
receives an explicit evidence-boundary contract whenever search is available;
actual answer-quality and citation fidelity still need representative live
evaluation.

## Milestone 16 — deterministic conversation/search evaluation corpus (2026-08-11)

| Criterion | Status | Exact action | Evidence | Limitation |
|---|---|---|---|---|
| Corpus covers required interaction classes | PASS | Added `evaluations/conversation-search-corpus.json` and evaluator | 13 cases cover general chat, latest information, Thai/English, follow-up context, hyphenated names, comparison, encyclopedia/social/video scopes, empty/degraded evidence, citation disclosure, and live parity boundary | This is contract coverage, not a collection of live model answers |
| Per-case truthful status report | PASS | `npm.cmd run evaluate:conversation` | 12 `PASS`, 0 `FAIL`, 1 `NOT VERIFIED`; the single unverified case is explicitly the live SOLAT-vs-ChatGPT semantic comparison | A green deterministic report does not claim ChatGPT-level answer quality |
| Citation and failure policy is exercised | PASS | Corpus simulates empty, degraded, and unsafe source outcomes | Unsafe `asurascans.com` citation is excluded, degraded status remains degraded, and empty status remains empty | Live provider/search transport failures need separate live evidence |
| Evaluator itself is regression-tested | PASS | Added unit coverage for corpus result count and aggregate counts | Test asserts 13 cases, 12 pass, no deterministic failure, and a distinct `NOT VERIFIED` parity row | Changing the corpus requires review to avoid weakening the target |
| Regression verification | PASS | `npm.cmd run evaluate:conversation`; `npm.cmd run check`; `npm.cmd test`; `git diff --check` | Evaluator passes; syntax includes both evaluation scripts; 46/46 tests pass | No paid provider call was made for this deterministic milestone |

Milestone 16 status: `IMPLEMENTED BUT NOT FULLY VERIFIED`. SOLAT now has a
repeatable, cost-free contract evaluation baseline. Its parity case deliberately
stays `NOT VERIFIED` until paired live evidence exists, so the report cannot be
misread as a quality claim.

## Milestone 17 — three-way live-capture foundation (2026-08-11)

| Criterion | Status | Exact action | Evidence | Limitation |
|---|---|---|---|---|
| Three-party capture contract exists | PASS | Added `src/core/three-way-evaluator.js`, `scripts/capture-three-way.js`, and the safe ChatGPT-baseline template | Each row keeps separate visible ChatGPT, raw DeepSeek, and SOLAT captures; SOLAT retains approved sources, tool mode, tool rounds, search status, timestamps, and bounded usage only | The adapter does not call ChatGPT or expose any ChatGPT credential; its answer must be captured through the owner-controlled ChatGPT UI or supplied as a safe baseline file |
| Paid-call guard is explicit | PASS | The capture script rejects execution without `--execute` | A real provider request cannot happen accidentally from this benchmark script | `--execute` is an operator action, not a cost cap; benchmark scope must be selected deliberately |
| First real three-way row | PASS | Captured `general_chat_en` through signed-in ChatGPT UI, raw DeepSeek V4 Flash, and SOLAT using `npm.cmd run capture:three-way -- --execute --case-ids general_chat_en ...` | `artifacts/three-way-capture/three-way-general_chat_en-20260811-152800.json`: all three transports returned a visible response; raw DeepSeek used 201 final-response tokens and SOLAT used 677 final-response tokens | This row proves capture plumbing only. It predates the context-isolation rule, so its ChatGPT semantic baseline is `NOT VERIFIED` |
| Live search comparison exposes a quality gap | PASS | Captured `latest_info_en` in all three systems | `artifacts/three-way-capture/three-way-latest_info_en-20260811-153300.json`: ChatGPT cited UNESCO, Science Museum and arXiv; SOLAT used `search_and_model` with 4 tool rounds and approved Wikipedia URLs but included several unrelated entity pages | It identifies a real SOLAT gap, but the external baseline must be recaptured in Temporary Chat before semantic comparison |
| Ambiguous comparison exposes an entity-resolution gap | PASS | Captured `comparison_candidates` in all three systems | `artifacts/three-way-capture/three-way-comparison_candidates-20260811-153800.json`: ChatGPT identified the intended `Circles` characters and cited Pinterest/PixAI; raw DeepSeek guessed different media; SOLAT truthfully asked for context but its search evidence contained unrelated music and mythology pages | The intended identity is not proven by the selected SOLAT sources; additionally, baseline context isolation must be established before scoring it as comparable |
| Requested source scope works but ranking is too broad | PASS | Captured `encyclopedic_scope` in all three systems | `artifacts/three-way-capture/three-way-encyclopedic_scope-20260811-154500.json`: SOLAT selected the encyclopedic tool scope and cited Ada Lovelace, but also surfaced microarchitecture, award, day, and Linda Lovelace pages instead of following ChatGPT's focused one-source response | Tool selection/trace works; entity-level ranking and answer concision remain a quality gap |
| Social-source route exposes provider coverage gap | PASS | Captured `social_scope` in all three systems | `artifacts/three-way-capture/three-way-social_scope-20260811-155000.json`: ChatGPT found multiple Pinterest/Circles results and disclosed TikTok crawl limits; SOLAT's social scope returned empty, then auto scope introduced unrelated Wikipedia results | SOLAT must not silently replace a failed requested social scope with unrelated auto-scope evidence |
| Video-source case has a real tool-loop failure | FAIL | Captured `video_scope` in all three systems without automatic retry | `artifacts/three-way-capture/three-way-video_scope-20260811-155200.json`: ChatGPT cited a YouTube result and raw DeepSeek returned suggestions; SOLAT failed with `tool_loop_limit` after the provider exceeded the three-round cap | The cap correctly stopped runaway paid work and the UI would show failure truthfully, but video source selection/termination must be fixed before this case can be considered functional |
| Isolated ambiguous-name capture | PASS | Captured `hyphenated_name` in ChatGPT Temporary Chat, raw DeepSeek, and SOLAT | `artifacts/three-way-capture/three-way-hyphenated_name-20260811-155600.json`: all three visible answers were captured; both ChatGPT and SOLAT asked for context, while raw DeepSeek unexpectedly replied in Chinese | This is the first semantic-review-eligible external baseline because its `context_mode` is explicitly `temporary_chat`; the comparison score remains `NOT VERIFIED` pending a rubric |
| Isolated baseline selection and regression capture | PASS | The capture adapter now prefers a newer `temporary_chat` or `matched_history` row over a stale duplicate, then captured `general_chat_en` again | `artifacts/three-way-capture/three-way-general_chat_en-isolated-20260811-160700.json` and the duplicate-selection unit test | This prevents a stale un-isolated row from being silently used, but still does not score answer quality |
| Additional isolated Thai and insufficient-evidence captures | PASS | Captured `latest_info_th` and `empty_evidence` in ChatGPT Temporary Chat, raw DeepSeek, and SOLAT | `artifacts/three-way-capture/three-way-batch-general-th-empty-20260811-160500.json`: ChatGPT provides primary/credible citations for Ada Lovelace; SOLAT has a broad source-selection gap. On insufficient evidence, SOLAT asks for clarification but cites an unrelated result; raw DeepSeek labels an invented source as fictional | These are real quality findings, not a semantic-parity score; each still requires a stated manual rubric |
| Isolated latest-source comparison | PASS | Captured `latest_info_en` again from ChatGPT Temporary Chat before calling raw DeepSeek and SOLAT | `artifacts/three-way-capture/three-way-latest_info_en-isolated-20260811-161800.json`: all transports passed; ChatGPT cited UNESCO, Science Museum, CHM, and arXiv, while SOLAT used the requested encyclopedia scope but ranked broad family/adjacent pages and included unnecessary biography | The capture proves a concrete source-ranking and answer-focus gap. It is not a numeric semantic score |
| Isolated ambiguous-comparison capture | PASS | Captured `comparison_candidates` again from ChatGPT Temporary Chat before calling raw DeepSeek and SOLAT | `artifacts/three-way-capture/three-way-comparison_candidates-isolated-20260811-162100.json`: ChatGPT asks for the missing identity context and names the Circles possibility; raw DeepSeek invents multiple unsupported candidate biographies; SOLAT truthfully asks for context but its tool evidence remains unrelated | This is semantic-review eligible but remains `NOT VERIFIED` until a stated manual rubric evaluates the visible answers |
| Isolated requested-Wikipedia capture | PASS | Captured `encyclopedic_scope` again from ChatGPT Temporary Chat before calling raw DeepSeek and SOLAT | `artifacts/three-way-capture/three-way-encyclopedic_scope-isolated-20260811-162600.json`: ChatGPT and SOLAT both select the requested Wikipedia route. SOLAT exposes all five ranked pages, including three tangential ones and Linda Lovelace, whereas ChatGPT answers from the single relevant page | Tool selection and source disclosure are evidenced; ranking/answer focus remain a concrete quality gap, and no semantic score is assigned |
| Corpus coverage is machine-readable without paid calls | PASS | Ran `npm.cmd run report:three-way` after the repaired video route was captured | Output enumerates all 13 cases: 13 have isolated ChatGPT baselines, 13 have complete three-party transports, and all 13 correctly remain `NOT VERIFIED` for semantic quality | Complete transport coverage does not create a semantic-parity score |
| Isolated social-source comparison | PASS | Captured `social_scope` in ChatGPT Temporary Chat, raw DeepSeek, and SOLAT | `artifacts/three-way-capture/three-way-social_scope-isolated-20260811-163500.json`: ChatGPT found Pinterest material and disclosed that TikTok could not be confirmed; SOLAT selected social search but returned empty evidence for both sources | This proves a search-provider/query-expansion coverage gap. It is not a semantic score |
| Isolated requested-video comparison | FAIL | Captured `video_scope` in ChatGPT Temporary Chat, raw DeepSeek, and SOLAT; no automatic retry occurred | `artifacts/three-way-capture/three-way-video_scope-isolated-20260811-163800.json`: ChatGPT cites a concrete Computerphile YouTube video; raw DeepSeek responds; SOLAT again fails with `tool_loop_limit` | The repeated failure is now proven against an isolated external baseline and must be fixed in the next quality implementation round before this case can pass |
| Matched-history capture parity | PASS | Added a baseline-history override used only when the owner-captured baseline declares `matched_history` | The raw DeepSeek and SOLAT capture paths receive the exact same bounded history as the captured ChatGPT follow-up; regression test passes | This preserves fair context for a follow-up capture but does not evaluate response quality |
| Isolated follow-up context comparison | PASS | Captured `follow_up_context` using an exact ChatGPT Temporary Chat turn history, then sent the same history to raw DeepSeek and SOLAT | `artifacts/three-way-capture/three-way-follow_up_context-matched-history-20260811-164300.json`: all three transports passed. ChatGPT chose one Computer History Museum page; SOLAT resolved “it” to Ada Lovelace and searched successfully, but selected five Wikipedia pages | The context is comparable and source/tool trace is real; semantic parity remains `NOT VERIFIED` pending a stated rubric |
| Isolated degraded and citation-disclosure captures | PASS | Captured `degraded_evidence` and `citation_disclosure` with ChatGPT Temporary Chat, raw DeepSeek, and SOLAT | `artifacts/three-way-capture/three-way-degraded_evidence-isolated-20260811-165000.json` and `artifacts/three-way-capture/three-way-citation_disclosure-isolated-20260811-165400.json`: all transports returned visible clarification responses without fabricated citations | These prove truthful no-evidence behavior only; they do not score response quality |
| Isolated live-parity-boundary capture | PASS | Captured `live_semantic_parity` with ChatGPT Temporary Chat, raw DeepSeek, and SOLAT | `artifacts/three-way-capture/three-way-live_semantic_parity-isolated-20260811-170000.json`: all three responses ask for the actual SOLAT output or clarification, and ChatGPT's visible App Store citation remains recorded as external evidence only | The prompt itself cannot establish parity; it correctly remains manual review rather than a score |
| Latency metadata is explicit and truthful | PASS | Added deterministic latency fields and ran `npm.cmd run report:three-way` | Every DeepSeek/SOLAT capture has timestamp-derived millisecond latency in the coverage report; ChatGPT browser baselines record `latency_ms: null` where the signed-in UI did not provide a reliable request start time | Browser-baseline latency is `NOT VERIFIED`, never estimated or fabricated |
| Semantic score boundary is truthful | PASS | `comparisonBoundary` always emits `NOT VERIFIED` rather than calculating a proxy score from text overlap | Test asserts a complete three-way capture has sources/trace but still needs manual semantic review | A validated scoring rubric is required before any parity percentage may be claimed |
| Regression verification | PASS | `npm.cmd run check`; `npm.cmd test`; `git diff --check` | Syntax checks pass; 53/53 deterministic tests pass | This does not judge semantic quality |

Milestone 17 status: `IMPLEMENTED BUT NOT FULLY VERIFIED`. All 13 corpus cases now
have a context-isolated ChatGPT baseline and complete three-party visible transport
coverage. Every capture preserves visible text, outcome, source/tool trace, timestamps,
and DeepSeek/SOLAT latency. ChatGPT UI latency is explicitly unknown rather than guessed.
All 13 semantic comparisons remain `NOT VERIFIED`: no proxy score is presented as
ChatGPT parity, and source-ranking/entity-resolution quality still needs a rubric.

## Milestone 18 — bounded video-search completion (2026-08-11)

| Criterion | Status | Exact action | Evidence | Limitation |
|---|---|---|---|---|
| Tool round and total-call caps preserve a final answer | PASS | Updated `OpenAICompatibleProvider.completeWithTools` to execute at most three tool calls, then request one no-tool final response | Regression tests cover a repeating tool call and an over-sized tool-call batch; both preserve the cap and return a visible final response | The final no-tool response still depends on the provider obeying `tool_choice: none`; a provider that ignores it fails truthfully with `tool_loop_limit` |
| Explicit video scope cannot fall back to broad sources | PASS | The conversation boundary now constrains a model-requested `auto` scope to the user-requested video scope | Regression test requests YouTube while the model asks for `auto`; the executed tool call is `video` and the response records one scope adjustment | This does not make an external video search provider return results when it has none |
| Direct, ambiguous, and tool-failure paths remain covered | PASS | Ran deterministic conversation/router/provider suite | Existing model-first/direct and ambiguity tests pass; new provider test confirms a tool execution failure remains `tool_error` instead of a fabricated answer | Deterministic tests do not score helpfulness or answer quality |
| Live video route no longer loops or broadens source scope | PASS | `npm.cmd run capture:three-way -- --execute --case-ids video_scope ...` | `artifacts/three-way-capture/three-way-video_scope-post-scope-fix-20260811-172000.json`: all three transports pass; SOLAT makes two video-only search calls, returns `web_search_status: empty`, has no unapproved/broad sources, and produces a truthful final answer | The configured video search returned no YouTube result, so this proves safe termination and scope integrity—not retrieval quality or semantic parity |
| Final regression verification | PASS | `npm.cmd test`; `npm.cmd run check`; `npm.cmd run report:three-way`; `git diff --check` | 53/53 tests pass; syntax checks pass; coverage reports 13 isolated baselines and 13 complete transports | ChatGPT latency and semantic quality remain `NOT VERIFIED` without a browser timing instrument and human-approved rubric |

Milestone 18 status: `IMPLEMENTED BUT NOT FULLY VERIFIED`. The reproduced
`video_scope` failure is fixed for the observed route: total tool calls are bounded,
the video requirement is preserved, an honest empty-evidence answer is returned, and no
automatic retry occurred. This is not a claim that SOLAT matches ChatGPT semantically or
that video search has adequate external coverage.

## Milestone 19 — entity-aware comparison evidence gate (2026-08-11)

| Criterion | Status | Exact action | Evidence | Limitation |
|---|---|---|---|---|
| Complete-name comparison queries stay intact | PASS | Added comparison-query alignment and a strong multi-word identity ranking threshold | Regression covers `Park-Dayoung` versus `Han Nari` without reducing either name to a partial token | This is not universal named-entity resolution across languages or transliterations |
| Partial/ambiguous evidence is not presented as support | PASS | Filtered comparison tool results against the complete requested entity and withheld visible citations when one side lacks evidence | `npm.cmd test` includes the one-sided-evidence case; it retains the audit trace but returns zero visible sources | A model can still phrase an ungrounded claim; the provider prompt and future rubric must catch semantic behavior |
| Live capture exposes the remaining gap honestly | PASS | Ran one explicit live three-way capture for `comparison_candidates` without automatic retry | `artifacts/three-way-capture/three-way-comparison_candidates-post-evidence-filter-20260811-174000.json`: SOLAT asks for context; raw DeepSeek invents an unrelated answer; one matching-but-irrelevant event source showed why the UI citation gate was added | This capture predates the final visible-citation gate, so a fresh live UI verification is still `NOT VERIFIED` |
| Regression verification | PASS | `npm.cmd test`; `npm.cmd run check`; `git diff --check` | 58/58 deterministic tests pass; all checked JavaScript parses; diff whitespace check passes | No semantic parity percentage is assigned |

Milestone 19 status: `IMPLEMENTED BUT NOT FULLY VERIFIED`. Comparison results now
need evidence for each named side before any citation is visible to the user. The raw
search trace remains available for diagnosis. Broader ambiguity resolution, multilingual
entity matching, live UI verification of the new citation gate, and an auditable
SOLAT-versus-ChatGPT rubric remain unfinished.

## Milestone 20 — source-scope retrieval queries (2026-08-11)

| Criterion | Status | Exact action | Evidence | Limitation |
|---|---|---|---|---|
| Social/video scopes seek their requested platforms before filtering | PASS | Added bounded `site:` constraints to generic-engine queries for social and video source scopes | Regression verifies social uses Pinterest/TikTok/Instagram/Facebook constraints and video uses YouTube constraints, while the URL allowlist is still applied after retrieval | Search engines may not index every platform page or may restrict results |
| Scope cannot bypass the approved-host boundary | PASS | Kept the existing allowlist as the post-retrieval enforcement layer | Scope query only guides retrieval; `isAllowedUrl` still rejects unapproved URLs | This does not verify live platform accessibility |
| Regression verification | PASS | `npm.cmd test`; `npm.cmd run check`; `git diff --check` | 59/59 deterministic tests pass and checked JavaScript parses | No paid/provider request was used for this deterministic retrieval-planning change |

Milestone 20 status: `IMPLEMENTED BUT NOT FULLY VERIFIED`. Social and video searches
now ask a generic search provider for the requested approved platforms rather than
hoping the right host appears before filtering. Actual result availability and semantic
answer quality require live evidence and a separate rubric.

## Milestone 21 — evidence-backed semantic review rubric (2026-08-11)

| Criterion | Status | Exact action | Evidence | Limitation |
|---|---|---|---|---|
| Comparison dimensions are explicit | PASS | Added `evaluations/semantic-comparison-rubric.json` | Six dimensions cover task completion, context/ambiguity, tool/scope choice, grounding/sources, uncertainty, and language/tone | The rubric describes review; it does not yet contain any reviewed live case |
| Capture output cannot silently become a parity score | PASS | Attached a `NOT VERIFIED` rubric packet to every three-way comparison boundary | Regression asserts the packet has `scoring_allowed: false` even when all three visible answers were captured | A reviewer must still add evidence for each dimension before any score can be calculated |
| Regression verification | PASS | `npm.cmd test`; `npm.cmd run check`; `git diff --check` | 59/59 deterministic tests pass and checked JavaScript parses | No semantic percentage is published |

Milestone 21 status: `IMPLEMENTED BUT NOT FULLY VERIFIED`. SOLAT now has a
versioned, evidence-required rubric for future paired evaluation. It deliberately
prevents the existing capture data from being misrepresented as a ChatGPT-parity score.

## Milestone 22 — current Windows package rebuild (2026-08-11)

| Criterion | Status | Exact action | Evidence | Limitation |
|---|---|---|---|---|
| Package is rebuilt from the latest source | PASS | `npm.cmd run build` | Electron Builder completed and produced `dist/win-unpacked/SOLAT.exe` at 2026-08-11 18:41 local workspace time | The packaged executable was not interactively exercised in this build step |
| Provider configuration remains outside source | PASS | Build ran `scripts/copy-local-env.js` after packaging | Local configuration is copied beside the executable; build output explicitly warns not to share it | A configured key still requires an owner-controlled real-provider check before functionality can be claimed |
| UI source disclosure is included in the package source set | PASS | Electron build file set includes `renderer/**/*` and current renderer contains the bounded source drawer/count | Source disclosure is delivered from the current renderer build input | Visual behavior needs an interactive packaged-app check |

Milestone 22 status: `IMPLEMENTED BUT NOT FULLY VERIFIED`. A current Windows
package now exists, but model connectivity and visual interaction in that exact package
still require a bounded launch-and-response check.

## Milestone 23 — packaged startup smoke (2026-08-11)

| Criterion | Status | Exact action | Evidence | Limitation |
|---|---|---|---|---|
| Latest packaged executable starts | PASS | Launched `dist/win-unpacked/SOLAT.exe` hidden for a bounded startup smoke, inspected its process, then stopped that exact test process | Process id 18396 was running and reported `Responding: true` after four seconds | This is a process-start check, not a visual interaction test |
| No paid provider call occurred | PASS | Startup smoke did not submit a conversation | The executable only started and was closed; no provider request was made | Model response behavior remains unverified in the package |
| Source disclosure behavior remains a UI follow-up | NOT VERIFIED | Static renderer contract and package source inclusion were checked in earlier milestones | Renderer has bounded source drawer/count code, but no live in-package search response was submitted | Requires a configured owner-approved provider/search interaction in the packaged application |

Milestone 23 status: `IMPLEMENTED BUT NOT FULLY VERIFIED`. The rebuilt application
starts successfully. Interactive response/source-display verification is intentionally
left unclaimed until it is exercised with an approved live configuration.

## Milestone 24 — context and multi-scope regression expansion (2026-08-11)

| Criterion | Status | Exact action | Evidence | Limitation |
|---|---|---|---|---|
| Follow-up reference keeps its entity and requested source type | PASS | Added an `it`/Ada Lovelace/YouTube corpus case and evaluator assertions | `npm.cmd run evaluate:conversation` reports `resolved_from_context`, retains `Ada Lovelace`, and exposes video scope | This checks router hints, not the model's final wording |
| Multiple requested source scopes remain visible to the model | PASS | Added Pinterest+YouTube corpus case and exact source-scope assertion | Evaluator reports ordered candidates `social`, `video`, `auto` for one user message | It does not make the provider call every scope unnecessarily; tool selection remains model-controlled |
| Regression verification | PASS | `npm.cmd run evaluate:conversation`; `npm.cmd test`; `npm.cmd run check`; `git diff --check` | Corpus: 14 PASS, 0 FAIL, 1 correctly `NOT VERIFIED`; test suite: 59/59 PASS | No paid/provider request was used |

Milestone 24 status: `IMPLEMENTED BUT NOT FULLY VERIFIED`. The most important
context-follow-up and multi-platform routing expectations are now regression-protected.
Live model use of those hints and the packaged source disclosure still need a bounded
real configuration check.

## Milestone 25 — strict comparison identity evidence (2026-08-11)

| Criterion | Status | Exact action | Evidence | Limitation |
|---|---|---|---|---|
| Comparison evidence must identify the named target directly | PASS | Tightened comparison filtering to require the complete normalized target in a result title or canonical URL | Regression rejects `Catch the Wave` even when its snippet says `Han Nari`, and records it as dropped/unrelated | Relevant pages with poor titles/URLs may be withheld; this is intentionally safer than presenting an unsupported comparison citation |
| Raw trace remains diagnosable while UI stays honest | PASS | Kept the rejected-search quality count and existing no-citation rule for incomplete comparisons | The tool trace records `comparison_target_not_found`; visible source count remains zero | The model's prose still needs live review for complete grounding |
| Regression verification | PASS | `npm.cmd test`; `npm.cmd run check`; `git diff --check` | 60/60 deterministic tests pass and checked JavaScript parses | No paid/provider request was used |
| Latest package contains the identity gate | PASS | `npm.cmd run build`, then bounded hidden startup smoke | Rebuilt `dist/win-unpacked/SOLAT.exe` started with process id 2948 and `Responding: true`, then the exact test process was closed | Interactive model/source-display behavior still needs an approved live check |

Milestone 25 status: `IMPLEMENTED BUT NOT FULLY VERIFIED`. SOLAT now refuses a
comparison citation when the target name merely appears incidentally in a snippet. This
reduces false confidence for similarly named people, characters, and event credits.

## Milestone 26 — multi-scope execution and false-comparison prevention (2026-08-11)

| Criterion | Status | Exact action | Evidence | Limitation |
|---|---|---|---|---|
| Explicit multi-platform request runs every requested scope after model selects search | PASS | When a model tool call requests `auto` and the user explicitly named multiple scopes, the conversation boundary executes each requested approved scope and returns a merged tool result | Regression for Pinterest+YouTube records both `social` and `video`, preserves two visible sources, and reports requested scope coverage `complete` | This is bounded to explicitly requested scopes; it does not fan out ordinary `auto` searches |
| Platform list is not mistaken for a people comparison | PASS | Comparison detection now requires an explicit comparison cue (`compare`, `vs`, `versus`, or Thai equivalent) | Regression confirms `Search Pinterest and YouTube for Ada Lovelace` stays a multi-scope request, not two alleged entities | Other natural-language comparison forms need future multilingual expansion |
| Regression verification | PASS | `npm.cmd test`; `npm.cmd run check`; `git diff --check` | 61/61 deterministic tests pass and checked JavaScript parses | No paid/provider request was used |

Milestone 26 status: `IMPLEMENTED BUT NOT FULLY VERIFIED`. A direct request for
multiple approved source types is now carried through the model-selected search boundary
without silently dropping one of them. Live retrieval availability and final answer
quality still require evidence from an approved provider run.

## Milestone 27 — explicit source disclosure UI contract (2026-08-11)

| Criterion | Status | Exact action | Evidence | Limitation |
|---|---|---|---|---|
| Citation drawer has a stable semantic hook | PASS | Added `data-source-disclosure` to the existing compact Sources drawer | UI contract confirms the drawer is attached only from bounded source data and retains the `Sources · N` one-line summary | Static contract does not replace a full visual browser test |
| Incomplete comparison state is visible in metadata while citations stay withheld | PASS | UI contract now asserts the comparison-incomplete disclosure path remains present | Renderer shows the search-status warning but depends on conversation core to supply an empty source list | A live packaged response remains `NOT VERIFIED` without approved provider use |
| Regression verification | PASS | `npm.cmd test`; `npm.cmd run check`; `git diff --check` | 61/61 deterministic tests pass and checked JavaScript parses | No paid/provider request was used |

Milestone 27 status: `IMPLEMENTED BUT NOT FULLY VERIFIED`. The one-line Sources
control now has an explicit UI contract and continues to be hidden when comparison
evidence is incomplete. Live visual behavior still awaits an approved interaction.

## Milestone 28 — conversation-derived entity search qualifiers (2026-08-11)

| Criterion | Status | Exact action | Evidence | Limitation |
|---|---|---|---|---|
| Prior domain context qualifies named-entity search alternatives | PASS | Router now detects recent manhwa/character or music/artist context and appends bounded qualified candidate queries | Regression with `These are manhwa characters` produces `Park Dayoung manhwa character` and `Han Nari manhwa character` after the original complete-name queries | Domain detection is heuristic and needs broader multilingual/evaluation coverage |
| Original message and model freedom are preserved | PASS | Qualifiers remain advisory `search_query_variants` in intent hints | Full original text and history still go to the model; no hard routing gate was introduced | The provider may still choose a different query |
| Regression verification | PASS | `npm.cmd test`; `npm.cmd run check`; `git diff --check` | 61/61 deterministic tests pass and checked JavaScript parses | No paid/provider request was used |

Milestone 28 status: `IMPLEMENTED BUT NOT FULLY VERIFIED`. Entity lookup can now
use an already-stated domain to distinguish names such as a character versus an artist,
without rewriting the user's request or pretending the router has certain identity proof.

## Milestone 29 — Thai comparison parsing regression (2026-08-11)

| Criterion | Status | Exact action | Evidence | Limitation |
|---|---|---|---|---|
| Thai comparison cue is parsed without relying on ASCII word boundaries | PASS | Added Unicode-escaped Thai comparison recognition and Thai separator parsing | Regression for `เปรียบเทียบ Park Dayoung กับ Han Nari` identifies both names and preserves manhwa context qualification | Only the covered Thai comparison forms are proven; broader Thai NLP remains model-assisted |
| Plain multi-platform lists remain distinct from comparisons | PASS | Retained explicit comparison-cue requirement alongside the Thai parser | Existing Pinterest+YouTube regression remains non-comparative | Unusual informal wording needs future corpus expansion |
| Regression verification | PASS | `npm.cmd test`; `npm.cmd run check`; `git diff --check` | 61/61 deterministic tests pass and checked JavaScript parses | No paid/provider request was used |

Milestone 29 status: `IMPLEMENTED BUT NOT FULLY VERIFIED`. Thai explicit comparisons
now follow the same entity-aware path as English `compare`/`vs` requests, while platform
lists are not accidentally turned into named-entity comparisons.

## Milestone 30 — enforceable semantic-review rubric (2026-08-11)

| Criterion | Status | Exact action | Evidence | Limitation |
|---|---|---|---|---|
| Rubric cannot score an incomplete review | PASS | Added `validateSemanticReview` for the versioned six-dimension rubric | Missing score or evidence from either SOLAT/reference response yields `NOT VERIFIED` and no score | This validates review completeness, not the truth of a reviewer's judgment |
| Completed evidence-backed review is distinguished from product parity | PASS | Validator computes a weighted 0–4 result only after all dimensions have two-sided evidence and labels it rubric-review evidence | Regression proves incomplete review cannot score and complete review can; implementation explicitly says it is not a product-parity claim | No real case has been scored under this rubric yet |
| Regression verification | PASS | `npm.cmd test`; `npm.cmd run check`; `git diff --check` | 62/62 deterministic tests pass and checked JavaScript parses | No paid/provider request was used |

Milestone 30 status: `IMPLEMENTED BUT NOT FULLY VERIFIED`. The semantic rubric is
now executable: it rejects unsupported scores rather than merely documenting a policy.
Live three-way captures still need evidence-backed review before any quality figure can
be responsibly reported.

## Milestone 31 — DeepSeek DSML tool-call adapter and approved live recapture (2026-08-11)

| Criterion | Status | Exact action | Evidence | Limitation |
|---|---|---|---|---|
| DSML tool-call markup is not shown to the user as an answer | PASS | Added a strict whole-message DSML parser at the OpenAI-compatible provider boundary; only valid `web_search`-style call structure reaches the normal validated tool loop | `test/core.test.js` contains an end-to-end DSML tool-call case; malformed markup is rejected as `malformed_response` | This supports the observed single-parameter DSML format. New provider markup variants must be added with a regression case before support is claimed |
| Approved live provider recapture completes without exposing DSML markup | PASS | Ran one owner-authorized `npm.cmd run capture:three-way -- --execute --case-ids comparison_candidates ...` after the adapter change | `artifacts/three-way-capture/three-way-comparison_candidates-milestone31-20260811-191500.json`: SOLAT transport PASS; visible response is a grounded clarification, not DSML markup; 3 bounded empty searches are traceable | Both names still had no approved-source evidence, so no source is displayed and no factual comparison is claimed |
| Previous provider-format failure remains auditable | PASS | Preserved the first authorized capture before the fix | `artifacts/three-way-capture/three-way-comparison_candidates-milestone30-20260811-190000.json`: DSML markup was captured as the visible response, which exposed the adapter defect truthfully | This record is diagnostic evidence, not a successful product response |
| Semantic/parity result is not fabricated | NOT VERIFIED | Capture keeps the six-dimension evidence-backed review boundary | Both live capture reports explicitly mark the three-way semantic comparison `NOT VERIFIED` | SOLAT's response quality, source recall, and ChatGPT similarity require further implementation and a completed evidence-backed review |
| Regression verification | PASS | `npm.cmd test`; `npm.cmd run check`; `git diff --check` | 63/63 deterministic tests pass; checked JavaScript parses; diff has no whitespace errors | The live check covered one explicit case and one provider call per path, not all conversations |

Milestone 31 status: `IMPLEMENTED BUT NOT FULLY VERIFIED`. The concrete provider
format defect discovered by live capture is fixed and verified with one approved
recapture. Search recall and semantic quality are deliberately still open work; the
evidence does not support a claim of ChatGPT parity.

## Milestone 32 — identity-result guard and approved source-display capture (2026-08-11)

| Criterion | Status | Exact action | Evidence | Limitation |
|---|---|---|---|---|
| Partial-name pages are withheld for a person-name lookup | PASS | Added a narrow title/URL identity guard for title-cased multi-word names before ranking | Regression rejects an `Adoy` page whose snippet contains separate `Park` and `Dayoung` terms for the query `Park Dayoung` | This is a precision guard; it cannot create a missing trusted source |
| Live search → model → visible sources path works | PASS | Ran one owner-authorized three-way capture for `latest_info_en` | `artifacts/three-way-capture/three-way-latest_info_en-milestone32-20260811-192500.json`: SOLAT PASS, `mode: search_and_model`, `web_search_status: ready`, and four validated Wikipedia sources in the visible response payload | Capture uses the configured DuckDuckGo/Wikipedia path only; social/video search recall is not proven |
| “Latest” quality is accurately bounded | NOT VERIFIED | Inspected the captured SOLAT answer against the wording of the request | The answer correctly cites Ada Lovelace information but uses a general Wikipedia article, not a source proven to be the newest publication | Freshness ranking and authority selection beyond the approved current allowlist are future work |
| Regression verification | PASS | `npm.cmd test`; `npm.cmd run check`; `git diff --check` | 64/64 deterministic tests pass; checked JavaScript parses; diff has no whitespace errors | One live prompt does not establish broad search quality or ChatGPT parity |

Milestone 32 status: `IMPLEMENTED BUT NOT FULLY VERIFIED`. SOLAT now avoids a
specific false-identity failure and has a captured real response with source disclosure.
It still needs a retrieval provider with genuine web-index coverage plus freshness
ranking before it can claim reliable current-information search.

## Milestone 33 — Thai follow-up context and retrieval-capability truthfulness (2026-08-11)

| Criterion | Status | Exact action | Evidence | Limitation |
|---|---|---|---|---|
| Thai follow-up can retain a single recent named entity | PASS | Added Thai reference and search signals while retaining the original message and the model-first route | Regression: `หาข้อมูลเกี่ยวกับเขาพร้อมแหล่งที่มา` after Ada Lovelace resolves the reference and enables `web_search` | Resolution remains advisory and only resolves when one recent named entity is available |
| Live Thai follow-up reaches source-backed SOLAT answer | PASS | Ran one owner-authorized three-way capture with seeded visible prior context | `artifacts/three-way-capture/three-way-follow_up_context_th-milestone33-20260811-193500.json`: SOLAT PASS, `search_and_model`, direct Ada Lovelace response, and two visible Wikipedia sources | ChatGPT reference baseline was not captured for this new case, so semantic comparison is correctly `NOT VERIFIED` |
| Search provider capability is exposed truthfully | PASS | Added provider capability metadata; DuckDuckGo Instant Answer is marked `instant_answer_limited`, while SearXNG/Brave are broad-index capable | Unit checks cover DDG, Wikipedia, SearXNG capability states; status can no longer imply that DDG Instant Answer has general social/video web coverage | A broad web-index provider still needs owner configuration before social/video recall can be verified |
| Regression verification | PASS | `npm.cmd test`; `npm.cmd run check`; `npm.cmd run evaluate:conversation`; `git diff --check` | 64/64 deterministic tests pass; corpus: 15 PASS, 0 FAIL, 1 expected `NOT VERIFIED` | The live check is one conversation case; it does not validate all Thai forms |

Milestone 33 status: `IMPLEMENTED BUT NOT FULLY VERIFIED`. Continuous Thai
conversation context now has real captured evidence and retrieval limitations are
explicit. The remaining retrieval-quality work requires a genuine broad web-index
configuration and expanded multi-source live evaluation.

## Milestone 34 — language-respecting conversation contract (2026-08-11)

| Criterion | Status | Exact action | Evidence | Limitation |
|---|---|---|---|---|
| Response language and Thai tone are explicit model guidance | PASS | Added language-of-latest-user-message and respectful-Thai guidance to the advisory system message | Regression asserts the provider boundary includes both language and respectful-Thai instructions without changing the original user message | A prompt contract guides the model; it cannot guarantee every provider completion's style |
| Live Thai source-backed response follows the contract | PASS | Ran one owner-authorized seeded-context capture after the language guidance change | `artifacts/three-way-capture/three-way-follow_up_context_th-milestone34-20260811-194500.json`: SOLAT response is Thai, contextual, source-backed, and model transport is PASS | No matched ChatGPT baseline is stored for this case, so parity is `NOT VERIFIED` |

## Milestone 35 — aggregate multi-search status truthfulness (2026-08-11)

| Criterion | Status | Exact action | Evidence | Limitation |
|---|---|---|---|---|
| Earlier valid evidence is not overwritten by a later empty search | PASS | Replaced last-search-only status with bounded aggregate status across all tool runs | Regression runs one `ready` and one `empty` search and asserts response status remains `ready` with the visible source | A fully unavailable or degraded provider path needs separate runtime cases |
| Live follow-up reports search status correctly | PASS | Ran one owner-authorized recapture after the aggregation fix | `artifacts/three-way-capture/three-way-follow_up_context_th-milestone35-20260811-195500.json`: `web_search_status: ready` with four visible validated Wikipedia sources | Search source diversity remains limited by the configured Instant Answer provider |
| Regression verification | PASS | `npm.cmd test`; `npm.cmd run check`; `npm.cmd run evaluate:conversation`; `git diff --check` | 65/65 deterministic tests pass; corpus: 15 PASS, 0 FAIL, 1 expected `NOT VERIFIED` | Live verification covers the single seeded Thai follow-up case |

Milestone 35 status: `IMPLEMENTED BUT NOT FULLY VERIFIED`. SOLAT now keeps
conversation context across Thai follow-ups, responds in the user's language, and
reports a multi-search outcome without discarding earlier verified evidence. Genuine
broad social/video web recall and a completed three-way semantic review remain open.

## Milestone 36 — UI search-status consistency (2026-08-11)

| Criterion | Status | Exact action | Evidence | Limitation |
|---|---|---|---|---|
| Compact Sources row uses the aggregate backend search status | PASS | Renderer now mirrors `webSearchStatus` in the compact row rather than presenting the final individual search run as the overall outcome | Static UI regression requires the aggregate `displayStatus` assignment and keeps the one-line Sources disclosure contract | This is a renderer/source contract check; visual layout still needs a packaged interactive check |
| UI scope label reflects all returned evidence scopes | PASS | Renderer reads `searchSummary.source_scopes` first and falls back to the last run only when the summary is absent | UI source-count code keeps multi-scope summary behavior and no frontend provider request is introduced | The configured DDG source cannot prove real multi-platform recall |
| Regression verification | PASS | `npm.cmd test`; `npm.cmd run check`; `git diff --check` | 65/65 deterministic tests pass; checked JavaScript parses; diff has no whitespace errors | No new provider call was needed because this change only maps existing response metadata into the UI |
| Current packaged application starts | PASS | Rebuilt with `npm.cmd run build`, launched `dist/win-unpacked/SOLAT.exe` hidden for four seconds, verified its exact process, then stopped it | Packaged startup smoke: PID 25804 | This startup smoke does not replace an interactive source-disclosure test |

Milestone 36 status: `IMPLEMENTED BUT NOT FULLY VERIFIED`. A source-backed
response can no longer be labelled empty merely because a later bounded lookup did
not find extra material. The remaining search-provider limitation is explicit rather
than hidden.

## Milestone 37 — source disclosure integrity (2026-08-11)

| Criterion | Status | Exact action | Evidence | Limitation |
|---|---|---|---|---|
| Visible Sources panel comes only from validated search evidence | PASS | Removed provider-written Sources blocks from the rendered answer and use only `responseMeta.sources` created by the search-tool path | Static UI regression covers the source metadata path and the disclosure is constructed from `toolSources` only | This does not improve the configured provider's recall or authority choices |
| Unverified model links cannot appear as trusted citations | PASS | Assistant markdown links are converted to ordinary text unless their canonical URL exactly matches a validated tool result | `test/ui.test.js` verifies the `restrictAssistantLinks` guard and its validated-search-only contract | An interactive packaged UI check is still required to assess visual presentation |
| Regression and packaged-startup verification | PASS | `npm.cmd test`; `npm.cmd run check`; `git diff --check`; rebuilt the Windows package and launched its exact executable briefly | 65/65 deterministic tests pass; checked JavaScript parses; diff has no whitespace errors; packaged-startup smoke PASS (PID 23408) | No paid provider call was needed: this change operates after provider output is received; startup does not replace an interactive visual check |

Milestone 37 status: `IMPLEMENTED BUT NOT FULLY VERIFIED`. SOLAT now separates
model prose from evidence-backed source disclosure, so a plausible-looking model URL
cannot be presented as a verified citation. Broad-index search configuration and
interactive visual verification remain open.

## Milestone 38 — truthful scoped-search capability (2026-08-11)

| Criterion | Status | Exact action | Evidence | Limitation |
|---|---|---|---|---|
| A limited search API does not pretend to have searched social/video platforms | PASS | Made social and video requests return `unavailable` with `scope_not_supported` when the configured provider has no scoped web-index capability | New regression covers both scopes with the DDG Instant Answer adapter and asserts no unsupported provider request is made | This deliberately withholds results; it cannot replace a broad-index provider |
| Broad-index adapters retain bounded platform queries | PASS | Kept explicit `site:` constraints for SearXNG/Brave-capable scoped searches and moved the regression fixture to the broad-index adapter | Regression verifies the Pinterest/TikTok and YouTube query constraints are sent through a configured SearXNG boundary | The local configuration is still DDG Instant Answer, so real social/video recall remains `NOT VERIFIED` |
| Regression verification | PASS | `npm.cmd test`; `npm.cmd run check`; `git diff --check` | 66/66 deterministic tests pass; checked JavaScript parses; diff has no whitespace errors | This does not involve a paid provider or a real broad web index |

Milestone 38 status: `IMPLEMENTED BUT NOT FULLY VERIFIED`. A social/video request
will now fail transparently under the current limited provider instead of producing a
misleading empty result. Enabling real platform discovery still requires configuration
of SearXNG or Brave, followed by live verification.

## Milestone 39 — Thai platform and context routing (2026-08-11)

| Criterion | Status | Exact action | Evidence | Limitation |
|---|---|---|---|---|
| Thai platform names produce the intended search scopes | PASS | Added Unicode-safe Thai recognition for TikTok, Pinterest, Instagram, Facebook, and YouTube before generating advisory tool hints | Router regression for a Thai TikTok-and-YouTube request produces `social`, `video`, and `auto` candidates and enables `web_search` | The router remains advisory: the model may still determine that clarification is needed |
| Thai manhwa/music context reaches disambiguation hints | PASS | Replaced fragile encoding-dependent Thai patterns with Unicode-safe patterns for manhwa/character and music context | Regression confirms Thai prior context produces the `manhwa character` qualifier for a later ambiguous comparison | Candidate resolution and source choice still need real broad-index evidence for obscure entities |
| Regression verification | PASS | `npm.cmd test`; `npm.cmd run check`; `git diff --check` | 66/66 deterministic tests pass; checked JavaScript parses; diff has no whitespace errors | No paid provider call was needed for deterministic routing coverage |

Milestone 39 status: `IMPLEMENTED BUT NOT FULLY VERIFIED`. Thai search requests
now generate the same scoped search hints as their English equivalents. The remaining
gap is not language recognition but live evidence quality from a genuine web index.

## Milestone 40 — regression evidence for Thai retrieval intent (2026-08-11)

| Criterion | Status | Exact action | Evidence | Limitation |
|---|---|---|---|---|
| Corpus covers Thai multi-scope search and Thai manhwa context | PASS | Added two deterministic conversation cases and a context-qualifier assertion to the evaluator | `npm.cmd run evaluate:conversation`: 17 PASS, 0 FAIL, 1 expected `NOT VERIFIED`; the new Thai cases both PASS | This verifies routing inputs and expected hints, not a live social/video search result |
| Full local regression remains green | PASS | Ran evaluator plus `npm.cmd test`, `npm.cmd run check`, and `git diff --check` | 66/66 unit and integration tests pass; JavaScript syntax checks and whitespace check pass | The one `NOT VERIFIED` corpus row intentionally prevents treating deterministic behavior as live semantic parity |

Milestone 40 status: `IMPLEMENTED BUT NOT FULLY VERIFIED`. The regression suite
now proves that Thai platform requests and Thai fictional-work context enter the same
search/ambiguity path as English equivalents. It still cannot prove external-source
quality without an enabled broad web index and a live evidence capture.

## Milestone 41 — requested-platform evidence selection (2026-08-11)

| Criterion | Status | Exact action | Evidence | Limitation |
|---|---|---|---|---|
| Explicit platform request narrows allowed evidence to that platform | PASS | Added platform-host extraction before scoped retrieval and allowlist filtering | Regression: a TikTok request emits only `site:tiktok.com` and accepts only TikTok URLs; a Thai Pinterest request emits only `site:pinterest.com` and accepts only Pinterest URLs | A generic social request still intentionally permits all approved social platforms |
| Source selection remains bounded for broad-index adapters | PASS | Preserved URL allowlisting and added host-specific constraints in the actual SearXNG/Brave query path | `npm.cmd test`: scoped-query regression passes alongside existing unsafe-URL and identity-guard checks | Local DDG Instant Answer remains incapable of a real scoped web search and will report that state truthfully |
| Regression verification | PASS | `npm.cmd test`; `npm.cmd run check`; `git diff --check` | 66/66 deterministic tests pass; syntax and whitespace checks pass | No live broad-index provider was configured for this run |

Milestone 41 status: `IMPLEMENTED BUT NOT FULLY VERIFIED`. When a user names a
specific supported platform, SOLAT will no longer substitute evidence from a different
social platform. Live retrieval quality remains dependent on configuring a genuine
broad web index.

## Milestone 42 — truthful no-tool search response (2026-08-11)

| Criterion | Status | Exact action | Evidence | Limitation |
|---|---|---|---|---|
| Explicit search request is not silently presented as ordinary model-only research | PASS | Added `model_without_requested_search`, `available_not_used`, and search-request/use metadata when the model declines its offered tool | Conversation-core regression simulates a model reply with zero tool calls and asserts no visible sources, `search_requested: true`, and `search_used: false` | This keeps the model in control of tool choice; it does not force a search call |
| UI shows missing search use rather than hiding it | PASS | Added a compact Search row when a search was requested but no tool evidence exists | Static UI regression requires the `search_requested` branch and the visible “tool available but not used” notice | Packaged visual layout remains `NOT VERIFIED` until an interactive check |
| Regression verification | PASS | `npm.cmd test`; `npm.cmd run check`; `git diff --check` | 67/67 deterministic tests pass; syntax and whitespace checks pass | No paid provider call was required |

Milestone 42 status: `IMPLEMENTED BUT NOT FULLY VERIFIED`. SOLAT now makes a
search omission visible in both response metadata and the UI instead of showing an
unmarked model-only answer after an explicit research request.

## Milestone 43 — revision-aware three-way evidence (2026-08-11)

| Criterion | Status | Exact action | Evidence | Limitation |
|---|---|---|---|---|
| New paid captures record the implementation revision and sanitized search capability | PASS | Added revision and search-status provenance to future three-way capture artifacts | Capture script records `implementation.git_revision` and `search` status without provider secrets | Existing legacy artifacts cannot be retroactively assigned a trustworthy revision |
| Coverage report distinguishes old captures from evidence of current code | PASS | Coverage report now compares each artifact revision to the current Git revision | `npm.cmd run report:three-way`: 18 cases, 13 complete legacy captures, 0 captures verified for the current revision, and all 18 require manual semantic review | This is an honest evidence boundary, not a failure of the app code |
| Regression verification | PASS | `npm.cmd run report:three-way`; `npm.cmd test`; `npm.cmd run check`; `git diff --check` | 67/67 deterministic tests pass; report and syntax checks run successfully | Current-revision live evidence still requires a deliberately authorized capture after code is finalized |

Milestone 43 status: `IMPLEMENTED BUT NOT FULLY VERIFIED`. SOLAT will no longer
allow a capture from an unknown or older implementation revision to be treated as
proof for the latest code. The report truthfully shows that fresh capture work remains.

## Milestone 44 — conservative joined-name variants (2026-08-11)

| Criterion | Status | Exact action | Evidence | Limitation |
|---|---|---|---|---|
| Joined TitleCase names gain a non-destructive spaced search variant | PASS | Added `titlecase_spacing_variant`, e.g. `ParkDayoung` → `Park Dayoung`, while preserving the original query | Router regression asserts both forms are available in bounded query variants | Fully lowercase unknown tokens are intentionally not spell-corrected because that would invent a name |
| Conversation/search regression remains green | PASS | `npm.cmd test`; `npm.cmd run evaluate:conversation`; `npm.cmd run check`; `git diff --check` | 67/67 tests pass; deterministic corpus: 17 PASS, 0 FAIL, 1 expected `NOT VERIFIED` | This improves query preparation, not external retrieval availability |

Milestone 44 status: `IMPLEMENTED BUT NOT FULLY VERIFIED`. SOLAT can now recover
one common pasted-name format without silently rewriting unknown spelling. Real
evidence quality remains contingent on a configured broad web-index provider.

## Milestone 45 — Brave live search and current-revision three-way capture (2026-08-11)

| Criterion | Status | Exact action | Evidence | Limitation |
|---|---|---|---|---|
| Configured broad web search remains secret-safe | PASS | Read the configured search status without printing the key | Brave adapter reports `configured: true`, `enabled: true`, `web_index: broad`, and scoped web search enabled | Configuration status does not itself prove retrieval quality |
| Live approved-platform search returns visible evidence | PASS | Performed one authorized Brave query for `Ada Lovelace TikTok` with social scope | The request was bounded to `site:tiktok.com` and returned one allowed TikTok discovery URL, with no provider errors | This is one live smoke case, not coverage of every entity or platform |
| Current-revision three-way capture for social search | PASS | Ran one authorized `social_scope` capture using the existing isolated ChatGPT baseline, raw DeepSeek, and SOLAT | `artifacts/three-way-capture/three-way-social_scope-brave-current-20260811-195000.json`: all three capture outcomes are `PASS`; SOLAT used 3 bounded tool rounds, reports `search_and_model`, and exposes one TikTok source | The ChatGPT baseline was captured earlier; semantic quality is not inferred from transport success |
| Coverage report reads capture revision correctly | PASS | Corrected the report to retain capture-level implementation metadata before comparing revisions | `npm.cmd run report:three-way`: 18 cases, 13 complete captures, 1 capture matched the current implementation revision | Only one of the 18 cases has fresh current-revision evidence |
| Semantic parity claim | NOT VERIFIED | Retained the six-dimension evidence-backed rubric without auto-scoring | The social capture explicitly marks comparison `NOT VERIFIED` and `manual_review_required: true` | A successful call and source citation do not establish 75–85% ChatGPT equivalence |
| Regression verification | PASS | `npm.cmd test`; `npm.cmd run evaluate:conversation`; `npm.cmd run check`; `git diff --check` | 67/67 tests pass; deterministic corpus 17 PASS, 0 FAIL, 1 expected NOT VERIFIED; syntax and whitespace checks pass | No full new paid 18-case run was performed |

Milestone 45 status: `IMPLEMENTED BUT NOT FULLY VERIFIED`. The configured Brave
adapter has now produced one real, platform-bounded result through SOLAT and the
three-way evidence report can correctly identify that capture as belonging to the
current application revision. Broader source-quality and semantic comparisons remain
explicitly unverified until separate, evidence-backed captures are collected.

## Milestone 46 — bounded provider context for long conversations (2026-08-11)

| Criterion | Status | Exact action | Evidence | Limitation |
|---|---|---|---|---|
| Long chat avoids avoidable context-limit failure | PASS | Added a provider-facing context window that selects most-recent complete turns within a bounded character budget | Unit test proves the latest user input remains complete, older stored history remains untouched, and omitted-turn count is visible in response metadata | This is deterministic recency selection, not a semantic summary of omitted history |
| Routing and ownership continue to see full session history | PASS | Kept the full history as the stored session and router input; bounded only the message list sent to the model | `ConversationCore` continues to append all user/assistant turns after a successful response | Very long conversations can still require the user to restate an old detail that no longer fits the provider window |
| Regression verification | PASS | `npm.cmd test`; `npm.cmd run evaluate:conversation`; `npm.cmd run check`; `git diff --check` | 68/68 tests pass; deterministic corpus 17 PASS, 0 FAIL, 1 expected NOT VERIFIED; syntax and whitespace checks pass | No paid call was needed because this change is a deterministic provider-boundary guard |

Milestone 46 status: `IMPLEMENTED BUT NOT FULLY VERIFIED`. SOLAT now preserves
the latest user message and recent conversational flow while preventing unbounded
history from causing a predictable provider context-length failure. It does not claim
that omitted older turns have been semantically summarized or recovered.

## Milestone 47 — ordinal follow-up resolution (2026-08-11)

| Criterion | Status | Exact action | Evidence | Limitation |
|---|---|---|---|---|
| Follow-up references retain comparison order | PASS | Added chronological extraction of earlier comparison candidates and ordinal recognition for first/second and Thai equivalents | New corpus case resolves `Find the first one on Pinterest` after `Compare Park-Dayoung and Han Nari` to `Park-Dayoung` and creates the bounded context query variant | Resolution is advisory; it does not assert that either name belongs to a particular real-world entity |
| Ordinary prose is less likely to become a fake entity | PASS | Excluded common sentence-openers such as `We were` from TitleCase candidate extraction | Existing Ada Lovelace follow-up case still resolves the person rather than an English sentence opener | Unusual names written only in scripts without spaces may still need user context or search evidence |
| Regression verification | PASS | `npm.cmd test`; `npm.cmd run evaluate:conversation`; `npm.cmd run check`; `git diff --check` | 68/68 tests pass; deterministic corpus 18 PASS, 0 FAIL, 1 expected NOT VERIFIED | This validates routing and query construction, not a paid live semantic comparison |

Milestone 47 status: `IMPLEMENTED BUT NOT FULLY VERIFIED`. SOLAT can use a
bounded, ordered comparison context for common follow-ups without rewriting the
user's message or treating its routing hint as a fact.

## Milestone 48 — source-diverse evidence ranking (2026-08-11)

| Criterion | Status | Exact action | Evidence | Limitation |
|---|---|---|---|---|
| Generic search avoids a repeated-host answer list | PASS | Added a soft two-result-per-host preference after URL deduplication and relevance ranking | Regression verifies an approved second host is shown before a third duplicate host | This does not imply independent factual corroboration; it only improves result diversity |
| Explicit platform request remains faithful | PASS | Disabled the soft host cap when the query explicitly names one allowed platform | Regression keeps three relevant Pinterest results available in explicit-platform mode | A platform's own results can still be low quality; relevance and URL safety gates remain separate |
| Evidence carries source diversity metadata | PASS | Added `distinct_source_hosts` to the search-quality trace | Returned evidence records how many approved hosts contributed results | This is diagnostic metadata, not a quality score or a truth claim |
| Regression verification | PASS | `npm.cmd test`; `npm.cmd run evaluate:conversation`; `npm.cmd run check`; `git diff --check` | 68/68 tests pass; deterministic corpus 18 PASS, 0 FAIL, 1 expected NOT VERIFIED | No paid call was needed because ranking is deterministic |

Milestone 48 status: `IMPLEMENTED BUT NOT FULLY VERIFIED`. Generic searches now
favor a more useful spread of approved sources while explicit TikTok, Pinterest, and
other supported-platform requests still honor the user's chosen scope.

## Milestone 49 — exact identity-source guard (2026-08-11)

| Criterion | Status | Exact action | Evidence | Limitation |
|---|---|---|---|---|
| Same-name Wikipedia pages are not treated as the requested person | PASS | Tightened identity matching from substring matching to an exact source label or exact final URL slug, allowing a source separator such as `Park Dayoung — character profile` | Regressions reject `Ada Lovelace Award` and `Ada Lovelace (microarchitecture)` for an Ada Lovelace identity request while accepting an exact TikTok discovery slug | This intentionally withholds loosely titled visual boards rather than risk presenting a same-name topic as the person |
| Live capture exposed the prior evidence-quality defect honestly | PASS | Ran one authorized current-revision three-way capture for `latest_info_en`, then inspected visible sources rather than assuming transport PASS implied relevance | `artifacts/three-way-capture/three-way-latest_info_en-diversity-current-20260811-202900.json` captured all three responses; inspection found three same-name but unrelated Wikipedia pages, triggering this fix | The pre-fix capture is evidence of the defect, not proof of the corrected behavior |
| Regression verification | PASS | `npm.cmd test`; `npm.cmd run evaluate:conversation`; `npm.cmd run check`; `git diff --check` | 68/68 tests pass; deterministic corpus 18 PASS, 0 FAIL, 1 expected NOT VERIFIED | Corrected live retrieval still needs a separate future capture before semantic quality can be claimed |

Milestone 49 status: `IMPLEMENTED BUT NOT FULLY VERIFIED`. A source must now
identify the requested named subject itself rather than merely begin with the same
words. This reduces a concrete class of misleading citations found in live evidence.

## Milestone 50 — post-fix live identity evidence (2026-08-11)

| Criterion | Status | Exact action | Evidence | Limitation |
|---|---|---|---|---|
| Corrected identity guard survives a real provider run | PASS | Performed one authorized `latest_info_en` three-way capture after the exact-identity fix | `artifacts/three-way-capture/three-way-latest_info_en-identity-guard-current-20260811-203400.json`: all three captures PASS; SOLAT uses Brave + DeepSeek in `search_and_model` mode and exposes only `Ada Lovelace - Wikipedia` | One source does not establish that this is the newest or best possible academic source |
| Same-name pages are absent from visible SOLAT sources | PASS | Inspected the visible source list and tool trace in the post-fix artifact | The prior Award/microarchitecture/Day pages are absent; auto search has one ready evidence result and two truthful empty tool attempts | This is one identity query; other entities and languages require separate evidence |
| Semantic parity claim | NOT VERIFIED | Retained manual rubric boundary for the captured answer | Capture comparison is `NOT VERIFIED`, with all six semantic dimensions requiring evidence-backed review | Transport success and a correct source label do not prove ChatGPT parity |

Milestone 50 status: `IMPLEMENTED BUT NOT FULLY VERIFIED`. The exact-identity
guard now has live evidence for one named-person query. It improves citation
correctness but does not yet establish broad search recall, multilingual entity
resolution, or semantic equivalence.

## Milestone 51 — Thai ordinal follow-up regression (2026-08-11)

| Criterion | Status | Exact action | Evidence | Limitation |
|---|---|---|---|---|
| Thai `คนแรก` resolves a preceding comparison candidate | PASS | Added a Thai corpus case using the same Park-Dayoung/Han Nari history as the English ordinal case | `npm.cmd run evaluate:conversation`: `thai_ordinal_follow_up_context` PASS; the bounded query variant is `Park-Dayoung` with social scope | The referenced entities are Latin-script examples; arbitrary Thai-script names still depend on search evidence and model interpretation |
| Regression verification | PASS | `npm.cmd test`; `npm.cmd run evaluate:conversation`; `npm.cmd run check`; `git diff --check` | 68/68 tests pass; corpus 19 PASS, 0 FAIL, 1 expected NOT VERIFIED | No provider call was required because this is a routing regression |

Milestone 51 status: `IMPLEMENTED BUT NOT FULLY VERIFIED`. English and Thai
ordinal follow-ups now have matched deterministic coverage without changing the
user's actual message or bypassing tool safety.

## Milestone 52 — preserve explicit platforms across model tool calls (2026-08-11)

| Criterion | Status | Exact action | Evidence | Limitation |
|---|---|---|---|---|
| Model-shortened tool query cannot widen an explicit platform request | PASS | Added scope-specific platform terms back to a model tool call when the original user request names Pinterest, TikTok, Instagram, Facebook, or YouTube | Regression sends `Ada Lovelace Pinterest` to social scope and `Ada Lovelace YouTube` to video scope, even when the model initially requests only `Ada Lovelace` | This constrains retrieval; it does not certify the authenticity of an account returned by a platform |
| Live evidence identified the widening defect | PASS | Performed one authorized multi-scope capture and inspected all visible sources | `artifacts/three-way-capture/three-way-multi_scope-live-20260811-204100.json` shows the pre-fix social run exposed Instagram and TikTok alongside the requested Pinterest, while the video run returned YouTube results | This pre-fix artifact is retained as evidence of the defect, not proof of corrected runtime behavior |
| Regression verification | PASS | `npm.cmd test`; `npm.cmd run evaluate:conversation`; `npm.cmd run check`; `git diff --check` | 68/68 tests pass; corpus 19 PASS, 0 FAIL, 1 expected NOT VERIFIED | A fresh live capture after this code change is still required |

Milestone 52 status: `IMPLEMENTED BUT NOT FULLY VERIFIED`. Explicit platform
requests now survive the model-to-tool boundary and therefore keep evidence and the
visible source disclosure within the platforms the user named.

## Milestone 53 — repeat-search cost and trace guard (2026-08-11)

| Criterion | Status | Exact action | Evidence | Limitation |
|---|---|---|---|---|
| Repeated identical scoped search runs once per user turn | PASS | Added a per-turn cache keyed by the constrained query and source scope before the search adapter is called | Regression makes the model request the same Pinterest tool call twice and confirms the physical adapter runs once | The cache is intentionally limited to one response turn; a later user message may search again for fresh results |
| Audit trail remains complete | PASS | Kept one trace record for every model tool call and marked the second call as `cache_reused` | Regression confirms two model calls remain visible while only one provider/search execution occurs | This records execution reuse, not semantic correctness of the source result |
| Multi-scope results are not conflated | PASS | Cache key includes the source scope, so an identical text query for Pinterest and YouTube remains two independent retrievals | Regression confirms separate Pinterest and YouTube executions and platform-preserving query text | This does not increase recall on a platform that returns no approved results |
| Regression verification | PASS | `npm.cmd test`; `npm.cmd run evaluate:conversation`; `npm.cmd run check`; `git diff --check` | 68/68 tests pass; corpus 19 PASS, 0 FAIL, 1 expected NOT VERIFIED; syntax and whitespace checks pass | No paid call was needed because this is deterministic request de-duplication |

Milestone 53 status: `IMPLEMENTED BUT NOT FULLY VERIFIED`. SOLAT now avoids
duplicating an identical scoped web search during one answer while retaining an
honest per-tool-call trace. It does not cache across separate user turns and does
not claim that cached evidence is automatically current.

## Milestone 54 — contextual qualifier for same-name follow-ups (2026-08-11)

| Criterion | Status | Exact action | Evidence | Limitation |
|---|---|---|---|---|
| Follow-up search retains one unambiguous prior domain | PASS | Added a bounded query qualifier only when recent context has exactly one domain and the model tool query has no domain of its own | Regression first discusses `Park Dayoung` as a `manhwa character`, then verifies a later `Find more sources about her` tool request becomes `Park Dayoung manhwa character` | The qualifier is an advisory retrieval hint, not a fact about the person or a replacement for real evidence |
| New user domain takes precedence | PASS | Skipped the prior qualifier whenever the model query already names a domain such as singer, music, manhwa, manga, character, or anime | The helper has an explicit no-append guard before a tool call is made | A query that is still ambiguous after this guard can require clarification or return an honest insufficient-evidence result |
| User message and model-first flow stay intact | PASS | Preserved the original current message and conversation history; adjusted only the bounded tool query supplied by the model | `ConversationCore` still passes the complete latest user message and advisory router hints to the provider | No live provider call was made for this deterministic query-construction change |
| Regression verification | PASS | `npm.cmd test`; `npm.cmd run evaluate:conversation`; `npm.cmd run check`; `git diff --check` | 70/70 tests pass; corpus 19 PASS, 0 FAIL, 1 expected NOT VERIFIED; syntax and whitespace checks pass | Semantic parity with an external model remains `NOT VERIFIED` pending paired evidence and rubric review |

Milestone 54 status: `IMPLEMENTED BUT NOT FULLY VERIFIED`. SOLAT now carries
one clear conversational domain into a follow-up search to reduce same-name
mix-ups, while allowing an explicitly newly qualified query to override prior
context.

## Milestone 55 — live search-and-model delivery smoke (2026-08-11)

| Criterion | Status | Exact action | Evidence | Limitation |
|---|---|---|---|---|
| Configured DeepSeek and Brave path completes one real answer | PASS | Ran one authorized `npm.cmd run smoke:live-search` invocation; no retry was used | `artifacts/live-search-smoke/live-search-smoke-20260811-211500.json`: DeepSeek V4 Flash + Brave, 4,080 ms, 1,453 prompt tokens and 55 completion tokens reported by the provider | Provider usage is recorded only as returned metadata; it is not a billing ledger |
| Model-selected search produces a validated visible source | PASS | Smoke prompt required the model to call `web_search` before answering | Artifact records `search_and_model`, one tool round, ready encyclopedic evidence, and one allowed `Ada Lovelace` Wikipedia URL | One named-person smoke case does not prove recall for social platforms, multilingual names, or ambiguous queries |
| Failure state remains truthful | PASS | Harness would record FAIL/NOT VERIFIED instead of fabricating a source if provider, search, or tool output failed | `src/core/live-search-smoke.js` evaluates readiness, tool use, allowed URL evidence, and provider failure separately | This run verifies the source/core path, not an interactive desktop click-through |

Milestone 55 status: `IMPLEMENTED BUT NOT FULLY VERIFIED`. One bounded live
request confirms the configured production adapters can produce a grounded reply
with a validated source. Broader conversation quality and ChatGPT parity remain
separate, unverified claims.

## Milestone 56 — truthful search degradation (2026-08-11)

| Criterion | Status | Exact action | Evidence | Limitation |
|---|---|---|---|---|
| A web-search timeout no longer discards an otherwise usable model answer | PASS | Converted a tool execution exception into an explicit `unavailable` tool result for the model, without retrying it | Regression causes a `timeout` search failure and verifies the final response remains available in `search_and_model` mode | If the model provider itself fails or returns malformed output, the response still fails truthfully |
| No source or upstream error detail is fabricated | PASS | Returned zero results/sources plus a normalized error code and a generic safe message | Regression verifies no visible sources, unavailable search status, one error count, and `search_unavailable` quality state | The user-facing final wording remains the model's responsibility, guided by the system instruction to state the limitation plainly |
| Repeated failed call remains bounded | PASS | Stored the unavailable result in the same per-turn scoped cache used for successful results | `ConversationCore` applies the existing cache key before a second identical call could invoke the adapter again | Separate user turns can intentionally retry a search because freshness may have changed |
| Regression verification | PASS | `npm.cmd test`; `npm.cmd run evaluate:conversation`; `npm.cmd run check`; `git diff --check` | 71/71 tests pass; corpus 19 PASS, 0 FAIL, 1 expected NOT VERIFIED; syntax and whitespace checks pass | No paid call was required for this deterministic failure-boundary behavior |

Milestone 56 status: `IMPLEMENTED BUT NOT FULLY VERIFIED`. Search degradation
now has a usable, truthful path: SOLAT can explain that approved search did not
complete rather than presenting a blank failure as if no answer could be given.

## Milestone 57 — DeepSeek multi-tool compatibility and comparison boundary (2026-08-11)

| Criterion | Status | Exact action | Evidence | Limitation |
|---|---|---|---|---|
| DSML tool calls with multiple arguments and lead-in prose are accepted safely | PASS | Extended the DeepSeek-compatible DSML parser to accept multiple named parameters inside one valid block and to retain only non-markup lead-in prose | Regression exercises `query` plus `source_scope` and verifies DSML markup is not copied into the following assistant turn | Partially formed, duplicate, or multiple DSML blocks remain hard failures rather than being guessed |
| Tool-call history remains compatible with DeepSeek V4 | PASS | Preserved an empty assistant string instead of `null`, preserved reasoning text when present, and used the cleaned visible content rather than raw DSML markup | Deterministic provider tests cover standard and DSML turns; a direct authorized API inspection returned standard OpenAI-compatible `tool_calls` with both arguments | Thinking-mode behavior is not claimed because SOLAT is configured for non-thinking mode |
| Two-name comparison receives a bounded complete pair budget | PASS | Raised only explicit two-candidate comparisons from three to six tool calls across the existing three rounds | Regression verifies the comparison-specific cap; generic requests remain capped at three | This can use more search/model calls for a comparison and still stops after the fixed cap |
| Tool-loop recovery synthesizes without another tool call | PASS | When the provider persists in tool-call mode after the cap, create one separate, tool-free synthesis from completed evidence only | Regression confirms no further tool execution and a final evidence-bound response | This is one bounded recovery model request, not a semantic-quality guarantee |
| Live ambiguous comparison delivers rather than fails | PASS | One authorized live request: `Compare Park Dayoung and Han Nari. Are they manhwa characters?` | DeepSeek V4 Flash completed in `search_and_model` mode after 3 tool rounds; both candidate names had independent empty evidence and the answer stated the evidence was insufficient | The result is a truthful no-evidence response; it does not establish that the names are or are not manhwa characters |
| Regression verification | PASS | `npm.cmd test`; `npm.cmd run evaluate:conversation`; `npm.cmd run check`; `git diff --check` | 72/72 tests pass; corpus 19 PASS, 0 FAIL, 1 expected NOT VERIFIED; syntax and whitespace checks pass | Broader search recall and external-model semantic parity remain unverified |

Milestone 57 status: `IMPLEMENTED BUT NOT FULLY VERIFIED`. The production path
now handles the real DeepSeek multi-tool protocol and produces a bounded,
evidence-only response instead of failing when an ambiguous comparison exhausts
its allowed searches. It correctly reports missing evidence rather than inventing
an identity or a comparison.

## Milestone 58 — social discovery for character/manhwa requests (2026-08-11)

| Criterion | Status | Exact action | Evidence | Limitation |
|---|---|---|---|---|
| Character/manhwa language exposes social discovery as an advisory scope | PASS | Added social scope candidate when the user mentions manhwa, webtoon, manga, character, fanart, fandom, or Thai equivalents | Router regression for `Compare Park Dayoung and Han Nari. Are they manhwa characters?` returns `social, auto` while leaving model-first routing intact | This does not force every model request to use social search or claim that a social result is authoritative |
| Live comparison returns distinct visible sources for both names | PASS | Performed one authorized live comparison after the scope change | DeepSeek V4 Flash completed in 2 tool rounds; SOLAT exposed three allowlisted social discovery sources, including separate TikTok discovery URLs for Park Dayoung and Han Nari | The available evidence is social discovery, not an official publisher, author, or encyclopedic record |
| Source-quality limitation is expressed in the final answer | PASS | The visible answer identified its social-source limitation and advised verification against official/publisher material | Live response explicitly separated its conclusion from the lack of official confirmation | Model wording is not an independently scored factual verification; external semantic parity remains `NOT VERIFIED` |
| Regression verification | PASS | `npm.cmd test`; `npm.cmd run evaluate:conversation`; `npm.cmd run check` | 72/72 tests pass; corpus 19 PASS, 0 FAIL, 1 expected NOT VERIFIED | This live run does not prove broad platform recall or a general identity-resolution rate |

Milestone 58 status: `IMPLEMENTED BUT NOT FULLY VERIFIED`. SOLAT can now
select social discovery for character-oriented questions and disclose the returned
sources, while keeping the distinction between social evidence and authoritative
confirmation visible.

## Milestone 59 — evidence authority labels (2026-08-11)

| Criterion | Status | Exact action | Evidence | Limitation |
|---|---|---|---|---|
| Search evidence distinguishes social/video discovery from encyclopedic evidence | PASS | Added deterministic authority levels: `social_discovery`, `video_discovery`, `encyclopedic`, `mixed_with_encyclopedic`, `approved_web`, or `none` | Unit tests cover Pinterest/TikTok-only, YouTube-only, Wikipedia-only, and mixed source sets | A domain class is not a factual truth score; a Wikipedia page can still be incomplete and a social/video post can still be useful |
| Model receives a calibrated-language instruction | PASS | Added a provider system instruction that social-only evidence must be phrased as indication/reporting, with the missing stronger source stated | Conversation core continues to send the original user message and full advisory hints, adding only evidence-level guidance | This does not guarantee each model response obeys perfectly; a future live language-quality review is still required |
| Regression verification | PASS | `npm.cmd test`; `npm.cmd run evaluate:conversation`; `npm.cmd run check` | 72/72 tests pass; corpus 19 PASS, 0 FAIL, 1 expected NOT VERIFIED | No paid call was used for this deterministic classification and prompt-boundary change |

Milestone 59 status: `IMPLEMENTED BUT NOT FULLY VERIFIED`. SOLAT can now make
the difference between social discovery and stronger reference evidence explicit
to the model before it writes a user-facing answer.

## Milestone 60 — persist evidence authority for UI reloads (2026-08-11)

| Criterion | Status | Exact action | Evidence | Limitation |
|---|---|---|---|---|
| Source authority survives conversation reload | PASS | Persisted `quality.authority_level` with search evidence and retained source scopes/hosts in the sanitized response metadata | Persistence regression restores `social_discovery` and the `social` scope while still redacting API-key text | Persisted metadata is an audit/display record; it does not refresh old web evidence |
| UI can disclose the level after reopening a thread | PASS | Renderer reads the restored evidence quality and adds the authority label to the one-line search disclosure | UI regression covers the authority label branch and source disclosure path | Interactive desktop click-through remains a separate manual check |
| Regression verification | PASS | `npm.cmd test`; `npm.cmd run evaluate:conversation`; `npm.cmd run check`; `git diff --check` | 72/72 tests pass; corpus 19 PASS, 0 FAIL, 1 expected NOT VERIFIED; syntax and whitespace checks pass | No paid call was needed for persistence/UI metadata |

Milestone 60 status: `IMPLEMENTED BUT NOT FULLY VERIFIED`. Reopening a
conversation no longer loses the evidence-quality label that tells the user how
strong the displayed sources are.

## Milestone 61 — shared exact-identity guard at conversation boundary (2026-08-11)

| Criterion | Status | Exact action | Evidence | Limitation |
|---|---|---|---|---|
| All adapters use the same identity guard before comparison citations appear | PASS | ConversationCore now delegates comparison-target validation to the web-search exact-title/URL-slug guard instead of using a weaker substring check | Full regression retains the existing event-snippet and unrelated-name rejection cases; adapter and conversation paths now share one implementation | Exact matching can intentionally withhold a loosely titled page until stronger evidence appears |
| Comparison evidence cannot be completed from a partial name mention | PASS | Kept the existing `comparison_target_not_found` and visible-source withholding behavior while strengthening the boundary | `npm.cmd test` passes the comparison split, event snippet, partial-name, and citation withholding tests | This is citation correctness, not a guarantee of broad search recall |
| Regression verification | PASS | `npm.cmd test`; `npm.cmd run evaluate:conversation`; `npm.cmd run check` | 72/72 tests pass; corpus 19 PASS, 0 FAIL, 1 expected NOT VERIFIED | No paid call was needed because the change unifies deterministic validation |

Milestone 61 status: `IMPLEMENTED BUT NOT FULLY VERIFIED`. Same-name and
comparison results now pass through one exact identity rule regardless of which
approved search adapter produced them.

## Milestone 62 — preserve authority metadata in three-way captures (2026-08-11)

| Criterion | Status | Exact action | Evidence | Limitation |
|---|---|---|---|---|
| Three-way evidence records source authority for later comparison | PASS | Extended `captureSolat` to retain search-quality status, ambiguity, and `authority_level` for every bounded search run | Regression captures an encyclopedic result and asserts the authority metadata is present in the report | This records evidence provenance; it does not score whether the answer is factually correct |
| Regression verification | PASS | `npm.cmd test`; `npm.cmd run check`; `git diff --check` | 72/72 deterministic tests pass; syntax and whitespace checks pass | No paid call was needed because the change only preserves already-returned metadata |

Milestone 62 status: `IMPLEMENTED BUT NOT FULLY VERIFIED`. The paired/three-way
report can now distinguish the quality of evidence used by SOLAT instead of
showing only a source count. Semantic parity with external models remains
`NOT VERIFIED` until a complete evidence-backed review is supplied.

## Milestone 63 — separate scope selection from evidence success (2026-08-11)

| Criterion | Status | Exact action | Evidence | Limitation |
|---|---|---|---|---|
| Search metadata distinguishes router candidates, attempted scopes, and ready evidence | PASS | Added `candidate_source_scopes`, `candidate_source_scopes_used`, and separate requested-scope completion fields to `searchSummary` | Regression covers a YouTube scope that was attempted but returned empty, and a multi-scope request that returned both scopes | A scope can be attempted successfully at the adapter boundary while returning no relevant evidence |
| Persistence retains scope-selection truth after reload | PASS | Persisted candidate/requested scopes, used scopes, statuses, and authority levels through the sanitized response metadata | Conversation persistence regression restores scope and authority metadata without exposing secrets | Persisted metadata is historical and does not re-run search |
| Three-way capture carries scope-selection truth for review | PASS | Added bounded `search_summary` to SOLAT capture rows alongside per-run evidence | Three-way regression asserts candidate-used and requested-complete fields | Semantic comparison still requires a human evidence-backed rubric |
| Regression verification | PASS | `npm.cmd test`; `npm.cmd run check`; `git diff --check` | 72/72 deterministic tests pass; syntax and whitespace checks pass | No paid call was needed for this metadata-only change |

Milestone 63 status: `IMPLEMENTED BUT NOT FULLY VERIFIED`. Reports now avoid
the misleading shortcut where “a scope was suggested” or “a scope was called”
is treated as proof that usable evidence was found.

## Milestone 64 — classify video discovery separately (2026-08-11)

| Criterion | Status | Exact action | Evidence | Limitation |
|---|---|---|---|---|
| YouTube evidence is not mislabeled as social evidence | PASS | Added `video_discovery` authority level for YouTube/youtu.be-only results | Web-search regression asserts YouTube-only results receive `video_discovery`; social-only results remain `social_discovery`; owner-authorized runtime capture `artifacts/three-way-capture/three-way-video-authority-20260811-211449.json` records the revised revision and truthful empty-scope result | This is source-type classification, not a factual truth score |
| Model and UI use the same calibrated label | PASS | Updated provider guidance and renderer disclosure to recognize video discovery separately | UI regression covers the new label branch; conversation prompt names both discovery classes | Model compliance still requires live semantic review |
| Regression verification | PASS | `npm.cmd test`; `npm.cmd run check`; `git diff --check` | 72/72 deterministic tests pass; syntax and whitespace checks pass | No paid call was needed for this deterministic labeling fix |

Milestone 64 status: `IMPLEMENTED BUT NOT FULLY VERIFIED`. A YouTube result
now tells the model and user that it is video discovery, instead of implying it
has the same evidence class as Pinterest/TikTok social discovery.

## Milestone 65 — keep compact UI status aligned with usable evidence (2026-08-11)

| Criterion | Status | Exact action | Evidence | Limitation |
|---|---|---|---|---|
| A later empty scope does not hide an earlier usable source label | PASS | Renderer now selects the newest evidence-bearing run for the compact status line while retaining aggregate scope/status metadata | UI regression covers the evidence-selection branch; runtime capture showed multiple empty runs followed by a ready scoped result | This affects the compact label only; source links still come exclusively from validated tool output |
| Regression and package verification | PASS | `npm.cmd test`; `npm.cmd run check`; `git diff --check`; `npm.cmd run build` | 72/72 deterministic tests pass; syntax, whitespace, and packaged build pass | Interactive desktop visual inspection remains manual evidence |

Milestone 65 status: `IMPLEMENTED BUT NOT FULLY VERIFIED`. The source line no
longer lets the last empty tool attempt erase the strongest evidence label from
the same response.

## Milestone 66 — evidence-backed comparison observations (2026-08-11)

| Criterion | Status | Exact action | Evidence | Limitation |
|---|---|---|---|---|
| Three-way reports expose reviewable observations for every rubric dimension | PASS | Added versioned `solat.comparison-observations.v1` with task, context, tool/scope, grounding, uncertainty, and language observations | Regression asserts observations are present and include SOLAT search-use and authority fields | Observations are triage evidence, not automatic semantic scores |
| Observations preserve the no-fabricated-parity boundary | PASS | Every comparison remains `NOT VERIFIED` with `manual_review_required: true`; no weighted score is generated from heuristics | Existing semantic-review regression plus new observation assertions pass | A reviewer still must supply two-sided evidence for every dimension |
| Regression verification | PASS | `npm.cmd test`; `npm.cmd run check`; `git diff --check` | 72/72 deterministic tests pass; syntax and whitespace checks pass | No paid call was needed for this report-structure change |

Milestone 66 status: `IMPLEMENTED BUT NOT FULLY VERIFIED`. The comparison
artifact now tells a reviewer exactly where to inspect instead of stopping at a
generic “manual review required” message, while refusing to turn heuristics into
a ChatGPT-parity percentage.

## Milestone 67 — disclose the actual provider query (2026-08-11)

| Criterion | Status | Exact action | Evidence | Limitation |
|---|---|---|---|---|
| Search evidence records the provider query sent to the web adapter | PASS | Added bounded `provider_query` metadata beside the original user query in response evidence, persistence, and three-way capture | Regression asserts the scoped YouTube query is preserved as `Ada Lovelace YouTube site:youtube.com` | Query text explains what was requested, not whether the provider indexed a matching page |
| Query disclosure does not expose secrets | PASS | Reused existing redaction and bounded-length rules for persisted/provider-query metadata | Persistence and config tests continue to reject secret leakage | URLs, snippets, and provider responses remain separately validated |
| Regression verification | PASS | `npm.cmd test`; `npm.cmd run check`; `git diff --check` | 72/72 deterministic tests pass; syntax and whitespace checks pass | No paid call was needed for this observability-only change |

Milestone 67 status: `IMPLEMENTED BUT NOT FULLY VERIFIED`. When a platform
search misses a result, the report now shows the exact bounded query and scope
that were attempted, making ranking/provider recall issues diagnosable instead
of opaque.

## Milestone 68 — scoped discovery recall without weakening the allowlist (2026-08-11)

| Criterion | Status | Exact action | Evidence | Limitation |
|---|---|---|---|---|
| Social/video pages with caption-style titles can remain usable evidence | PASS | Added a bounded fallback only for explicit `social`/`video` scopes when strict encyclopedic title/slug matching finds no result; every identifying token must still meet the normal relevance threshold | Regression feeds a Pinterest result titled `Ada Lovelace ideas and portraits` and receives one `social_discovery` result with `discovery_fallback_used: true` | This improves recall for scoped discovery; it does not prove that the page is authoritative or factually correct |
| General and encyclopedic identity protection remains strict | PASS | The fallback is disabled for `auto` and `encyclopedic` scopes, and the existing exact identity gate remains unchanged there | Existing partial-name and unrelated-entity tests continue to pass | A loosely titled social/video result can still require manual review |
| Regression and package verification | PASS | `npm.cmd test`; `npm.cmd run check`; `git diff --check`; `npm.cmd run build` | 73/73 deterministic tests pass; syntax, whitespace, and packaged build pass | Live social/video recall remains provider-dependent; semantic parity with external models is still `NOT VERIFIED` |

Milestone 68 status: `IMPLEMENTED BUT NOT FULLY VERIFIED`. The search path now
recovers relevant Pinterest/TikTok/Instagram/Facebook/YouTube-style discovery
pages whose captions do not use an exact encyclopedia title, while keeping the
strict identity behavior for broad and encyclopedic searches.

## Milestone 69 — Thai connector comparisons (2026-08-11)

| Criterion | Status | Exact action | Evidence | Limitation |
|---|---|---|---|---|
| Thai “A กับ B” name pairs reach comparison-aware routing | PASS | Intent router recognizes a short Thai entity pair joined by `กับ` as a comparison candidate when neither side is a conversational pronoun/topic | Regression passes for `ปาร์ค ดายอง กับ ฮานาริ`, yielding `web_search` and two ordered candidate entities | This is an advisory hint; DeepSeek still sees the original message and makes the final tool/answer decision |
| Ordinary Thai conversation is not misclassified as comparison | PASS | Added exclusions for common conversational subjects such as `ฉัน`, `คุณ`, `เรา`, and `เรื่อง` | Regression keeps `ฉันคุยกับคุณเรื่องนี้` out of comparison routing | Unusual colloquial phrasing may still need model-first clarification |
| Regression verification | PASS | `npm.cmd test`; `npm.cmd run check`; `git diff --check` | 73/73 deterministic tests pass; syntax and whitespace checks pass | Live semantic parity remains `NOT VERIFIED` |

Milestone 69 status: `IMPLEMENTED BUT NOT FULLY VERIFIED`. Thai comparison
phrasing now reaches the same candidate-resolution path as English `and`/`vs`,
without replacing the user's original text or forcing a single intent.

## Milestone 70 — live multi-scope search after routing fixes (2026-08-11)

| Criterion | Status | Exact action | Evidence | Limitation |
|---|---|---|---|---|
| SOLAT performs model-selected multi-scope search and synthesis | PASS | One owner-authorized `capture:three-way --execute --case-ids multi_scope_request` run on revision `06986f9` | `artifacts/three-way-capture/three-way-current-after-thai-20260811-213050.json`: SOLAT `PASS`, mode `search_and_model`, 3 tool rounds, 6 validated sources | This is one prompt/capture, not a general recall guarantee |
| Requested Pinterest and YouTube scopes complete with truthful source classes | PASS | Live Brave-backed search executed `social` then `video`; a first empty video attempt was followed by a ready video query | Capture records Pinterest `ready`, YouTube `ready`, `requested_source_scope_status: complete`, hosts `www.pinterest.com` and `www.youtube.com`, authority levels `social_discovery` and `video_discovery` | Discovery evidence is not the same as encyclopedic/factual verification |
| Provider query and fallback behavior are inspectable | PASS | Capture retained each bounded provider query and result count | The artifact records the Pinterest query, the empty first YouTube query, and the successful YouTube query without secrets | External ChatGPT baseline was missing for this case, so semantic parity remains `NOT VERIFIED` |

Milestone 70 status: `IMPLEMENTED BUT NOT FULLY VERIFIED`. This is the first
current-revision live evidence showing the requested multi-platform search path
actually returning approved sources and then synthesizing them through DeepSeek.

## Milestone 71 — paired baseline capture with live social search (2026-08-11)

| Criterion | Status | Exact action | Evidence | Limitation |
|---|---|---|---|---|
| One matched prompt has all three visible responses | PASS | Owner-authorized `capture:three-way --execute --case-ids social_scope` using the stored ChatGPT baseline and current SOLAT revision | `artifacts/three-way-capture/three-way-current-social-paired-20260811-213221.json`: ChatGPT, raw DeepSeek, and SOLAT all `PASS` | The baseline is a captured temporary-chat response, not an API equivalence proof |
| SOLAT chooses search plus model and returns approved platform evidence | PASS | Live Brave-backed run for `Search Park Dayoung on TikTok and Pinterest` | SOLAT used `search_and_model`, one bounded tool round, six validated sources, `social_discovery`, and `requested_source_scope_status: complete`; provider queries are recorded | Social evidence is discovery evidence and may not establish official ownership or identity |
| Comparison remains honest and reviewable | PASS | Three-way evaluator emits observations for the six rubric dimensions and refuses automatic parity scoring | Capture has `capture_counts: 3 PASS`, `comparison_counts: 1 NOT VERIFIED`, and `manual_review_required: true` | No semantic percentage is claimed without an approved two-sided rubric review |

Milestone 71 status: `IMPLEMENTED BUT NOT FULLY VERIFIED`. The paired
capture path now has a current, matched social-search example with all three
responses present; only the semantic-quality judgment remains intentionally
manual/unverified.

## Milestone 72 — paired video-search capture (2026-08-11)

| Criterion | Status | Exact action | Evidence | Limitation |
|---|---|---|---|---|
| A matched YouTube prompt has all three visible responses | PASS | Owner-authorized `capture:three-way --execute --case-ids video_scope` using the stored baseline and current implementation | `artifacts/three-way-capture/three-way-current-video-paired-20260811-213314.json`: capture counts are `3 PASS` and no provider capture failed | The three-way semantic result remains review evidence, not an automatic quality score |
| SOLAT uses the requested video scope and discloses discovery limits | PASS | Live Brave-backed YouTube search followed by DeepSeek synthesis | SOLAT used `search_and_model`, one tool round, three validated YouTube sources, `requested_source_scope_status: complete`, and `video_discovery`; response says links should be checked because discovery metadata is not full video verification | A YouTube URL alone does not prove the video's claims or suitability |
| Comparison remains bounded and honest | PASS | Evaluator generated all six comparison observations and retained `manual_review_required` | Capture records `comparison_counts: 1 NOT VERIFIED`, with no fabricated parity percentage | Manual review is still required for task quality, grounding, and tone |

Milestone 72 status: `IMPLEMENTED BUT NOT FULLY VERIFIED`. Current evidence now
covers both social and video multi-source paths with matched external baselines;
semantic parity is deliberately not claimed.

## Milestone 73 — side-by-side comparison evidence packet (2026-08-11)

| Criterion | Status | Exact action | Evidence | Limitation |
|---|---|---|---|---|
| Reviewers can inspect bounded answer excerpts for every provider | PASS | Added bounded `response_preview` fields to each comparison observation | Three-way regression asserts the SOLAT preview and keeps the full response separately available in the capture | A preview is for triage; it is not a substitute for reading the full answer |
| Reviewers can inspect sources and provider queries side by side | PASS | Added `source_preview` and `search_evidence_preview` to the six rubric dimensions | Regression asserts the validated Wikipedia host and the scoped search evidence preview | Source presence does not prove claim correctness |
| No automatic semantic score is introduced | PASS | Kept `manual_review_required: true`, `scoring_allowed: false`, and the existing validation boundary | Full regression remains green and all live paired captures stay `NOT VERIFIED` for semantic comparison | A human must still fill every rubric dimension with evidence before scoring |
| Regression and package verification | PASS | `npm.cmd test`; `npm.cmd run check`; `git diff --check`; `npm.cmd run build` | 73/73 deterministic tests pass; syntax, whitespace, and packaged build pass | External-model semantic parity remains `NOT VERIFIED` |

Milestone 73 status: `IMPLEMENTED BUT NOT FULLY VERIFIED`. Comparison files now
contain enough bounded, source-aware material for a reviewer to compare answers
without guessing which search run or provider output produced each claim.

## Milestone 74 — current-revision paired evidence (2026-08-11)

| Criterion | Status | Exact action | Evidence | Limitation |
|---|---|---|---|---|
| At least one complete paired capture matches the current implementation revision | PASS | Ran `report:three-way` after a fresh owner-authorized social paired capture | Coverage report showed `current_revision_captures: 1`; the capture implementation revision matched `d985b0b` | Other historical captures remain correctly marked `NOT VERIFIED` when their revision is older |
| Current revision evidence remains a three-way comparison, not a proxy | PASS | Fresh capture included the stored ChatGPT baseline, raw DeepSeek, and SOLAT response | `three-way-current-final-social-20260811-213711.json` records all three `PASS`, with SOLAT search/tool/source metadata | Semantic comparison status remains `NOT VERIFIED` by design |
| Regression verification | PASS | `npm.cmd test`; `npm.cmd run check`; `git diff --check`; `npm.cmd run build` | 73/73 deterministic tests pass; syntax, whitespace, and packaged build pass | Full 20-case current-revision coverage would require additional matched baselines and approved provider calls |

Milestone 74 status: `IMPLEMENTED BUT NOT FULLY VERIFIED`. The evidence report
now distinguishes current-code proof from historical captures without treating
older artifacts as proof for a newer implementation.

## Milestone 75 — resolve follow-up references before clarification (2026-08-11)

| Criterion | Status | Exact action | Evidence | Limitation |
|---|---|---|---|---|
| A resolved follow-up is not mislabeled as unresolved ambiguity | PASS | Intent router now changes a resolved `reference_resolution` to `use_resolved_context_reference` and clears the clarification-only flag without changing the original user message | `npm.cmd test` passes the Ada Lovelace follow-up assertions; the router still exposes the full history and recommended query | This is deterministic routing evidence, not a guarantee that every provider will follow the hint |
| DeepSeek receives an explicit resolved-context instruction | PASS | Conversation system hint now tells the model to use the resolved subject for source searches and not ask the user to repeat it when history is consistent | `test/core.test.js` verifies both resolved and unresolved hint branches | The model may still decline a tool call; no hard gate was introduced |
| Live three-way follow-up completes with source evidence | PASS | One owner-authorized `capture:three-way --execute --case-ids follow_up_context` after revision `1018840` | `artifacts/three-way-capture/three-way-current-followup-resolved-20260811-214323.json`: ChatGPT, raw DeepSeek, and SOLAT are `PASS`; SOLAT used `search_and_model`, one tool round, and returned one validated `en.wikipedia.org` source | Semantic comparison remains `NOT VERIFIED`; the capture is one follow-up case, not a general parity claim |
| Regression and package verification | PASS | `npm.cmd test`; `npm.cmd run check`; `git diff --check`; `npm.cmd run build` | 74/74 deterministic tests pass; syntax, whitespace, and packaged build pass | Full current-revision corpus coverage and human semantic review remain outstanding |

Milestone 75 status: `IMPLEMENTED BUT NOT FULLY VERIFIED`. Follow-up context
now reaches the model as a resolved subject instead of being treated as a reason
to ask the user to repeat a topic that is already present in the conversation.

## Milestone 76 — bounded recovery when an explicit search tool call is omitted (2026-08-11)

| Criterion | Status | Exact action | Evidence | Limitation |
|---|---|---|---|---|
| Clear source requests do not silently become uncited model-only answers | PASS | Added a one-shot recovery path after `tool_choice=auto` returns no tool call, limited to high-confidence web-search intent with no unresolved reference | Regression covers a direct Ada Lovelace source request and a resolved follow-up; both perform one bounded search and final evidence synthesis | This is a bounded fallback, not a promise that every conversational message searches |
| Unresolved references still avoid guessing | PASS | Recovery is disabled when a pronoun/reference has no resolved context; the model receives clarification guidance instead | Regression `conversation core does not recover an unresolved source reference` passes with zero search calls | The model's wording still needs live language review |
| Live recovery reaches approved evidence | PASS | One owner-authorized `capture:three-way --execute --case-ids follow_up_context` after revision `ec12c70` | `artifacts/three-way-capture/three-way-current-followup-recovery-20260811-215214.json`: all 3 captures `PASS`; SOLAT `search_and_model`, `ready`, one validated Wikipedia source | Comparison remains `NOT VERIFIED`; one case does not establish broad semantic parity |
| Regression and package verification | PASS | `npm.cmd test`; `npm.cmd run check`; `git diff --check`; `npm.cmd run build` | 77/77 deterministic tests pass; syntax, whitespace, and packaged build pass; recovery failure remains visible and citation-free | Full current-revision corpus and evidence-backed semantic review remain incomplete |

Milestone 76 status: `IMPLEMENTED BUT NOT FULLY VERIFIED`. Explicit source
requests now have a truthful, one-shot recovery when the model initially omits
the search tool, while unresolved references remain protected from guessing.

## Milestone 77 — identity-first evidence ranking (2026-08-11)

| Criterion | Status | Exact action | Evidence | Limitation |
|---|---|---|---|---|
| Exact subject matches outrank related high-authority pages | PASS | Search ranking now gives lexical/entity identity priority and uses authority as a bounded tie-breaker; leading search verbs are removed before extracting a named entity | Regression ranks an exact `Ada Lovelace` profile above an `Ada (name)` Wikipedia page for `Find Ada Lovelace` | Lexical identity is not a factual truth guarantee |
| Existing host diversity and URL safety remain intact | PASS | Kept canonical URL deduplication, allowlist filtering, and soft per-host diversity after the revised score | Existing ranking, unsafe-host, duplicate, and explicit-platform tests remain green | A source can still be incomplete or stale even when it is the best-ranked approved result |
| Regression verification | PASS | `npm.cmd test`; `npm.cmd run check`; `git diff --check` | 77/77 deterministic tests pass; all checked JavaScript parses and whitespace check passes | Live semantic parity and broad current-revision coverage remain incomplete |

Milestone 77 status: `IMPLEMENTED BUT NOT FULLY VERIFIED`. Search ranking now
prefers the page that identifies the requested subject instead of allowing
authority alone to elevate a related page.

## Milestone 78 โ€” persist search recovery and source-status metadata (2026-08-11)

| Criterion | Status | Exact action | Evidence | Limitation |
|---|---|---|---|---|
| Reopened conversations retain whether bounded search recovery ran | PASS | Conversation persistence now stores `responseMeta.searchRecoveryUsed` and `searchSummary.search_recovery_used`; the renderer carries the live response flag into the saved assistant message | `test/conversation-persistence.test.js` restores both flags as `true`; `npm.cmd test` passes 77/77 | Existing records written before this field was added naturally read as `false` |
| Source disclosure and search state remain visible after reload | PASS | Kept the existing bounded source/evidence/authority fields and added the recovery marker without persisting secrets | Persistence regression still restores source URL, evidence authority, scopes, and status fields; `npm.cmd run check` and `git diff --check` pass | This proves metadata continuity, not the factual correctness of a source |
| Regression verification | PASS | `npm.cmd test`; `npm.cmd run check`; `git diff --check` | 77/77 deterministic tests pass; all checked JavaScript parses and whitespace check passes | Live provider semantic parity remains `NOT VERIFIED`; no paid test was needed for this persistence-only change |

Milestone 78 status: `IMPLEMENTED BUT NOT FULLY VERIFIED`. Search recovery and
source-status metadata now survive conversation persistence, so reopening a
thread does not silently turn a recovered, source-backed answer into an
uncategorized model response.

## Milestone 79 โ€” complete source-scope evidence in three-way comparison (2026-08-11)

| Criterion | Status | Exact action | Evidence | Limitation |
|---|---|---|---|---|
| Paired evidence records requested and completed source scopes | PASS | Three-way capture now carries `source_scopes`, `requested_source_scopes`, and `source_hosts` into the comparison observation | `test/core.test.js` asserts the SOLAT observation contains the requested encyclopedic scope and its host | Scope metadata shows what ran, not whether the answer interpreted each source correctly |
| Recovery and model-selected tool paths remain distinguishable | PASS | Capture and observation now preserve `search_recovery_used` separately from `search_used` | Three-way regression asserts recovery is visible in both the capture summary and tool-choice observation | A recovery marker does not prove the provider's final prose is semantically correct |
| Regression verification | PASS | `npm.cmd test`; `npm.cmd run check`; `git diff --check` | 78/78 deterministic tests pass; checked JavaScript and whitespace remain clean | External ChatGPT semantic parity is still `NOT VERIFIED` and requires evidence-backed review |
| Current-revision paired capture remains reproducible | PASS | Added `--chatgpt-capture` to `scripts/capture-three-way.js` so a prior owner-captured baseline can seed a fresh current-code run without copying secrets or editing provider output | `artifacts/three-way-capture/three-way-current-social-scope-20260811-220400.json` at revision `9b3eecd` captured ChatGPT, raw DeepSeek, and SOLAT as `3 PASS`; SOLAT used `search_and_model`, `ready`, social scope, and six approved TikTok/Pinterest sources | The capture's semantic comparison is intentionally `NOT VERIFIED`; the baseline is still an owner-captured temporary-chat response |

Milestone 79 status: `IMPLEMENTED BUT NOT FULLY VERIFIED`. The comparison
packet now shows not only that Search ran, but which source scopes were requested,
which were completed, and whether a bounded recovery path was used.

## Milestone 80 โ€” truthful mixed-language comparison observations (2026-08-11)

| Criterion | Status | Exact action | Evidence | Limitation |
|---|---|---|---|---|
| Language triage does not misclassify an English answer containing a Thai source title | PASS | `languageHint` now counts Thai and Latin characters and returns `mixed` for genuinely mixed text instead of treating one quoted title as a Thai answer | Regression covers English-only, Thai-only, and English-with-Thai-title responses; `npm.cmd test` passes 78/78 | This remains a triage signal; it does not judge fluency or tone |
| Comparison observations remain usable for manual language/tone review | PASS | The existing `language_and_tone` dimension receives the corrected `non_th`/`mixed`/`th` hint while retaining the full bounded response preview | `artifacts/three-way-capture/three-way-current-social-language-20260811-220622.json` at revision `e8168aa` records the current responses without the previous false-Thai classification | Human review is still required for semantic quality and politeness |
| Regression verification | PASS | `npm.cmd test`; `npm.cmd run check`; `git diff --check` | 78/78 deterministic tests pass; syntax and whitespace checks pass | Live ChatGPT semantic parity remains `NOT VERIFIED` |

Milestone 80 status: `IMPLEMENTED BUT NOT FULLY VERIFIED`. The evidence packet
no longer labels an English answer as Thai merely because a source title contains
a few Thai characters.

## Milestone 81 โ€” separate requested search scopes from advisory candidates (2026-08-11)

| Criterion | Status | Exact action | Evidence | Limitation |
|---|---|---|---|---|
| Explicit source/platform requests remain enforceable | PASS | Intent hints now expose `task.requested_source_scopes` separately; Wikipedia, social, and video words are the only direct requirements | Router regression asserts Wikipedia/social/video and multi-scope requests produce the expected requested scopes | A user can still phrase a source request indirectly; the model-first path remains advisory in that case |
| Contextual hints do not silently force an unrelated source scope | PASS | ConversationCore now enforces only `requested_source_scopes`; `source_scope_candidates` remains advisory for contexts such as manhwa or visual discovery | Regression asserts comparison/manhwa context has social as a candidate but no requested scope | The model may still choose an unsuitable tool; source quality gates and truthful status remain the enforcement boundary |
| Regression verification | PASS | `npm.cmd test`; `npm.cmd run check`; `git diff --check`; `npm.cmd run build` | 78/78 deterministic tests pass; syntax, whitespace, and packaged build pass | Live provider behavior and semantic parity remain `NOT VERIFIED` |
| Current runtime capture after the scope split | PASS | One owner-authorized `capture:three-way --execute --case-ids social_scope` run after the scope change | `artifacts/three-way-capture/three-way-current-social-scopes-20260811-220844.json` at revision `d14b9c0` captured all 3 responses; SOLAT was `search_and_model` with `ready` social evidence and `requested_source_scopes: ["social"]` | This verifies the explicit social path, not every contextual or ambiguous query |

Milestone 81 status: `IMPLEMENTED BUT NOT FULLY VERIFIED`. Router suggestions
now help DeepSeek choose among sources without turning contextual hints into
unrequested hard requirements.

## Milestone 82 โ€” regression corpus asserts requested scopes (2026-08-11)

| Criterion | Status | Exact action | Evidence | Limitation |
|---|---|---|---|---|
| Deterministic corpus checks explicit versus advisory scope behavior | PASS | `conversation-evaluator` now validates `expect.requested_source_scopes`; the corpus covers encyclopedic, social, video, and multi-scope requests | `npm.cmd run evaluate:conversation` reports 19 PASS, 0 FAIL, 1 NOT VERIFIED; scope cases now assert both candidate and requested arrays | The corpus validates routing contracts, not live provider recall |
| Existing context/follow-up coverage remains intact | PASS | Kept the original candidate-scope checks and added requested-scope checks without changing model-first behavior | `npm.cmd test` passes 78/78 and all follow-up/comparison tests remain green | Live ambiguous-name interpretation still needs broader provider captures |
| Package verification | PASS | `npm.cmd run check`; `npm.cmd run build`; `git diff --check` | Syntax, whitespace, and packaged Electron output pass | Semantic parity with ChatGPT remains `NOT VERIFIED` |

Milestone 82 status: `IMPLEMENTED BUT NOT FULLY VERIFIED`. The regression
corpus now guards the distinction that prevents contextual hints from becoming
unrequested tool requirements.

## Milestone 83 โ€” lowercase identity evidence guard (2026-08-11)

| Criterion | Status | Exact action | Evidence | Limitation |
|---|---|---|---|---|
| Lowercase multi-word names receive the same identity protection | PASS | `namedEntityInQuery` now has a conservative lowercase fallback after removing query stopwords and generic topic words | Regression recognizes `find a source about park dayoung` as `park dayoung` and accepts only an exact title/slug identity match | It intentionally does not correct misspellings or infer aliases |
| Unrelated partial-name pages remain filtered | PASS | Existing exact-title/slug gate is reused for the lowercase identity; no authority-only bypass was added | Existing unrelated `Adoy`/partial-name tests plus the new lowercase identity assertions pass | Lexical identity is not a factual truth guarantee |
| Regression verification | PASS | `npm.cmd test`; `npm.cmd run check`; `git diff --check` | 78/78 deterministic tests pass; syntax and whitespace checks pass | Live provider behavior and semantic parity remain `NOT VERIFIED` |

Milestone 83 status: `IMPLEMENTED BUT NOT FULLY VERIFIED`. Lowercase user
input now gets the same bounded evidence protection as title-cased names without
silently “fixing” an unknown spelling.
## Milestone 84 — preserve explicit source scope during recovery (2026-08-11)

| Criterion | Status | Exact action | Evidence | Limitation |
|---|---|---|---|---|
| Recovery search cannot silently widen a single explicit source request | PASS | ConversationCore now uses the one requested source scope for bounded recovery; only multi-scope requests use `auto` so the executor can expand them | Regression `conversation core preserves an explicit Wikipedia scope during recovery` asserts the executed call is `source_scope: encyclopedic` and the final summary is complete | Recovery remains one bounded pass and does not guarantee provider recall |
| Evidence disclosure remains truthful after recovery | PASS | The recovered result continues through the same search evidence/source aggregation path | The regression checks the visible source host is `en.wikipedia.org` and the requested scope is complete | Semantic quality and answer helpfulness still require external review |
| Regression verification | PASS | `npm.cmd test`; `npm.cmd run check`; `git diff --check` | 79/79 deterministic tests pass; syntax and whitespace checks pass | Live provider behavior and ChatGPT semantic parity remain `NOT VERIFIED` |

Milestone 84 status: `IMPLEMENTED BUT NOT FULLY VERIFIED`. Explicit recovery
requests now stay inside the source family the user asked for instead of
silently falling back to a broader approved web scope.
## Milestone 85 — reject combined comparison searches (2026-08-11)

| Criterion | Status | Exact action | Evidence | Limitation |
|---|---|---|---|---|
| Comparison evidence is not attributed to the first matching entity | PASS | ConversationCore now rejects a tool query containing both compared entities; the model must issue bounded per-entity searches | Regression `conversation core rejects a combined comparison query instead of attributing it to the first name` confirms zero search execution and one truthful rejected tool call | Provider behavior may still need a follow-up call to split the comparison |
| Existing per-entity comparison flow remains available | PASS | Single-entity alignment and complete-evidence checks remain unchanged | `npm.cmd test` passes the existing alignment and two-entity completion cases | Live provider retry behavior is not measured in this deterministic test |
| Regression verification | PASS | `npm.cmd test`; `npm.cmd run check`; `git diff --check` | 80/80 deterministic tests pass; syntax and whitespace checks pass | Semantic parity remains `NOT VERIFIED` |

Milestone 85 status: `IMPLEMENTED BUT NOT FULLY VERIFIED`. SOLAT no longer
silently treats a combined comparison query as evidence for only the first
name, reducing a major source of cross-entity factual contamination.
## Milestone 86 — comparison tool guidance (2026-08-11)

| Criterion | Status | Exact action | Evidence | Limitation |
|---|---|---|---|---|
| The model receives an explicit per-entity comparison instruction | PASS | Added advisory guidance to the provider-facing routing message: issue one `web_search` call per named entity and keep evidence tied to that entity | Comparison regression asserts the provider-facing hint contains the instruction; user content and history remain unchanged | Guidance is advisory; the runtime guard still rejects combined queries if the model ignores it |
| Existing model-first behavior is preserved | PASS | Added guidance without converting the router into a hard gate or changing allowed tools | `npm.cmd test` passes all existing general, ambiguous, follow-up, and provider-failure cases | Live model adherence is not measured here |
| Regression verification | PASS | `npm.cmd test`; `npm.cmd run check`; `git diff --check` | 80/80 deterministic tests pass; syntax and whitespace checks pass | Semantic parity remains `NOT VERIFIED` |

Milestone 86 status: `IMPLEMENTED BUT NOT FULLY VERIFIED`. The model now
receives the intended comparison workflow before it chooses tools, while the
runtime safety guard remains in place.
## Milestone 87 — lowercase named-identity regression (2026-08-11)

| Criterion | Status | Exact action | Evidence | Limitation |
|---|---|---|---|---|
| Common lowercase person-name queries remain identity lookups | PASS | Added `diana king` coverage to the named-entity and exact title/slug gate | `npm.cmd test` recognizes the lowercase name and accepts only the matching Wikipedia title/slug | The gate cannot resolve aliases or misspellings without source evidence |
| Partial or unrelated pages remain blocked | PASS | Reused the existing exact identity guard rather than relaxing it for lowercase input | Existing partial-name and unrelated-page assertions remain green | Provider recall is still dependent on configured search coverage |
| Regression verification | PASS | `npm.cmd test`; `npm.cmd run check`; `git diff --check` | 80/80 deterministic tests pass; syntax and whitespace checks pass | Semantic parity remains `NOT VERIFIED` |

Milestone 87 status: `IMPLEMENTED BUT NOT FULLY VERIFIED`. Lowercase real-name
queries now have an explicit regression contract without weakening evidence
quality gates.
## Milestone 88 — comparison guidance in tool schema (2026-08-11)

| Criterion | Status | Exact action | Evidence | Limitation |
|---|---|---|---|---|
| Tool selection guidance matches the runtime comparison guard | PASS | Added the per-entity comparison rule directly to the `web_search` tool description as well as the routing hint | Search contract regression asserts the description contains `one query per named entity`; comparison tests still reject combined queries | Model adherence still depends on provider behavior |
| Source/tool contract remains bounded | PASS | No new hosts or tool capabilities were added; source allowlists and scope enum are unchanged | Existing search boundary tests remain green | Live platform recall remains dependent on configured provider capability |
| Regression verification | PASS | `npm.cmd test`; `npm.cmd run check`; `git diff --check` | 80/80 deterministic tests pass; syntax and whitespace checks pass | Semantic parity remains `NOT VERIFIED` |

Milestone 88 status: `IMPLEMENTED BUT NOT FULLY VERIFIED`. The comparison
rule is now visible both in routing context and in the tool contract used by
the model.
## Milestone 89 — evidence freshness audit (2026-08-11)

| Criterion | Status | Exact action | Evidence | Limitation |
|---|---|---|---|---|
| Paired evidence is not misattributed to the current revision | PASS | Ran `npm.cmd run report:three-way` and checked the revision match for every capture row | Report shows `total: 20`, `isolated_baselines: 13`, `complete_captures: 13`, `current_revision_captures: 0`, and `manual_review_required: 20` | Existing captures are transport evidence from earlier revisions, not proof of current semantic behavior |
| Semantic parity remains honestly bounded | PASS | Kept every comparison row `NOT VERIFIED` when the capture revision is stale or the baseline is missing | Coverage report marks all 20 rows `comparison_status: NOT VERIFIED` | A new owner-authorized three-way capture is required before current-revision comparison |
| No paid/provider call was added by this audit | PASS | Used only the local deterministic coverage report | No new remote request or credential was used | Live provider freshness remains an explicit follow-up, not silently assumed |

Milestone 89 status: `IMPLEMENTED BUT NOT FULLY VERIFIED`. The evidence
report now clearly separates historical transport captures from proof of the
current code revision and keeps semantic claims unverified until fresh paired
evidence exists.
## Milestone 90 — explicit capture freshness fields (2026-08-11)

| Criterion | Status | Exact action | Evidence | Limitation |
|---|---|---|---|---|
| Coverage reports distinguish complete-but-stale evidence | PASS | `report-three-way-coverage.js` now emits `stale_complete_captures`, per-row `revision_match`, and `freshness_reason` | `node scripts/report-three-way-coverage.js` reports `stale_complete_captures: 13`, `current_revision_captures: 0`, and reasons such as `capture_revision_stale`, `capture_incomplete`, and `capture_missing` | It does not create fresh provider captures |
| Semantic claims remain bounded by revision freshness | PASS | Current-revision evidence still requires both complete transports and an exact git revision match | The report keeps every stale row at `evidence_for_current_revision: NOT VERIFIED` | A new authorized capture is still needed for current-revision semantic review |
| Regression verification | PASS | `npm.cmd run check`; `git diff --check`; read-only coverage report | Script syntax and whitespace pass; report exposes the stale/current split without provider calls | Live answer quality remains `NOT VERIFIED` |

Milestone 90 status: `IMPLEMENTED BUT NOT FULLY VERIFIED`. Evidence freshness
is now explicit in the machine-readable report, preventing a complete old
capture from looking like proof of the current implementation.
## Milestone 91 — factual identity questions enter model-first search path (2026-08-11)

| Criterion | Status | Exact action | Evidence | Limitation |
|---|---|---|---|---|
| Direct factual questions can expose search to the model | PASS | Intent router now recognizes `Who/What/Where/When is...`, `tell me about`, `explain`, and Thai factual forms as web-search signals | Router regression marks `Who is Diana King?` as `web_search` with `web_search` allowed | The model may still decide not to call the tool; hints remain advisory |
| Self-referential chat is not sent to web search unnecessarily | PASS | Added a self-reference exclusion for `you/your/we/our/i/my` | Regression keeps `What is your name?` on the direct path | More nuanced self/world references may need future coverage |
| Regression verification | PASS | `npm.cmd test`; `npm.cmd run check`; `git diff --check` | 80/80 deterministic tests pass; syntax and whitespace checks pass | Live semantic parity remains `NOT VERIFIED` |

Milestone 91 status: `IMPLEMENTED BUT NOT FULLY VERIFIED`. Ordinary factual
identity questions now have a reliable route to model-selected search without
turning personal conversation into unnecessary web queries.
## Milestone 92 — Thai factual-question regression (2026-08-11)

| Criterion | Status | Exact action | Evidence | Limitation |
|---|---|---|---|---|
| Thai identity questions can reach model-selected search | PASS | Added router coverage for `ใครคือ Diana King` | Regression marks the Thai factual question as `web_search` with the tool allowed | Thai phrasing coverage remains intentionally bounded to common factual forms |
| Direct/self-referential chat remains protected | PASS | Kept the self-reference exclusion and existing general-chat regression | `What is your name?` remains direct and all 80 tests pass | Natural-language intent still depends on provider behavior after hints |
| Regression verification | PASS | `npm.cmd test`; `npm.cmd run check`; `git diff --check` | 80/80 deterministic tests pass; syntax and whitespace checks pass | Live semantic parity remains `NOT VERIFIED` |

Milestone 92 status: `IMPLEMENTED BUT NOT FULLY VERIFIED`. The factual search
route now has explicit Thai coverage as well as English coverage.
## Milestone 93 — current-revision social three-way capture (2026-08-11)

| Criterion | Status | Exact action | Evidence | Limitation |
|---|---|---|---|---|
| Current code revision has a complete three-way transport capture | PASS | Owner-authorized single-case `npm.cmd run capture:three-way -- --execute --case-ids social_scope` using the existing isolated ChatGPT baseline | `artifacts/three-way-capture/three-way-current-revision-social-20260811-222000.json`; all 3 transports returned visible responses; git revision `c8f04c5` matches the current revision at capture time | This is one social-scope case, not full corpus coverage |
| SOLAT selected the requested source scope and disclosed sources | PASS | The capture used the configured Brave adapter and model-selected `social` search | SOLAT returned `search_and_model`, `web_search_status: ready`, `requested_source_scope_status: complete`, 2 validated sources (TikTok and Pinterest), and `source_count: 2` | Social evidence is discovery-level, not definitive identity proof |
| Semantic comparison remains honest | PASS | Kept the comparison row `NOT VERIFIED` and did not calculate a parity percentage | Rubric reports `manual_review_required: true`, `scoring_allowed: false`, `comparison_status: NOT VERIFIED` | Human review of the six semantic dimensions is still required |
| Coverage report reflects freshness | PASS | Re-ran `npm.cmd run report:three-way` after capture | Counts now show `current_revision_captures: 1`, `stale_complete_captures: 12`, and all 20 rows still `manual_review_required` | Other current-revision cases remain uncaptured |

Milestone 93 status: `IMPLEMENTED BUT NOT FULLY VERIFIED`. One current-revision
social case now has real three-way transport evidence, while semantic quality
is intentionally left for manual rubric review.
## Milestone 94 — runtime-tree freshness matching (2026-08-12)

| Criterion | Status | Exact action | Evidence | Limitation |
|---|---|---|---|---|
| Documentation-only commits do not invalidate runtime captures | PASS | Coverage checker now compares capture and current revisions over `src`, `renderer`, `package.json`, and `scripts` instead of requiring identical full git hashes | `npm.cmd run report:three-way` keeps the current social capture at `revision_match: PASS` and labels the drift `docs_or_metadata_only_revision_drift` | A change in any runtime tree path correctly invalidates the capture |
| Stale evidence remains visible | PASS | Rows still expose `revision_match`, `freshness_reason`, and `stale_complete_captures` | Coverage output reports 12 stale complete captures and 1 current runtime-tree capture | Other corpus rows still need fresh captures |
| Regression verification | PASS | `npm.cmd run check`; `git diff --check`; read-only coverage report | Script syntax, whitespace, and freshness output pass without provider calls | Semantic parity remains `NOT VERIFIED` |

Milestone 94 status: `IMPLEMENTED BUT NOT FULLY VERIFIED`. Freshness checking
now tracks the code that affects runtime behavior while preserving explicit
warnings for stale or missing evidence.
## Milestone 95 — source corroboration status (2026-08-12)

| Criterion | Status | Exact action | Evidence | Limitation |
|---|---|---|---|---|
| Search evidence distinguishes one source host from multiple hosts | PASS | Added `quality.corroboration` with `none`, `single_host`, or `multi_host` | Search quality tests assert the single-host state; existing multi-scope output remains available through distinct hosts | Multiple hosts do not automatically mean factual agreement |
| Corroboration survives conversation persistence | PASS | Persisted the bounded corroboration field alongside authority and relevance metadata | Persistence path now redacts and stores the field without secrets or raw provider bodies | Existing stored conversations without the field default to `none` |
| Regression verification | PASS | `npm.cmd test`; `npm.cmd run check`; `git diff --check` | 80/80 deterministic tests pass; syntax and whitespace checks pass | Semantic parity remains `NOT VERIFIED` |

Milestone 95 status: `IMPLEMENTED BUT NOT FULLY VERIFIED`. SOLAT can now
distinguish “one approved source host found” from “multiple hosts returned”
without treating host count alone as proof of agreement.

## Milestone 96 — packaged runtime refresh (2026-08-12)

| Criterion | Status | Exact action | Evidence | Limitation |
|---|---|---|---|---|
| Packaged application includes the current source tree | PASS | `npm.cmd run build` | `electron-builder` completed for `dist/win-unpacked` and refreshed the packaged application | Build output is not a substitute for an interactive browser review |
| Static and regression checks remain green after packaging | PASS | `npm.cmd test`; `npm.cmd run check`; `git diff --check` | 80/80 deterministic tests pass; syntax and whitespace checks pass | Paid provider freshness and semantic parity remain `NOT VERIFIED` |

Milestone 96 status: `IMPLEMENTED BUT NOT FULLY VERIFIED`. The packaged
runtime has been rebuilt from the current source, while live semantic quality
still requires an owner-authorized comparison capture and rubric review.

## Milestone 97 — visible corroboration label (2026-08-12)

| Criterion | Status | Exact action | Evidence | Limitation |
|---|---|---|---|---|
| Search answers show the number of validated sources | PASS | Kept the existing source disclosure and compact `Search · N sources` line | `renderer/renderer.js`; UI regression test | A source count does not prove factual agreement |
| Search answers distinguish one host from multiple hosts | PASS | Added `one source host` and `multiple source hosts` labels from validated search quality metadata | `renderer/renderer.js`; `test/ui.test.js` | Multiple hosts indicate source diversity only, not that the claims agree or were independently fact-checked |
| Current UI is included in the packaged app | PASS | Ran `npm.cmd run build` after the renderer change | `dist/win-unpacked` rebuilt successfully | Interactive browser review remains `NOT VERIFIED` |

Milestone 97 status: `IMPLEMENTED BUT NOT FULLY VERIFIED`. Users can now see
source count and bounded host-diversity context below search-backed answers;
semantic parity with ChatGPT remains `NOT VERIFIED`.

## Milestone 98 — deterministic conversation regression refresh (2026-08-12)

| Criterion | Status | Exact action | Evidence | Limitation |
|---|---|---|---|---|
| Context, ambiguity, source-scope, comparison, and degraded-search cases remain covered | PASS | `npm.cmd run evaluate:conversation` | 19 cases `PASS`, 0 `FAIL`; general chat remains model-first, follow-ups resolve context, Thai and multi-scope requests retain their intended hints | Deterministic checks do not prove live model answer quality |
| Semantic parity is not overstated | PASS | Kept the live parity case as an explicit `NOT VERIFIED` result | Evaluation reports 1 `NOT VERIFIED` case with the reason that a deterministic evaluator cannot establish parity with a live ChatGPT answer | Requires matched external baseline and rubric review |

Milestone 98 status: `IMPLEMENTED BUT NOT FULLY VERIFIED`. The local
conversation/tool-selection contract is green; live semantic parity remains
an explicit evidence gap rather than a fabricated score.

## Milestone 99 — persistence regression for source diversity (2026-08-12)

| Criterion | Status | Exact action | Evidence | Limitation |
|---|---|---|---|---|
| Source diversity metadata survives save/load | PASS | Extended the conversation persistence fixture with `multi_host` and asserted it after reload | `test/conversation-persistence.test.js`; `npm.cmd test` reports 80/80 | This validates metadata integrity, not factual agreement between sources |
| Static checks remain green | PASS | `npm.cmd run check`; `git diff --check` | Both pass after the persistence regression change | Live provider evidence remains unchanged |

Milestone 99 status: `IMPLEMENTED BUT NOT FULLY VERIFIED`. Source-quality
metadata now has a regression guard across the persistence boundary.

## Milestone 100 — explicit agreement-status boundary (2026-08-12)

| Criterion | Status | Exact action | Evidence | Limitation |
|---|---|---|---|---|
| Multiple hosts cannot be mistaken for factual agreement | PASS | Added `agreement_status: not_assessed` for multi-host evidence and exposed it in the compact UI line | `src/core/web-search.js`; `renderer/renderer.js`; 80/80 tests pass | The system still needs a semantic comparison rubric to assess agreement |
| Agreement status survives persistence | PASS | Added persistence serialization and reload assertions | `src/core/conversation-persistence.js`; `test/conversation-persistence.test.js` | Metadata is a guardrail, not a truth verdict |
| Regression and syntax checks remain green | PASS | `npm.cmd test`; `npm.cmd run check`; `git diff --check` | All pass; 80/80 tests | Live provider capture was not repeated in this change |

Milestone 100 status: `IMPLEMENTED BUT NOT FULLY VERIFIED`. Evidence now
states explicitly when cross-host agreement has not been assessed, preventing
the model or UI from treating source diversity as proof.

## Milestone 101 — comparison packet carries agreement boundary (2026-08-12)

| Criterion | Status | Exact action | Evidence | Limitation |
|---|---|---|---|---|
| Three-way evidence comparison exposes agreement status | PASS | Added `agreement_status` to sanitized search evidence and comparison observations | `src/core/three-way-evaluator.js`; regression asserts `single_source` is preserved in the comparison packet | This is an evidence boundary, not a semantic score |
| Failed/unknown agreement remains visible | PASS | Sanitizer defaults missing agreement metadata to `not_assessed` | Capture path and comparison packet keep the unknown state explicit | A live paired capture is still needed for current-revision review |
| Regression verification | PASS | `npm.cmd test`; `npm.cmd run check`; `git diff --check` | 80/80 deterministic tests pass; syntax and whitespace checks pass | ChatGPT semantic parity remains `NOT VERIFIED` |

Milestone 101 status: `IMPLEMENTED BUT NOT FULLY VERIFIED`. Manual reviewers
now receive the agreement-assessment boundary alongside source and scope data.

## Milestone 102 — packaged comparison evaluator refresh (2026-08-12)

| Criterion | Status | Exact action | Evidence | Limitation |
|---|---|---|---|---|
| Packaged runtime contains the agreement-aware comparison evaluator | PASS | `npm.cmd run build` after the evaluator change | `electron-builder` completed and refreshed `dist/win-unpacked` | Interactive runtime review is still `NOT VERIFIED` |
| No regression after packaging | PASS | Existing 80/80 test suite and syntax/whitespace checks remain green before packaging | Previous command output: 80/80 pass; `npm.cmd run check`; `git diff --check` pass | No paid provider request was made by this rebuild |

Milestone 102 status: `IMPLEMENTED BUT NOT FULLY VERIFIED`. The packaged
application now carries the same evidence boundary as the source tree.

## Milestone 103 — manual rubric uses agreement boundary (2026-08-12)

| Criterion | Status | Exact action | Evidence | Limitation |
|---|---|---|---|---|
| Manual grounding review names agreement status explicitly | PASS | Updated the grounding review prompt to compare `agreement_status` and reject multi-host as proof of agreement | `src/core/three-way-evaluator.js`; regression assertion in `test/core.test.js` | It still requires a human or approved evaluator to judge factual agreement |
| Regression verification | PASS | `npm.cmd test`; `npm.cmd run check`; `git diff --check` | 80/80 deterministic tests pass; syntax and whitespace checks pass | No live semantic score is claimed |

Milestone 103 status: `IMPLEMENTED BUT NOT FULLY VERIFIED`. The comparison
rubric now guards the exact evidence limitation that previously could be
misread by a reviewer.

## Milestone 104 — runtime package aligned with rubric (2026-08-12)

| Criterion | Status | Exact action | Evidence | Limitation |
|---|---|---|---|---|
| Packaged runtime includes the latest agreement-aware manual rubric | PASS | `npm.cmd run build` after the comparison evaluator change | `electron-builder` completed successfully and refreshed `dist/win-unpacked` | This does not perform interactive browser verification |
| Runtime and source checks remain aligned | PASS | Build followed the already passing 80/80 test, syntax, and whitespace checks | The packaged output was produced from the current source tree | Live semantic parity remains `NOT VERIFIED` |

Milestone 104 status: `IMPLEMENTED BUT NOT FULLY VERIFIED`. The packaged
runtime is aligned with the latest evidence-comparison safeguards.

## Milestone 105 — live search smoke on current runtime (2026-08-12)

| Criterion | Status | Exact action | Evidence | Limitation |
|---|---|---|---|---|
| DeepSeek and Brave are connected through the current tool path | PASS | `npm.cmd run smoke:live-search` | Outcome `PASS`; model `deepseek-v4-flash`; search provider `brave`; `mode: search_and_model`; `web_search_status: ready` | This is one smoke prompt, not broad semantic coverage |
| Search result is visible and approved | PASS | Same smoke run | One visible source: `https://en.wikipedia.org/wiki/Ada_Lovelace`; source count 1; no secret exposed | It does not prove every query or scope will rank correctly |
| Provider usage is recorded truthfully | PASS | Same smoke run | `provider_request_count: 4`; usage metadata recorded for the final response; no retry loop | This live smoke consumed provider quota |

Milestone 105 status: `IMPLEMENTED BUT NOT FULLY VERIFIED`. The current
runtime path has one real search-and-model smoke success, while broad semantic
quality and ChatGPT parity remain unverified.

## Milestone 106 — coverage truth after latest runtime changes (2026-08-12)

| Criterion | Status | Exact action | Evidence | Limitation |
|---|---|---|---|---|
| Historical three-way captures are not presented as current evidence | PASS | `npm.cmd run report:three-way` after the latest evaluator/package changes | Coverage reports `total: 20`, `stale_complete_captures: 13`, `current_revision_captures: 0`, `manual_review_required: 20` | Fresh current-revision paired captures still require owner-authorized provider calls |
| Worktree does not contain tracked uncommitted changes | PASS | `git status --short` | Only intentionally untracked historical capture artifacts remain | Those artifacts are preserved and not staged |

Milestone 106 status: `IMPLEMENTED BUT NOT FULLY VERIFIED`. The report now
continues to distinguish transport evidence from evidence for the current
runtime revision.

## Milestone 107 — live smoke exposes agreement boundary (2026-08-12)

| Criterion | Status | Exact action | Evidence | Limitation |
|---|---|---|---|---|
| Live smoke and comparison evidence use the same agreement vocabulary | PASS | Added `agreement_status` to the smoke report's sanitized `search_evidence` | `src/core/live-search-smoke.js`; smoke regression asserts `not_assessed` when quality metadata is absent | Smoke still covers only one prompt |
| Regression verification | PASS | `npm.cmd test`; `npm.cmd run check`; `git diff --check` | 80/80 tests pass; syntax and whitespace checks pass | No new provider call was needed for this change |

Milestone 107 status: `IMPLEMENTED BUT NOT FULLY VERIFIED`. The smoke,
runtime, and comparison layers now expose the same bounded evidence semantics.

## Milestone 108 — authorized current-revision paired capture (2026-08-12)

| Criterion | Status | Exact action | Evidence | Limitation |
|---|---|---|---|---|
| Current revision has a complete three-way transport capture | PASS | `npm.cmd run capture:three-way -- --execute --case-ids latest_info_en --chatgpt-capture artifacts/three-way-capture/three-way-current-scope-selection-20260811-211228.json --output artifacts/three-way-capture/three-way-current-authorized-latest-info-20260812-093500.json` | ChatGPT baseline, raw DeepSeek V4 Flash, and SOLAT all `PASS`; implementation revision `35a813c7635fdf3557c32f44f3548e8439431ddb` | This is one case, not complete corpus coverage |
| SOLAT used search and exposed validated evidence | PASS | Same capture | `mode: search_and_model`; `web_search_status: ready`; one visible Wikipedia source; search evidence includes explicit `agreement_status` | Search quality is still subject to manual review |
| Coverage report recognizes freshness | PASS | `npm.cmd run report:three-way` | `total: 20`; `stale_complete_captures: 12`; `current_revision_captures: 1`; `manual_review_required: 20` | Semantic comparison remains `NOT VERIFIED` by design |

Milestone 108 status: `IMPLEMENTED BUT NOT FULLY VERIFIED`. One current
revision paired capture is now available for manual semantic review; no
numeric parity score is claimed.

## Milestone 109 — authorized current social-scope capture (2026-08-12)

| Criterion | Status | Exact action | Evidence | Limitation |
|---|---|---|---|---|
| Current revision covers a social multi-platform request | PASS | `npm.cmd run capture:three-way -- --execute --case-ids social_scope --chatgpt-capture artifacts/three-way-capture/three-way-current-scope-selection-20260811-211228.json --output artifacts/three-way-capture/three-way-current-authorized-social-20260812-094000.json` | ChatGPT baseline, raw DeepSeek V4 Flash, and SOLAT all `PASS`; SOLAT `mode: search_and_model`, requested scope `social`, TikTok/Pinterest evidence returned | Social results are discovery evidence and require bounded claims |
| Current revision coverage increased | PASS | `npm.cmd run report:three-way` | `total: 20`; `current_revision_captures: 2`; `stale_complete_captures: 11`; `manual_review_required: 20` | Remaining cases still need fresh captures if full current-revision coverage is required |
| No semantic parity score is fabricated | PASS | Capture evaluator retained its manual-review boundary | `comparison_counts.NOT VERIFIED: 1` for the new case | Manual rubric review is still required |

Milestone 109 status: `IMPLEMENTED BUT NOT FULLY VERIFIED`. Current evidence
now includes both encyclopedic and social tool-selection cases.

## Milestone 110 — multi-scope capture boundary (2026-08-12)

| Criterion | Status | Exact action | Evidence | Limitation |
|---|---|---|---|---|
| Multi-scope request was exercised against the current runtime | PASS | `npm.cmd run capture:three-way -- --execute --case-ids multi_scope_request ...` | SOLAT executed social and video scopes and returned bounded Pinterest/YouTube evidence metadata | The external ChatGPT baseline for this case is missing |
| Incomplete three-way evidence is not counted as paired proof | PASS | `npm.cmd run report:three-way` after the attempt | Coverage remains `current_revision_captures: 2`; the incomplete multi-scope row is not counted; all rows remain `manual_review_required` | A matched ChatGPT baseline is required before this case can become paired evidence |
| Provider failure/limitation remains visible | PASS | Capture evaluator retained `chatgpt_baseline_missing` and `comparison_counts.NOT VERIFIED` | No fabricated parity score or PASS status was emitted for the incomplete case | The capture consumed provider quota for DeepSeek and SOLAT |

Milestone 110 status: `IMPLEMENTED BUT NOT FULLY VERIFIED`. Multi-scope
execution is exercised, but its three-way comparison remains correctly
unverified until a matched external baseline exists.

## Milestone 111 — rebuild and deterministic verification after authorized captures (2026-08-12)

| Criterion | Status | Exact action | Evidence | Limitation |
|---|---|---|---|---|
| Packaged runtime rebuilt from the latest tracked source | PASS | `npm.cmd run build` | `electron-builder` completed and refreshed `dist/win-unpacked`; local provider configuration was copied beside the executable | No interactive browser/computer-use verification was available in this run |
| Full deterministic regression remains green | PASS | `npm.cmd run check`; `npm.cmd test` | Syntax checks PASS; 80/80 tests PASS | Deterministic tests do not establish semantic parity with ChatGPT |
| Conversation corpus remains honest about external comparison | PASS | `npm.cmd run evaluate:conversation` | 19 PASS, 0 FAIL, 1 NOT VERIFIED (`live_semantic_parity_requires_external_baseline`) | The NOT VERIFIED row is intentional and blocks a parity claim |
| Coverage report retains current/stale and incomplete distinctions | PASS | `npm.cmd run report:three-way` | Current authorized captures are retained; incomplete multi-scope capture is not counted as paired proof | Current paired rows still require manual semantic review; broad current-revision coverage is incomplete |

Milestone 111 status: `IMPLEMENTED BUT NOT FULLY VERIFIED`. The package is
rebuilt and deterministic checks are green. Paid captures provide transport
and tool-path evidence only; semantic quality/parity remains `NOT VERIFIED`.

## Milestone 112 — comparison evidence recovery for hyphenated candidates (2026-08-12)

| Criterion | Status | Exact action | Evidence | Limitation |
|---|---|---|---|---|
| Comparison search creates a safe spacing variant per named candidate | PASS | Updated `searchQueryVariants` and added a regression for `compare Park-Dayoung and Han Nari` | `test/core.test.js`; candidate queries include both `Park-Dayoung` and `Park Dayoung` without inventing a spelling | Provider/model may still choose not to use every advisory variant |
| Missing comparison-side evidence gets one bounded recovery pass | PASS | Added per-candidate recovery in `ConversationCore` with a final synthesis boundary and regression coverage | `src/core/conversation-core.js`; 81/81 deterministic tests pass; recovery is capped to four queries and preserves incomplete evidence | If the provider has no final text path, the recovery evidence remains visible but cannot force a new synthesis |
| Current revision was exercised against an isolated external baseline | PASS | Authorized `npm.cmd run capture:three-way -- --execute --case-ids comparison_candidates ...` after revision `4e8bd39` | `artifacts/three-way-capture/three-way-current-authorized-comparison-20260812-100100.json`; all three transports PASS; SOLAT used `search_and_model`, found one Park Dayoung discovery result, and kept Han Nari unresolved | The result is intentionally not a semantic parity score; evidence is incomplete and requires clarification/manual review |
| Freshness and review boundaries remain truthful | PASS | `npm.cmd run report:three-way` | `total: 20`; `current_revision_captures: 1`; `stale_complete_captures: 12`; `manual_review_required: 20`; comparison row remains `NOT VERIFIED` | Broad current-revision coverage and semantic parity remain open |

Milestone 112 status: `IMPLEMENTED BUT NOT FULLY VERIFIED`. The system now
tries a bounded per-candidate recovery for comparison gaps, and the latest
capture shows the intended behavior: one side has discovery evidence while the
other remains unresolved instead of being invented or misattributed.

## Milestone 113 — no duplicate comparison recovery calls (2026-08-12)

| Criterion | Status | Exact action | Evidence | Limitation |
|---|---|---|---|---|
| Recovery does not repeat an already attempted query | PASS | Track attempted query strings before generating missing-candidate recovery variants | `src/core/conversation-core.js`; regression remains green at 81/81 | This reduces waste but cannot create evidence when the approved provider has no matching result |
| Latest package contains the de-duplicated recovery path | PASS | `npm.cmd run build` after revision `2c02d69` | `electron-builder` completed successfully | Interactive UI/runtime verification remains NOT VERIFIED |
| Latest authorized comparison capture reflects current revision | PASS | `npm.cmd run capture:three-way -- --execute --case-ids comparison_candidates ...` | `artifacts/three-way-capture/three-way-current-authorized-comparison-20260812-101000.json`; implementation revision `2c02d69`; SOLAT `search_and_model`, one TikTok discovery result for Park Dayoung, no usable Han Nari evidence | Semantic comparison remains `NOT VERIFIED`; incomplete evidence is correctly disclosed |
| Coverage report preserves the current/stale boundary | PASS | `npm.cmd run report:three-way` | Current capture is counted only when its runtime revision matches; all rows remain manual-review-required | Full current-revision corpus and ChatGPT parity are still open |

Milestone 113 status: `IMPLEMENTED BUT NOT FULLY VERIFIED`. Duplicate
recovery work is removed, and the latest capture shows truthful partial evidence
without turning one source into a comparison-wide claim.

## Milestone 114 — comparison recovery traceability (2026-08-12)

| Criterion | Status | Exact action | Evidence | Limitation |
|---|---|---|---|---|
| Three-way evidence records whether comparison recovery ran | PASS | Added `comparison_recovery_used` to the sanitized SOLAT capture and observation packet | `src/core/three-way-evaluator.js`; regression asserts the field is preserved in the grounding/tool-choice observation | Existing historical captures do not gain the field retroactively |
| Regression and package verification | PASS | `npm.cmd test`; `npm.cmd run check`; `git diff --check`; `npm.cmd run build` | 81/81 tests pass; syntax, whitespace and packaged build pass | Interactive runtime verification remains NOT VERIFIED |
| Semantic comparison boundary remains unchanged | PASS | Kept `scoring_allowed: false` until evidence-backed manual review | Three-way evaluator continues to return `NOT VERIFIED` for semantic quality | No numeric ChatGPT parity claim is supported |

Milestone 114 status: `IMPLEMENTED BUT NOT FULLY VERIFIED`. Comparison
recovery is now auditable in the same evidence packet as source/tool choice,
while the system still refuses to turn transport or recovery metadata into a
semantic quality score.

## Milestone 115 — current revision comparison trace refreshed (2026-08-12)

| Criterion | Status | Exact action | Evidence | Limitation |
|---|---|---|---|---|
| Latest comparison capture includes the recovery trace field | PASS | Authorized `capture:three-way --execute --case-ids comparison_candidates` after revision `c978ae2` | `artifacts/three-way-capture/three-way-current-authorized-comparison-20260812-101900.json`; `comparison_recovery_used: false` is recorded truthfully, while model-selected follow-up searches are visible in `search_evidence` | The model's own tool choices can still vary between runs |
| Capture matches the current runtime tree | PASS | `npm.cmd run report:three-way` | `current_revision_captures: 1`; `stale_complete_captures: 12`; `manual_review_required: 20` | Only one of 20 cases is fresh for the current runtime |
| Partial comparison remains safe | PASS | Same capture and evaluator boundary | Park Dayoung has one social-discovery result; Han Nari has no usable evidence; visible source count remains 0 and comparison status stays `NOT VERIFIED` | A human or approved evaluator is still required to judge answer quality |

Milestone 115 status: `IMPLEMENTED BUT NOT FULLY VERIFIED`. The latest
current-revision evidence is refreshed and traceable; it confirms truthful
partial grounding, not ChatGPT-level semantic parity.

## Milestone 116 โ€” deterministic coverage for hyphenated comparison variants (2026-08-12)

| Criterion | Status | Exact action | Evidence | Limitation |
|---|---|---|---|---|
| Corpus covers the repaired comparison query variants | PASS | Added `hyphenated_comparison_variants` to `evaluations/conversation-search-corpus.json` | The case asserts the bounded sequence includes `Park-Dayoung`, `Park Dayoung`, `Han Nari`, and the normalized comparison query | This verifies router planning only; it does not prove provider retrieval quality |
| Regression suite and evaluator remain green | PASS | `npm.cmd run evaluate:conversation`; `npm.cmd test`; `npm.cmd run check`; `git diff --check` | Evaluator: 20 PASS, 0 FAIL, 1 NOT VERIFIED; tests: 81/81 PASS; syntax and whitespace checks PASS | `live_semantic_parity_requires_external_baseline` remains intentionally NOT VERIFIED |
| No unsupported parity claim is introduced | PASS | Kept live semantic baseline case unchanged | The deterministic report still separates transport/routing checks from semantic comparison | A matched ChatGPT answer and rubric are still required for semantic scoring |

Milestone 116 status: `IMPLEMENTED BUT NOT FULLY VERIFIED`. The newly repaired
comparison variant behavior is now part of the deterministic corpus and will
regress visibly, while live semantic parity remains an explicit open boundary.

## Milestone 117 โ€” contextual source-scope candidates for manhwa follow-ups (2026-08-12)

| Criterion | Status | Exact action | Evidence | Limitation |
|---|---|---|---|---|
| Prior manhwa context informs candidate source scopes | PASS | `analyzeIntent` now adds advisory `social` beside `auto` when the resolved conversation context is a manhwa character context | `src/core/intent-router.js`; router regression and corpus case `manhwa_context_scope_candidate` | `social` is only a candidate hint; the model may still choose `auto` or ask for clarification |
| Explicit source requests remain authoritative | PASS | Kept `requested_source_scopes` derived only from the current explicit user message | `test/core.test.js`; existing explicit social/video/encyclopedic cases remain PASS | Context does not silently force a source or bypass the model-first path |
| Full deterministic verification | PASS | `npm.cmd run evaluate:conversation`; `npm.cmd test`; `npm.cmd run check`; `git diff --check` | Evaluator: 21 PASS, 0 FAIL, 1 NOT VERIFIED; tests: 81/81 PASS; syntax and whitespace checks PASS | Live provider retrieval and semantic parity remain NOT VERIFIED |

Milestone 117 status: `IMPLEMENTED BUT NOT FULLY VERIFIED`. Follow-up context
now gives the model a relevant social-discovery option for manhwa identity cases
without turning the router into a hard gate.

## Milestone 118 โ€” authorized current comparison capture after contextual scope hint (2026-08-12)

| Criterion | Status | Exact action | Evidence | Limitation |
|---|---|---|---|---|
| Latest runtime still completes all three transport paths | PASS | Authorized single-run `npm.cmd run capture:three-way -- --execute --case-ids comparison_candidates ...` | `artifacts/three-way-capture/three-way-current-authorized-context-scope-20260812-20260812-100148.json`; ChatGPT baseline, raw DeepSeek V4 Flash, and SOLAT transport all PASS | This proves transport and trace integrity, not answer quality |
| SOLAT keeps comparison candidates separate and discloses weak evidence | PASS | Same capture | SOLAT returned separate Park Dayoung/Han Nari search traces, two visible TikTok discovery sources, and explicit limitations; no unsupported parity score was emitted | Both candidates do not have authoritative corroboration; `agreement_status` remains `not_assessed` |
| Current implementation is identified correctly | PASS | `npm.cmd run report:three-way` | `current_revision_captures: 1`, revision `72519c8...`, comparison row remains `NOT VERIFIED` | Other corpus rows are stale or missing current captures |

Milestone 118 status: `IMPLEMENTED BUT NOT FULLY VERIFIED`. The authorized
runtime capture confirms the latest search/context path is live and truthful;
the raw model answer still demonstrates why semantic comparison remains a
manual-review boundary.

## Milestone 119 โ€” bounded context variants for both comparison candidates (2026-08-12)

| Criterion | Status | Exact action | Evidence | Limitation |
|---|---|---|---|---|
| Hyphenated comparison keeps context-qualified variants for both entities | PASS | Increased the advisory query-variant cap from 5 to 8 and added a manhwa comparison regression | `src/core/intent-router.js`, `test/core.test.js`; both `Park-Dayoung manhwa character` and `Han Nari manhwa character` are retained | Variants are hints; the model/provider can still choose fewer searches |
| Corpus catches truncation regressions | PASS | Added `hyphenated_manhwa_comparison_variants` to the deterministic corpus | `npm.cmd run evaluate:conversation`: 22 PASS, 0 FAIL, 1 NOT VERIFIED | This validates planning, not live search recall |
| Full deterministic verification | PASS | `npm.cmd test`; `npm.cmd run check`; `git diff --check` | 81/81 tests PASS; syntax and whitespace checks PASS | Semantic parity remains NOT VERIFIED |

Milestone 119 status: `IMPLEMENTED BUT NOT FULLY VERIFIED`. The bounded
planner now retains context for both sides of a hyphenated comparison instead
of silently dropping the second candidate's contextual query.

## Milestone 120 โ€” current-revision query-variant runtime capture (2026-08-12)

| Criterion | Status | Exact action | Evidence | Limitation |
|---|---|---|---|---|
| Latest package executes the comparison path after the variant-cap change | PASS | One authorized `npm.cmd run capture:three-way -- --execute --case-ids comparison_candidates ...` | `artifacts/three-way-capture/three-way-current-authorized-query-variants-20260812-100527.json`; implementation revision `c602049`; all three transports PASS | This single case does not represent the full corpus |
| Recovery remains bounded and truthful | PASS | Same capture | SOLAT recorded `comparison_recovery_used: true`, separated candidate queries, and kept visible source count at 0 while one side remained unresolved | Search returned only one usable social-discovery side; no comparison-wide citation was shown |
| Semantic comparison remains protected | PASS | `npm.cmd run report:three-way` | Current capture is recognized as current; comparison status remains `NOT VERIFIED` and no score is emitted | Manual evidence-backed review is still required |

Milestone 120 status: `IMPLEMENTED BUT NOT FULLY VERIFIED`. Runtime evidence
matches the latest source and confirms the safety boundary under incomplete
comparison evidence.

## Milestone 121 โ€” advisory source-scope priority for ambiguous comparisons (2026-08-12)

| Criterion | Status | Exact action | Evidence | Limitation |
|---|---|---|---|---|
| Intent hints expose an ordered scope preference | PASS | Added `task.source_scope_priority` and included it in the provider-facing comparison instruction | `src/core/intent-router.js`, `src/core/conversation-core.js`; comparison priority is `encyclopedic → auto`, while manhwa context is `social → encyclopedic → auto` | The priority is advisory; model-selected tools remain enabled |
| Explicit user source choice stays authoritative | PASS | Priority generation leaves `requested_source_scopes` unchanged and the prompt explicitly preserves that rule | Existing encyclopedic/social/video and mixed-scope regressions remain PASS | A provider can still fail to call a suggested scope |
| Regression/evaluator coverage | PASS | Added evaluator support and corpus expectations for scope priority; ran `npm.cmd run evaluate:conversation`, `npm.cmd test`, `npm.cmd run check`, `git diff --check` | Evaluator: 22 PASS, 0 FAIL, 1 NOT VERIFIED; tests: 81/81 PASS | Live semantic parity remains NOT VERIFIED |

Milestone 121 status: `IMPLEMENTED BUT NOT FULLY VERIFIED`. The model now
receives a reasoned source-order hint for ambiguous comparisons without turning
the router into a single-intent or single-source gate.

## Milestone 122 โ€” explicit source choice wins priority ordering (2026-08-12)

| Criterion | Status | Exact action | Evidence | Limitation |
|---|---|---|---|---|
| User-selected source scope is first in advisory priority | PASS | `source_scope_priority` now starts with `requested_source_scopes` before contextual/comparison suggestions | `src/core/intent-router.js`; TikTok comparison regression and social corpus case | The model may still fail or return no results from the requested provider |
| Contextual fallback remains available without overriding explicit choice | PASS | Existing candidate scopes and model-first routing remain unchanged | Existing multi-scope and context regressions remain PASS | No scope is silently forced when the user did not request it |
| Deterministic verification | PASS | `npm.cmd run evaluate:conversation`; `npm.cmd test`; `npm.cmd run check`; `git diff --check` | Evaluator: 22 PASS, 0 FAIL, 1 NOT VERIFIED; tests: 81/81 PASS | Live semantic comparison remains NOT VERIFIED |

Milestone 122 status: `IMPLEMENTED BUT NOT FULLY VERIFIED`. Explicit platform
requests now cannot be displaced by a generic comparison priority hint.

## Milestone 123 — authorized current-revision priority capture (2026-08-12)

| Criterion | Status | Exact action | Evidence | Limitation |
|---|---|---|---|---|
| Three-way transport completes on the current revision | PASS | Authorized single-run `npm.cmd run capture:three-way -- --execute --case-ids comparison_candidates --chatgpt-capture artifacts/three-way-capture/three-way-comparison_candidates-isolated-20260811-162100.json --output artifacts/three-way-capture/three-way-current-authorized-priority-20260812-101024.json` | Capture `artifacts/three-way-capture/three-way-current-authorized-priority-20260812-101024.json`; ChatGPT baseline, raw DeepSeek V4 Flash, and SOLAT transports completed; revision `9d412cddbd741ce57a25be915420267196c4e5` | This is one paid run, not full-corpus parity evidence |
| Source priority is observable at runtime | PASS | Inspected the same capture trace | SOLAT attempted `encyclopedic` first, then `auto`; explicit comparison candidates remained separate and no duplicate recovery loop was used | Provider retrieval returned incomplete corroboration, so source count remained 0 |
| Failure and semantic limits remain truthful | PASS | Ran compact `report:three-way` extraction after capture | `comparison_candidates`: `latest_capture_complete=PASS`, `evidence_for_current_revision=PASS`, `revision_match=PASS`, `comparison_status=NOT VERIFIED`; latency metadata recorded (DeepSeek 9518 ms, SOLAT 13634 ms) | Raw DeepSeek response contained unsupported identity/career claims; no semantic score is claimed |

Milestone 123 status: `IMPLEMENTED BUT NOT FULLY VERIFIED`. The authorized
runtime capture confirms the new source-priority behavior on the current build.
Semantic parity and trustworthy cross-source answer quality remain `NOT VERIFIED`
until corroborating evidence and a human/rubric review are available.

## Milestone 124 — lowercase subject continuity for ambiguous follow-ups (2026-08-12)

| Criterion | Status | Exact action | Evidence | Limitation |
|---|---|---|---|---|
| Follow-up keeps a short lowercase subject from the user's prior turn | PASS | Added a bounded user-turn subject extractor in `contextEntities` for two-to-four lexical tokens | `src/core/intent-router.js`; `lowercase_subject_follow_up` regression in `test/core.test.js` and `evaluations/conversation-search-corpus.json` | This is conservative lexical continuity, not semantic entity resolution |
| Original message and model-first behavior are preserved | PASS | The extractor only adds an advisory context candidate; it does not rewrite `original_message`, force a tool, or change hard-gate behavior | `npm.cmd run evaluate:conversation`: new case PASS; existing model-first and ambiguity cases remain PASS | A provider may still ask for clarification when evidence is conflicting |
| Full deterministic verification | PASS | `npm.cmd test`; `npm.cmd run evaluate:conversation`; `npm.cmd run check`; `git diff --check` | 81/81 tests PASS; evaluator 23 PASS, 0 FAIL, 1 NOT VERIFIED; syntax and whitespace checks PASS | Live provider wording and semantic ChatGPT parity remain `NOT VERIFIED` |

Milestone 124 status: `IMPLEMENTED BUT NOT FULLY VERIFIED`. Lowercase subjects
from recent user turns now survive into pronoun/ordinal follow-ups without
silently forcing a search or claiming that lexical continuity proves identity.

## Milestone 125 — complete explicitly requested multi-scope searches (2026-08-12)

| Criterion | Status | Exact action | Evidence | Limitation |
|---|---|---|---|---|
| Every explicitly named source scope is executed | PASS | The search executor now expands any multi-scope `requested_source_scopes` list even when the model initially calls one concrete scope instead of `auto` | `src/core/conversation-core.js`; regression `conversation core completes every explicit scope when the model chooses only one` | This applies only to explicit user requests; advisory candidate scopes remain model-selected |
| Platform-specific query constraints remain intact | PASS | Each expanded scope still passes through requested-platform and context-qualifier constraints before execution | Regression asserts `Ada Lovelace Pinterest` and `Ada Lovelace YouTube` queries and both visible source hosts | Provider availability can still make an individual scope empty/degraded |
| Full deterministic verification | PASS | `npm.cmd test`; `npm.cmd run evaluate:conversation`; `npm.cmd run check`; `git diff --check` | 82/82 tests PASS; evaluator 23 PASS, 0 FAIL, 1 NOT VERIFIED; syntax and whitespace checks PASS | Live provider quality and semantic parity remain `NOT VERIFIED` |

Milestone 125 status: `IMPLEMENTED BUT NOT FULLY VERIFIED`. Explicit multi-source
requests can no longer be silently reduced to the one platform selected by the
model, while ordinary model-first tool choice remains unchanged.

## Milestone 126 — expose source-priority provenance in response evidence (2026-08-12)

| Criterion | Status | Exact action | Evidence | Limitation |
|---|---|---|---|---|
| The selected source order is visible in the response summary | PASS | Added `source_scope_priority` to the conversation search summary | `src/core/conversation-core.js`; multi-scope regression asserts `['social', 'video', 'auto']` | This records intended order, not proof that every advisory scope was used |
| Priority survives persistence and three-way reporting | PASS | Added bounded, redacted serialization to conversation persistence and the three-way capture/report packet | `src/core/conversation-persistence.js`, `src/core/three-way-evaluator.js` | Existing historical messages without the field remain backward-compatible with an empty list |
| Full deterministic verification | PASS | `npm.cmd test`; `npm.cmd run evaluate:conversation`; `npm.cmd run check`; `git diff --check` | 82/82 tests PASS; evaluator 23 PASS, 0 FAIL, 1 NOT VERIFIED; syntax and whitespace checks PASS | Live semantic parity remains `NOT VERIFIED` |

Milestone 126 status: `IMPLEMENTED BUT NOT FULLY VERIFIED`. Reviewers can now
see not only which source scopes were requested and used, but also the ordered
reasoning hint that led to that search plan.

## Milestone 127 — auditable source family, authority tier, and selection basis (2026-08-12)

| Criterion | Status | Exact action | Evidence | Limitation |
|---|---|---|---|---|
| Each selected result exposes a source family | PASS | Added normalized families for encyclopedic, social, video, AI-summary, and approved-web hosts | `src/core/web-search.js`; `test/core.test.js` source metadata regression | Family is host-based metadata, not a truth oracle |
| Authority and selection rationale are visible | PASS | Added `authority_tier` and `selection_basis` to assessed results and source disclosures | `src/core/web-search.js`; `test/core.test.js` asserts primary reference and approved-source selection | Tier reflects configured host policy and relevance gates, not factual correctness |
| Full deterministic verification | PASS | `npm.cmd test`; `npm.cmd run evaluate:conversation`; `npm.cmd run check`; `git diff --check` | 82/82 tests PASS; evaluator 23 PASS, 0 FAIL, 1 NOT VERIFIED; syntax and whitespace checks PASS | Live provider quality and semantic ChatGPT parity remain `NOT VERIFIED` |

Milestone 127 status: `IMPLEMENTED BUT NOT FULLY VERIFIED`. Search evidence now
communicates not only the URL and count, but also the source family, configured
authority tier, and why the result survived selection. These fields support
review and UI disclosure without claiming that ranking alone proves truth.

## Milestone 128 — contextual corroboration for character/manhwa follow-ups (2026-08-12)

| Criterion | Status | Exact action | Evidence | Limitation |
|---|---|---|---|---|
| A social discovery result can receive bounded encyclopedic corroboration | PASS | Added one model-first supplemental encyclopedic search when recent context identifies a manhwa/character and the model selected another scope | `src/core/conversation-core.js`, `src/core/intent-router.js`; regression `conversation core adds bounded encyclopedic corroboration for a manhwa follow-up` | Only one bounded corroboration pass is allowed; explicit source requests remain authoritative |
| The user-facing status records the extra evidence path | PASS | Added `contextual_coverage_used` to search summary, persistence, three-way capture, and source-priority UI label | `src/core/conversation-persistence.js`, `src/core/three-way-evaluator.js`, `renderer/renderer.js` | A corroborating source still does not prove the model's semantic answer is correct |
| Full deterministic verification | PASS | `npm.cmd test`; `npm.cmd run evaluate:conversation`; `npm.cmd run check`; `git diff --check` | 83/83 tests PASS; evaluator 23 PASS, 0 FAIL, 1 NOT VERIFIED; syntax and whitespace checks PASS | Live source-provider behavior and ChatGPT semantic parity remain `NOT VERIFIED` |

Milestone 128 status: `IMPLEMENTED BUT NOT FULLY VERIFIED`. Character/manhwa
follow-ups no longer stop at a single discovery source when a bounded stronger
source check is available, while the original user wording and model-first
tool choice remain intact.

## Milestone 129 — standalone named-topic lookup before answer (2026-08-12)

| Criterion | Status | Exact action | Evidence | Limitation |
|---|---|---|---|---|
| A short named topic is treated as a lookup candidate | PASS | Added bounded named-topic detection with stopwords and preserved model-first routing | `src/core/intent-router.js`; `Hitler` intent regression | Lexical name detection cannot prove which same-name entity the user means |
| Search can resolve a bare-name ambiguity before synthesis | PASS | Enabled one bounded recovery search for named lookup hints even when clarification is also a candidate | `src/core/conversation-core.js`; standalone named-topic recovery regression | If evidence conflicts or is empty, the model must still ask/qualify rather than guess |
| Full deterministic verification | PASS | `npm.cmd test`; `npm.cmd run evaluate:conversation`; `npm.cmd run check`; `git diff --check` | 84/84 tests PASS; evaluator 23 PASS, 0 FAIL, 1 NOT VERIFIED; syntax and whitespace checks PASS | Live provider quality and ChatGPT semantic parity remain `NOT VERIFIED` |

Milestone 129 status: `IMPLEMENTED BUT NOT FULLY VERIFIED`. A bare named
question can now obtain approved evidence before SOLAT answers, reducing the
observed failure where a factual topic was handled as uncited generic chat.

## Milestone 130 — named-topic recovery honors source priority (2026-08-12)

| Criterion | Status | Exact action | Evidence | Limitation |
|---|---|---|---|---|
| Bare-name recovery uses the highest-priority approved scope | PASS | Recovery now selects the first advisory priority scope for named lookups instead of always using `auto` | `src/core/conversation-core.js`; standalone `Hitler` regression asserts `encyclopedic` | Explicit user-selected scopes still override this advisory priority |
| Scope remains truthful in the returned evidence | PASS | Search adapter outcome and response summary preserve the executed scope | `test/core.test.js`; existing source disclosure and persistence paths | Provider may return no evidence or degraded results |
| Focused verification | PASS | `npm.cmd test -- --test-name-pattern="standalone named|intent router keeps"` | 6/6 selected test files pass | Full regression/build still pending after this change |

Milestone 130 status: `IMPLEMENTED BUT NOT FULLY VERIFIED`. Named-topic
recovery now starts with the configured stronger source family, reducing the
risk that a bare factual name is answered from an unrelated general result.

## Milestone 131 — bounded corroboration for incomplete comparisons (2026-08-12)

| Criterion | Status | Exact action | Evidence | Limitation |
|---|---|---|---|---|
| Incomplete comparison evidence triggers stronger per-candidate coverage | PASS | Added at most one query per candidate lacking evidence in the highest-priority approved scope after the model's initial and bounded recovery searches; this also corroborates a social-only hit | `src/core/conversation-core.js`; `comparisonRecoveryUsed`/`comparisonCoverageUsed` regression | Coverage is bounded to two candidates and does not retry endlessly |
| Synthesis keeps candidate evidence separate and truthful | PASS | Final model prompt includes the coverage packet and requires uncertainty when either side remains unsupported | Regression and existing comparison evidence gates in `test/core.test.js` | Semantic correctness still requires live review |
| Focused verification | PASS | `npm.cmd test -- --test-name-pattern=comparison` and one authorized three-way capture | 12/12 selected tests pass; `artifacts/three-way-capture/three-way-current-comparison-both-encyclopedic-20260812-120000.json` records `comparison_coverage_used: true` and encyclopedic attempts for both candidates | Capture comparison status remains `NOT VERIFIED`; the provider returned no usable encyclopedic result |

Milestone 131 status: `IMPLEMENTED BUT NOT FULLY VERIFIED`. The comparison
path now attempts a stronger, candidate-specific corroboration pass instead of
ending after an `auto` search that only found one side.

## Milestone 132 — align comparison candidates with priority trace (2026-08-12)

| Criterion | Status | Exact action | Evidence | Limitation |
|---|---|---|---|---|
| Candidate scopes include the stronger comparison fallback | PASS | Added `encyclopedic` to the advisory candidate list for comparisons and named lookups without an explicit platform request | `src/core/intent-router.js`; intent regression covers social/encyclopedic/auto ordering | Explicit platform requests remain scoped to the user's requested platforms |
| Priority and candidate traces agree | PASS | The scope shown in `source_scope_priority` is now also represented in `source_scope_candidates` | Intent router regression and persisted summary fields | Candidate presence does not prove the provider selected that scope |
| Deterministic verification | PASS | `npm.cmd test`; `npm.cmd run evaluate:conversation`; `npm.cmd run check`; `git diff --check` | 84/84 tests PASS; evaluator 23 PASS, 0 FAIL, 1 NOT VERIFIED | Live semantic parity remains `NOT VERIFIED` |

Milestone 132 status: `IMPLEMENTED BUT NOT FULLY VERIFIED`. Review traces now
describe the comparison search plan consistently, making it clear why an
encyclopedic corroboration attempt is expected.

## Milestone 133 — stop repeated semantic tool calls (2026-08-12)

| Criterion | Status | Exact action | Evidence | Limitation |
|---|---|---|---|---|
| Repeated tool requests cannot consume the full loop without new evidence | PASS | `OpenAICompatibleProvider.completeWithTools` now fingerprints tool name plus normalized arguments and skips semantically duplicate calls, even when the provider changes call IDs | `src/core/provider.js`; regression `provider stops semantically repeated tool calls before the round cap` | A provider can still request a genuinely different query until the configured cap |
| Existing evidence remains available for truthful synthesis | PASS | Duplicate detection exits to the existing bounded text-only synthesis path without appending an unmatched assistant tool call | `test/core.test.js`; existing forced-final and malformed-response tests remain green | If the provider continues emitting tool calls during both final synthesis attempts, the operation still fails with `tool_loop_limit` |
| Full deterministic verification | PASS | `npm.cmd test`; `npm.cmd run evaluate:conversation`; `npm.cmd run check`; `git diff --check` | 85/85 tests PASS; evaluator 23 PASS, 0 FAIL, 1 NOT VERIFIED; syntax and whitespace checks PASS | Live provider behavior and ChatGPT semantic parity remain `NOT VERIFIED` |

Milestone 133 status: `IMPLEMENTED BUT NOT FULLY VERIFIED`. The provider now
avoids wasting bounded rounds on the same semantic search request, reducing a
known source of `tool_loop_limit` failures while preserving truthful failure
behavior when synthesis still cannot complete.

## Milestone 134 — canonical duplicate-call identity (2026-08-12)

| Criterion | Status | Exact action | Evidence | Limitation |
|---|---|---|---|---|
| Duplicate tool detection is independent of JSON property order | PASS | Added recursive stable serialization for tool-call arguments before fingerprinting | `src/core/provider.js`; regression sends the same search arguments with reversed key order and executes the tool once | This only handles semantically identical JSON values; genuinely different queries remain eligible |
| Runtime package contains the current provider fix | PASS | Rebuilt and relaunched `dist/win-unpacked/SOLAT.exe` after the provider/test change | `npm.cmd run build` succeeded and the packaged process started successfully (`PID 17140`) | This is a startup check, not a live paid-provider semantic run |
| Regression verification | PASS | `npm.cmd test`; `npm.cmd run check`; `git diff --check` | 85/85 tests PASS; syntax and whitespace checks PASS | Live provider behavior and ChatGPT semantic parity remain `NOT VERIFIED` |

Milestone 134 status: `IMPLEMENTED BUT NOT FULLY VERIFIED`. Repeated search
requests are now recognized consistently even when a compatible provider
reorders argument fields between rounds.

## Milestone 135 — executable semantic-review gate (2026-08-12)

| Criterion | Status | Exact action | Evidence | Limitation |
|---|---|---|---|---|
| Rubric review can be validated outside the unit-test harness | PASS | Added `npm.cmd run validate:semantic-review -- --input <review.json>` using the same versioned `validateSemanticReview` function as the evaluator | `scripts/validate-semantic-review.js`; `package.json`; command against `evaluations/semantic-comparison-rubric.json` returned `NOT VERIFIED` with exit code 2 | An annotation file must still contain all six dimensions and two-sided evidence before scoring is allowed |
| Incomplete review cannot pass silently | PASS | CLI exits 2 for missing dimensions or evidence and prints the exact reason without a score | Deterministic command output: `semantic_review_missing_dimensions`, `scoring_allowed: false` | This gate validates structure/evidence presence, not the reviewer's factual judgment |
| Regression verification | PASS | `npm.cmd test`; `npm.cmd run check`; `git diff --check` | 85/85 tests PASS; all checked JavaScript parses; whitespace check PASS | Live current-revision captures and semantic parity remain `NOT VERIFIED` |

Milestone 135 status: `IMPLEMENTED BUT NOT FULLY VERIFIED`. Semantic comparison
now has an executable, fail-closed review gate instead of relying only on an
in-process helper or a prose instruction.

## Milestone 136 — package alignment after review-gate tooling (2026-08-12)

| Criterion | Status | Exact action | Evidence | Limitation |
|---|---|---|---|---|
| Packaged runtime is rebuilt from the current committed tree | PASS | Stopped the prior local SOLAT process, ran `npm.cmd run build`, and relaunched the resulting executable | `dist/win-unpacked/SOLAT.exe` built successfully and started as PID 18132 | Startup does not prove live provider answer quality |
| Source and package verification remain green | PASS | Re-ran `npm.cmd test`, `npm.cmd run check`, semantic-review fail-closed check, and `git diff --check` before packaging | 85/85 tests PASS; syntax/whitespace PASS; incomplete rubric correctly exits 2 with `NOT VERIFIED` | Current-revision three-way semantic captures are still absent |

Milestone 136 status: `IMPLEMENTED BUT NOT FULLY VERIFIED`. The packaged
application now matches the source tree that contains the executable semantic
review gate.

## Milestone 137 — first current-revision three-way capture after review gate (2026-08-12)

| Criterion | Status | Exact action | Evidence | Limitation |
|---|---|---|---|---|
| Current code can complete a three-way transport capture | PASS | One owner-authorized `npm.cmd run capture:three-way -- --execute --case-ids general_chat_en` with the isolated ChatGPT baseline and no retry | `artifacts/three-way-capture/three-way-current-general_chat_en-20260812-110617.json`; ChatGPT, raw DeepSeek V4 Flash, and SOLAT all returned visible responses | This is one general-chat case and does not cover search or ambiguity |
| Capture is tied to the current implementation | PASS | Ran `npm.cmd run report:three-way` after capture | `current_revision_captures: 1`; current revision `0cbcec8...` matches the capture; 12 older complete rows remain stale | The remaining corpus rows need separate current-revision captures |
| Semantic score remains fail-closed | PASS | Evaluator retained the six-dimension rubric packet for the new row | Capture reports `comparison_status: NOT VERIFIED`, `scoring_allowed: false`, and `manual_review_required: true` | No parity percentage is claimed without completed two-sided evidence review |

Milestone 137 status: `IMPLEMENTED BUT NOT FULLY VERIFIED`. The first live
capture now proves the current runtime path, while keeping semantic quality
separate from transport success.

## Milestone 138 — per-platform evidence coverage (2026-08-12)

| Criterion | Status | Exact action | Evidence | Limitation |
|---|---|---|---|---|
| Requested platforms are distinguished from the broader source scope | PASS | Added platform-host coverage metadata to `ConversationCore` | `requested_platforms`, `requested_platforms_with_evidence`, and `requested_platform_status` are emitted only when the user names platforms | A ready social scope can still have incomplete platform coverage |
| Platform coverage is persisted and included in three-way observations | PASS | Extended conversation persistence and `three-way-evaluator` sanitization | Metadata is bounded/redacted and preserved for review without secrets | This records evidence coverage; it does not prove semantic answer quality |
| Missing platform evidence is fail-visible | PASS | Added regression `conversation core reports incomplete platform coverage when one requested platform has no evidence` | `npm.cmd test`: 86/86 PASS; a Pinterest-only result for a TikTok+Pinterest request reports `requested_platform_status: incomplete` | Provider recall remains external and may vary by query |
| Live social capture after the change | PASS | One owner-authorized bounded `capture:three-way --execute --case-ids social_scope` | `three-way-current-social_scope-20260812-112129.json`: 3/3 transport PASS; SOLAT returned six sources across TikTok and Pinterest and reported platform coverage `complete` | Semantic comparison remains `NOT VERIFIED`; one case is not a general recall guarantee |

Milestone 138 status: `IMPLEMENTED BUT NOT FULLY VERIFIED`. The system now
reports platform-level evidence coverage separately from scope-level readiness,
so a partial TikTok/Pinterest search cannot be presented as complete by metadata
alone.

## Milestone 139 — visible platform coverage disclosure (2026-08-12)

| Criterion | Status | Exact action | Evidence | Limitation |
|---|---|---|---|---|
| The UI exposes platform evidence coverage next to the source count | PASS | Added a bounded `Platforms · found/requested · status` line to the assistant metadata row | `renderer/renderer.js`; `test/ui.test.js`; `npm.cmd test`: 86/86 PASS | This is metadata disclosure, not a semantic quality score |
| Source disclosure remains allowlisted | PASS | Kept existing `responseSources` validation and source-fold links unchanged | All UI/source tests remain green | Model-written URLs are still intentionally hidden when not tool-validated |

Milestone 139 status: `IMPLEMENTED BUT NOT FULLY VERIFIED`. The owner can now
see both source count and whether every explicitly named platform returned
validated evidence.

## Milestone 140 — empty-result platform disclosure (2026-08-12)

| Criterion | Status | Exact action | Evidence | Limitation |
|---|---|---|---|---|
| A search with no validated sources still discloses requested platform coverage | PASS | Added a zero-of-requested platform line to the no-source renderer branch | `renderer/renderer.js`; `npm.cmd test`: 86/86 PASS | The line reports evidence availability, not why the provider had no result |

Milestone 140 status: `IMPLEMENTED BUT NOT FULLY VERIFIED`.

## Milestone 141 — current follow-up context capture (2026-08-12)

| Criterion | Status | Exact action | Evidence | Limitation |
|---|---|---|---|---|
| Follow-up context is preserved into a source-backed turn | PASS | One owner-authorized bounded `capture:three-way --execute --case-ids follow_up_context` using the matched-history baseline | `three-way-current-follow_up_context-20260812-112235.json`: SOLAT used `search_and_model`, two bounded tool rounds, and returned one validated Wikipedia source for the resolved Ada Lovelace follow-up | This is one follow-up case, not a general context-resolution guarantee |
| The three-way transport remains complete | PASS | Same capture recorded baseline, raw DeepSeek, and SOLAT visible responses | `capture_counts: 3 PASS`; no retry loop was used | Raw DeepSeek baseline did not use tools, so semantic parity remains `NOT VERIFIED` |

Milestone 141 status: `IMPLEMENTED BUT NOT FULLY VERIFIED`.

## Milestone 142 — named-lookup encyclopedic corroboration (2026-08-12)

| Criterion | Status | Exact action | Evidence | Limitation |
|---|---|---|---|---|
| Named lookup can supplement model-selected discovery with bounded encyclopedic evidence | PASS | Added a named-lookup corroboration scope that runs only when no explicit source scope is requested and the router prioritizes encyclopedic evidence | `src/core/conversation-core.js`; regression `conversation core adds bounded encyclopedic corroboration after a named social lookup` | One bounded corroboration pass does not guarantee provider recall |
| Explicit source requests remain authoritative | PASS | Corroboration returns no scope when `requested_source_scopes` is non-empty | Existing explicit-scope regression suite remains green | A provider can still return weak evidence within the requested scope |
| Regression verification | PASS | `npm.cmd test`; `npm.cmd run check`; `git diff --check` | 87/87 tests PASS; syntax and whitespace checks PASS | Live semantic parity remains `NOT VERIFIED` |

Milestone 142 status: `IMPLEMENTED BUT NOT FULLY VERIFIED`.

## Milestone 143 — packaging check boundary (2026-08-12)

| Criterion | Status | Exact action | Evidence | Limitation |
|---|---|---|---|---|
| Source tests and syntax remain green after corroboration change | PASS | `npm.cmd test`; `npm.cmd run check`; `git diff --check` | 87/87 tests PASS; syntax and whitespace checks PASS | none observed in source checks |
| Rebuild from current source | PASS (alternate output) | `npx.cmd electron-builder --dir --config.directories.output=dist-current` | `dist-current/win-unpacked/SOLAT.exe` and `resources/app.asar` were produced at 11:27 from HEAD `0919ebe` | Default `dist/win-unpacked` remains NOT VERIFIED because four running `SOLAT.exe` processes (PIDs 6408, 7660, 18132, 23852) hold `dxcompiler.dll`; no process was stopped automatically |

Milestone 143 status: `IMPLEMENTED BUT NOT FULLY VERIFIED`.

## Milestone 144 — bounded recovery after an empty explicit search (2026-08-12)

| Criterion | Status | Exact action | Evidence | Limitation |
|---|---|---|---|---|
| Explicit source requests do not stop after an empty first tool result | PASS | Added one bounded recovery path when the initial explicit search returns no usable `ready` sources/results; the original model-first path and explicit scope remain authoritative | `src/core/conversation-core.js`; regression `conversation core recovers an explicit search request when the initial tool result has no usable evidence` | Recovery is attempted only when the provider supports a final text completion; it does not retry indefinitely |
| Recovery avoids duplicate-query loops | PASS | Recovery query selection skips already attempted query variants and remains capped at one recovery synthesis | `recoverySearchQuery(...)`, `shouldRecoverInsufficientSearch(...)`; 88-test regression suite | If every bounded query variant is exhausted, the same original query may be reused once and the provider result remains authoritative |
| Failure remains truthful | PASS | Empty, degraded, or unavailable evidence is still disclosed as such; no source is fabricated | Existing unavailable/empty-search tests plus new recovery test | Live provider recall and semantic correctness are not established by deterministic tests |
| Full deterministic verification | PASS | `npm.cmd test`; `npm.cmd run check`; `npm.cmd run evaluate:conversation`; `git diff --check` | 88/88 tests PASS; evaluator 23 PASS, 0 FAIL, 1 NOT VERIFIED; syntax and whitespace checks PASS | Live semantic parity and default packaged-runtime freshness remain `NOT VERIFIED` |

Milestone 144 status: `IMPLEMENTED BUT NOT FULLY VERIFIED`.

## Milestone 145 — package the empty-search recovery revision (2026-08-12)

| Criterion | Status | Exact action | Evidence | Limitation |
|---|---|---|---|---|
| Alternate packaged runtime contains the current source revision | PASS | Ran `npx.cmd electron-builder --dir --config.directories.output=dist-current-144` after commit `37b0ecf` | `dist-current-144/win-unpacked/SOLAT.exe` and `resources/app.asar` were produced at 11:36:16 | This is an alternate output; the default `dist/win-unpacked` remains locked by older running processes |
| Packaging does not claim provider quality | PASS | Package verification was limited to artifact existence/timestamps | Same artifact paths; no paid/provider call was made | Startup and semantic answer quality still require separate runtime evidence |

Milestone 145 status: `IMPLEMENTED BUT NOT FULLY VERIFIED`.

## Milestone 146 — trusted reference allowlist and evidence rationale (2026-08-12)

| Criterion | Status | Exact action | Evidence | Limitation |
|---|---|---|---|---|
| Auto/approved search can use bounded institutional references without opening arbitrary domains | PASS | Added an explicit trusted-reference allowlist for UNESCO, Science Museum Group, Computer History Museum, arXiv, Britannica, and Oxford subdomains; encyclopedic scope remains Wikipedia-only | `src/core/web-search.js`; regression `web search admits only configured trusted reference hosts in auto scope` | Allowlisting a domain is not a factual-truth guarantee; page content still requires relevance and model review |
| Source family and authority metadata identify trusted references | PASS | Trusted reference hosts are labeled `reference` and receive configured authority tiers | `sourceFamilyForHost`, `authorityTierForHost`; 89-test suite | Authority tier is a configured policy signal, not independent fact verification |
| Selection rationale reflects actual matched evidence | PASS | Fixed assessment to compute `selection_basis` from the enriched relevance result instead of an unscored intermediate object | `src/core/web-search.js`; existing ranking/source metadata tests | This improves audit metadata; it does not change the semantic answer by itself |
| Full deterministic verification | PASS | `npm.cmd test`; `npm.cmd run check`; `git diff --check` | 89/89 tests PASS; syntax and whitespace checks PASS | Live semantic parity remains `NOT VERIFIED`; a fresh live capture is required after this revision |

Milestone 146 status: `IMPLEMENTED BUT NOT FULLY VERIFIED`.

## Milestone 147 — current live capture after trusted-reference revision (2026-08-12)

| Criterion | Status | Exact action | Evidence | Limitation |
|---|---|---|---|---|
| Current revision completes the three-way transport path | PASS | One owner-authorized `node scripts/capture-three-way.js --execute --case-ids latest_info_en` with the matched ChatGPT baseline and no retry | `artifacts/three-way-capture/three-way-current-trusted-reference-latest-info-20260812-114300.json`; ChatGPT, raw DeepSeek V4 Flash, and SOLAT all returned visible responses (`capture_counts: 3 PASS`) | This is one latest-info case, not a corpus-wide guarantee |
| Search evidence is visible and allowlisted | PASS | Current SOLAT capture records `web_search_status: ready`, validated Wikipedia evidence, and the configured trusted-reference allowlist | Same capture; `implementation.git_revision: 249ec31f...` | Provider recall varies; one run may return only one approved reference even when more are allowed |
| Semantic comparison remains fail-closed | PASS | Three responses were recorded, but no score was generated without six-dimension evidence-backed review | Same capture: `comparison_counts.NOT VERIFIED: 1`, `manual_review_required: true` | ChatGPT semantic parity is still `NOT VERIFIED` |

Milestone 147 status: `IMPLEMENTED BUT NOT FULLY VERIFIED`.

## Milestone 148 — Thai clarification regression (2026-08-12)

| Criterion | Status | Exact action | Evidence | Limitation |
|---|---|---|---|---|
| A Thai clarification question is routed as ambiguity instead of being answered by an unsupported guess | PASS | Added a regression using a real Unicode Thai phrase (`คุณหมายถึงอะไรในคำถามนี้`) and asserted clarification candidate, ambiguity, and ask-before-guess routing | `test/core.test.js`; `npm.cmd test`: 89/89 PASS | This verifies routing hints, not the quality of the provider's final wording |
| Existing context, comparison, and source-scope behavior remains intact | PASS | Ran full deterministic suite and syntax checks after the regression | `npm.cmd test`, `npm.cmd run check`, `git diff --check` all pass | Live semantic parity remains `NOT VERIFIED` |

Milestone 148 status: `IMPLEMENTED BUT NOT FULLY VERIFIED`.

## Milestone 149 — Thai question and latest-information signals (2026-08-12)

| Criterion | Status | Exact action | Evidence | Limitation |
|---|---|---|---|---|
| Thai factual questions are not mislabeled as bare-name ambiguity | PASS | Added Unicode-aware Thai interrogative terms without relying on ASCII `\\b` boundaries | `src/core/intent-router.js`; regression asserts `ใครคือ Diana King` is not likely ambiguous | Provider wording and entity disambiguation still need live semantic review |
| Thai latest-information requests carry the freshness hint | PASS | Added Unicode-aware latest-information terms for `ราคา`, `วันนี้`, `ตอนนี้`, `ล่าสุด`, and related signals | Regression asserts `ข้อมูลล่าสุดเกี่ยวกับ SOLAT` sets `needs_latest_information: true` | This is a routing hint; it does not prove a provider returned fresh evidence |
| Existing routing and evidence behavior remains stable | PASS | `npm.cmd test`; `npm.cmd run check`; `npm.cmd run evaluate:conversation`; `git diff --check` | 89/89 tests PASS; evaluator 23 PASS, 0 FAIL, 1 NOT VERIFIED | Live semantic parity remains `NOT VERIFIED` |

Milestone 149 status: `IMPLEMENTED BUT NOT FULLY VERIFIED`.

## Milestone 150 — pronoun ambiguity across comparison context (2026-08-12)

| Criterion | Status | Exact action | Evidence | Limitation |
|---|---|---|---|---|
| English pronouns such as `her`, `his`, and `its` are treated as references | PASS | Extended reference detection and added a multi-entity follow-up regression | `src/core/intent-router.js`; `test/core.test.js` asserts `find a source about her` resolves to `ambiguous_context` when Park Dayoung and Han Nari are both present | Pronoun resolution remains advisory and cannot infer gender or identity beyond available context |
| Ambiguous multi-entity follow-ups do not trigger a guessed search query | PASS | Conversation routing now asks for clarification and does not emit a literal `her` search variant | Same regression; full deterministic suite passes | A live provider may still phrase the clarification differently |
| Full deterministic verification | PASS | `npm.cmd test`; `npm.cmd run check`; `npm.cmd run evaluate:conversation`; `git diff --check` | 89/89 tests PASS; evaluator 23 PASS, 0 FAIL, 1 NOT VERIFIED | Live semantic parity remains `NOT VERIFIED` |

Milestone 150 status: `IMPLEMENTED BUT NOT FULLY VERIFIED`.

## Milestone 151 — ambiguous English pronoun follow-up guard (2026-08-12)

| Criterion | Status | Exact action | Evidence | Limitation |
|---|---|---|---|---|
| `her`, `his`, and `its` are resolved as references instead of literal search terms | PASS | Extended the reference vocabulary and aligned the contextual recovery query to the resolved subject | `src/core/intent-router.js`; `test/core.test.js` multi-entity follow-up regression | Pronoun meaning can remain ambiguous when context has multiple candidates |
| Multiple candidates force clarification rather than silent subject selection | PASS | Ambiguous context now remains `ambiguous_context` and suppresses a literal pronoun query | `npm.cmd test`: 89/89 PASS | This is deterministic routing evidence, not a provider-quality score |
| Existing follow-up/source behavior remains stable | PASS | Full syntax, deterministic corpus, and whitespace checks | `npm.cmd run check`; evaluator 23 PASS, 0 FAIL, 1 NOT VERIFIED; `git diff --check` | Live semantic parity remains `NOT VERIFIED` |

Milestone 151 status: `IMPLEMENTED BUT NOT FULLY VERIFIED`.

## Milestone 152 — explicit Gemini/AI Overview source scope (2026-08-12)

| Criterion | Status | Exact action | Evidence | Limitation |
|---|---|---|---|---|
| Gemini/AI Overview can be selected as a distinct approved source scope | PASS | Added `ai_summary` to `SOURCE_SCOPES`, restricted to `gemini.google.com`, and exposed it in the tool schema | `src/core/web-search.js`; tool enum regression passes | Allowlisting Gemini does not guarantee that an AI summary is available or accurate |
| Intent routing preserves an explicit Gemini request | PASS | Added Gemini, AI Overview, and Google AI signals to candidate/requested source scope resolution | `src/core/intent-router.js`; regression asserts `requested_source_scopes: ['ai_summary']` | The model still chooses whether to call the tool under model-first routing |
| Existing source allowlist and failure behavior remain intact | PASS | Full deterministic suite, syntax check, and evaluator run | 89/89 tests PASS; evaluator 23 PASS, 0 FAIL, 1 NOT VERIFIED | Live Gemini retrieval and semantic parity remain `NOT VERIFIED` |

Milestone 152 status: `IMPLEMENTED BUT NOT FULLY VERIFIED`.

## Milestone 153 — Gemini evidence boundary regression (2026-08-12)

| Criterion | Status | Exact action | Evidence | Limitation |
|---|---|---|---|---|
| `ai_summary` rejects non-Gemini sources | PASS | Added a local HTTP boundary test containing both Gemini and Wikipedia results; only Gemini is retained | `test/core.test.js`: `AI summary scope admits only Gemini evidence` | The test uses deterministic provider responses, not a live Gemini request |
| Gemini evidence is labeled consistently | PASS | Verified `source_family: ai_summary` and `authority_level: ai_summary` on the retained result | Same regression; source metadata is preserved for disclosure | Metadata does not prove the AI summary's factual accuracy |
| Full deterministic verification | PASS | `npm.cmd test`; `npm.cmd run check`; `npm.cmd run evaluate:conversation`; `git diff --check` | 90/90 tests PASS; evaluator 23 PASS, 0 FAIL, 1 NOT VERIFIED | Live semantic parity remains `NOT VERIFIED` |

Milestone 153 status: `IMPLEMENTED BUT NOT FULLY VERIFIED`.

## Milestone 154 — AI summary corpus coverage (2026-08-12)

| Criterion | Status | Exact action | Evidence | Limitation |
|---|---|---|---|---|
| The conversation corpus covers an explicit Gemini/AI Overview request | PASS | Added an `ai_summary_scope` case requiring `web_search`, `source_scope: ai_summary`, and `requested_source_scopes: ['ai_summary']` | `evaluations/conversation-search-corpus.json`; `test/core.test.js` corpus assertions | This validates routing metadata, not live Gemini availability |
| Corpus expectations remain internally consistent | PASS | Updated the deterministic corpus count assertion and ran the evaluator | `npm.cmd test`: 90/90 PASS; `npm.cmd run evaluate:conversation`: 24 PASS, 0 FAIL, 1 NOT VERIFIED | The single `live_semantic_parity` case remains intentionally NOT VERIFIED |
| Syntax and whitespace checks remain clean | PASS | Ran `npm.cmd run check` and `git diff --check` | Both commands exit 0 | No paid or live provider call was made in this milestone |

Milestone 154 status: `IMPLEMENTED BUT NOT FULLY VERIFIED`.

## Milestone 155 — AI summary source disclosure label (2026-08-12)

| Criterion | Status | Exact action | Evidence | Limitation |
|---|---|---|---|---|
| The UI identifies Gemini/AI Overview evidence distinctly from generic approved web sources | PASS | Added an `ai_summary` authority label to the compact search status and a renderer regression assertion | `renderer/renderer.js`; `test/ui.test.js` | This labels validated metadata; it does not establish that the AI summary is factually correct |
| Existing source disclosure and UI behavior remain intact | PASS | Ran the full deterministic suite, syntax checks, and whitespace check | `npm.cmd test`: 91/91 PASS; `npm.cmd run check`; `git diff --check` | No live Gemini request or semantic parity claim was made |

Milestone 155 status: `IMPLEMENTED BUT NOT FULLY VERIFIED`.

## Milestone 156 — explicit raw-baseline versus SOLAT capture boundary (2026-08-12)

| Criterion | Status | Exact action | Evidence | Limitation |
|---|---|---|---|---|
| The three-way harness keeps raw DeepSeek and SOLAT captures distinguishable | PASS | Added assertions for the raw-provider and router/provider source traces in the matched-history capture regression | `test/core.test.js`; `src/core/three-way-evaluator.js` | Trace labels prove path separation, not answer quality |
| Matched conversation history is shared without collapsing the two model paths | PASS | Regression asserts the same recorded history reaches both the raw provider and SOLAT session, while the comparison remains fail-closed | `test/core.test.js`; `npm.cmd test`: 91/91 PASS | Live provider responses were not requested in this milestone |
| Deterministic verification remains green | PASS | Ran test, evaluator, syntax, and whitespace checks | evaluator 24 PASS, 0 FAIL, 1 NOT VERIFIED; `npm.cmd run check`; `git diff --check` | Semantic parity still requires an evidence-backed external review |

Milestone 156 status: `IMPLEMENTED BUT NOT FULLY VERIFIED`.

## Milestone 157 — preserve explicit AI-summary scope in conversation metadata (2026-08-12)

| Criterion | Status | Exact action | Evidence | Limitation |
|---|---|---|---|---|
| Explicit Gemini/AI Overview requests retain their required scope through the conversation-core boundary | PASS | Added `ai_summary` to the requested/candidate scope allowlists used when constructing `searchSummary` | `src/core/conversation-core.js`; `test/core.test.js` regression asserts `requested_source_scopes`, `source_scope_priority`, and completed status | This verifies metadata and scope enforcement, not live Gemini retrieval |
| AI-summary priority is visible to downstream UI/evidence consumers | PASS | The summary now preserves `['ai_summary', 'auto']` instead of dropping the explicit priority | Same regression; `renderer/renderer.js` labels `ai_summary` as `AI summary` | Provider tool choice remains model-first and may still decline a tool call |
| Deterministic verification remains green | PASS | Ran test, evaluator, syntax, and whitespace checks | `npm.cmd test`: 91/91 PASS; evaluator 24 PASS, 0 FAIL, 1 NOT VERIFIED; `npm.cmd run check`; `git diff --check` | Semantic parity remains `NOT VERIFIED` |

Milestone 157 status: `IMPLEMENTED BUT NOT FULLY VERIFIED`.

## Milestone 158 — persist comparison evidence context (2026-08-12)

| Criterion | Status | Exact action | Evidence | Limitation |
|---|---|---|---|---|
| Conversation persistence retains comparison entities and which entities have evidence | PASS | Added bounded, redacted `comparison_entities` and `comparison_entities_with_evidence` fields to the persisted search summary | `src/core/conversation-persistence.js`; `test/conversation-persistence.test.js` verifies round-trip behavior | Persisted metadata is an audit/context record, not a claim that the comparison is factually complete |
| Incomplete comparison state remains truthful after reload | PASS | Persisted `comparison_evidence_status` and `source_scope_priority` alongside existing source metadata | Same regression; `npm.cmd test`: 91/91 PASS | A later provider turn must still re-evaluate fresh evidence |
| Safety and deterministic checks remain green | PASS | Ran test, syntax, and whitespace checks | `npm.cmd test`: 91/91 PASS; `npm.cmd run check`; `git diff --check` | Live semantic parity remains `NOT VERIFIED` |

Milestone 158 status: `IMPLEMENTED BUT NOT FULLY VERIFIED`.

## Milestone 159 — structural evidence comparison without semantic overclaim (2026-08-12)

| Criterion | Status | Exact action | Evidence | Limitation |
|---|---|---|---|---|
| Three-way captures expose comparable transport/tool/source facts | PASS | Added versioned pairwise structural observations for response presence, status, tool-round delta, source-count delta, and scope overlap | `src/core/three-way-evaluator.js`; `test/core.test.js` asserts raw DeepSeek versus SOLAT observations | These are structural signals only and cannot measure correctness or quality |
| Semantic scoring remains fail-closed | PASS | Structural output carries `semantic_score: null`; existing rubric still requires evidence for all dimensions | Same regression; comparison status remains `NOT VERIFIED` without review evidence | A human or approved external review is still required for semantic scoring |
| Deterministic checks remain green | PASS | Ran `npm.cmd test`, `npm.cmd run check`, and `git diff --check` | 91/91 tests PASS; syntax and whitespace checks PASS | Live provider parity remains `NOT VERIFIED` |

Milestone 159 status: `IMPLEMENTED BUT NOT FULLY VERIFIED`.

## Milestone 160 — preserve ranked evidence metadata in comparisons (2026-08-12)

| Criterion | Status | Exact action | Evidence | Limitation |
|---|---|---|---|---|
| Three-way evidence observations retain ranking and authority metadata | PASS | Preserved bounded source `score`, `source_family`, `authority_tier`, and `selection_basis` fields in SOLAT captures and structural observations | `src/core/three-way-evaluator.js`; `test/core.test.js` asserts the metadata survives into the grounding observation | Metadata reflects the search adapter's assessment; it is not independent factual verification |
| Evidence comparison remains safe for external baselines | PASS | Kept external ChatGPT source capture separate and only applied metadata preservation to validated SOLAT sources | `safeExternalSources` and `safeSources` paths remain distinct; deterministic tests pass | External source claims still require manual review |
| Deterministic checks remain green | PASS | Ran `npm.cmd test`, `npm.cmd run check`, and `git diff --check` | 91/91 tests PASS; syntax and whitespace checks PASS | Semantic parity remains `NOT VERIFIED` |

Milestone 160 status: `IMPLEMENTED BUT NOT FULLY VERIFIED`.

## Milestone 161 — bounded page-reader tool path (2026-08-12)

| Criterion | Status | Exact action | Evidence | Limitation |
|---|---|---|---|---|
| The model can request a bounded page read after search without bypassing source policy | PASS | Exposed `web_read_page` beside `web_search`; execution reuses the approved-host URL gate, timeout, HTML stripping, and character cap | `src/core/web-search.js`; `src/core/conversation-core.js`; page-reader contract tests | Only URLs returned by the approved search policy should be passed by the model; the reader does not discover arbitrary pages |
| Page text is isolated from search evidence and treated as untrusted | PASS | Page reads are recorded separately (`pageReads`/`pageReadUsed`) and the provider hint explicitly forbids following page instructions | `test/core.test.js`; prompt-boundary text in `conversation-core.js` | The model may still misunderstand page content; semantic quality remains unverified |
| Unsafe/failed page reads remain truthful | PASS | Unsafe URLs fail with `unsafe_url`; provider errors return an unavailable page-read result without claiming search success | `test/core.test.js`; `WebSearchService.execute` | No live external page fetch was made in this milestone |
| Deterministic verification remains green | PASS | Ran `npm.cmd test`, `npm.cmd run check`, and `git diff --check` | 93/93 tests PASS; syntax and whitespace checks PASS | Live semantic parity remains `NOT VERIFIED` |

Milestone 161 status: `IMPLEMENTED BUT NOT FULLY VERIFIED`.

## Milestone 162 — page-read evidence in comparison captures (2026-08-12)

| Criterion | Status | Exact action | Evidence | Limitation |
|---|---|---|---|---|
| Three-way evidence captures record page-reader use without leaking page text | PASS | Added bounded page-read status, URL, truncation, and error-code metadata to SOLAT captures; raw page text is not copied into the comparison artifact | `src/core/three-way-evaluator.js`; structural comparison includes page-read count | This records tool use, not the correctness of the page interpretation |
| Structural comparison includes page-read deltas | PASS | Pairwise observations now compare page-read counts alongside tool rounds and source counts | `test/core.test.js`; `solat.structural-comparison.v1` | Semantic scoring remains separate and unavailable without review evidence |
| Deterministic verification remains green | PASS | Ran `npm.cmd test`, `npm.cmd run check`, and `git diff --check` | 93/93 tests PASS; syntax and whitespace checks PASS | Live semantic parity remains `NOT VERIFIED` |

Milestone 162 status: `IMPLEMENTED BUT NOT FULLY VERIFIED`.

## Milestone 163 — enforce page-reader size cap at runtime (2026-08-12)

| Criterion | Status | Exact action | Evidence | Limitation |
|---|---|---|---|---|
| Runtime page reader clamps malformed `max_chars` input | PASS | Clamped the direct service path to 500–12000 characters, even when a caller bypasses the tool schema | `src/core/web-search.js`; `test/core.test.js` passes `max_chars: 50000` and asserts the returned cap is 12000 | No live page fetch was made |
| Page-reader safety behavior remains intact | PASS | Preserved approved-host validation, timeout handling, HTML stripping, and truthful truncation metadata | `src/core/web-search.js`; `npm.cmd test` 93/93 PASS | External provider/page availability was not exercised |
| Deterministic verification remains green | PASS | Ran tests, syntax checks, and whitespace checks | `npm.cmd test`: 93/93 PASS; `npm.cmd run check`; `git diff --check` | Live semantic parity remains `NOT VERIFIED` |

Milestone 163 status: `IMPLEMENTED BUT NOT FULLY VERIFIED`.

## Milestone 164 — advertise dependent page-reader capability in intent hints (2026-08-12)

| Criterion | Status | Exact action | Evidence | Limitation |
|---|---|---|---|---|
| Router exposes the complete approved web-tool set | PASS | Added `web_read_page` beside `web_search` when web lookup is a candidate; kept the hint advisory rather than making it a hard route | `src/core/intent-router.js`; intent-router regression asserts both tools | The model still decides whether a page read is useful |
| Page-reader dependency remains bounded | PASS | Hint documentation identifies page reading as a follow-up to an approved search URL; runtime URL and size gates remain in `WebSearchService` | `src/core/web-search.js`; Milestone 163 runtime cap and page-reader tests | A hint cannot prove that a provider will choose the tool correctly |
| Deterministic verification remains green | PASS | Ran tests, syntax checks, and whitespace checks | `npm.cmd test`: 93/93 PASS; `npm.cmd run check`; `git diff --check` | Live semantic parity remains `NOT VERIFIED` |

Milestone 164 status: `IMPLEMENTED BUT NOT FULLY VERIFIED`.

## Milestone 165 — constrain auto-scope queries for explicit platforms (2026-08-12)

| Criterion | Status | Exact action | Evidence | Limitation |
|---|---|---|---|---|
| Explicit platform requests improve retrieval recall without broadening hosts | PASS | When `auto` search receives a narrowed approved host set (for example, a Pinterest mention), add a bounded `site:` constraint before provider retrieval; ordinary auto search remains unconstrained | `src/core/web-search.js`; regression asserts `Park Dayoung Pinterest (site:pinterest.com)` and existing auto/allowlist tests remain green | Search provider ranking/recall still depends on the configured index |
| Source safety and evidence filtering remain enforced | PASS | Kept post-retrieval URL allowlist, identity matching, relevance threshold, ranking, and source metadata unchanged | Existing web-search safety/ranking tests pass | No live provider request was made in this milestone |
| Deterministic verification remains green | PASS | Ran tests, syntax checks, and whitespace checks | `npm.cmd test`: 93/93 PASS; `npm.cmd run check`; `git diff --check` | Live semantic parity remains `NOT VERIFIED` |

Milestone 165 status: `IMPLEMENTED BUT NOT FULLY VERIFIED`.

## Milestone 166 — enforce runtime search-result limit (2026-08-12)

| Criterion | Status | Exact action | Evidence | Limitation |
|---|---|---|---|---|
| Malformed/direct search limits cannot exceed the configured bound | PASS | Clamp `search(..., {limit})` to 1–10 before calling any provider and before ranking/slicing results | `src/core/web-search.js`; regression passes `limit: 50000` and asserts no more than 10 results | This is a volume/safety bound, not a guarantee of relevance |
| Provider and source evidence remain truthful | PASS | Preserve existing provider query, allowlist, identity filter, ranking, quality, and degraded/error paths while applying the clamp | Existing search safety and quality tests remain green | No live provider request was made |
| Deterministic verification remains green | PASS | Ran tests, syntax checks, and whitespace checks | `npm.cmd test`: 93/93 PASS; `npm.cmd run check`; `git diff --check` | Live semantic parity remains `NOT VERIFIED` |

Milestone 166 status: `IMPLEMENTED BUT NOT FULLY VERIFIED`.

## Milestone 167 — preserve merged evidence quality metadata (2026-08-12)

| Criterion | Status | Exact action | Evidence | Limitation |
|---|---|---|---|---|
| Multi-scope tool results retain corroboration and authority facts | PASS | `mergeScopedOutcomes` now reports distinct source hosts, corroboration, agreement status, authority level, and the union of matched entities | `src/core/conversation-core.js`; regression covers Wikipedia + YouTube evidence | `not_assessed` means agreement was not independently checked; it is not a factual endorsement |
| Merged evidence remains bounded and truthful | PASS | Existing URL deduplication, error aggregation, source allowlist, and status selection remain unchanged | Same regression plus existing multi-scope conversation tests | Provider output can still be incomplete or wrong; semantic quality remains unverified |
| Deterministic verification remains green | PASS | Ran tests, syntax checks, and whitespace checks | `npm.cmd test`: 94/94 PASS; `npm.cmd run check`; `git diff --check` | Live semantic parity remains `NOT VERIFIED` |

Milestone 167 status: `IMPLEMENTED BUT NOT FULLY VERIFIED`.

## Milestone 168 — require search provenance before page reads (2026-08-12)

| Criterion | Status | Exact action | Evidence | Limitation |
|---|---|---|---|---|
| Page reader only reads a URL discovered by approved search in the same turn | PASS | ConversationCore records canonical URLs from successful search results and rejects undeclared page reads with `page_not_discovered` | `src/core/conversation-core.js`; regression covers both the accepted search→read sequence and direct-read rejection | The search result itself may still be incomplete; this protects provenance, not factual correctness |
| Page-read failure is visible and non-fabricated | PASS | Rejected reads return a bounded unavailable tool result, are recorded in `pageReads`, and never call the page adapter | Same regression asserts error code and zero adapter calls | No live page request was made |
| Deterministic verification remains green | PASS | Ran tests, syntax checks, and whitespace checks | `npm.cmd test`: 95/95 PASS; `npm.cmd run check`; `git diff --check` | Live semantic parity remains `NOT VERIFIED` |

Milestone 168 status: `IMPLEMENTED BUT NOT FULLY VERIFIED`.

## Milestone 169 — truthful mode for undeclared page-tool failure (2026-08-12)

| Criterion | Status | Exact action | Evidence | Limitation |
|---|---|---|---|---|
| UI mode distinguishes a failed page-tool attempt from successful search+model work | PASS | A page-read failure without any search result now returns `model_with_tool_failure`; successful search→read remains `search_and_model` | `src/core/conversation-core.js`; regression asserts the failure mode and successful page-read path | This reports transport/tool state, not answer quality |
| Existing error/source disclosure remains truthful | PASS | The page-read error remains in bounded `pageReads`; no citation or successful search status is fabricated | Same regression and existing source-disclosure tests | Live UI rendering of this new mode remains unverified |
| Deterministic verification remains green | PASS | Ran tests, syntax checks, and whitespace checks | `npm.cmd test`: 95/95 PASS; `npm.cmd run check`; `git diff --check` | Live semantic parity remains `NOT VERIFIED` |

Milestone 169 status: `IMPLEMENTED BUT NOT FULLY VERIFIED`.

## Milestone 170 — expose aggregate source quality in response metadata (2026-08-12)

| Criterion | Status | Exact action | Evidence | Limitation |
|---|---|---|---|---|
| The response-level search summary reports source quality, not only source count | PASS | Added aggregate `source_corroboration`, `source_agreement_status`, and `source_authority_level` derived from validated visible sources | `src/core/conversation-core.js`; exact summary and multi-scope regressions assert single-host and multi-host states | `not_assessed` deliberately does not claim factual agreement |
| Summary remains aligned with visible citations | PASS | Aggregation runs after URL deduplication and before comparison citation withholding, so it cannot count hidden/invalid URLs as visible evidence | Existing comparison/source disclosure tests remain green | UI rendering of the new metadata is not yet a pixel-level verification |
| Deterministic verification remains green | PASS | Ran tests, syntax checks, and whitespace checks | `npm.cmd test`: 95/95 PASS; `npm.cmd run check`; `git diff --check` | Live semantic parity remains `NOT VERIFIED` |

Milestone 170 status: `IMPLEMENTED BUT NOT FULLY VERIFIED`.

## Milestone 171 - keep withheld comparison metadata truthful and visible (2026-08-12)

| Criterion | Status | Exact action | Evidence | Limitation |
|---|---|---|---|---|
| Hidden incomplete comparisons cannot retain positive source-quality claims | PASS | When comparison evidence is incomplete and citations are withheld, reset aggregate corroboration, agreement, and authority fields to `none` | `src/core/conversation-core.js`; regression asserts all three fields after a one-sided comparison | Raw search trace remains available for audit; it is not rendered as citation evidence |
| UI can show aggregate quality when the latest run lacks per-run quality fields | PASS | Renderer falls back to response-level summary fields only when visible source count is positive; withheld results cannot produce a positive label | `renderer/renderer.js`; `test/ui.test.js` static contract | Live pixel-level UI check for this fallback remains `NOT VERIFIED` |
| Deterministic verification remains green | PASS | Ran tests, syntax checks, and whitespace checks | `npm.cmd test`: 95/95 PASS; `npm.cmd run check`; `git diff --check` | Live semantic parity remains `NOT VERIFIED` |

Milestone 171 status: `IMPLEMENTED BUT NOT FULLY VERIFIED`.

## Milestone 172 - selected master visual home (2026-08-12)

| Criterion | Status | Exact action | Evidence | Limitation |
|---|---|---|---|---|
| Empty conversations render from the owner-selected master visual without stretching | PASS | Copied the selected concept image into the renderer and fitted the home stage at its exact 1584:1024 ratio | `renderer/assets/solat-home-master.png`; browser inspection measured ratio `1.546875` at 1280x720 | The owner's subjective visual approval remains required |
| Master-image controls remain functional | PASS | Clicked the Plan a project card; it populated the real composer and enabled SEND. Navigation and three starter hotspots were present and interactive | `renderer/renderer.js`; local browser inspection; `test/ui.test.js` | Provider submission was intentionally not called during visual QA |
| Retired Music lane is absent from the visible UI | PASS | Inspected computed visibility and confirmed no Music panel occupies layout space | `.music-panel { display: none !important; }`; local browser inspection | Legacy internal music integration remains dormant to avoid an unrelated destructive removal |
| Deterministic verification remains green | PASS | Ran syntax checks and the complete test suite | `npm.cmd run check`; `npm.cmd test`: 96/96 PASS | Paid and real-model tests were not run |
| Final visual quality | NOT VERIFIED | Rendered and inspected the desktop home state against the selected master image | Local browser screenshot inspection | `MANUAL REVIEW REQUIRED` by the owner |

Milestone 172 status: `IMPLEMENTED BUT NOT FULLY VERIFIED`.
## Milestone 173 - kinetic home-to-chat interaction and responsive visual QA

- criterion: Cursor-free master home, custom pointer, animated Send transition, angular chat surface, red/cyan Settings theme, and responsive mobile composition
- result: PASS
- exact command/action: `npm.cmd test`; `node --check renderer\renderer.js`; visual QA in local browser at 1280x720 and 390x844 across home, Send transition, chat, and all Settings tabs
- exact input/output: 96/96 tests passed; custom cursor opacity `1`; home animation names `masterReveal, masterPulse`; Send layer class `launch` and stamp opacity `1`; Settings opened with six provider rows; mobile horizontal overflow `0`
- files/evidence: `renderer/index.html`, `renderer/renderer.js`, `renderer/assets/solat-home-master-clean.png`, `test/ui.test.js`
- limitation/blocker: Subjective visual quality remains `MANUAL REVIEW REQUIRED`; local browser preview intentionally reports provider IPC unavailable and no paid-provider request was made

## Milestone 174 - original-character in-place motion and distinct scene transitions (2026-08-12)

| Criterion | Status | Exact action | Evidence | Limitation |
|---|---|---|---|---|
| The owner-selected character remains in its original home position while moving in place | PASS | Split the original raster character into animated body, head, arm, legs, and coat-tail layers; measured the host bounds across two animation frames | Host bounds stayed `[83.125, 0, 1113.75, 720]`; body and coat transforms changed between frames; `renderer/index.html` | Motion quality and Persona-like feeling remain `MANUAL REVIEW REQUIRED` |
| Character appears only on the home screen | PASS | Tied character visibility to `.home-mode` and inspected both home and chat states | Home: `display: block`; chat: `display: none`; local browser inspection | None |
| Home controls align and remain interactive | PASS | Hovered the New Chat image bar and measured its hit region; inspected all visible buttons for non-zero transition/animation behavior | New Chat hit region aligned to the visual bar; no visible button had both zero transition and no animation | Subjective hover strength remains `MANUAL REVIEW REQUIRED` |
| Send and New Chat use distinct transitions | PASS | Captured mid-animation frames from real clicks | Send: red impact field with cyan axis and `SOLAT // ENGAGE`; New Chat: cream paper wipe with red/cyan signal and `NEW // SIGNAL` | No audio or haptic feedback is included |
| Responsive structure keeps controls and character visible | PASS | Inspected the home at 768x900 and measured all four navigation hotspots, three starter cards, Send, and character bounds | All controls retained positive bounds; no button was removed | The selected desktop composition is scaled as a whole on narrow screens |
| Deterministic verification remains green | PASS | Ran full tests, syntax checks, and whitespace validation | `npm.cmd test`: 96/96 PASS; `npm.cmd run check`: PASS; `git diff --check`: PASS | No paid provider or real-model request was made |

Milestone 174 status: `IMPLEMENTED BUT NOT FULLY VERIFIED`.

## Milestone 175 - compact command composer and aligned home interactions (2026-08-12)

| Criterion | Status | Exact action | Evidence | Limitation |
|---|---|---|---|---|
| Chat composer has a clear visual hierarchy and truthful interaction state | PASS | Added a compact `SOLAT INPUT` header, `COMMAND READY` / `INPUT ACTIVE` / `MESSAGE ARMED` / `SOLAT RESPONDING` state text, a visible SEND label, and internal focus treatment without moving the whole panel | `renderer/index.html`; `renderer/renderer.js`; local browser inspection at desktop and 390x844 | Subjective visual quality remains `MANUAL REVIEW REQUIRED` |
| Home text and hotspot interactions remain aligned to the selected image | PASS | Clicked Plan a project, verified the actual input received the suggestion, masked the raster placeholder while text is present, and replaced moving hover geometry with in-place cyan feedback | Local browser screenshots and DOM state; `test/ui.test.js` | Raster-source text still exists in the image and is covered only while the live input has content |
| Character and ambient motion avoid competing displacement | PASS | Reduced body/limb/coat travel, slowed the in-place cycle, reduced global energy-field opacity, and removed idle card translation | `renderer/index.html`; local browser inspection | Motion feeling remains `MANUAL REVIEW REQUIRED` |
| Responsive composer retains its controls without overflow | PASS | Inspected the chat composer at 390x844 after the transition settled | Attach, microphone, input, and send controls remained visible; placeholder was shortened to `Message SOLAT...` | Browser preview has no Electron IPC, so its expected delivery failure is not provider evidence |
| Deterministic verification remains green | PASS | Ran full tests, syntax checks, and whitespace validation | `npm.cmd test`: 97/97 PASS; `npm.cmd run check`: PASS; `git diff --check`: PASS | No paid provider or real-model request was made |

Milestone 175 status: `IMPLEMENTED BUT NOT FULLY VERIFIED`.

## Milestone 176 - natural non-character motion and compact response activity (2026-08-12)

| Criterion | Status | Exact action | Evidence | Limitation |
|---|---|---|---|---|
| Desktop starter hover responds without moving or washing out the card | PASS | Replaced the full-card cyan sweep with pointer-local light, restrained corner signals, and a compact per-card status label; inspected Plan a project in the live page | `renderer/index.html`; `renderer/renderer.js`; local browser screenshot | Subjective motion quality remains `MANUAL REVIEW REQUIRED` |
| Live text remains readable while gaining motion | PASS | Removed the overlapping colored text echo after visual inspection; kept readable raster labels and animated only the separate status label and subtle input text signal | Local browser screenshots before/after correction | Raster card titles themselves cannot be independently animated without replacing the source artwork |
| Home input blends with the authored frame | PASS | Replaced the large rectangular cover with a localized feathered paper mask and vertically realigned live text | Local browser screenshot with the Plan a project prompt populated | The placeholder baked into the raster is masked rather than removed from the source image |
| Pending responses show compact in-bubble activity | PASS | Added `SOLAT // PROCESSING`, a small Thinking bubble, smooth dot activity, scan/breathe treatment, and a 620 ms minimum readable duration | Live retry inspection showed `[data-thinking]` in a separate message row with a 178x52 px bubble | Preview intentionally has no Electron provider bridge, so completion was a truthful local failure and no provider was called |
| Responsive behavior avoids persistent hover artifacts | PASS | Disabled desktop pointer overlays on the portrait card layout while preserving normal card content | `renderer/index.html`; static UI regression | Full subjective mobile review remains `MANUAL REVIEW REQUIRED` |

Milestone 176 status: `IMPLEMENTED BUT NOT FULLY VERIFIED`.

## Milestone 177 - interior-only workspace and responsive QA (2026-08-13)

| Criterion | Status | Exact action | Evidence | Limitation |
|---|---|---|---|---|
| New conversations open directly in the interior workspace | PASS | Reloaded a new conversation and inspected the rendered DOM and desktop screenshot | `renderer/renderer.js`; `renderer/index.html`; interior workspace showed the heading, three working modes, and composer without rendering the legacy master home | Subjective visual quality remains `MANUAL REVIEW REQUIRED` |
| Populated conversations remain readable and truthful | PASS | Opened a stored conversation and verified the user/error message layout; normalized the historical missing-desktop-bridge TypeError into a user-facing message | `renderer/renderer.js`; local browser screenshot; UI regression | A real Electron provider response was not requested |
| Projects, Files, and Settings retain real local behavior | PASS | Created, renamed, and deleted a local project; inspected Settings on desktop and mobile; added transaction-completion and read-back checks to the IndexedDB file library | `renderer/renderer.js`; `renderer/index.html`; `test/ui.test.js` | OS file-picker automation was not available in the final browser pass, so the post-fix file-picker interaction is `NOT VERIFIED` |
| Mobile navigation and settings remain usable | PASS | Tested at 390x844, found and fixed the scrim stacking context, then reopened the sidebar and Settings | Sidebar remained sharp above the blurred content; Settings opened as a readable bottom sheet with all four tabs | Device-specific touch behavior outside this viewport is `NOT VERIFIED` |
| Deterministic verification remains green | PASS | Ran the complete Node test suite | `npm.cmd test`: 98/98 PASS | No paid provider or real-model request was made |

Milestone 177 status: `IMPLEMENTED BUT NOT FULLY VERIFIED`.

## Milestone 178 - continuous interior motion, contrast, and workspace return (2026-08-13)

| Criterion | Status | Exact action | Evidence | Limitation |
|---|---|---|---|---|
| Interior UI has continuous, restrained ambient motion | PASS | Added slow background drift, scan light, header signal breathing, active-thread pulse, composer breathing, headline/card idle motion, and model status pulse | `renderer/index.html`; desktop and 390x844 browser screenshots after reload | Subjective motion taste remains `MANUAL REVIEW REQUIRED` |
| Text hierarchy is clearer without excessive glow | PASS | Added explicit `--inner-ink`, `--inner-muted`, and `--inner-dim` tokens; raised body, starter, thread, and metadata contrast | `renderer/index.html`; desktop/mobile screenshots | Color perception varies by display calibration |
| SOLAT brand returns to the empty workspace | PASS | Converted the brand mark into `#brandHomeBtn` and routed it to `newConversation({ animate: true })`; clicked it from a populated conversation | `renderer/index.html`; `renderer/renderer.js`; browser result returned `region "What are we building?"` | Provider IPC was not needed for this navigation test |
| Motion setting and reduced-motion preference remain truthful | PASS | Disabled all newly added ambient animations when motion is off or reduced motion is requested | `renderer/index.html`; static tests | OS-level preference was not changed during browser QA |
| Deterministic verification remains green | PASS | Ran the complete Node test suite and syntax check | `npm.cmd test`: 98/98 PASS; `npm.cmd run check`: PASS | No paid provider or real-model request was made |

Milestone 178 status: `IMPLEMENTED BUT NOT FULLY VERIFIED`.

## Milestone 179 - right-side Joker artwork in the empty workspace (2026-08-13)

| Criterion | Status | Exact action | Evidence | Limitation |
|---|---|---|---|---|
| User-provided artwork is preserved as a standalone asset | PASS | Copied the supplied JFIF without raster edits into the renderer asset directory and referenced it from the empty workspace | `renderer/assets/ren-amamiya-joker.jfif`; `renderer/renderer.js` | The artwork remains user-provided content; licensing/ownership is outside this code change |
| Artwork fills the right side without competing with the workspace | PASS | Added a masked, low-opacity, screen-blended artwork layer with a subtle cyan glint; narrowed the text/card column so all three starter actions remain visible | `renderer/index.html`; desktop screenshot at 1280x720 | Subjective composition remains `MANUAL REVIEW REQUIRED` |
| Responsive layout remains usable | PASS | Tested the empty workspace at 390x844; hid the decorative art below the narrow breakpoint and verified no horizontal overflow | Browser screenshot; `scrollWidth === clientWidth`; all three starter actions visible | Tablet-specific art placement is `NOT VERIFIED` |
| Deterministic verification remains green | PASS | Ran the complete Node test suite, syntax check, and whitespace check | `npm.cmd test`: 98/98 PASS; `npm.cmd run check`: PASS; `git diff --check`: PASS | No paid provider or real-model request was made |

Milestone 179 status: `IMPLEMENTED BUT NOT FULLY VERIFIED`.

## Milestone 180 - supplied Persona-inspired asset placement and distinct transitions (2026-08-13)

| Criterion | Status | Exact action | Evidence | Limitation |
|---|---|---|---|---|
| Supplied assets are placed by UI responsibility without duplicating the existing Joker | PASS | Added the supplied menu, Projects, Files, Settings, chat-bubble, mask, sparkle, and star-trail assets to their matching navigation/composer/empty-workspace roles; retained the existing Joker asset only in the empty workspace art layer | `renderer/assets/persona-*.jfif`; `renderer/index.html`; `test/ui.test.js` | Asset ownership/licensing remains user-provided and is outside this code change |
| Decorative assets do not introduce blocking rectangles or cover readable content | PASS | Applied restrained sizing, blending, masking, opacity, and inverted treatment for white-background decorative references; inspected the desktop empty workspace and sidebar at runtime | Local browser screenshot at 1280x720 after reload | Subjective visual taste remains `MANUAL REVIEW REQUIRED` |
| Send and New Chat use two distinct supplied transition assets | PASS | Assigned `persona-eyes-send.jfif` to the `launch` transition and `persona-eyes-new-chat.jfif` to the `reset` transition; removed the obsolete home-only guard from Send | `renderer/index.html`; `renderer/renderer.js`; runtime class checks returned `scene-transition launch` and `scene-transition reset` | Preview has no Electron provider bridge, so this verifies transition invocation, not provider completion |
| Responsive layout remains usable after asset placement | PASS | Checked the empty workspace at the default desktop viewport and 390x844; narrow mode hides only decorative empty-workspace art while retaining controls | Browser screenshots; measured `scrollWidth === clientWidth` for the mobile shell | Additional physical devices are `NOT VERIFIED` |
| Deterministic verification remains green | PASS | Ran the complete Node test suite, syntax check, and whitespace validation | `npm.cmd test`: 98/98 PASS; `npm.cmd run check`: PASS; `git diff --check`: PASS | No paid provider or real-model request was made |

Milestone 180 status: `IMPLEMENTED BUT NOT FULLY VERIFIED`.

## Milestone 181 - full-screen transition artwork (2026-08-13)

| Criterion | Status | Exact action | Evidence | Limitation |
|---|---|---|---|---|
| Send transition uses the supplied image as the transition layer itself | PASS | Replaced the generic red slash panel with a full-screen image layer using `persona-eyes-send.jfif`; retained only a restrained scan overlay and the `SOLAT // ENGAGE` stamp | `renderer/index.html`; live browser screenshot during `launch` | Subjective transition style remains `MANUAL REVIEW REQUIRED` |
| New Chat transition uses a distinct supplied image as its own layer | PASS | Replaced the generic paper panel with a full-screen image layer using `persona-eyes-new-chat.jfif`; retained a separate scan treatment and the `NEW // SIGNAL` stamp | `renderer/index.html`; live browser screenshot during `reset` | Subjective transition style remains `MANUAL REVIEW REQUIRED` |
| Other supplied images remain assigned to their functional UI roles | PASS | Kept navigation icons, chat bubble, empty-workspace mask, sparkle, and star trail out of the transition layers | `renderer/index.html`; asset-placement assertions in `test/ui.test.js` | Asset ownership/licensing remains user-provided and is outside this code change |
| Deterministic verification remains green | PASS | Ran the complete Node test suite, syntax check, and whitespace validation; previewed both transitions at runtime | `npm.cmd test`: 98/98 PASS; `npm.cmd run check`: PASS; `git diff --check`: PASS | No paid provider or real-model request was made |

Milestone 181 status: `IMPLEMENTED BUT NOT FULLY VERIFIED`.

## Milestone 182 - visible asset treatment and cover cleanup (2026-08-13)

| Criterion | Status | Exact action | Evidence | Limitation |
|---|---|---|---|---|
| Transition artwork remains visibly readable | PASS | Kept both eye images as full-screen transition layers and increased the visibility of navigation/composer artwork rather than hiding it as a faint texture | `renderer/index.html`; desktop transition screenshots | Subjective visual intensity remains `MANUAL REVIEW REQUIRED` |
| Star trail is removed from the cover workspace | PASS | Removed the `persona-star-trail.jfif` cover pseudo-layer and added a regression assertion preventing it from returning to the empty workspace | `renderer/index.html`; `test/ui.test.js`; desktop empty-workspace screenshot | The supplied source asset remains in the asset folder but is no longer rendered |
| Remaining artwork stays assigned to an intentional role | PASS | Kept sparkle on the empty-workspace edge, mask on the readiness signal, chat bubble in the composer, and supplied icons in navigation | `renderer/index.html`; browser inspection | Fine-tuning subjective composition remains `MANUAL REVIEW REQUIRED` |
| Deterministic verification remains green | PASS | Ran the complete Node test suite, syntax check, and whitespace validation | `npm.cmd test`: 98/98 PASS; `npm.cmd run check`: PASS; `git diff --check`: PASS | No paid provider or real-model request was made |

Milestone 182 status: `IMPLEMENTED BUT NOT FULLY VERIFIED`.

## Milestone 183 - clear transition imagery and new supplied cover assets (2026-08-13)

| Criterion | Status | Exact action | Evidence | Limitation |
|---|---|---|---|---|
| Transition images are visible without a text block covering them | PASS | Removed the visual transition labels and kept the supplied eye images as the dominant transition layers | `renderer/index.html`; live Send/New Chat screenshots | Screen-reader transition labels remain in the DOM only as non-visual state text |
| White outer frame is removed from the transition presentation | PASS | Cropped the source image layers with angled `clip-path` windows so the white outer frame no longer fills the viewport while the eye artwork remains visible | `renderer/index.html`; live transition screenshots | White brush details intentionally retained inside the supplied artwork for its graphic style |
| New target asset has a useful functional placement | PASS | Added `persona-plan-target.jfif` as the visible Plan starter art | `renderer/renderer.js`; `renderer/index.html`; `test/ui.test.js` |
| New rose asset is visible as foreground cover art | PASS | Added `persona-project-roses.jfif` as a frontmost, animated empty-workspace figure while keeping it out of narrow mobile layouts | `renderer/renderer.js`; `renderer/index.html`; desktop browser screenshot | Subjective composition remains `MANUAL REVIEW REQUIRED` |
| Deterministic verification remains green | PASS | Ran the complete Node test suite, syntax check, and whitespace validation after the crop and asset additions | `npm.cmd test`: 98/98 PASS; `npm.cmd run check`: PASS; `git diff --check`: PASS | No paid provider or real-model request was made |

Milestone 183 status: `IMPLEMENTED BUT NOT FULLY VERIFIED`.

## Milestone 184 - classic transitions and blended foreground roses (2026-08-13)

| Criterion | Status | Exact action | Evidence | Limitation |
|---|---|---|---|---|
| Send returns to the classic SOLAT transition treatment | PASS | Restored the red slash, cyan impact bar, paper cut shape, and `SOLAT // ENGAGE` stamp; removed the full-screen eye-image layer | `renderer/index.html`; live browser screenshot during `launch` | Subjective transition taste remains `MANUAL REVIEW REQUIRED` |
| New Chat returns to the classic reset treatment | PASS | Restored the paper sweep, red/cyan cut line, and `NEW // SIGNAL` stamp; removed the full-screen eye-image layer | `renderer/index.html`; live browser screenshot during `reset` | Subjective transition taste remains `MANUAL REVIEW REQUIRED` |
| Foreground roses blend into the cover composition | PASS | Reduced the rose layer opacity and replaced its rectangular fade with a radial mask matching the existing Joker artwork treatment | `renderer/index.html`; desktop empty-workspace screenshot | Subjective composition remains `MANUAL REVIEW REQUIRED` |
| Deterministic verification remains green | PASS | Ran the complete Node test suite, syntax check, and whitespace validation after restoring the classic transition layers | `npm.cmd test`: 98/98 PASS; `npm.cmd run check`: PASS; `git diff --check`: PASS | No paid provider or real-model request was made |

Milestone 184 status: `IMPLEMENTED BUT NOT FULLY VERIFIED`.

## Milestone 185 - Research card art and layered foreground flowers (2026-08-13)

| Criterion | Status | Exact action | Evidence | Limitation |
|---|---|---|---|---|
| Supplied playing-card art belongs to Research | PASS | Added `persona-research-card.jfif` to the Research starter action and kept the target art on Plan | `renderer/renderer.js`; live DOM mapping; `test/ui.test.js` |
| Supplied star wallpaper supports the Research action | PASS | Added `persona-research-star.jfif` as a restrained animated accent on the Research card | `renderer/index.html`; `test/ui.test.js` | Subjective decoration remains `MANUAL REVIEW REQUIRED` |
| Flowers visibly layer over the cover composition | PASS | Raised the rose figure above the Joker/background layers and positioned it as a masked foreground overlay instead of a faded background texture | `renderer/index.html`; `renderer/renderer.js`; live DOM and browser inspection | Subjective composition remains `MANUAL REVIEW REQUIRED` |
| Deterministic verification remains green | PASS | Ran the complete Node test suite, syntax check, and whitespace validation | `npm.cmd test`: 98/98 PASS; `npm.cmd run check`: PASS; `git diff --check`: PASS | No paid provider or real-model request was made |

Milestone 185 status: `IMPLEMENTED BUT NOT FULLY VERIFIED`.

## Milestone 186 - reference-style flower layering, Create star art, and scrollable interior (2026-08-13)

| Criterion | Status | Exact action | Evidence | Limitation |
|---|---|---|---|---|
| Flowers sit at the upper-left behind the workspace content | PASS | Moved the rose figure to the upper-left of the empty workspace, restored it to the same background layer as the Joker, and kept the cards/content above it | `renderer/index.html`; `renderer/renderer.js`; desktop browser screenshot against the supplied reference | Subjective composition remains `MANUAL REVIEW REQUIRED` |
| Research and Create use the requested supplied images | PASS | Kept the playing card on Research and moved the star image to Create, with the star accent limited to the Create card | `renderer/renderer.js`; `renderer/index.html`; live DOM mapping |
| Interior workspace scrolling is explicit and functional | PASS | Set the interior `#log` to vertical auto scrolling with touch pan support and verified its scroll container/runtime metrics | `renderer/index.html`; `test/ui.test.js`; browser runtime showed `overflow: auto` and a scrollable log when content exceeds the viewport | Empty state fits within the tested desktop viewport, so its scroll range is minimal until more content is present |
| Deterministic verification remains green | PASS | Ran the complete Node test suite, syntax check, and whitespace validation | `npm.cmd test`: 98/98 PASS; `npm.cmd run check`: PASS; `git diff --check`: PASS | No paid provider or real-model request was made |

Milestone 186 status: `IMPLEMENTED BUT NOT FULLY VERIFIED`.

## Milestone 187 - lower-left flower placement and single transparent Create art (2026-08-13)

| Criterion | Status | Exact action | Evidence | Limitation |
|---|---|---|---|---|
| Flowers occupy the lower-left cover position | PASS | Moved the flower overlay from the upper-left to the lower-left while keeping it behind the workspace content and at the background-art layer | `renderer/index.html`; desktop browser inspection | Subjective composition remains `MANUAL REVIEW REQUIRED` |
| Create has no duplicate decoration | PASS | Removed the extra Create `::after` decoration and retained one visible Create image | `renderer/index.html`; `test/ui.test.js`; DOM assertion | Subjective scale remains `MANUAL REVIEW REQUIRED` |
| Create art has no white rectangular background | PASS | Added a transparent-background PNG derived from the supplied star art and assigned it as the Create image | `renderer/renderer.js`; `renderer/assets/persona-research-star-transparent.png`; image inspection | Transparency edge quality remains `MANUAL REVIEW REQUIRED` |
| Deterministic verification remains green | PASS | Ran the complete Node test suite, syntax check, and whitespace validation | `npm.cmd test`: 98/98 PASS; `npm.cmd run check`: PASS; `git diff --check`: PASS | No paid provider or real-model request was made |

Milestone 187 status: `IMPLEMENTED BUT NOT FULLY VERIFIED`.

## Milestone 188 - pixel-checked Create transparency and visual recheck (2026-08-13)

| Criterion | Status | Exact action | Evidence | Limitation |
|---|---|---|---|---|
| Create outer white background is removed | PASS | Rebuilt the supplied star art as 32-bit ARGB and flood-filled only near-white pixels connected to the image border, preserving enclosed white star details | `renderer/assets/persona-research-star-transparent.png`; corner alpha check reported `0`; live browser screenshot | Anti-aliased edge quality remains `MANUAL REVIEW REQUIRED` |
| Flower placement is visually confirmed | PASS | Reopened the live local UI and verified the flower bounds are in the lower-left (`left=275`, `bottom=605`, viewport height `720`) | Live browser DOM metrics and screenshot | Exact visual preference remains `MANUAL REVIEW REQUIRED` |
| Create remains a single artwork layer | PASS | Confirmed `::after` content is `none` and the card uses `persona-research-star-transparent.png` | Live browser DOM metrics; `renderer/index.html`; `renderer/renderer.js` |
| Deterministic verification remains green | PASS | Ran the complete Node test suite, syntax check, and whitespace validation | `npm.cmd test`: 98/98 PASS; `npm.cmd run check`: PASS; `git diff --check`: PASS | No paid provider or real-model request was made |

Milestone 188 status: `IMPLEMENTED BUT NOT FULLY VERIFIED`.

## Milestone 189 - shaped flower shadow and protected art layering (2026-08-13)

| Criterion | Status | Exact action | Evidence | Limitation |
|---|---|---|---|---|
| Flower shadow follows the artwork instead of a rectangle | PASS | Converted the flower artwork to transparent PNG and applied a restrained red/black drop shadow to the image shape | `renderer/assets/persona-project-roses-transparent.png`; live browser screenshot | Subjective shadow intensity remains `MANUAL REVIEW REQUIRED` |
| Character remains above the flower layer | PASS | Raised `.inner-art` to z-index 1 while keeping the flower layer at z-index 0; starter cards remain z-index 2 | `renderer/index.html`; live DOM z-index inspection | Responsive layouts remain `MANUAL REVIEW REQUIRED` |
| Flower stays in the lower-left corner without covering Plan | PASS | Kept the full 735:415 artwork at the workspace lower-left (`left=0`, `bottom=525` in the tested viewport); Plan ends at `bottom=362` | Live browser DOM metrics and screenshot | Exact preferred scale remains `MANUAL REVIEW REQUIRED` |
| Deterministic verification remains green | PASS | Ran the complete Node test suite, syntax check, and whitespace validation | `npm.cmd test`: 98/98 PASS; `npm.cmd run check`: PASS; `git diff --check`: PASS | No paid provider or real-model request was made |

Milestone 189 status: `IMPLEMENTED BUT NOT FULLY VERIFIED`.

## Milestone 190 - reference-matched starter card opacity (2026-08-13)

| Criterion | Status | Exact action | Evidence | Limitation |
|---|---|---|---|---|
| Plan, Research, and Create share the reference card opacity | PASS | Replaced the darker per-card fill with one shared paper-tint background `rgba(255,245,223,.035)` and explicit `opacity: 1` for all three cards | `renderer/index.html`; live browser computed styles reported the same background and opacity for all three cards; screenshot comparison | Subjective visual match remains `MANUAL REVIEW REQUIRED` |
| Card text and artwork remain fully readable | PASS | Kept card contents at full opacity while changing only the card surface fill | Live browser screenshot; DOM computed styles |
| Regression check prevents opacity drift | PASS | Added a UI assertion requiring the shared starter-card opacity rule | `test/ui.test.js` |
| Deterministic verification remains green | PASS | Ran the complete Node test suite, syntax check, and whitespace validation | `npm.cmd test`: 98/98 PASS; `npm.cmd run check`: PASS; `git diff --check`: PASS | No paid provider or real-model request was made |

Milestone 190 status: `IMPLEMENTED BUT NOT FULLY VERIFIED`.

## Milestone 191 - shaped lower flower edge (2026-08-13)

| Criterion | Status | Exact action | Evidence | Limitation |
|---|---|---|---|---|
| Lower flower corners no longer read as a rectangle | PASS | Added an angled collage-style `clip-path` to the lower-right edge while keeping the left edge flush with the workspace corner | `renderer/index.html`; live browser screenshot; computed clip path | Subjective edge shape remains `MANUAL REVIEW REQUIRED` |
| Flower remains at the lower-left and does not cover Plan | PASS | Preserved the lower-left placement and z-index below the starter cards | Live browser DOM metrics and screenshot |
| Regression check protects the shaped edge | PASS | Added a UI assertion requiring the flower `clip-path` | `test/ui.test.js` |
| Deterministic verification remains green | PASS | Ran the complete Node test suite, syntax check, and whitespace validation | `npm.cmd test`: 98/98 PASS; `npm.cmd run check`: PASS; `git diff --check`: PASS | No paid provider or real-model request was made |

Milestone 191 status: `IMPLEMENTED BUT NOT FULLY VERIFIED`.

## Milestone 192 - remove flower artwork from the interior workspace (2026-08-13)

| Criterion | Status | Exact action | Evidence | Limitation |
|---|---|---|---|---|
| Flower artwork is no longer rendered | PASS | Removed the `inner-front-art` figure from the empty workspace renderer | `renderer/renderer.js`; live UI inspection |
| Flower-specific styling is removed | PASS | Removed the flower layer, clip path, animation, and mobile override CSS | `renderer/index.html`; `test/ui.test.js` |
| Original assets remain preserved | PASS | Left the supplied/source flower files on disk but removed all production rendering references | `renderer/assets/`; `rg` reference check |
| Deterministic verification remains green | PASS | Ran the complete Node test suite, syntax check, and whitespace validation | `npm.cmd test`: 98/98 PASS; `npm.cmd run check`: PASS; `git diff --check`: PASS | No paid provider or real-model request was made |

Milestone 192 status: `IMPLEMENTED BUT NOT FULLY VERIFIED`.

## Milestone 193 - Desktop package and end-to-end UI smoke (2026-08-13)

| Criterion | Status | Exact action | Evidence | Limitation |
|---|---|---|---|---|
| Desktop app uses the V2 renderer and secure IPC boundary | PASS | Built with `npm.cmd run build` and launched `dist/win-unpacked/SOLAT.exe` | Window title `SOLAT — AI Operating System`; `contextIsolation=true`, `nodeIntegration=false`, `sandbox=true` remain in `src/main.js` | Packaged provider status depends on the local `.env` beside the executable |
| Desktop conversation works through the real app boundary | PASS | Used Computer Use to enter `hi` and press Enter in the packaged app | User message rendered, thinking state appeared, assistant response completed, and status returned `READY` | This is a local smoke test; no semantic parity claim is made |
| Desktop regression and package build | PASS | `npm.cmd test`; `npm.cmd run check`; `npm.cmd run build` | `98/98` tests passed, syntax check passed, Windows `dist/win-unpacked/SOLAT.exe` produced | No installer signing or paid-provider evaluation was performed |

Milestone 193 status: `IMPLEMENTED BUT NOT FULLY VERIFIED`.
