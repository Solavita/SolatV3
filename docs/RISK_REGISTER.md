# Risk register — Model Foundation

อัปเดต 2026-08-14

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
