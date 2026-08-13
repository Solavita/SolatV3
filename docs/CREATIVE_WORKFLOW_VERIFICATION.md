# Creative workflow verification checkpoint

Date: 2026-08-11

Current status: `IMPLEMENTED BUT NOT FULLY VERIFIED`

## Verified behavior

The V2 path now has one real secure flow:

`music UI action -> preload IPC -> Electron main -> CreativeWorkflow -> provider structured JSON -> validated contracts -> deterministic layout diagnostics -> QualityReport -> UI result`

The workflow creates, in order:

1. `CreativeBrief`
2. versioned `EmotionProfile` / Emotion DNA
3. `NarrativePlan`
4. `DesignSystem`
5. editable `CreativeDocument`
6. `QualityReport` with `human_review_required: true`

`OpenAICompatibleProvider.completeStructured` requests JSON mode and rejects invalid
JSON or a non-object response. `SessionWorkspace` gives the job an idempotency key,
explicit state, retry classification, output requirement, and trace ID. The layout
engine assigns bounded fallback boxes only when the document omits one and rejects
overflow or unsafe geometry; it does not delete content silently.

## Exact deterministic evidence

- `npm.cmd run check` — PASS
- `npm.cmd test` — PASS, 34/34 tests
- `git diff --check` — PASS
- `npm.cmd run build` — PASS after stopping only the exact prior SOLAT packaged process tree

The tests cover valid creative planning, malformed structured provider output, project
and job transitions, idempotency/replay, owner/session isolation, immutable original
assets, document validation, deterministic layout, and the secure UI IPC boundary.

The conversation path now preserves the complete user message and prior turns while
adding versioned, non-authoritative intent hints. The provider adapter validates
OpenAI-compatible tool calls and bounds executor rounds; no hard intent gate replaces
the model's decision.

The optional `WebSearchService` is behind its own adapter boundary. It supports
configured SearXNG, Brave, DuckDuckGo, and Wikipedia providers, applies URL allowlist
and dedup/ranking rules, and returns truthful disabled/degraded/unavailable states.
Search remains disabled by default until the owner configures a provider.

## Not yet verified

- A real paid provider response using the creative JSON schema has not been used in
  this checkpoint; no cost is claimed here.
- `src/core/exporter.js` now produces a deterministic editable HTML export with a
  manifest, escaped content, explicit asset references, provenance, and lock metadata.
  Browser/UI opening and visual fidelity still require runtime review.
- Original asset bytes are persisted by `AssetStore` with owner/project isolation,
  SHA-256 integrity verification, immutable-original metadata, and deletion intent;
  export-level fidelity is not yet verified.
- Targeted revision, web search/citation grounding, audio analysis, and full benchmark
  corpus execution are not connected to this vertical slice.
- Visual quality, emotional quality, originality, and competition readiness remain
  `MANUAL REVIEW REQUIRED`.

Additional checkpoint: uploaded originals now pass through `AssetStore` behind
`solat:store-original-asset`; owner/project binding, SHA-256, immutable-original
metadata, and a relative storage reference are recorded. A completed creative result
is retained per session and can cross `solat:export-html` into an immutable-by-revision
editable HTML export. Visual fidelity and real packaged export opening remain
`MANUAL REVIEW REQUIRED`.
