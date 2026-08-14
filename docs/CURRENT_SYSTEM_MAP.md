# Current system map — SOLAT V3

ตรวจ 2026-08-14 จาก source บน `D:\SOLAT_V3`.

- `src/core/provider.js`: OpenAI-compatible model adapter, response/tool-call validation, bounded tool loop, timeout/error mapping
- `src/core/conversation-core.js`: session-scoped conversation orchestration, full user message/history, search recovery and evidence merge
- `src/core/intent-router.js`: versioned advisory intent/context hints; model-first, no hard gate; query variants and reference resolution
- `src/core/web-search.js`: provider adapter boundary, allowlist, ranking/dedup, page-reader and degraded-state reporting
- `src/core/conversation-evaluator.js`: deterministic routing/evidence corpus evaluator
- `src/core/three-way-evaluator.js`: capture/structural comparison; semantic parity stays manual review
- `renderer/` + `src/preload.js` + `src/main.js`: UI/IPC boundary; renderer does not call providers directly
- `test/`: Node regression suite and UI contracts
- `evaluations/`: deterministic conversation/search and Model Foundation corpora

No Phase 0–4, Business Context, Commerce MVP or Google Classroom work is in scope
for the current Model Foundation iteration.
