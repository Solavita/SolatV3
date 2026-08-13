# SOLAT V2

SOLAT V2 is a clean Electron rebuild using the DeepSeek OpenAI-compatible API (`deepseek-v4-flash`) as its configured provider. V1 remains in the parent project as an archive/reference and is not imported into this app.

The post-Milestone 1 foundation includes versioned creative contracts and a first
Music-to-Deck planning path. Through secure IPC, the UI can submit a goal, audience,
slide count, and music anchor; the provider must return validated structured JSON;
SOLAT then creates Emotion DNA, a narrative plan, a design system, an editable
document model, and a quality report with a manual-review gate. A failed provider or
malformed plan never becomes a fake deck.

## Development

1. Install Node.js 20+.
2. Copy `.env.example` to `.env` and set the DeepSeek API key.
3. Run `npm install`.
4. Run `npm run dev`.

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
- One explicit DeepSeek smoke request passed through the provider boundary with
  `deepseek-v4-flash`; the key value was never printed or committed. The V4
  request explicitly selects non-thinking mode for stable normal chat.
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
  and recent context so DeepSeek can compare or ask for clarification without a
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
- Before sources reach DeepSeek or the visible source drawer, SOLAT now removes
  allowed-but-unrelated results, keeps canonical URL deduplication, and carries a
  bounded quality note. A comparison with separate evidence for each name is
  labelled as separate evidence rather than silently treating two entities as one.
- When a search snippet is insufficient, the model can request the bounded
  `web_read_page` tool for a URL already returned by the approved search path;
  URL allowlisting, timeout, text limits, and untrusted-page instructions remain
  enforced and page reads are reported separately from search results.
- Intent hints also include a bounded set of search-query variants for ambiguous
  hyphenated names and comparisons. They are advisory only: the full original
  user message and history stay intact, and DeepSeek still chooses whether and
  how to use the search tool.
- `npm.cmd run smoke:live-search -- --output artifacts\\live-search-smoke\\<timestamp>.json`
  runs one explicit owner-approved DeepSeek + search smoke case when both providers
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
