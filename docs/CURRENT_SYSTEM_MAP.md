# Current system map — SOLAT V3

ตรวจ 2026-08-22 จาก source บน `D:\SOLAT_V3`.

- `src/core/provider.js`: provider adapter, response/tool-call validation, bounded tool loop, timeout/error mapping; `ollama_local` uses native `/api/chat`, disables hidden reasoning, merges system messages at the transport boundary, and normalizes Ollama responses into SOLAT's provider contract
- `src/core/conversation-core.js`: session-scoped conversation orchestration, full user message/history, search recovery and evidence merge
- `src/core/intent-router.js`: versioned advisory intent/context hints; model-first, no hard gate; query variants and reference resolution
- `src/core/web-search.js`: provider adapter boundary, allowlist, ranking/dedup, page-reader and degraded-state reporting
- `src/core/conversation-evaluator.js`: deterministic routing/evidence corpus evaluator
- `src/core/three-way-evaluator.js`: capture/structural comparison; semantic parity stays manual review
- `src/core/model-router.js`: Auto/local Qwen/DeepSeek selection, compact local policy, fallback, per-attempt timing, and total routing timing metadata
- `src/core/computer-task-loop.js` + `src/core/computer-use-adapter.js`: deterministic browser/search fast path, semantic unknown-app inspection, application-local hotkeys, and verified postconditions; text-only providers do not capture unused screenshots
- `src/core/computer-task-loop.js`: every terminal failure emits a visible terminal event; deterministic Notepad and cross-app workflows retain exact user terms and stop boundedly
- `src/core/computer-use-adapter.js`: existing Chrome/app HWNDs are activated and reused where safe; YouTube selection has bounded direct-URL and semantic fallbacks with title/playback verification
- `src/core/computer-agent-tools.js`: bounded Computer Use registry including `computer_press_hotkey`
- `renderer/` + `src/preload.js` + `src/main.js`: UI/IPC boundary; renderer does not call providers directly. Computer-task progress is keyed by task and request, with terminal tombstones preventing delayed events from reviving stale UI state
- `scripts/run-computer-use-ui-15.js`: real Electron/CDP verification for 15 natural Computer Use commands; it opens only case prerequisites, captures evidence, and cleans up only the Electron process/profile it created
- `test/`: Node regression suite and UI contracts
- `evaluations/`: deterministic conversation/search and Model Foundation corpora

The source now has an optional SmolVLM GUI-grounding route, validated exact-window PNG input, a task/revision/HWND/hash/freshness boundary, and a UIA-first gate. Production sampling is adaptive and bounded to at most three frames, 500 ms apart, within two seconds; duplicate hashes stop the sampler and only the latest frame is sent. Vision remains disabled by default. The exact `pierretokns/smolvlm-500m-ccmcp-v1` Q4_K_M model and projector were installed and tested through both Ollama and llama.cpp, but returned image descriptions instead of valid grounding JSON on real SOLAT screenshots. Raw-coordinate click is not exposed because WinApp has no exact-HWND mouse-coordinate primitive and a safe DPI/client-rect binding is not implemented. Vision is therefore `BLOCKED`, not production-ready.

Latest verified development Computer Use evidence is `reports/computer-use-ui-15-full-final-v2-20260822.json`: 15/15 PASS with no timeout and 81.737 s summed terminal latency. The run includes Fast Path, exact browser searches, YouTube playback, Notepad edits, multi-HWND Calculator reading, cancellation recovery, cross-app return, ambiguity handling, and DeepSeek escalation. Plain SOLAT startup does not launch Chrome, Notepad or Calculator; those apps are opened only by an explicit user task or a selected live-test prerequisite.

Qwen 2B now has direct live evidence as a bounded controller. `reports/model-routing-qwen2-semantic-repair-final-20260822.json` passes 6/6 routes: Manual Qwen, Auto simple Qwen, a schema-valid local controller step, Manual DeepSeek, Auto complex DeepSeek, and failed-local fallback. Contradictory non-action/tool output receives one bounded local repair in Auto and then falls back; Manual Local fails visibly. The exact model averages 18.05 tok/s over 10 transport cases; the streamed runtime sample measured 3.211 s TTFT, 17.96 tok/s, 6.316 s total, peak Ollama working set 1,752,416,256 bytes, and system-used peak delta 1,691,062,272 bytes. Full regression passes 373/373; `npm run check` and `git diff --check` pass. `ollama list` and source search confirm the old Qwen 4B model/config are absent.

Latest verified packaged build is `D:\SOLAT_V3\dist-verified-20260822-full-prompt-final\win-unpacked\SOLAT.exe` (SHA-256 `D7807C916DF37C64F2E8205A8AE68BBE9244B23A14BA681527BDB67A6A63443D`, 225,441,792 bytes). The packaged runtime answered through Auto/Qwen in 5.739 s, launched no new Chrome/Notepad/Calculator process during plain startup, passed exact-query Chrome Fast Path in 4.118 s, and passed normal Notepad Computer Use in 4.279 s. Evidence is in `reports/packaged-qwen-smoke-full-prompt-final-20260822.json`, `reports/packaged-fast-path-full-prompt-final-20260822.json`, and `reports/packaged-computer-use-full-prompt-final-v2-20260822.json`. The app archive contains `.env.example` only, not `.env`; runtime secrets remain external. SmolVLM stays disabled because the accepted alternative is trusted UIA-first execution with DeepSeek escalation or visible failure.

No Phase 0–4, Business Context, Commerce MVP or Google Classroom work is in scope
for the current Model Foundation iteration.

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
