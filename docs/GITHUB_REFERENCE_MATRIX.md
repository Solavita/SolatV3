# GitHub reference matrix — Model Foundation

อัปเดต 2026-08-14. รายการนี้เป็น research/reference ไม่ใช่การเพิ่ม dependency โดยอัตโนมัติ

| Repository | Owner | License | Scope / source ที่ตรวจ | Runtime/dependency fit | Security/maintenance | Decision/status |
|---|---|---|---|---|---|---|
| https://github.com/openai/openai-agents-python | openai | MIT | `src/agents/run_context.py`: context wrapper แยก dependency/tool lifecycle จากข้อความที่ส่งให้โมเดล; README ระบุ sessions, tools, guardrails และ Python 3.10+ | ไม่ตรงกับ SOLAT ที่เป็น Node/Electron; นำแนวคิดแยก context state กับ provider input มาใช้ได้โดยไม่เพิ่ม Python runtime | Public, active, มี tests/CI; ต้องตรวจ approval/tool identity อย่างเข้มงวดก่อนนำแนวคิดไปใช้ | **REVIEWED → SANDBOX TESTED (concept only)**; ไม่ copy code/dependency |
| https://github.com/deepset-ai/fastapi-openai-compat | deepset-ai | Apache-2.0 | `src/fastapi_openai_compat`: request envelope, tool calling, streaming และ callback boundary; README/source ระบุ domain validation อยู่ที่ callback | เป็น Python/FastAPI จึงไม่เหมาะเป็น dependency ใน Electron; หลักการ adapter boundary ตรงกับ `src/core/provider.js` | Public, 31 commits, tests/CI; transport layer intentionally passes inner items through จึงต้องเพิ่ม validation ใน SOLAT เอง | **REVIEWED**; reference only, ไม่ integrate |
| https://github.com/harness/harness-evals | harness | Apache-2.0 | README/source contract: Golden → EvalCase → Score, structured-output/schema metrics, failure-returning evaluation และ CI exit codes | Python package และ optional paid/LLM extras ไม่ตรง local Node harness; schema/test artifact pattern นำมาปรับได้ | Public, license ชัด; optional integrations เพิ่ม network/secret risk จึงไม่ติดตั้ง | **REVIEWED**; adapted as local JSON benchmark shape only |
| https://github.com/responsibleai/ASSERT | responsibleai | MIT | README: requirement-driven scenarios, local-first artifacts, trace-aware assertions และ optional LLM judge | Python/OTel integrations ไม่ตรง SOLAT; scenario/evidence separation ใช้เป็น reference | Public Microsoft project, license/third-party notices ต้องคงตาม repo; external judge ไม่ใช้ใน local checkpoint | **REVIEWED**; reference only |
| https://github.com/EleutherAI/lm-evaluation-harness | EleutherAI | Apache-2.0 (repository license) | model wrapper interface, reproducible task/evaluator separation และ test expectations ใน `lm_eval` | Python-heavy, broad benchmark dependency ไม่เหมาะฝังใน desktop app; ใช้หลักฐานแยก adapter/evaluator | Mature/public, แต่ dependency footprint สูงและ benchmark semantics ไม่ตรง conversation routing | **REVIEWED → REJECTED for dependency**; no code copied |
| https://github.com/nemori-ai/nemori | nemori-ai | MIT (README) | episodic-memory concept and queryable memory fabric | Python 3.10+ and external model assumptions; ไม่ตรงกับ session-isolated local SOLAT foundation | Public but small/MVP and memory persistence risk; ไม่ใช้เป็น production memory | **REVIEWED → REJECTED for integration**; concept only |
| https://github.com/antoinezambelli/forge | antoinezambelli | License not confirmed sufficiently | README แนวคิด guardrails/tool loops/context compaction; source/license ไม่ยืนยันครบ | ไม่ควรนำเข้าจนกว่าจะยืนยัน license/dependency | **REJECTED**; ไม่ copy ไม่ติดตั้ง |

## Sandbox/adaptation decision

ไม่มี repository ใดถูก copy เข้า production และไม่มี dependency ใหม่ถูกติดตั้งในรอบนี้

แนวคิดที่นำมาปรับใน SOLAT คือ:

1. context object/state ต้องแยกจากข้อความต้นฉบับ และข้อความผู้ใช้ต้องถูกส่งครบ
2. tool call identity/arguments ต้องถูกตรวจและ failure ต้องไม่กลายเป็น success
3. evaluation artifact ต้องแยก expected behavior, actual evidence และ `NOT VERIFIED`
4. benchmark ต้องทำงาน local/free และไม่สร้าง semantic score เทียบ GPT เอง

