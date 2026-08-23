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