การปรับที่มีหลักฐานในรอบนี้อยู่ใน `src/core/intent-router.js` และ regression ใน
`test/core.test.js`; เป็น implementation ของ SOLAT เอง ไม่ใช่การนำโค้ดจาก repository ภายนอกมาแปะ

## License/security boundary

- MIT/Apache-2.0 ถูกพิจารณาได้ในเชิง license แต่ยังไม่ได้นำ code มาเป็น dependency
- ห้ามนำ `.env`, credential, trace ภายนอก หรือข้อมูลส่วนตัวเข้า benchmark
- paid provider และ external judge ถูกปิดไว้ในรอบ local/free นี้

## 2026-08-15 research addendum

| Repository | License | Reviewed scope | Compatibility / decision |
|---|---|---|---|
| https://github.com/responsibleai/ASSERT | MIT | Local-first, trace-grounded evaluation artifacts and requirement assertions | REVIEWED; reference only. Python/OTel dependency is not added to the Node/Electron runtime. |
| https://github.com/harness/harness-evals | Apache-2.0 | Structural/schema, tool-correctness, reliability and rubric evaluation concepts | REVIEWED; adapted conceptually into existing JSON reports; no dependency or paid evaluator added. |
| https://github.com/ajv-validator/ajv | MIT | JSON Schema validation | REVIEWED; not added because SOLAT already has a bounded dependency-free validator and changing it would add unnecessary runtime surface. |
| https://github.com/modelcontextprotocol/typescript-sdk | Apache-2.0 / MIT legacy code | MCP tool/resource protocol | REVIEWED; not integrated because current adapter boundary is sufficient and adding MCP would expand scope without a tested provider. |

No external repository code or dependency was copied into production in this iteration.

## Qwen3.7 model migration reuse ledger (2026-08-23)

| Item | Owner / license | Mode | Decision and actual use |
|---|---|---|---|
| Existing SOLAT provider, ModelRouter, Agent, Computer Use and tool-validation boundaries | SOLAT owner code | ADAPT | Migrated in place to `qwen_flash_plus.v1`; Flash remains the only final/structured/tool executor and Plus is bounded advisory-only. No parallel architecture was added. |
| Alibaba Model Studio OpenAI-compatible text endpoint | Alibaba Cloud service/API | CONFIGURE | Existing dependency-free OpenAI-compatible adapter was configured for `qwen3.7-flash` and `qwen3.7-plus`; no third-party GitHub code or runtime dependency was added. |
| Existing `qwencloud_vision` / Qwen3-VL-Flash boundary | SOLAT owner code plus Alibaba service/API | PRESERVE | Remains separate from text roles and retains bounded validated PNG/structured-output handling. |
| DeepSeek, RunPod and local/Ollama text routes | Historical SOLAT implementation | DECOMMISSION | Removed from active config, startup, composition and routing. Historical evidence remains audit-only; legacy mode values cannot re-enable those providers. |
| Immutable Voice V1 package | SOLAT owner artifact | ROLLBACK | Preserved unchanged: EXE SHA-256 `767BB75439291345F346CF9411AA94CD9406845985D1CD082EF494271C9832DA`; ASAR SHA-256 `5D680C99A6B58A82CAE87E5AC588CC3D6497B62B4F0F5BEA9A7A6E35C2A91879`. |

No external repository code was copied and no GitHub dependency was added for this
migration. Accepted live routing evidence is
`reports/model-routing-qwen37-20260823-v4.json` (SHA-256
`E15FECB41E8D44D7079F3C4DB8EFE1DEC0A8DEE51CB5838236F3E813699B67F2`). The v3 FAIL
artifact (SHA-256
`37590608A8E4C285CD8B1185BA86F98E933ECC6FBBC3AC2AEEA661BAFB26D120`) is diagnostic
only. The model-only `dist-verified-20260823-qwen37-model-v2` checkpoint remains
immutable. Goal 2 combines the same SOLAT-owned model, renderer, IPC and Voice code in
`dist-verified-20260823-qwen37-voice-combined-v1` without adding a GitHub dependency or
copying an external implementation. The combined ASAR passes 44/44 non-asset runtime,
15/15 key-file and 2/2 Voice MP4 parity plus privacy/active-legacy scans. Existing owner
Voice/UI material and immutable Voice V1/model-v2 hashes are preserved. Packaged live
provider/model/tool execution, network-zero evidence and broad semantic quality remain
NOT VERIFIED.

## Voice V1 reuse ledger (2026-08-23)

| Item | Owner / license | Mode | Decision and actual use |
|---|---|---|---|
| Existing SOLAT voice scene, mic/status controls, Composer, Chat, conversation state, AgentUI and secure IPC patterns | SOLAT owner code | ADAPT | Preserved the current owner UI/assets and adapted the existing typed-message brain path to accept one final speech transcript. |
| `cartesia-ai/cartesia-js` v4.0.1 | Cartesia / Apache-2.0 | ADAPT | Added as the only new runtime dependency. SOLAT adapters wrap official Ink 2 auto-finalize websocket STT and Sonic TTS behind local ports; no SDK object or credential crosses into the renderer. |
| Cartesia JavaScript SDK README/source and official STT/TTS/WebSocket examples | Cartesia / public documentation | REFERENCE | Used to confirm PCM formats, `turn.update` versus `turn.end`, close/cancel behavior and WAV output. No example application was copied wholesale. |
| `src/core/voice-service.js` and `renderer/voice-controller.js` | SOLAT original implementation | NEW | Provider boundary, session ownership integration, state machine, final-only dispatch, playback, barge-in and disposal were implemented for this repository. |
| Other SOLAT V2–V5 folders/repositories | SOLAT owner code | REFERENCE | Not used in V1 and deferred without importing code because the authoritative working system is `D:\SOLAT_V3` and the V1 prompt forbids parallel architecture and later-version work. |

No secret, credential, raw audio or unbounded provider response was added to source,
tests or documentation. The bounded synthetic verification transcript, sanitized
provider events and transport metrics are intentionally recorded in the verification
documents and `reports/voice-live-v1-20260823-v5.json`.

The packaged silent evidence in `reports/voice-packaged-silent-v1-20260823.json` uses
the same SOLAT-native controller and official Cartesia 4.0.1 adapter; it adds no GitHub
dependency or copied implementation. CDP was enabled only by ephemeral launch flags
bound to `127.0.0.1:9223`; neither production source nor the verified ASAR contains a
CDP flag, and the process, port and isolated profile were removed after the probe. The
report records bounded frame/IPC/state metrics, not raw microphone audio or credentials.

The integrated packaged evidence in `reports/voice-packaged-e2e-v1-20260823.json`
likewise adds no external code or dependency: the final package uses the existing
SOLAT-native controller/Chat path and Cartesia 4.0.1 adapter. CDP port 9224 was a
localhost test-launch facility only. The artifact persists neither raw PCM, device
label/group id, API key nor assistant text; it records the 352-character source length,
347-character rendered DOM length and source SHA-256 only. The TTS request matched the
assistant source length/hash—not the DOM—exactly. Report SHA-256 is
`8A7853999BF330267D2052E8DA7193F852DACA17206C3104D05F3C0520E973AC`.
Its PASS is bounded to one synthetic-input, silent-output turn; the seed was only
partially transcribed, so it does not establish exact STT accuracy, physical human
input, audible playback or acoustic echo behavior.

## 2026-08-15 Agent V3.1 research

| Repository | License/version | Reviewed source/fit | Decision |
|---|---|---|---|
| https://github.com/microsoft/winappCli | MIT / v0.6.0 | Windows UI Automation list/inspect/invoke/set-value/wait-for JSON CLI; Electron-compatible, semantic selectors, active Microsoft project | **INTEGRATED AS PINNED EXTERNAL ADAPTER**. Installed through Winget with published SHA-256 verification; SOLAT exposes only four bounded tools through `spawn(shell:false)`, adds sensitive-window/password denial, limits and approval, and uses `wait-for` to verify the requested post-action state instead of trusting exit code alone. |
| https://github.com/sbroenne/mcp-windows | MIT / reviewed 2026-08-15 | Dedicated STA UIA worker, semantic element references, schema-derived tools and post-mutation refresh | **REVIEWED / ADAPTED CONCEPTS ONLY**; .NET 10 sidecar and broad surface were not imported. |
| https://github.com/openai/openai-agents-js | MIT / reviewed 2026-08-15 | Canonical tool identity, argument validation, approval state, bounded cancellation and resumable run-state patterns | **REVIEWED / ADAPTED CONCEPTS ONLY** into existing AgentService; dependency rejected to preserve DeepSeek/model-agnostic architecture. |
| https://github.com/npm/write-file-atomic | ISC / v8.0.0 | temp-write, fsync, rename and cleanup algorithm | **REVIEWED / ADAPTED ALGORITHM ONLY**; dependency rejected because current engine constraints may not match Electron and SOLAT needs stronger path/hash/ownership rules. |
| https://github.com/modelcontextprotocol/typescript-sdk | Apache-2.0/MIT | Tool schema/cancellation boundary; reviewed advisory affecting shared transports before v1.26.0 | **REVIEWED / NOT INTEGRATED**; no arbitrary MCP discovery is exposed. |
| https://github.com/BAAI-Agents/Cradle | MIT / reviewed 2026-08-22 | Unified environment runner, atomic/composite skill registry, provider separation, and migration-specific app boundaries | **REVIEWED / ADAPTED CONCEPTS ONLY**. SOLAT's existing bounded tool registry, workflow hints, and provider adapters implement the compatible separation without importing Cradle's Python/game stack or screenshot-every-step loop. No code copied. |
| https://github.com/showlab/WorldGUI | License not present in the reviewed repository / reviewed 2026-08-22 | Planner-Critic, pre-execution Step-Check, and post-action Actor-Critic; screenshot/OCR/PyAutoGUI action pipeline | **REVIEWED / CONCEPT ONLY, CODE REJECTED**. SOLAT keeps strict step-schema validation and verified postconditions, but does not copy or depend on WorldGUI because its license was not confirmed and raw coordinate execution conflicts with SOLAT's exact-HWND/UIA safety boundary. |

No repository was copied wholesale. `src/core/filesystem-workspace.js` and the approval/tool composition are SOLAT-native implementations.

## 2026-08-15 implementation boundary

The current local changes use existing SOLAT contracts and do not add a GitHub dependency. File-intake, derived persistence, agent approval boundaries and evaluation manifest work are SOLAT-native adaptations; external repositories remain reference-only with license review recorded above. No secret, provider credential or external repository code was copied.

## V2 spatial interaction reference audit (2026-08-23)

| Repository | Owner / license | Reviewed scope | Decision and actual use |
|---|---|---|---|
| https://github.com/msllrs/relay | `msllrs` / PolyForm Shield | Transparent/live overlay interaction patterns and annotation workflow | **REFERENCE ONLY**. PolyForm Shield restrictions were not adopted as production code; no source or dependency copied. |
| https://github.com/Tamara-Codes/PromptShot | `Tamara-Codes` / MIT | Transparent/fullscreen overlay and immediate screenshot/annotation interaction ideas | **REFERENCE / ADAPT CONCEPTS ONLY**. SOLAT reuses the behavioral idea through its own secure Electron overlay; no code copied. |
| https://github.com/kaisinishe/ai_screen_assistant | `kaisinishe` / no license found in reviewed repository | Screen assistant and spatial grounding concepts | **REFERENCE ONLY**. No code or dependency used because a license was not confirmed. |
| https://github.com/konvajs/konva | `Anton Lavrenov` / MIT | Pointer/layer/shape organization for canvas interactions | **REFERENCE ONLY; NO DEPENDENCY**. SOLAT uses its own bounded canvas and does not add Konva to the runtime. |

The V2 implementation is SOLAT-native: `SpatialEvent`, `InteractionMemory`,
owner-bound secure IPC, display lifecycle, timestamp alignment, and the overlay
renderer were written in the existing Electron architecture. No repository code,
asset, secret, provider call, or runtime dependency from this audit was added.
The reference decisions are limited to behavior/architecture ideas and do not
establish license permission to copy code.

## V2 spatial final package provenance (2026-08-23)

The package is a SOLAT-native build, not copied from any audited repository:

- Output: `D:\SOLAT_V3\dist-verified-20260823-v2-spatial-v1`
- Direct `electron-builder` build; local `.env` was not copied.
- EXE SHA-256: `30F8C64508C6D016E24C07F47285205BDA395794C870457943069C3BC213DF43`
- ASAR SHA-256: `419EBA2872D8E4224AA72FA5E7A75CBD628AB6239E82605BA2B0962B7A9229F5`
- Parity: 17/17 spatial/model/voice/security plus overlay HTML/JS/preload and
  MP4/assets.
- Privacy inventory: zero real `.env`, private-key, certificate, or credential
  files; public `.env.example` only.
- Startup evidence:
  `reports/v2-spatial-packaged-startup-20260823-v1.json`, SHA-256
  `E8721B9822BB9C5237275FF46773294753692781B3552C90ADF324D24F99A9B2`, PASS
  at 6,000 ms with no harness provider request or credential environment and
  process/profile cleanup PASS.

This provenance does not change the reference decisions above. Network-zero,
packaged live provider/model execution, and physical spatial pointer behavior
remain `NOT VERIFIED` / `MANUAL REVIEW REQUIRED`.

## V3–V6 reuse ledger (2026-08-23)

| Source/component | Owner / license | Mode | Actual use |
|---|---|---|---|
| Electron BrowserWindow/WebContentsView security APIs | OpenJS contributors / MIT | ADAPT | SOLAT-native isolated Browser Workspace; remote pages get no SOLAT preload or Node. |
| Stagehand | Browserbase / MIT | REFERENCE | Reviewed its observe/act/extract and deterministic-plus-AI targeting pattern. No package or code was imported because it would add a second browser-agent/model/cloud surface; SOLAT keeps the existing Qwen Agent and bounded Electron contracts. |
| Playwright | Microsoft / Apache-2.0 | REFERENCE | Reviewed resilient DOM targeting, actionability, contexts/tabs and tracing. No package, browser binary or code was imported because the active embedded Electron surface remains authoritative. |
| browser-use | browser-use / MIT | REFERENCE | Audited and rejected as a dependency: its Python/LLM/browser stack would duplicate SOLAT's existing Agent/provider/runtime. No code imported. |
| Qt WebEngine | Qt Project / commercial or LGPL/GPL terms plus Chromium notices | REFERENCE | Audited and rejected: a Qt browser would create a parallel UI/runtime and additional distribution obligations. No code imported. |
| Existing SOLAT Agent, ComputerTaskLoop, Qwen, vision, asset and Voice ports | SOLAT owner code | ADAPT | Remain the only reasoning/execution/provider path; V3–V6 add bounded tools/context, not a second brain. |
| `@mediapipe/tasks-vision` 1.0.1 | Google / Apache-2.0 | PORT | Sole new dependency; renderer-local HandLandmarker is adapted to provider-neutral landmarks. |
| Official Hand Landmarker task asset | Google MediaPipe / Apache-2.0 model card | PORT | Unchanged file from `https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task`; SHA-256 `FBC2A30080C3C557093B5DDFC334698132EB341044CCEE322CCF8BCF3607CDE1`; no runtime download. The official model card is linked in `THIRD_PARTY_NOTICES.md`; the package includes `LICENSES/Apache-2.0.txt`. |
| J.E.S.T.E.R | heeelol / no license found in audited repository | REFERENCE | Deeply reviewed 21-landmark adapter separation, palm-scale-normalized pinch, hold state and two-hand distance/angle transforms. SOLAT adapted concepts only and copied no source because no usable license was present; its versioned SpatialEvent, owner/session isolation, EMA and multi-frame hysteresis are SOLAT-native. |
| Iron-Man-Hologram | MalvXor / README says MIT; no LICENSE file found in audited tree | REFERENCE | Reviewed tracker-to-gesture-to-transport separation and smoothing concepts. Python/WebSocket/Three.js/YOLO code and hologram visuals were not imported. |
| Gesture Lab | quiet-node / MIT | REFERENCE | Reviewed on-device MediaPipe gesture vocabulary and interaction feedback; no Three.js/UI/assets/code/dependency imported. |
| Gesture | Gesture-App / no license found in audited repository | REFERENCE | Reviewed hands-as-general-input, bounded averaging/debounce and local transport concepts; no code/dependency imported. |
| Screenpipe | screenpipe / source-available commercial license | REFERENCE | Reviewed timestamped local interaction-history/privacy concepts only. Its continuous screen/audio recorder and source were not imported; SOLAT persists bounded semantic events instead of raw continuous media. |
| Relay | msllrs / PolyForm Shield | ADAPT | Reused only previously audited timing/reference-composition concepts for V6 event ordering; no Relay code or dependency copied. |
| SpatialAsset and Multimodal Fusion | SOLAT owner code | NEW | Immutable provenance, ghost/transfer/insertion, semantic fusion, persistence and reference resolution. |

No repository was copied wholesale. No provider credential, raw camera frame,
raw audio or third-party page content was added to source/evidence.
